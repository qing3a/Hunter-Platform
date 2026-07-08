// src/main/schemas/pm.ts
//
// PM Workbench (Phase 3b) — Zod request/response schemas for /v1/pm/*.
//
// Conventions mirror src/main/schemas/headhunter-workspace.ts:
//   - Request bodies are .strict() — unknown keys cause a 400.
//   - Status enums use z.enum([...]) — strings must match exactly.
//   - All unix-ms timestamps are integers (z.number().int()).
//
// Task 2 covers only the Projects surface (5 endpoints). Future tasks
// (positions, staffing plans, decompositions, matches, notes) will append
// to this file. Routing is wired in Task 17; this file only declares
// the wire shapes.

import { z } from 'zod';

// ===== Shared primitives =====

/**
 * Project lifecycle. Five states; matches the CHECK constraint and
 * capability docs in src/main/capabilities/pm.ts.
 *   planning  — initial state on create
 *   active    — work has started
 *   paused    — temporarily on hold
 *   completed — done
 *   cancelled — abandoned (not deleted — kept for audit)
 */
export const ProjectStatusSchema = z.enum([
  'planning', 'active', 'paused', 'completed', 'cancelled',
]);

/** Single team member slot in `projects.current_team`. */
const TeamMemberSchema = z.object({
  role: z.string().min(1).max(100),
  count: z.number().int().nonnegative(),
}).strict();

/**
 * Mirrors `ProjectRow` in db/repositories/projects.ts.
 * `current_team` is stored as a JSON string in SQLite; we expose it as a
 * typed array on the wire and let the repo handle parse/stringify.
 *
 * `created_at` and `updated_at` are unix milliseconds.
 */
export const ProjectRowSchema = z.object({
  id: z.string(),
  pm_user_id: z.string(),
  name: z.string(),
  target: z.string().nullable(),
  budget_total: z.number().int().nullable(),
  /** unix ms */
  start_at: z.number().int().nullable(),
  /** unix ms */
  end_at: z.number().int().nullable(),
  current_team: z.array(TeamMemberSchema).nullable(),
  status: ProjectStatusSchema,
  /** unix ms */
  created_at: z.number().int(),
  /** unix ms */
  updated_at: z.number().int(),
}).strict();

/** List-row variant: Project + computed aggregates. */
export const ProjectSummarySchema = ProjectRowSchema.extend({
  position_count: z.number().int().nonnegative(),
  plan_count: z.number().int().nonnegative(),
}).strict();

// ===== Projects — request shapes =====

/** GET /v1/pm/projects?status=&limit=&offset= */
// Note: limit has no upper bound here — the repo clamps to 100 internally,
// so a client asking for limit=999 still gets up to 100 rows back instead of
// an INVALID_PARAMS rejection. We do still require >= 1 to avoid `LIMIT 0`.
export const ListProjectsQuerySchema = z.object({
  status: ProjectStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
}).strict();

/** POST /v1/pm/projects */
export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  target: z.string().max(2000).optional(),
  budget_total: z.number().int().nonnegative().optional(),
  /** unix ms */
  start_at: z.number().int().optional(),
  /** unix ms */
  end_at: z.number().int().optional(),
  current_team: z.array(TeamMemberSchema).optional(),
}).strict();

/** PATCH /v1/pm/projects/:id — partial of create + status */
export const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  target: z.string().max(2000).nullable().optional(),
  budget_total: z.number().int().nonnegative().nullable().optional(),
  /** unix ms */
  start_at: z.number().int().nullable().optional(),
  /** unix ms */
  end_at: z.number().int().nullable().optional(),
  current_team: z.array(TeamMemberSchema).nullable().optional(),
  status: ProjectStatusSchema.optional(),
}).strict();

/**
 * Inferred TypeScript types from the Zod schemas above. These are the
 * canonical handler-input types — handlers and the repo should reference
 * them instead of duplicating the shape with a redundant `as` cast.
 *
 * (Defined as `z.infer<...>` so the type stays in lock-step with the
 * schema; if the schema changes, the type changes automatically.)
 */
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
export type ListProjectsQuery = z.infer<typeof ListProjectsQuerySchema>;

// ===== Projects — response shapes =====

export const ProjectCreateResponseSchema = z.object({
  ok: z.literal(true),
  data: ProjectRowSchema,
}).strict();

export const ProjectListResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    projects: z.array(ProjectSummarySchema),
    total: z.number().int().nonnegative(),
  }),
}).strict();

/**
 * Staffing plan row — exposed inside the project detail response. Mirrors
 * the `staffing_plans` table (see v028 migration). We only declare the
 * fields actually returned; internal columns like `created_at` are
 * included for consistency with the rest of the API.
 */
const StaffingPlanSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  total_headcount: z.number().int().nonnegative(),
  estimated_cost: z.number().int().nullable(),
  /** JSON array of position definitions; left as `unknown[]` on the wire. */
  positions_json: z.array(z.unknown()),
  is_selected: z.number().int().min(0).max(1),
  created_at: z.number().int(),
}).strict();

/**
 * Position row — exposed inside the project detail response. Mirrors
 * `project_positions`. `required_skills_json` is a JSON array of strings.
 */
const ProjectPositionSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  required_skills: z.array(z.string()),
  title_level: z.string().nullable(),
  industry: z.string().nullable(),
  salary_min: z.number().int().nullable(),
  salary_max: z.number().int().nullable(),
  status: z.enum(['open', 'paused', 'filled', 'cancelled']),
  headcount_planned: z.number().int().nonnegative(),
  headcount_filled: z.number().int().nonnegative(),
  created_at: z.number().int(),
}).strict();

export const ProjectDetailResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    project: ProjectRowSchema,
    positions: z.array(ProjectPositionSchema),
    plans: z.array(StaffingPlanSchema),
    stats: z.object({
      total_positions: z.number().int().nonnegative(),
      filled_positions: z.number().int().nonnegative(),
      total_plans: z.number().int().nonnegative(),
      selected_plan_id: z.string().nullable(),
    }),
  }),
}).strict();

export const ProjectUpdateResponseSchema = z.object({
  ok: z.literal(true),
  data: ProjectRowSchema,
}).strict();

export const ProjectDeleteResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({ deleted: z.literal(true) }),
}).strict();