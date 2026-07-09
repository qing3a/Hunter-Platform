// src/main/db/repositories/hunter-tasks.ts
//
// Repository for the hunter_tasks table (per-headhunter todos, v027).
// Factory function pattern matching notifications.ts: takes the shared DB
// handle and returns a closure-bound object with prepared statements.
//
// All methods that touch a specific row require the caller's hunter_user_id
// so the SQL itself enforces the ownership scope (defense in depth — even
// if the handler forgets to filter, the repo won't leak across hunters).

import { randomUUID } from 'node:crypto';
import type { DB } from '../connection.js';

export type HunterTaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type HunterTaskStatusFilter = 'pending' | 'completed' | 'all';

export interface HunterTaskRow {
  id: string;
  hunter_user_id: string;
  title: string;
  description: string | null;
  related_recommendation_id: string | null;
  related_candidate_user_id: string | null;
  /** unix ms */
  due_at: number | null;
  /** unix ms */
  completed_at: number | null;
  priority: HunterTaskPriority;
  /** unix ms */
  created_at: number;
  /** unix ms */
  updated_at: number;
}

export interface HunterTaskInsert {
  hunter_user_id: string;
  title: string;
  description?: string | null;
  related_recommendation_id?: string | null;
  related_candidate_user_id?: string | null;
  /** unix ms */
  due_at?: number | null;
  priority?: HunterTaskPriority;
}

export interface HunterTaskUpdate {
  title?: string;
  description?: string | null;
  /** unix ms */
  due_at?: number | null;
  priority?: HunterTaskPriority;
}

export interface HunterTaskListFilter {
  status?: HunterTaskStatusFilter;
  limit?: number;
  offset?: number;
}

const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MAX = 100;

export function createHunterTasksRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO hunter_tasks (
      id, hunter_user_id, title, description,
      related_recommendation_id, related_candidate_user_id,
      due_at, completed_at, priority,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
  `);

  const findByIdStmt = db.prepare('SELECT * FROM hunter_tasks WHERE id = ? AND hunter_user_id = ?');

  const updateStmt = db.prepare(`
    UPDATE hunter_tasks
    SET title = COALESCE(?, title),
        description = COALESCE(?, description),
        due_at = COALESCE(?, due_at),
        priority = COALESCE(?, priority),
        updated_at = ?
    WHERE id = ? AND hunter_user_id = ?
  `);

  const completeStmt = db.prepare(`
    UPDATE hunter_tasks
    SET completed_at = ?, updated_at = ?
    WHERE id = ? AND hunter_user_id = ?
  `);

  const reopenStmt = db.prepare(`
    UPDATE hunter_tasks
    SET completed_at = NULL, updated_at = ?
    WHERE id = ? AND hunter_user_id = ?
  `);

  const deleteStmt = db.prepare('DELETE FROM hunter_tasks WHERE id = ? AND hunter_user_id = ?');

  return {
    /**
     * Insert a new task. Auto-generates id (task_<uuid12>) and the
     * created_at / updated_at timestamps. `priority` defaults to 'normal'
     * when the caller omits it.
     */
    insert(input: HunterTaskInsert): string {
      const now = Date.now();
      const id = `task_${randomUUID().slice(0, 12)}`;
      const priority: HunterTaskPriority = input.priority ?? 'normal';
      insertStmt.run(
        id,
        input.hunter_user_id,
        input.title,
        input.description ?? null,
        input.related_recommendation_id ?? null,
        input.related_candidate_user_id ?? null,
        input.due_at ?? null,
        priority,
        now,
        now,
      );
      return id;
    },

    /**
     * Look up a single task, scoped to the owning hunter. Returns null
     * for both "row doesn't exist" and "row exists but belongs to a
     * different hunter" — the caller can't distinguish, which is what we
     * want for ownership scoping.
     */
    findById(id: string, hunterUserId: string): HunterTaskRow | null {
      const row = findByIdStmt.get(id, hunterUserId);
      return (row as HunterTaskRow | undefined) ?? null;
    },

    /**
     * List the caller's tasks.
     *
     *   status: pending | completed | all  (default 'pending')
     *   ORDER BY due_at ASC NULLS LAST, created_at DESC
     *
     * limit/offset are clamped: default 50, max 100, offset floored at 0.
     */
    list(hunterUserId: string, filter: HunterTaskListFilter = {}): HunterTaskRow[] {
      const status: HunterTaskStatusFilter = filter.status ?? 'pending';
      const where: string[] = ['hunter_user_id = ?'];
      const params: (string | number)[] = [hunterUserId];
      if (status === 'pending') {
        where.push('completed_at IS NULL');
      } else if (status === 'completed') {
        where.push('completed_at IS NOT NULL');
      }
      // status === 'all' → no extra filter.

      const limit = Math.min(Math.max(filter.limit ?? LIST_LIMIT_DEFAULT, 1), LIST_LIMIT_MAX);
      const offset = Math.max(filter.offset ?? 0, 0);

      // SQLite supports `NULLS LAST` natively (3.30+). Node 22 ships with
      // a recent enough SQLite that this is safe; falls back to a
      // CASE-based ordering otherwise (not needed here).
      const sql = `
        SELECT * FROM hunter_tasks
        WHERE ${where.join(' AND ')}
        ORDER BY (due_at IS NULL) ASC, due_at ASC, created_at DESC
        LIMIT ? OFFSET ?
      `;
      params.push(limit, offset);
      return db.prepare(sql).all(...params) as unknown as HunterTaskRow[];
    },

    /**
     * Patch the mutable task fields (title / description / due_at /
     * priority). Only fields present in `patch` are written; others are
     * left untouched via SQL COALESCE. updated_at is bumped to now.
     *
     * Returns true if a row was updated, false if no row matched
     * (either id missing or hunter_user_id mismatch — same semantics
     * either way to avoid leaking existence).
     */
    update(id: string, hunterUserId: string, patch: HunterTaskUpdate): boolean {
      const now = Date.now();
      const result = updateStmt.run(
        patch.title ?? null,
        patch.description ?? null,
        patch.due_at ?? null,
        patch.priority ?? null,
        now,
        id,
        hunterUserId,
      );
      return result.changes > 0;
    },

    /**
     * Mark the task complete: set completed_at = now, bump updated_at.
     * Returns the updated row (re-read for freshness), or null when no
     * row matched the (id, hunter_user_id) pair.
     */
    complete(id: string, hunterUserId: string): HunterTaskRow | null {
      const now = Date.now();
      const result = completeStmt.run(now, now, id, hunterUserId);
      if (result.changes === 0) return null;
      return this.findById(id, hunterUserId);
    },

    /**
     * Clear completed_at (re-open the task). updated_at is bumped to now.
     * Returns the updated row, or null when no row matched.
     */
    reopen(id: string, hunterUserId: string): HunterTaskRow | null {
      const now = Date.now();
      const result = reopenStmt.run(now, id, hunterUserId);
      if (result.changes === 0) return null;
      return this.findById(id, hunterUserId);
    },

    /**
     * Delete the row. Returns true if a row was deleted, false if no
     * row matched (so the handler can decide whether to surface a 404
     * or silently ignore).
     */
    delete(id: string, hunterUserId: string): boolean {
      const result = deleteStmt.run(id, hunterUserId);
      return result.changes > 0;
    },
  };
}