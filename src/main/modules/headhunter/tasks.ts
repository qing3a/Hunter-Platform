// src/main/modules/headhunter/tasks.ts
//
// Hunter Workspace (Phase 3a, Task 3) — per-headhunter todo list handler.
//
// Authorization model:
//   - Caller must be a headhunter. Non-headhunters get FORBIDDEN.
//   - All row-level operations (update / complete / reopen / delete) are
//     scoped to `caller.id` via the repo. "Not owned" is mapped to
//     NOT_FOUND so we never leak the existence of another hunter's row.
//
// Validation:
//   - Title is required, non-empty after trim, and at most 200 chars.
//   - Priority (if provided) must be one of the four enums; the repo
//     coerces a missing value to 'normal'.
//
// Errors:
//   - Errors.forbidden(...)  — wrong user type
//   - Errors.invalidParams(...) — bad title (empty / over 200)
//   - Errors.notFound(...)  — task missing OR not owned by the caller
//
// HTTP routing for this module is wired in Task 7. The handler is invoked
// directly by the router (and by integration tests in this phase).

import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import {
  createHunterTasksRepo,
  type HunterTaskInsert,
  type HunterTaskListFilter,
  type HunterTaskRow,
  type HunterTaskUpdate,
} from '../../db/repositories/hunter-tasks.js';
import { Errors } from '../../errors.js';

const TITLE_MAX = 200;

export interface HunterTasksModule {
  list(user: User, filter?: HunterTaskListFilter): HunterTaskRow[];
  create(user: User, input: HunterTaskInsert): HunterTaskRow;
  update(user: User, taskId: string, patch: HunterTaskUpdate): HunterTaskRow;
  complete(user: User, taskId: string): HunterTaskRow;
  reopen(user: User, taskId: string): HunterTaskRow;
  delete(user: User, taskId: string): void;
}

export function createHunterTasks(db: DB): HunterTasksModule {
  const repo = createHunterTasksRepo(db);

  /** Throw unless the caller is a headhunter. Centralizes the check. */
  function assertHeadhunter(user: User): void {
    if (user.user_type !== 'hr') {
      throw Errors.forbidden('Only headhunters can manage tasks');
    }
  }

  /**
   * Validate the task title. Empty / whitespace-only is invalid; over
   * 200 chars is invalid. Trim before length-check so trailing spaces
   * don't push us past the limit.
   */
  function validateTitle(raw: unknown): string {
    if (typeof raw !== 'string') {
      throw Errors.invalidParams('title is required', { field: 'title' });
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      throw Errors.invalidParams('title cannot be empty', { field: 'title' });
    }
    if (trimmed.length > TITLE_MAX) {
      throw Errors.invalidParams(
        `title too long (max ${TITLE_MAX} chars)`,
        { field: 'title', max: TITLE_MAX, actual: trimmed.length },
      );
    }
    return trimmed;
  }

  return {
    /** List the caller's tasks. status filter defaults to 'pending'. */
    list(user: User, filter?: HunterTaskListFilter): HunterTaskRow[] {
      assertHeadhunter(user);
      return repo.list(user.id, filter ?? {});
    },

    /**
     * Create a new task for the caller. Title is validated; everything
     * else is optional. Returns the freshly-inserted row so the client
     * doesn't need a follow-up GET.
     */
    create(user: User, input: HunterTaskInsert): HunterTaskRow {
      assertHeadhunter(user);
      const title = validateTitle(input?.title);
      const id = repo.insert({
        ...input,
        hunter_user_id: user.id,
        title,
      });
      const row = repo.findById(id, user.id);
      // findById right after insert is guaranteed to succeed barring an
      // external wipe; a null here would be a programmer error.
      if (!row) {
        throw Errors.internal('Created task could not be read back');
      }
      return row;
    },

    /**
     * Patch mutable task fields. NOT_FOUND for both "missing" and
     * "not owned" — we don't leak existence across hunters.
     */
    update(user: User, taskId: string, patch: HunterTaskUpdate): HunterTaskRow {
      assertHeadhunter(user);
      if (!taskId || typeof taskId !== 'string') {
        throw Errors.invalidParams('task_id is required');
      }
      // Validate title length if it's being patched.
      if (patch && Object.prototype.hasOwnProperty.call(patch, 'title')) {
        patch = { ...patch, title: validateTitle(patch.title) };
      }
      const ok = repo.update(taskId, user.id, patch ?? {});
      if (!ok) throw Errors.notFound('Task not found');
      const row = repo.findById(taskId, user.id);
      // findById after a successful update always returns a row; null
      // would mean a concurrent delete, which is fine to surface as 404.
      if (!row) throw Errors.notFound('Task not found');
      return row;
    },

    /** Mark the task complete. NOT_FOUND when missing or not owned. */
    complete(user: User, taskId: string): HunterTaskRow {
      assertHeadhunter(user);
      if (!taskId || typeof taskId !== 'string') {
        throw Errors.invalidParams('task_id is required');
      }
      const row = repo.complete(taskId, user.id);
      if (!row) throw Errors.notFound('Task not found');
      return row;
    },

    /** Clear completed_at. NOT_FOUND when missing or not owned. */
    reopen(user: User, taskId: string): HunterTaskRow {
      assertHeadhunter(user);
      if (!taskId || typeof taskId !== 'string') {
        throw Errors.invalidParams('task_id is required');
      }
      const row = repo.reopen(taskId, user.id);
      if (!row) throw Errors.notFound('Task not found');
      return row;
    },

    /**
     * Delete the task. NOT_FOUND when the row doesn't exist or isn't
     * owned by the caller — same rationale as update / complete.
     */
    delete(user: User, taskId: string): void {
      assertHeadhunter(user);
      if (!taskId || typeof taskId !== 'string') {
        throw Errors.invalidParams('task_id is required');
      }
      const ok = repo.delete(taskId, user.id);
      if (!ok) throw Errors.notFound('Task not found');
    },
  };
}