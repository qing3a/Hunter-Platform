// src/main/modules/pm/plans.ts
//
// PM Workbench (Phase 3b, Task 7) — Staffing Plans handler module.
//
// Surface (6 endpoints, wired in Task 17):
//   - GET    /v1/pm/projects/:projectId/plans     list   (?limit=, ?offset=)
//   - POST   /v1/pm/projects/:projectId/plans     create
//   - GET    /v1/pm/plans/:id                     detail
//   - PATCH  /v1/pm/plans/:id                     update
//   - DELETE /v1/pm/plans/:id                     delete
//   - POST   /v1/pm/plans/:id/select              setSelected (uniqueness enforced in repo)
//
// Authorization model:
//   - Caller must be a PM (user_type === 'pm'). Non-PMs get FORBIDDEN.
//   - Row-level operations (detail / update / delete / select) are
//     scoped to the calling PM via a JOIN to `projects` in the repo
//     (`findByIdForPm`). "Not owned" maps to NOT_FOUND so we never
//     leak the existence of another PM's plans.
//   - Project-scoped operations (list / create) first verify the
//     project is owned by the caller via projects.findById; otherwise
//     NOT_FOUND.
//
// Uniqueness invariant:
//   `setSelected` calls repo.setSelected which wraps the
//   unselect-all + select-one writes in a BEGIN/COMMIT transaction.
//   Only one plan per project can have is_selected=1 at any time.

import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import {
  createStaffingPlansRepo,
  type PlanRow,
} from '../../db/repositories/staffing-plans.js';
import { createProjectsRepo } from '../../db/repositories/projects.js';
import { Errors } from '../../errors.js';
import {
  CreatePlanSchema,
  ListPlansQuerySchema,
  UpdatePlanSchema,
  type CreatePlanInput,
  type ListPlansQuery,
  type UpdatePlanInput,
} from '../../schemas/pm.js';

/**
 * Widened user_type for PM-only endpoints. Same pattern as positions.ts.
 */
type UserTypeExtended = User['user_type'] | 'pm';

/** Runtime check that the user is a PM (cast-and-narrow). */
function userTypeIs(user: User, t: UserTypeExtended): boolean {
  return (user.user_type as UserTypeExtended) === t;
}

const NAME_MAX = 200;

export interface PlansModule {
  listPlans(user: User, projectId: string, filter: unknown): { plans: PlanRow[]; total: number };
  createPlan(user: User, projectId: string, input: unknown): PlanRow;
  getPlan(user: User, planId: string): PlanRow;
  updatePlan(user: User, planId: string, patch: unknown): PlanRow;
  deletePlan(user: User, planId: string): { deleted: true };
  setSelectedPlan(user: User, planId: string): PlanRow;
}

