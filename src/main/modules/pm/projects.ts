// src/main/modules/pm/projects.ts
//
// PM Workbench (Phase 3b, Task 2) — Projects handler module.
//
// Surface (5 endpoints, wired in Task 17):
//   - POST   /v1/pm/projects        create
//   - GET    /v1/pm/projects        list  (?status=, ?limit=, ?offset=)
//   - GET    /v1/pm/projects/:id    detail
//   - PATCH  /v1/pm/projects/:id    update
//   - DELETE /v1/pm/projects/:id    delete (cascade)
//
// Authorization model:
//   - Caller must be a PM (user_type === 'pm'). Non-PMs get FORBIDDEN.
//   - All row-level operations (detail / update / delete) are scoped to
//     `caller.id` via the repo. "Not owned" maps to NOT_FOUND so we
//     never leak the existence of another PM's project.
//
// Validation:
//   - name is required, non-empty after trim, max 200 chars.
//   - status (if provided) must be one of the 5 enums.
//   - budget_total is non-negative integer.
//   - current_team is an array of { role, count }; role 1..100, count >= 0.
//   - start_at / end_at are unix milliseconds.
//
// Errors:
//   - Errors.forbidden(...)    — caller is not a PM
//   - Errors.invalidParams(...) — bad name / status / fields
//   - Errors.notFound(...)     — project missing OR not owned by caller

import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import {
  createProjectsRepo,
  type ProjectRow,
  type ProjectSummary,
} from '../../db/repositories/projects.js';
import { Errors } from '../../errors.js';
import {
  CreateProjectSchema,
  ListProjectsQuerySchema,
  ProjectStatusSchema,
  UpdateProjectSchema,
  type CreateProjectInput,
  type ListProjectsQuery,
  type UpdateProjectInput,
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

const NAME_MAX = 200;

/**
 * Shape returned by `getProject` — the project row, its positions and
 * plans, plus aggregate stats. Positions / plans are read via separate
 * prepared statements to keep the query plan simple (and to avoid
 * hammering the DB with a giant JOIN for projects with many positions).
 */
export interface ProjectDetail {
  project: ProjectRow;
  positions: ProjectPositionRow[];
  plans: StaffingPlanRow[];
  stats: {
    total_positions: number;
    filled_positions: number;
    total_plans: number;
    selected_plan_id: string | null;
  };
}

/** Subset of project_positions surfaced via the detail endpoint. */
export interface ProjectPositionRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  required_skills: string[];
  title_level: string | null;
  industry: string | null;
  salary_min: number | null;
  salary_max: number | null;
  status: 'open' | 'paused' | 'filled';
  headcount_planned: number;
  headcount_filled: number;
  created_at: number;
}

/** Subset of staffing_plans surfaced via the detail endpoint. */
export interface StaffingPlanRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  total_headcount: number;
  estimated_cost: number | null;
  positions_json: unknown[];
  is_selected: number;
  created_at: number;
}

export interface ProjectsModule {
  createProject(user: User, input: unknown): ProjectRow;
  listProjects(user: User, filter: unknown): { projects: ProjectSummary[]; total: number };
  getProject(user: User, id: string): ProjectDetail;
  updateProject(user: User, id: string, patch: unknown): ProjectRow;
  deleteProject(user: User, id: string): { deleted: true };
}

