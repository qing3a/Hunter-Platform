// src/main/modules/pm/positions.ts
//
// PM Workbench (Phase 3b, Task 5) — Positions handler module.
//
// Surface (5 endpoints + 2 extras, wired in Task 17):
//   - POST   /v1/pm/projects/:projectId/positions      create
//   - GET    /v1/pm/projects/:projectId/positions      list
//   - POST   /v1/pm/projects/:projectId/positions/bulk bulk (Task 6 AI decompose)
//   - GET    /v1/pm/positions/:id                      detail (+ stats)
//   - PATCH  /v1/pm/positions/:id                      update
//   - DELETE /v1/pm/positions/:id                      delete
//   - GET    /v1/pm/projects/:projectId/positions/stats stats (Overview tab)
//
// Authorization model:
//   - Caller must be a PM (user_type === 'pm'). Non-PMs get FORBIDDEN.
//   - Row-level operations (detail / update / delete) are scoped to
//     `caller.id` via a JOIN to `projects` in the repo. "Not owned"
//     maps to NOT_FOUND so we never leak the existence of another
//     PM's positions.
//   - Project-scoped operations (create / list / bulk / stats) first
//     verify the project is owned by the caller; otherwise NOT_FOUND.
//
// Validation:
//   - title is required, non-empty after trim, max 200 chars.
//   - status (if provided) must be one of the 3 enums (open/paused/filled).
//   - headcount_planned >= 1; headcount_filled >= 0.
//   - required_skills is an array of 1..100-char strings, max 50 entries.
//   - salary_min / salary_max are non-negative integers.

import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import {
  createProjectPositionsRepo,
  type PositionRow,
  type PositionStats,
} from '../../db/repositories/project-positions.js';
import { createProjectsRepo } from '../../db/repositories/projects.js';
import { Errors } from '../../errors.js';
import {
  BulkCreatePositionsSchema,
  CreatePositionSchema,
  ListPositionsQuerySchema,
  PositionStatusSchema,
  UpdatePositionSchema,
  type BulkCreatePositionsInput,
  type CreatePositionInput,
  type ListPositionsQuery,
  type UpdatePositionInput,
} from '../../schemas/pm.js';

/**
 * Widened user_type for PM-only endpoints. The shared `User.user_type`
 * type currently lists three roles; PMs are minted via the OTP verify
 * path (which writes user_type='pm' at the DB layer) and exist in the
 * users table, so the runtime value can be 'pm' even though the
 * compile-time type is narrower. This local union is the boundary where
 * the cast happens; everywhere else we use the narrow User type.
 */
type UserTypeExtended = User['user_type'] | 'pm';

/** Runtime check that the user is a PM (cast-and-narrow). */
function userTypeIs(user: User, t: UserTypeExtended): boolean {
  return (user.user_type as UserTypeExtended) === t;
}

const TITLE_MAX = 200;

export interface PositionsModule {
  createPosition(user: User, projectId: string, input: unknown): PositionRow;
  listPositions(user: User, projectId: string, filter: unknown): { positions: PositionRow[]; total: number };
  getPosition(user: User, positionId: string): { position: PositionRow; stats: { headcount_planned: number; headcount_filled: number; is_complete: boolean } };
  updatePosition(user: User, positionId: string, patch: unknown): PositionRow;
  deletePosition(user: User, positionId: string): { deleted: true };
  bulkCreate(user: User, projectId: string, input: unknown): { positions: PositionRow[] };
  stats(user: User, projectId: string): PositionStats;
}

