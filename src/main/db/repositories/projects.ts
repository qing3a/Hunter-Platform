// src/main/db/repositories/projects.ts
//
// PM Workbench (Phase 3b, Task 2) — repository for the `projects` table
// (v028 migration). Factory pattern matching notifications.ts / hunter-tasks.ts:
// takes the shared DB handle and returns a closure-bound object with
// prepared statements.
//
// Design choices:
//   - All methods that touch a single row require the caller's pm_user_id
//     so SQL itself enforces the ownership scope (defense in depth — even if
//     a handler forgets to filter, the repo won't leak across PMs).
//   - `current_team` is a JSON column — parsed on read, stringified on write.
//   - `list()` joins on (project_positions, staffing_plans) to compute
//     position_count / plan_count aggregates.
//   - `insert()` also seeds a default 5-stage staffing plan template so the
//     UI immediately has a selected plan to render.

import { randomUUID } from 'node:crypto';
import type { DB } from '../connection.js';

export type ProjectStatus =
  | 'planning' | 'active' | 'paused' | 'completed' | 'cancelled';

export interface TeamMember {
  role: string;
  count: number;
}

export interface ProjectRow {
  id: string;
  pm_user_id: string;
  name: string;
  target: string | null;
  budget_total: number | null;
  /** unix ms */
  start_at: number | null;
  /** unix ms */
  end_at: number | null;
  current_team: TeamMember[] | null;
  status: ProjectStatus;
  /** unix ms */
  created_at: number;
  /** unix ms */
  updated_at: number;
}

export interface ProjectInsert {
  pm_user_id: string;
  name: string;
  target?: string | null | undefined;
  budget_total?: number | null | undefined;
  /** unix ms */
  start_at?: number | null | undefined;
  /** unix ms */
  end_at?: number | null | undefined;
  current_team?: TeamMember[] | null | undefined;
}

export interface ProjectUpdate {
  name?: string | undefined;
  target?: string | null | undefined;
  budget_total?: number | null | undefined;
  /** unix ms */
  start_at?: number | null | undefined;
  /** unix ms */
  end_at?: number | null | undefined;
  current_team?: TeamMember[] | null | undefined;
  status?: ProjectStatus | undefined;
}

export interface ProjectListFilter {
  status?: ProjectStatus | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface ProjectSummary extends ProjectRow {
  position_count: number;
  plan_count: number;
}

export interface ProjectListResult {
  projects: ProjectSummary[];
  total: number;
}

const LIST_LIMIT_DEFAULT = 20;
const LIST_LIMIT_MAX = 100;

/**
 * Sentinel staffing-plan id prefix used to mint the auto-created default
 * plan. Matches the per-resource prefix convention used elsewhere
 * (proj_<uuid12>, plan_<uuid12>, ...).
 */
const DEFAULT_PLAN_NAME = '默认计划 (5 阶段漏斗)';

/**
 * Hydrate a raw SQLite row into a typed `ProjectRow`. Handles JSON parse
 * for the `current_team` column. Used by every read path.
 */
function rowFromDb(row: Record<string, unknown>): ProjectRow {
  let current_team: TeamMember[] | null = null;
  const raw = row.current_team;
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        current_team = parsed as TeamMember[];
      }
    } catch {
      // Malformed JSON — surface as null rather than 500. Handler can
      // decide to flag the row if desired; for now we silently degrade
      // (matches the candidate-portal-profile.ts pattern for malformed
      // skills_json / expectations_json).
      current_team = null;
    }
  }
  return {
    id: row.id as string,
    pm_user_id: row.pm_user_id as string,
    name: row.name as string,
    target: (row.target as string | null) ?? null,
    budget_total: (row.budget_total as number | null) ?? null,
    start_at: (row.start_at as number | null) ?? null,
    end_at: (row.end_at as number | null) ?? null,
    current_team,
    status: row.status as ProjectStatus,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
  };
}