export function createProjectsHandler(db: DB): ProjectsModule {
  const repo = createProjectsRepo(db);

  /** Throw unless the caller is a PM. Centralizes the check. */
  function assertPm(user: User): void {
    if (!userTypeIs(user, 'pm')) {
      throw Errors.forbidden('Only PMs can manage projects');
    }
  }

  /**
   * Validate the project name. Empty / whitespace-only is invalid;
   * over 200 chars is invalid. Trim before length-check so trailing
   * spaces don't push us past the limit.
   */
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

  /** Strict-parse the create body; throws INVALID_PARAMS on failure. */
  function parseCreateInput(input: unknown): CreateProjectInput {
    const parsed = CreateProjectSchema.safeParse(input);
    if (!parsed.success) {
      throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
    }
    return parsed.data;
  }

  /** Strict-parse the update body; throws INVALID_PARAMS on failure. */
  function parseUpdateInput(input: unknown): UpdateProjectInput {
    const parsed = UpdateProjectSchema.safeParse(input);
    if (!parsed.success) {
      throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
    }
    return parsed.data;
  }

  /** Strict-parse the list query; throws INVALID_PARAMS on failure. */
  function parseListFilter(filter: unknown): ListProjectsQuery {
    const parsed = ListProjectsQuerySchema.safeParse(filter ?? {});
    if (!parsed.success) {
      throw Errors.invalidParams('Invalid query parameters', { issues: parsed.error.issues });
    }
    return parsed.data;
  }

  /**
   * Read the positions for a project. Returns a typed array with
   * `required_skills` parsed from JSON.
   */
  function readPositions(projectId: string): ProjectPositionRow[] {
    const rows = db.prepare(`
      SELECT id, project_id, title, description, required_skills_json,
             title_level, industry, salary_min, salary_max, status,
             headcount_planned, headcount_filled, created_at
      FROM project_positions
      WHERE project_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(projectId) as Array<{
      id: string;
      project_id: string;
      title: string;
      description: string | null;
      required_skills_json: string | null;
      title_level: string | null;
      industry: string | null;
      salary_min: number | null;
      salary_max: number | null;
      status: 'open' | 'paused' | 'filled';
      headcount_planned: number;
      headcount_filled: number;
      created_at: number;
    }>;
    return rows.map((r) => {
      let skills: string[] = [];
      if (r.required_skills_json) {
        try {
          const parsed = JSON.parse(r.required_skills_json);
          if (Array.isArray(parsed)) skills = parsed.map(String);
        } catch {
          skills = [];
        }
      }
      return {
        id: r.id,
        project_id: r.project_id,
        title: r.title,
        description: r.description,
        required_skills: skills,
        title_level: r.title_level,
        industry: r.industry,
        salary_min: r.salary_min,
        salary_max: r.salary_max,
        status: r.status,
        headcount_planned: r.headcount_planned,
        headcount_filled: r.headcount_filled,
        created_at: r.created_at,
      };
    });
  }

  /**
   * Read the staffing plans for a project. Returns a typed array with
   * `positions_json` parsed from JSON (left as `unknown[]` on the wire).
   */
  function readPlans(projectId: string): StaffingPlanRow[] {
    const rows = db.prepare(`
      SELECT id, project_id, name, description, total_headcount,
             estimated_cost, positions_json, is_selected, created_at
      FROM staffing_plans
      WHERE project_id = ?
      ORDER BY is_selected DESC, created_at ASC, id ASC
    `).all(projectId) as Array<{
      id: string;
      project_id: string;
      name: string;
      description: string | null;
      total_headcount: number;
      estimated_cost: number | null;
      positions_json: string;
      is_selected: number;
      created_at: number;
    }>;
    return rows.map((r) => {
      let positions: unknown[] = [];
      if (r.positions_json) {
        try {
          const parsed = JSON.parse(r.positions_json);
          if (Array.isArray(parsed)) positions = parsed;
        } catch {
          positions = [];
        }
      }
      return {
        id: r.id,
        project_id: r.project_id,
        name: r.name,
        description: r.description,
        total_headcount: r.total_headcount,
        estimated_cost: r.estimated_cost,
        positions_json: positions,
        is_selected: r.is_selected,
        created_at: r.created_at,
      };
    });
  }

  return {
    /**
     * Create a new project owned by the caller. The repo auto-creates
     * the default 5-stage staffing plan template; we return the project
     * row so the client doesn't need a follow-up GET.
     */
    createProject(user: User, input: unknown): ProjectRow {
      assertPm(user);
      const parsed = parseCreateInput(input);
      const name = validateName(parsed.name);
      return repo.insert({
        pm_user_id: user.id,
        name,
        target: parsed.target,
        budget_total: parsed.budget_total,
        start_at: parsed.start_at,
        end_at: parsed.end_at,
        current_team: parsed.current_team,
      });
    },

    /**
     * List the caller's projects. status filter is optional (exact match).
     * Pagination defaults to limit=20, offset=0. Returns the page + the
     * un-paginated total so the client can render a "page X of Y" control.
     */
    listProjects(user: User, filter: unknown): { projects: ProjectSummary[]; total: number } {
      assertPm(user);
      const parsed = parseListFilter(filter);
      return repo.list(user.id, parsed);
    },

    /**
     * Detail for a single project. NOT_FOUND for both "missing" and
     * "not owned" — we don't leak existence across PMs. The detail
     * includes the project's positions, plans, and aggregate stats.
     */
    getProject(user: User, id: string): ProjectDetail {
      assertPm(user);
      if (!id || typeof id !== 'string') {
        throw Errors.invalidParams('project_id is required');
      }
      const project = repo.findById(id, user.id);
      if (!project) throw Errors.notFound('Project not found');

      const positions = readPositions(project.id);
      const plans = readPlans(project.id);
      const selected = plans.find((p) => p.is_selected === 1) ?? null;

      const filledPositions = positions.reduce(
        (sum, p) => sum + (p.headcount_filled ?? 0),
        0,
      );

      return {
        project,
        positions,
        plans,
        stats: {
          total_positions: positions.length,
          filled_positions: filledPositions,
          total_plans: plans.length,
          selected_plan_id: selected ? selected.id : null,
        },
      };
    },

    /**
     * Patch mutable fields. NOT_FOUND for both "missing" and
     * "not owned". If `name` is being patched, we re-validate it.
     */
    updateProject(user: User, id: string, patch: unknown): ProjectRow {
      assertPm(user);
      if (!id || typeof id !== 'string') {
        throw Errors.invalidParams('project_id is required');
      }
      const parsed = parseUpdateInput(patch);
      // Re-validate name when it's being patched.
      if (parsed.name !== undefined) {
        parsed.name = validateName(parsed.name);
      }
      // Re-validate status via the enum schema (the Zod parse already
      // narrowed it, but a defensive double-check guards against future
      // refactors that bypass parseUpdateInput).
      if (parsed.status !== undefined) {
        const ok = ProjectStatusSchema.safeParse(parsed.status);
        if (!ok.success) {
          throw Errors.invalidParams('Invalid status', { field: 'status' });
        }
      }
      const ok = repo.update(id, user.id, parsed);
      if (!ok) throw Errors.notFound('Project not found');
      // Re-read to return the post-update row (with parsed current_team).
      const row = repo.findById(id, user.id);
      if (!row) {
        // Successful update but the row vanished — race with a
        // concurrent delete. Surface as 404.
        throw Errors.notFound('Project not found');
      }
      return row;
    },

    /**
     * Delete the project. FK cascade removes positions / plans /
     * decompositions / matches. NOT_FOUND for missing or not-owned.
     */
    deleteProject(user: User, id: string): { deleted: true } {
      assertPm(user);
      if (!id || typeof id !== 'string') {
        throw Errors.invalidParams('project_id is required');
      }
      const ok = repo.delete(id, user.id);
      if (!ok) throw Errors.notFound('Project not found');
      return { deleted: true };
    },
  };
}