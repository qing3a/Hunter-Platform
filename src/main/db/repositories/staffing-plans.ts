// src/main/db/repositories/staffing-plans.ts
//
// PM Workbench (Phase 3b, Task 7) — repository for the `staffing_plans`
// table (v028 migration). Factory pattern matching projects.ts /
// project-positions.ts: takes the shared DB handle and returns a
// closure-bound object with prepared statements.
//
// Design choices:
//   - Plans are scoped to a project (not directly to a PM). The PM
//     ownership check is enforced via a JOIN to `projects` in the
//     row-level methods (`findByIdForPm`, `update`, `delete`, `setSelected`).
//     This mirrors how the spec authorises access — a PM can only touch
//     plans belonging to a project they own.
//   - `positions_json` is a JSON column — parsed on read, stringified
//     on write. Malformed JSON is silently degraded to `[]` (same
//     pattern as projects.current_team / project_positions.required_skills_json).
//   - `setSelected` enforces uniqueness (only one selected plan per
//     project) by wrapping the unselect-all + select-one writes in
//     a single BEGIN/COMMIT transaction. A failure between the two
//     writes rolls back to the prior state instead of leaving the
//     project with two selected plans (or none).

import { randomUUID } from 'node:crypto';
import type { DB } from '../connection.js';

export interface PlanRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  total_headcount: number;
  estimated_cost: number | null;
  /**
   * On the wire / repo interface, this is a parsed array. On the DB
   * it's a JSON-stringified TEXT column. We always parse on read,
   * always stringify on write.
   */
  positions_json: PlanPositionSpec[];
  /** 0 = draft, 1 = selected (only one per project). */
  is_selected: number;
  /** unix ms */
  created_at: number;
}

/**
 * Entry inside `plans.positions_json`. Mirrors the per-position spec
 * used by Task 6's decompose handler's CommitDecompositionRequestSchema
 * (slimmed — no rationale / source-tracking needed once persisted as a
 * plan; the rationale lives on the position_decompositions audit row).
 */
export interface PlanPositionSpec {
  position_id: string;
  count: number;
}

export interface PlanInsert {
  name: string;
  description?: string | null | undefined;
  total_headcount?: number | undefined;
  estimated_cost?: number | null | undefined;
  positions_json?: PlanPositionSpec[] | undefined;
  /** 0 | 1. Defaults to 0 if not provided. */
  is_selected?: 0 | 1 | undefined;
}

export interface PlanUpdate {
  name?: string | undefined;
  description?: string | null | undefined;
  total_headcount?: number | undefined;
  estimated_cost?: number | null | undefined;
  positions_json?: PlanPositionSpec[] | null | undefined;
  is_selected?: 0 | 1 | undefined;
}

export interface PlanListFilter {
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface PlanListResult {
  plans: PlanRow[];
  total: number;
}

const LIST_LIMIT_DEFAULT = 20;
const LIST_LIMIT_MAX = 100;

/**
 * Hydrate a raw SQLite row into a typed `PlanRow`. Handles JSON parse
 * for `positions_json` (defensive — malformed JSON is degraded to `[]`).
 * Used by every read path.
 */
function rowFromDb(row: Record<string, unknown>): PlanRow {
  let positions: PlanPositionSpec[] = [];
  const raw = row.positions_json;
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        positions = parsed.map((p) => {
          if (p && typeof p === 'object') {
            const obj = p as Record<string, unknown>;
            return {
              position_id: typeof obj.position_id === 'string' ? obj.position_id : '',
              count: typeof obj.count === 'number' ? obj.count : 0,
            };
          }
          return { position_id: '', count: 0 };
        });
      }
    } catch {
      // Malformed JSON — degrade to empty array (matches the policy in
      // project-positions.ts and projects.ts for their respective JSON
      // columns).
      positions = [];
    }
  }
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    total_headcount: row.total_headcount as number,
    estimated_cost: (row.estimated_cost as number | null) ?? null,
    positions_json: positions,
    is_selected: row.is_selected as number,
    created_at: row.created_at as number,
  };
}