export function createPlansHandler(db: DB): PlansModule {
  const repo = createStaffingPlansRepo(db);
  const projectsRepo = createProjectsRepo(db);

  /** Throw unless the caller is a PM. Centralizes the check. */
  function assertPm(user: User): void {
    if (!userTypeIs(user, 'pm')) {
      throw Errors.forbidden('Only PMs can manage staffing plans');
    }
  }

  /**
   * Verify the project exists AND is owned by the calling PM. Returns
   * the project_id on success; throws NOT_FOUND on any failure.
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
   * Look up a plan by id, scoped to the calling PM. Returns the row or
   * null; throws NOT_FOUND for "not found" AND "not owned" — caller
   * can't distinguish.
   */
  function findByIdForUser(user: User, planId: string): PlanRow {
    if (!planId || typeof planId !== 'string') {
      throw Errors.invalidParams('plan_id is required');
    }
    const row = repo.findByIdForPm(planId, user.id);
    if (!row) throw Errors.notFound('Plan not found');
    return row;
  }

  /** Strict-parse the create body; throws INVALID_PARAMS on failure. */
  function parseCreateInput(input: unknown): CreatePlanInput {
    const parsed = CreatePlanSchema.safeParse(input);
    if (!parsed.success) {
      throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
    }
    return parsed.data;
  }

  /** Strict-parse the update body; throws INVALID_PARAMS on failure. */
  function parseUpdateInput(input: unknown): UpdatePlanInput {
    const parsed = UpdatePlanSchema.safeParse(input);
    if (!parsed.success) {
      throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
    }
    return parsed.data;
  }

  /** Strict-parse the list query; throws INVALID_PARAMS on failure. */
  function parseListFilter(filter: unknown): ListPlansQuery {
    const parsed = ListPlansQuerySchema.safeParse(filter ?? {});
    if (!parsed.success) {
      throw Errors.invalidParams('Invalid query parameters', { issues: parsed.error.issues });
    }
    return parsed.data;
  }

  /** Trim + length-check the plan name; throws INVALID_PARAMS on failure. */
  function validateName(raw: unknown): string {
    if (typeof raw !== 'string') {
      throw Errors.invalidParams('name is required', { field: 'name' });
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      throw Errors.invalidParams('name cannot be empty', { field: 'name' });
    }
    if (trimmed.length > NAME_MAX) {
      throw Errors.invalidParams(
        `name too long (max ${NAME_MAX} chars)`,
        { field: 'name', max: NAME_MAX, actual: trimmed.length },
      );
    }
    return trimmed;
  }

  return {
    /**
     * List plans for a project owned by the caller. Pagination via
     * limit/offset (defaults mirror the repo's). Returns the page plus
     * the un-paginated total.
     */
    listPlans(user: User, projectId: string, filter: unknown): { plans: PlanRow[]; total: number } {
      assertPm(user);
      const project = assertProjectOwned(user, projectId);
      const parsed = parseListFilter(filter);
      return repo.listByProject(project, parsed);
    },

    /**
     * Create a draft plan under a project. Newly-created plans have
     * is_selected=0 (draft). To make this plan the selected one, call
     * setSelectedPlan — that path enforces the uniqueness invariant.
     */
    createPlan(user: User, projectId: string, input: unknown): PlanRow {
      assertPm(user);
      const project = assertProjectOwned(user, projectId);
      const parsed = parseCreateInput(input);
      const name = validateName(parsed.name);
      return repo.insert(project, {
        name,
        description: parsed.description ?? null,
        total_headcount: parsed.total_headcount,
        estimated_cost: parsed.estimated_cost ?? null,
        positions_json: parsed.positions_json ?? [],
      });
    },

    /**
     * Detail for a single plan. NOT_FOUND for both "missing" and
     * "not owned" — we don't leak existence across PMs.
     */
    getPlan(user: User, planId: string): PlanRow {
      assertPm(user);
      return findByIdForUser(user, planId);
    },

    /**
     * Patch mutable fields. NOT_FOUND for both "missing" and
     * "not owned". If `name` is being patched, we re-validate it.
     * Direct patching of is_selected is intentionally NOT exposed
     * here — callers must use setSelectedPlan so the unselect-all
     * + select-one writes run transactionally.
     */
    updatePlan(user: User, planId: string, patch: unknown): PlanRow {
      assertPm(user);
      // Pre-flight: ensure the plan is visible to this PM (scopes
      // by project ownership) and grab its project_id for the update.
      const existing = findByIdForUser(user, planId);
      const parsed = parseUpdateInput(patch);
      // Re-validate name when it's being patched.
      if (parsed.name !== undefined) {
        parsed.name = validateName(parsed.name);
      }
      const ok = repo.update(planId, existing.project_id, parsed);
      if (!ok) throw Errors.notFound('Plan not found');
      // Re-read to return the post-update row (with parsed
      // positions_json).
      const row = repo.findById(planId);
      if (!row) {
        // Successful update but the row vanished — race with a
        // concurrent delete. Surface as 404.
        throw Errors.notFound('Plan not found');
      }
      return row;
    },

    /**
     * Delete the plan. NOT_FOUND for missing or not-owned. The
     * default 5-stage plan auto-created on project create CAN be
     * deleted — the UI may want to replace it with a custom plan
     * before any positions are filled.
     */
    deletePlan(user: User, planId: string): { deleted: true } {
      assertPm(user);
      const existing = findByIdForUser(user, planId);
      const ok = repo.delete(planId, existing.project_id);
      if (!ok) throw Errors.notFound('Plan not found');
      return { deleted: true };
    },

    /**
     * Mark this plan as the project's selected plan. Uniqueness
     * (only one selected plan per project) is enforced atomically in
     * the repo via BEGIN/COMMIT — a failure on the select-one write
     * rolls back the unselect-all so the previously-selected plan
     * stays selected.
     */
    setSelectedPlan(user: User, planId: string): PlanRow {
      assertPm(user);
      const existing = findByIdForUser(user, planId);
      const row = repo.setSelected(planId, existing.project_id);
      if (!row) throw Errors.notFound('Plan not found');
      return row;
    },
  };
}