export function createPositionsHandler(db: DB): PositionsModule {
  const repo = createProjectPositionsRepo(db);
  const projectsRepo = createProjectsRepo(db);

  /** Throw unless the caller is a PM. Centralizes the check. */
  function assertPm(user: User): void {
    if (!userTypeIs(user, 'pm')) {
      throw Errors.forbidden('Only PMs can manage positions');
    }
  }

  /**
   * Verify the project exists AND is owned by the calling PM. Returns
   * the project_id on success; throws NOT_FOUND on any failure. Used
   * by the project-scoped endpoints (create / list / bulk / stats).
   */
  function assertProjectOwned(user: User, projectId: string): string {
    if (!projectId || typeof projectId !== 'string') {
      throw Errors.invalidParams('project_id is required');
    }
    const project = projectsRepo.findById(projectId, user.id);
    if (!project) throw Errors.notFound('Project not found');
    return project.id;
  }

  /**
   * Validate the position title. Empty / whitespace-only is invalid;
   * over 200 chars is invalid. Trimming happens upstream (Zod .min(1)
   * requires at least one non-whitespace char in practice via the
   * pre-trim check below).
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

  /** Strict-parse the create body; throws INVALID_PARAMS on failure. */
  function parseCreateInput(input: unknown): CreatePositionInput {
    const parsed = CreatePositionSchema.safeParse(input);
    if (!parsed.success) {
      throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
    }
    return parsed.data;
  }

  /** Strict-parse the update body; throws INVALID_PARAMS on failure. */
  function parseUpdateInput(input: unknown): UpdatePositionInput {
    const parsed = UpdatePositionSchema.safeParse(input);
    if (!parsed.success) {
      throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
    }
    return parsed.data;
  }

  /** Strict-parse the list query; throws INVALID_PARAMS on failure. */
  function parseListFilter(filter: unknown): ListPositionsQuery {
    const parsed = ListPositionsQuerySchema.safeParse(filter ?? {});
    if (!parsed.success) {
      throw Errors.invalidParams('Invalid query parameters', { issues: parsed.error.issues });
    }
    return parsed.data;
  }

  /** Strict-parse the bulk body; throws INVALID_PARAMS on failure. */
  function parseBulkInput(input: unknown): BulkCreatePositionsInput {
    const parsed = BulkCreatePositionsSchema.safeParse(input);
    if (!parsed.success) {
      throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
    }
    return parsed.data;
  }

  /**
   * Look up a position by id, scoped to the calling PM. Looks up the
   * position's project first (one extra query) so we can pass pm_user_id
   * to the repo's PM-aware find. Returns the row or null. Throws
   * NOT_FOUND for "not found" AND "not owned" — caller can't distinguish.
   */
  function findByIdForUser(user: User, positionId: string): PositionRow {
    if (!positionId || typeof positionId !== 'string') {
      throw Errors.invalidParams('position_id is required');
    }
    // Look up the project_id for this position. The position itself
    // doesn't carry a PM id, so we have to hop through projects to
    // verify ownership. We use a plain `SELECT project_id FROM
    // project_positions WHERE id = ?` first; if no row, NOT_FOUND.
    // If the row exists, we then check `projects.findById(pid, user.id)`
    // — which scopes the project to the PM.
    const projectId = db.prepare(
      'SELECT project_id FROM project_positions WHERE id = ?'
    ).get(positionId) as { project_id: string } | undefined;
    if (!projectId) throw Errors.notFound('Position not found');
    const project = projectsRepo.findById(projectId.project_id, user.id);
    if (!project) throw Errors.notFound('Position not found');
    const row = repo.findById(positionId, projectId.project_id);
    if (!row) throw Errors.notFound('Position not found');
    return row;
  }

  return {
    /**
     * Create a new position under a project. The project must be
     * owned by the caller (PM auth is also enforced).
     */
    createPosition(user: User, projectId: string, input: unknown): PositionRow {
      assertPm(user);
      const project = assertProjectOwned(user, projectId);
      const parsed = parseCreateInput(input);
      const title = validateTitle(parsed.title);
      return repo.insert(project, {
        title,
        description: parsed.description ?? null,
        required_skills: parsed.required_skills ?? null,
        title_level: parsed.title_level ?? null,
        industry: parsed.industry ?? null,
        salary_min: parsed.salary_min ?? null,
        salary_max: parsed.salary_max ?? null,
        headcount_planned: parsed.headcount_planned ?? 1,
      });
    },

    /**
     * List positions for a project owned by the caller. status filter
     * is optional (exact match). Pagination defaults to limit=20,
     * offset=0. Returns the page + un-paginated total.
     */
    listPositions(user: User, projectId: string, filter: unknown): { positions: PositionRow[]; total: number } {
      assertPm(user);
      const project = assertProjectOwned(user, projectId);
      const parsed = parseListFilter(filter);
      return repo.listByProject(project, parsed);
    },

    /**
     * Detail for a single position. Returns the row + a small
     * derived stats object (headcount_planned / headcount_filled /
     * is_complete). NOT_FOUND for both "missing" and "not owned".
     */
    getPosition(user: User, positionId: string): { position: PositionRow; stats: { headcount_planned: number; headcount_filled: number; is_complete: boolean } } {
      assertPm(user);
      const row = findByIdForUser(user, positionId);
      const isComplete = row.headcount_filled >= row.headcount_planned;
      return {
        position: row,
        stats: {
          headcount_planned: row.headcount_planned,
          headcount_filled: row.headcount_filled,
          is_complete: isComplete,
        },
      };
    },

    /**
     * Patch mutable fields. NOT_FOUND for both "missing" and
     * "not owned". If `title` is being patched, we re-validate it.
     */
    updatePosition(user: User, positionId: string, patch: unknown): PositionRow {
      assertPm(user);
      // Pre-flight: ensure the position is visible to this PM (scopes
      // by project ownership) and grab its project_id for the update.
      const existing = findByIdForUser(user, positionId);
      const parsed = parseUpdateInput(patch);
      // Re-validate title when it's being patched.
      if (parsed.title !== undefined) {
        parsed.title = validateTitle(parsed.title);
      }
      // Re-validate status via the enum schema (Zod already narrowed
      // it; this is defense in depth for future refactors that might
      // bypass parseUpdateInput).
      if (parsed.status !== undefined) {
        const ok = PositionStatusSchema.safeParse(parsed.status);
        if (!ok.success) {
          throw Errors.invalidParams('Invalid status', { field: 'status' });
        }
      }
      const ok = repo.update(positionId, existing.project_id, parsed);
      if (!ok) throw Errors.notFound('Position not found');
      // Re-read to return the post-update row (with parsed
      // required_skills).
      const row = repo.findById(positionId, existing.project_id);
      if (!row) {
        // Successful update but the row vanished — race with a
        // concurrent delete. Surface as 404.
        throw Errors.notFound('Position not found');
      }
      return row;
    },

    /**
     * Delete the position. NOT_FOUND for missing or not-owned.
     */
    deletePosition(user: User, positionId: string): { deleted: true } {
      assertPm(user);
      const existing = findByIdForUser(user, positionId);
      const ok = repo.delete(positionId, existing.project_id);
      if (!ok) throw Errors.notFound('Position not found');
      return { deleted: true };
    },

    /**
     * Bulk-insert positions. Used by Task 6's AI decompose path. The
     * project must be owned by the caller. Returns the freshly-inserted
     * rows in input order.
     */
    bulkCreate(user: User, projectId: string, input: unknown): { positions: PositionRow[] } {
      assertPm(user);
      const project = assertProjectOwned(user, projectId);
      const parsed = parseBulkInput(input);
      // Trim each item's title so callers can't smuggle whitespace-only
      // strings past the .min(1) check. The Zod schema is shared with
      // createPosition so we keep this consistent.
      const items = parsed.items.map((item) => ({
        ...item,
        title: validateTitle(item.title),
      }));
      const positions = repo.bulkInsert(project, items);
      return { positions };
    },

    /**
     * Aggregate stats for a project's positions. Powers the Overview
     * tab on ProjectDetailPage.
     */
    stats(user: User, projectId: string): PositionStats {
      assertPm(user);
      const project = assertProjectOwned(user, projectId);
      return repo.stats(project);
    },
  };
}