export function createStaffingPlansRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO staffing_plans (
      id, project_id, name, description, total_headcount,
      estimated_cost, positions_json, is_selected, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // findByIdForPm joins to projects so we can enforce PM ownership in
  // SQL (defense in depth — even if the handler forgets to filter, the
  // repo won't leak across PMs).
  const findByIdForPmStmt = db.prepare(`
    SELECT sp.* FROM staffing_plans sp
    JOIN projects p ON p.id = sp.project_id
    WHERE sp.id = ? AND p.pm_user_id = ?
  `);

  // Plain findById for repo-level tests / callers that already hold
  // a verified project context. Does NOT check PM ownership — callers
  // are expected to do that themselves.
  const findByIdStmt = db.prepare(
    'SELECT * FROM staffing_plans WHERE id = ?'
  );

  const countByProjectStmt = db.prepare(
    'SELECT COUNT(*) AS n FROM staffing_plans WHERE project_id = ?'
  );

  const deleteStmt = db.prepare(
    'DELETE FROM staffing_plans WHERE id = ? AND project_id = ?'
  );

  const unselectAllStmt = db.prepare(
    'UPDATE staffing_plans SET is_selected = 0 WHERE project_id = ?'
  );

  const selectOneStmt = db.prepare(
    'UPDATE staffing_plans SET is_selected = 1 WHERE id = ? AND project_id = ?'
  );

  const getSelectedStmt = db.prepare(
    'SELECT * FROM staffing_plans WHERE project_id = ? AND is_selected = 1 LIMIT 1'
  );

  return {
    /**
     * Insert a new staffing plan for `projectId`. Auto-generates id
     * (`plan_<uuid12>`), `is_selected=0` (drafts), `positions_json='[]'`,
     * and `created_at=now()`. Returns the freshly-inserted row.
     *
     * The caller (handler) is responsible for calling `setSelected`
     * afterwards if they want this plan to be the project's active
     * plan — that keeps the uniqueness invariant in one place.
     */
    insert(projectId: string, input: PlanInsert): PlanRow {
      const id = `plan_${randomUUID().slice(0, 12)}`;
      const now = Date.now();
      const positionsJson = JSON.stringify(input.positions_json ?? []);
      insertStmt.run(
        id,
        projectId,
        input.name,
        input.description ?? null,
        input.total_headcount ?? 0,
        input.estimated_cost ?? null,
        positionsJson,
        input.is_selected ?? 0,
        now,
      );
      const row = this.findById(id);
      if (!row) {
        // Should never happen — INSERT just succeeded.
        throw new Error(`staffing_plans.insert: failed to read back ${id}`);
      }
      return row;
    },

    /**
     * Plain find by id (no PM ownership check). Use `findByIdForPm`
     * from handler code. Returns null if the row doesn't exist.
     */
    findById(id: string): PlanRow | null {
      const row = findByIdStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) return null;
      return rowFromDb(row);
    },

    /**
     * Look up a single plan by id, scoped to the calling PM via JOIN
     * to `projects`. Returns null for both "row doesn't exist" and
     * "row exists but the project is owned by a different PM" — the
     * caller can't distinguish, which is the intended ownership
     * scoping behavior.
     */
    findByIdForPm(planId: string, pmUserId: string): PlanRow | null {
      const row = findByIdForPmStmt.get(planId, pmUserId) as Record<string, unknown> | undefined;
      if (!row) return null;
      return rowFromDb(row);
    },

    /**
     * List plans for a project, most-recent first (ties broken by id
     * DESC). The PM ownership scope is NOT enforced here — callers
     * (handlers) must first check that the project is owned by the
     * PM via projects.findById.
     *
     * Pagination: default 20, max 100, offset floored at 0. Returns
     * `{ plans, total }` where `total` is the un-paginated count for
     * the same filter.
     */
    listByProject(projectId: string, filter: PlanListFilter = {}): PlanListResult {
      const limit = Math.min(Math.max(filter.limit ?? LIST_LIMIT_DEFAULT, 1), LIST_LIMIT_MAX);
      const offset = Math.max(filter.offset ?? 0, 0);

      const totalRow = countByProjectStmt.get(projectId) as { n: number } | undefined;
      const total = totalRow?.n ?? 0;

      const rows = db.prepare(`
        SELECT * FROM staffing_plans
        WHERE project_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
      `).all(projectId, limit, offset) as Array<Record<string, unknown>>;

      return { plans: rows.map(rowFromDb), total };
    },

    /**
     * Patch mutable fields. Dynamic SQL: each present key is set in
     * the SET clause; absent keys are left untouched. For nullable
     * columns (description / estimated_cost / positions_json), `null`
     * in the patch means "clear this field".
     *
     * Note: this method does NOT enforce the "one selected plan per
     * project" invariant — callers wanting to flip is_selected must
     * go through `setSelected` instead so the unselect-all + select-one
     * writes run in one transaction.
     *
     * Returns true if a row was updated, false if no row matched
     * (id, project_id) — handler maps false to NOT_FOUND.
     */
    update(id: string, projectId: string, patch: PlanUpdate): boolean {
      const sets: string[] = [];
      const params: (string | number | null)[] = [];

      if (patch.name !== undefined) {
        sets.push('name = ?');
        params.push(patch.name);
      }
      if (patch.description !== undefined) {
        sets.push('description = ?');
        params.push(patch.description);
      }
      if (patch.total_headcount !== undefined) {
        sets.push('total_headcount = ?');
        params.push(patch.total_headcount);
      }
      if (patch.estimated_cost !== undefined) {
        sets.push('estimated_cost = ?');
        params.push(patch.estimated_cost);
      }
      if (patch.positions_json !== undefined) {
        sets.push('positions_json = ?');
        params.push(patch.positions_json === null ? null : JSON.stringify(patch.positions_json));
      }
      if (patch.is_selected !== undefined) {
        sets.push('is_selected = ?');
        params.push(patch.is_selected);
      }

      if (sets.length === 0) {
        // No-op patch — treat as success so the handler doesn't 404.
        // The handler re-reads the row regardless.
        return true;
      }

      params.push(id, projectId);
      const sql = `UPDATE staffing_plans SET ${sets.join(', ')} WHERE id = ? AND project_id = ?`;
      const result = db.prepare(sql).run(...params);
      return result.changes > 0;
    },

    /**
     * Delete the row. Returns true if a row was deleted, false if no
     * row matched (id, project_id). FK cascade is not relevant here
     * since nothing references staffing_plans (per v028 migration).
     */
    delete(id: string, projectId: string): boolean {
      const result = deleteStmt.run(id, projectId);
      return result.changes > 0;
    },

    /**
     * Mark this plan as the selected plan for its project, enforcing
     * the uniqueness invariant atomically:
     *
     *   1. UPDATE all plans WHERE project_id = ? SET is_selected = 0
     *   2. UPDATE the target plan SET is_selected = 1
     *
     * Both writes run inside an explicit BEGIN/COMMIT — if step 2
     * fails for any reason (no row matched id, FK violation, disk
     * fault), the unselect-all is rolled back so we don't leave the
     * project with no selected plan. Caller maps a no-row-match to
     * NOT_FOUND by checking the returned row.
     *
     * Returns the freshly-updated plan row, or null if no row
     * matched (id, project_id).
     */
    setSelected(planId: string, projectId: string): PlanRow | null {
      db.exec('BEGIN');
      try {
        unselectAllStmt.run(projectId);
        const selectResult = selectOneStmt.run(planId, projectId);
        if (selectResult.changes === 0) {
          // No row matched the (id, project_id) pair — roll back the
          // unselect-all so the previously-selected plan stays selected.
          db.exec('ROLLBACK');
          return null;
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      // Re-read the row so we return positions_json parsed and
      // values fresh-from-disk (defends against any drift between the
      // UPDATE and this read).
      return this.findById(planId);
    },

    /**
     * Get the currently-selected plan for a project, or null if no
     * plan is selected. Caller is expected to have already verified
     * PM ownership via projects.findById.
     */
    getSelected(projectId: string): PlanRow | null {
      const row = getSelectedStmt.get(projectId) as Record<string, unknown> | undefined;
      if (!row) return null;
      return rowFromDb(row);
    },

    /**
     * Bulk-clear is_selected across all plans in a project. Exposed
     * for callers (e.g. handlers) that want to "deselect all" without
     * selecting a specific plan. Wrapped in BEGIN/COMMIT to match
     * setSelected's transactional discipline (single write here, but
     * keeping the pattern uniform makes the call site easier to read).
     *
     * Returns the number of rows whose is_selected flag was cleared
     * (i.e. the count of plans that WERE selected before the call).
     */
    bulkUnselect(projectId: string): number {
      db.exec('BEGIN');
      try {
        const result = unselectAllStmt.run(projectId);
        db.exec('COMMIT');
        return Number(result.changes);
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}