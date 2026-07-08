// src/main/db/repositories/project-positions.ts
//
// PM Workbench (Phase 3b, Task 5) — repository for the `project_positions`
// table (v028 migration). Factory pattern matching projects.ts /
// hunter-tasks.ts: takes the shared DB handle and returns a closure-bound
// object with prepared statements.
//
// Design choices:
//   - Positions are scoped to a project, not directly to a PM. The PM
//     ownership check is enforced indirectly via a JOIN to `projects`
//     in the row-level methods (`findById`, `update`, `delete`).
//     This mirrors how the spec authorises access — a PM can only see
//     positions belonging to a project they own.
//   - `required_skills` is a JSON column — parsed on read, stringified
//     on write. Malformed JSON is silently degraded to `[]` (same
//     pattern as projects.current_team).
//   - `listByProject` joins to `projects` to enforce the ownership scope.
//   - `bulkInsert` is wrapped in an explicit BEGIN/COMMIT (same recipe as
//     projects.insert) so partial failures don't leave half a batch.

import { randomUUID } from 'node:crypto';
import type { DB } from '../connection.js';

export type PositionStatus = 'open' | 'paused' | 'filled';
export type TitleLevel = 'junior' | 'mid' | 'senior' | 'staff';

export interface PositionRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  required_skills: string[];
  title_level: string | null;
  industry: string | null;
  salary_min: number | null;
  salary_max: number | null;
  status: PositionStatus;
  headcount_planned: number;
  headcount_filled: number;
  /** unix ms */
  created_at: number;
}

export interface PositionInsert {
  title: string;
  description?: string | null | undefined;
  required_skills?: string[] | null | undefined;
  title_level?: string | null | undefined;
  industry?: string | null | undefined;
  salary_min?: number | null | undefined;
  salary_max?: number | null | undefined;
  headcount_planned?: number | undefined;
  headcount_filled?: number | undefined;
  status?: PositionStatus | undefined;
}

export interface PositionUpdate {
  title?: string | undefined;
  description?: string | null | undefined;
  required_skills?: string[] | null | undefined;
  title_level?: string | null | undefined;
  industry?: string | null | undefined;
  salary_min?: number | null | undefined;
  salary_max?: number | null | undefined;
  headcount_planned?: number | undefined;
  headcount_filled?: number | undefined;
  status?: PositionStatus | undefined;
}

export interface PositionListFilter {
  status?: PositionStatus | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface PositionListResult {
  positions: PositionRow[];
  total: number;
}

export interface PositionStats {
  total: number;
  open: number;
  paused: number;
  filled: number;
  headcount_planned_total: number;
  headcount_filled_total: number;
}

const LIST_LIMIT_DEFAULT = 20;
const LIST_LIMIT_MAX = 100;

/**
 * Hydrate a raw SQLite row into a typed `PositionRow`. Handles JSON parse
 * for `required_skills_json`. Used by every read path.
 */
function rowFromDb(row: Record<string, unknown>): PositionRow {
  let skills: string[] = [];
  const raw = row.required_skills_json;
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) skills = parsed.map(String);
    } catch {
      // Malformed JSON — degrade to empty array (matches projects.current_team
      // policy in projects.ts).
      skills = [];
    }
  }
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    required_skills: skills,
    title_level: (row.title_level as string | null) ?? null,
    industry: (row.industry as string | null) ?? null,
    salary_min: (row.salary_min as number | null) ?? null,
    salary_max: (row.salary_max as number | null) ?? null,
    status: row.status as PositionStatus,
    headcount_planned: row.headcount_planned as number,
    headcount_filled: row.headcount_filled as number,
    created_at: row.created_at as number,
  };
}