export function createProjectsRepo(db: DB) {
  const insertProjectStmt = db.prepare(`
    INSERT INTO projects (
      id, pm_user_id, name, target, budget_total,
      start_at, end_at, current_team, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertDefaultPlanStmt = db.prepare(`
    INSERT INTO staffing_plans (
      id, project_id, name, description, total_headcount,
      estimated_cost, positions_json, is_selected, created_at
    ) VALUES (?, ?, ?, NULL, 0, NULL, '[]', 1, ?)
  `);

  const findByIdStmt = db.prepare(
    'SELECT * FROM projects WHERE id = ? AND pm_user_id = ?'
  );

  const countByPmStmt = db.prepare(
    'SELECT COUNT(*) AS n FROM projects WHERE pm_user_id = ?'
  );
  const countByPmAndStatusStmt = db.prepare(
    'SELECT COUNT(*) AS n FROM projects WHERE pm_user_id = ? AND status = ?'
  );

  // NOTE: `update` builds dynamic SQL based on which patch keys are present.
  // We can't use a static prepared statement because SQLite cannot bind
  // `undefined` parameters and some columns (target / current_team /
  // budget_total / start_at / end_at) use `null` to mean "clear this
  // field", distinct from "leave unchanged". Per-field COALESCE would not
  // distinguish those cases. Dynamic SQL is simpler and the cost is one
  // prepare() per update — acceptable for a low-frequency PM endpoint.

  const deleteStmt = db.prepare(
    'DELETE FROM projects WHERE id = ? AND pm_user_id = ?'
  );

  /**
   * Helper: count positions for a set of project ids in one round trip.
   * Returns a map keyed by project_id so the caller can join in JS
   * without N+1 queries.
   */
  function countPositionsFor(projectIds: string[]): Map<string, number> {
    const map = new Map<string, number>();
    if (projectIds.length === 0) return map;
    // Build a parameterized IN clause.
    const placeholders = projectIds.map(() => '?').join(',');
    const stmt = db.prepare(
      `SELECT project_id, COUNT(*) AS n FROM project_positions
       WHERE project_id IN (${placeholders})
       GROUP BY project_id`
    );
    const rows = stmt.all(...projectIds) as Array<{ project_id: string; n: number }>;
    for (const r of rows) map.set(r.project_id, r.n);
    return map;
  }

  function countPlansFor(projectIds: string[]): Map<string, number> {
    const map = new Map<string, number>();
    if (projectIds.length === 0) return map;
    const placeholders = projectIds.map(() => '?').join(',');
    const stmt = db.prepare(
      `SELECT project_id, COUNT(*) AS n FROM staffing_plans
       WHERE project_id IN (${placeholders})
       GROUP BY project_id`
    );
    const rows = stmt.all(...projectIds) as Array<{ project_id: string; n: number }>;
    for (const r of rows) map.set(r.project_id, r.n);
    return map;
  }

  return {
    /**
     * Insert a new project owned by `pmUserId` and seed the default 5-stage
     * staffing plan template. Auto-generates id (proj_<uuid12>) and
     * created_at / updated_at timestamps.
     *
     * The default plan is created with `is_selected = 1` because it's the
     * only plan for the project; subsequent plans will start as drafts.
     *
     * `current_team` (if provided) is JSON-stringified for storage.
     *
     * Returns the freshly-inserted project row.
     */
    insert(input: ProjectInsert): ProjectRow {
      const now = Date.now();
      const id = `proj_${randomUUID().slice(0, 12)}`;
      const teamJson = input.current_team ? JSON.stringify(input.current_team) : null;
      insertProjectStmt.run(
        id,
        input.pm_user_id,
        input.name,
        input.target ?? null,
        input.budget_total ?? null,
        input.start_at ?? null,
        input.end_at ?? null,
        teamJson,
        'planning',
        now,
        now,
      );

      // Seed the default 5-stage plan template.
      const planId = `plan_${randomUUID().slice(0, 12)}`;
      insertDefaultPlanStmt.run(planId, id, DEFAULT_PLAN_NAME, now);

      // Re-read to return a fully-hydrated row (ensures current_team is
      // parsed the same way as a subsequent findById()).
      const row = this.findById(id, input.pm_user_id);
      if (!row) {
        // Should never happen — INSERT just succeeded.
        throw new Error(`projects.insert: failed to read back ${id}`);
      }
      return row;
    },

    /**
     * Look up a single project, scoped to the owning PM. Returns null
     * for both "row doesn't exist" and "row exists but belongs to a
     * different PM" — the caller can't distinguish, which is the
     * intended ownership scoping behavior.
     */
    findById(id: string, pmUserId: string): ProjectRow | null {
      const row = findByIdStmt.get(id, pmUserId) as Record<string, unknown> | undefined;
      if (!row) return null;
      return rowFromDb(row);
    },

    /**
     * List the caller's projects. status filter is optional (exact match).
     * Pagination: default 20, max 100, offset floored at 0.
     * Ordered by created_at DESC. Each row is augmented with
     * `position_count` (from project_positions) and `plan_count`
     * (from staffing_plans).
     *
     * Returns `{ projects, total }` where `total` is the un-paginated
     * count for the same filter — the caller can use it to render a
     * "page X of Y" control.
     */
    list(pmUserId: string, filter: ProjectListFilter = {}): ProjectListResult {
      const limit = Math.min(Math.max(filter.limit ?? LIST_LIMIT_DEFAULT, 1), LIST_LIMIT_MAX);
      const offset = Math.max(filter.offset ?? 0, 0);

      const where: string[] = ['pm_user_id = ?'];
      const params: (string | number)[] = [pmUserId];
      if (filter.status) {
        where.push('status = ?');
        params.push(filter.status);
      }

      const totalRow = filter.status
        ? countByPmAndStatusStmt.get(pmUserId, filter.status)
        : countByPmStmt.get(pmUserId);
      const total = (totalRow as { n: number } | undefined)?.n ?? 0;

      const sql = `
        SELECT * FROM projects
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
      `;
      params.push(limit, offset);
      const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

      const projects = rows.map(rowFromDb);
      const ids = projects.map((p) => p.id);
      const positionCounts = countPositionsFor(ids);
      const planCounts = countPlansFor(ids);

      const summaries: ProjectSummary[] = projects.map((p) => ({
        ...p,
        position_count: positionCounts.get(p.id) ?? 0,
        plan_count: planCounts.get(p.id) ?? 0,
      }));

      return { projects: summaries, total };
    },

    /**
     * Patch mutable fields. Dynamic SQL: each present key is set in the
     * SET clause; absent keys are left untouched. For nullable columns
     * (target / budget_total / start_at / end_at / current_team), `null`
     * in the patch means "clear this field" (write NULL to the column).
     * updated_at is bumped to now unconditionally.
     *
     * Returns true if a row was updated, false if no row matched the
     * (id, pm_user_id) pair (handler maps false to NOT_FOUND).
     */
    update(id: string, pmUserId: string, patch: ProjectUpdate): boolean {
      const now = Date.now();
      const sets: string[] = [];
      const params: (string | number | null)[] = [];

      if (patch.name !== undefined) {
        sets.push('name = ?');
        params.push(patch.name);
      }
      if (patch.target !== undefined) {
        sets.push('target = ?');
        params.push(patch.target);
      }
      if (patch.budget_total !== undefined) {
        sets.push('budget_total = ?');
        params.push(patch.budget_total);
      }
      if (patch.start_at !== undefined) {
        sets.push('start_at = ?');
        params.push(patch.start_at);
      }
      if (patch.end_at !== undefined) {
        sets.push('end_at = ?');
        params.push(patch.end_at);
      }
      if (patch.current_team !== undefined) {
        sets.push('current_team = ?');
        params.push(patch.current_team === null ? null : JSON.stringify(patch.current_team));
      }
      if (patch.status !== undefined) {
        sets.push('status = ?');
        params.push(patch.status);
      }

      // Always bump updated_at.
      sets.push('updated_at = ?');
      params.push(now);

      // WHERE clause + bind.
      params.push(id, pmUserId);

      const sql = `UPDATE projects SET ${sets.join(', ')} WHERE id = ? AND pm_user_id = ?`;
      const result = db.prepare(sql).run(...params);
      return result.changes > 0;
    },

    /**
     * Delete the row. Returns true if a row was deleted, false if no
     * row matched. Positions / plans are removed by FK cascade (the
     * project_positions / staffing_plans tables declare
     * `ON DELETE CASCADE` on project_id in v028).
     */
    delete(id: string, pmUserId: string): boolean {
      const result = deleteStmt.run(id, pmUserId);
      return result.changes > 0;
    },
  };
}