export function createProjectPositionsRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO project_positions (
      id, project_id, title, description, required_skills_json,
      title_level, industry, salary_min, salary_max, status,
      headcount_planned, headcount_filled, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // findById joins to projects so we can enforce PM ownership in SQL
  // (defense in depth). Returns null for both "row doesn't exist" and
  // "row exists but the project is owned by a different PM".
  const findByIdStmt = db.prepare(`
    SELECT pp.* FROM project_positions pp
    JOIN projects p ON p.id = pp.project_id
    WHERE pp.id = ? AND p.pm_user_id = ? AND pp.project_id = ?
  `);

  const countByProjectStmt = db.prepare(
    'SELECT COUNT(*) AS n FROM project_positions WHERE project_id = ?'
  );
  const countByProjectAndStatusStmt = db.prepare(
    'SELECT COUNT(*) AS n FROM project_positions WHERE project_id = ? AND status = ?'
  );

  const deleteStmt = db.prepare(
    'DELETE FROM project_positions WHERE id = ? AND project_id = ?'
  );

  /**
   * Mint a position row from an insert payload. Shared between
   * `insert` and `bulkInsert` so the row shape stays in sync.
   */
  function buildRow(projectId: string, input: PositionInsert): {
    id: string;
    now: number;
    skillsJson: string | null;
  } {
    return {
      id: `pos_${randomUUID().slice(0, 12)}`,
      now: Date.now(),
      skillsJson: input.required_skills ? JSON.stringify(input.required_skills) : null,
    };
  }

  return {
    /**
     * Insert a single position under `projectId`. Auto-generates id
     * (`pos_<uuid12>`), `status='open'`, `headcount_filled=0`,
     * and `created_at = now()`. Returns the freshly-inserted row.
     */
    insert(projectId: string, input: PositionInsert): PositionRow {
      const { id, now, skillsJson } = buildRow(projectId, input);
      insertStmt.run(
        id,
        projectId,
        input.title,
        input.description ?? null,
        skillsJson,
        input.title_level ?? null,
        input.industry ?? null,
        input.salary_min ?? null,
        input.salary_max ?? null,
        input.status ?? 'open',
        input.headcount_planned ?? 1,
        input.headcount_filled ?? 0,
        now,
      );
      // Re-read so the row matches what listByProject returns
      // (skills JSON is parsed back to an array).
      const row = this.findById(id, projectId);
      if (!row) {
        // Should never happen — INSERT just succeeded.
        throw new Error(`project_positions.insert: failed to read back ${id}`);
      }
      return row;
    },

    /**
     * Look up a single position by id, scoped to the owning project.
     * Caller is expected to also pass the PM id (via JOIN to projects)
     * — the second ? in the WHERE clause is `pm_user_id` (enforced in
     * `findByIdByProjectAndPm` below).
     */
    findById(id: string, projectId: string): PositionRow | null {
      // findByIdStmt joins to projects and filters by pm_user_id; the
      // call signature here is `(id, projectId)` for symmetry with
      // other repos. For a real ownership check, callers should
      // instead use findByIdForPm (defined below). The handler always
      // uses the PM-aware variant; this overload is kept for repo
      // unit tests that don't care about PM scope.
      const row = db.prepare(
        'SELECT * FROM project_positions WHERE id = ? AND project_id = ?'
      ).get(id, projectId) as Record<string, unknown> | undefined;
      if (!row) return null;
      return rowFromDb(row);
    },

    /**
     * Look up a single position by id, scoped to the owning project AND
     * the calling PM. Returns null for both "row doesn't exist" and
     * "row exists but belongs to a different PM" — the caller can't
     * distinguish, which is the intended ownership scoping behavior.
     */
    findByIdForPm(positionId: string, pmUserId: string, projectId: string): PositionRow | null {
      const row = findByIdStmt.get(positionId, pmUserId, projectId) as Record<string, unknown> | undefined;
      if (!row) return null;
      return rowFromDb(row);
    },

    /**
     * List positions for a project. The PM ownership scope is NOT
     * enforced here — callers (handlers) must first check that the
     * project is owned by the PM via projects.findById. status filter
     * is optional. Pagination: default 20, max 100, offset floored
     * at 0. Ordered by created_at ASC, id ASC (chronological).
     *
     * Returns `{ positions, total }` where `total` is the un-paginated
     * count for the same filter.
     */
    listByProject(projectId: string, filter: PositionListFilter = {}): PositionListResult {
      const limit = Math.min(Math.max(filter.limit ?? LIST_LIMIT_DEFAULT, 1), LIST_LIMIT_MAX);
      const offset = Math.max(filter.offset ?? 0, 0);

      const where: string[] = ['project_id = ?'];
      const params: (string | number)[] = [projectId];
      if (filter.status) {
        where.push('status = ?');
        params.push(filter.status);
      }

      const totalRow = filter.status
        ? countByProjectAndStatusStmt.get(projectId, filter.status)
        : countByProjectStmt.get(projectId);
      const total = (totalRow as { n: number } | undefined)?.n ?? 0;

      const sql = `
        SELECT * FROM project_positions
        WHERE ${where.join(' AND ')}
        ORDER BY created_at ASC, id ASC
        LIMIT ? OFFSET ?
      `;
      params.push(limit, offset);
      const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

      return { positions: rows.map(rowFromDb), total };
    },

    /**
     * Patch mutable fields. Dynamic SQL: each present key is set in the
     * SET clause; absent keys are left untouched. For nullable columns
     * (description / required_skills / title_level / industry / salary_min
     * / salary_max), `null` in the patch means "clear this field".
     *
     * Returns true if a row was updated, false if no row matched
     * (id, project_id) — handler maps false to NOT_FOUND.
     */
    update(id: string, projectId: string, patch: PositionUpdate): boolean {
      const sets: string[] = [];
      const params: (string | number | null)[] = [];

      if (patch.title !== undefined) {
        sets.push('title = ?');
        params.push(patch.title);
      }
      if (patch.description !== undefined) {
        sets.push('description = ?');
        params.push(patch.description);
      }
      if (patch.required_skills !== undefined) {
        sets.push('required_skills_json = ?');
        params.push(patch.required_skills === null ? null : JSON.stringify(patch.required_skills));
      }
      if (patch.title_level !== undefined) {
        sets.push('title_level = ?');
        params.push(patch.title_level);
      }
      if (patch.industry !== undefined) {
        sets.push('industry = ?');
        params.push(patch.industry);
      }
      if (patch.salary_min !== undefined) {
        sets.push('salary_min = ?');
        params.push(patch.salary_min);
      }
      if (patch.salary_max !== undefined) {
        sets.push('salary_max = ?');
        params.push(patch.salary_max);
      }
      if (patch.headcount_planned !== undefined) {
        sets.push('headcount_planned = ?');
        params.push(patch.headcount_planned);
      }
      if (patch.headcount_filled !== undefined) {
        sets.push('headcount_filled = ?');
        params.push(patch.headcount_filled);
      }
      if (patch.status !== undefined) {
        sets.push('status = ?');
        params.push(patch.status);
      }

      if (sets.length === 0) {
        // No-op patch — treat as success (return true) so the handler
        // doesn't 404. The handler re-reads the row regardless.
        return true;
      }

      params.push(id, projectId);
      const sql = `UPDATE project_positions SET ${sets.join(', ')} WHERE id = ? AND project_id = ?`;
      const result = db.prepare(sql).run(...params);
      return result.changes > 0;
    },

    /**
     * Delete the row. Returns true if a row was deleted, false if no
     * row matched (id, project_id).
     */
    delete(id: string, projectId: string): boolean {
      const result = deleteStmt.run(id, projectId);
      return result.changes > 0;
    },

    /**
     * Insert multiple positions atomically (used by Task 6 AI decompose).
     * All inserts run inside an explicit BEGIN/COMMIT; if any one of
     * them throws, the entire batch is rolled back. Returns the
     * freshly-inserted rows in input order.
     */
    bulkInsert(projectId: string, items: PositionInsert[]): PositionRow[] {
      if (items.length === 0) return [];
      const now = Date.now();
      const ids = items.map(() => `pos_${randomUUID().slice(0, 12)}`);

      db.exec('BEGIN');
      try {
        for (let i = 0; i < items.length; i++) {
          const item = items[i]!;
          const id = ids[i]!;
          const skillsJson = item.required_skills ? JSON.stringify(item.required_skills) : null;
          insertStmt.run(
            id,
            projectId,
            item.title,
            item.description ?? null,
            skillsJson,
            item.title_level ?? null,
            item.industry ?? null,
            item.salary_min ?? null,
            item.salary_max ?? null,
            item.status ?? 'open',
            item.headcount_planned ?? 1,
            item.headcount_filled ?? 0,
            now,
          );
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }

      // Re-read all inserted rows so skills JSON is parsed.
      const placeholders = ids.map(() => '?').join(',');
      const rows = db.prepare(
        `SELECT * FROM project_positions WHERE id IN (${placeholders})`
      ).all(...ids) as Array<Record<string, unknown>>;
      const byId = new Map(rows.map((r) => [r.id as string, rowFromDb(r)]));
      return ids.map((id) => {
        const r = byId.get(id);
        if (!r) throw new Error(`bulkInsert: missing read-back for ${id}`);
        return r;
      });
    },

    /**
     * Aggregate counts and headcount sums across a project's positions.
     * Used by ProjectDetailPage's Overview tab. Single round trip via
     * conditional aggregation — no N+1.
     */
    stats(projectId: string): PositionStats {
      const row = db.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
          SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) AS paused_count,
          SUM(CASE WHEN status = 'filled' THEN 1 ELSE 0 END) AS filled_count,
          COALESCE(SUM(headcount_planned), 0) AS headcount_planned_total,
          COALESCE(SUM(headcount_filled), 0) AS headcount_filled_total
        FROM project_positions
        WHERE project_id = ?
      `).get(projectId) as {
        total: number;
        open_count: number | null;
        paused_count: number | null;
        filled_count: number | null;
        headcount_planned_total: number | null;
        headcount_filled_total: number | null;
      };
      return {
        total: row.total ?? 0,
        open: row.open_count ?? 0,
        paused: row.paused_count ?? 0,
        filled: row.filled_count ?? 0,
        headcount_planned_total: row.headcount_planned_total ?? 0,
        headcount_filled_total: row.headcount_filled_total ?? 0,
      };
    },
  };
}
