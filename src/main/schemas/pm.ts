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

// ===== Positions (Task 5) =====
//
// Positions belong to a project; they are PM-managed role definitions with
// skills / level / salary / headcount / status. Storage is in
// `project_positions` (see v028 migration). The four-state lifecycle is
// narrower than the project's five-state one — positions don't have
// "cancelled" surfaced on the wire (DB still allows it for parity with
// future migrations). Task 5 introduces a separate, more limited enum
// (open / paused / filled) and a `cancelled` state is NOT exposed via
// the API surface until later work (matching/migration tasks may add it).

/**
 * Position lifecycle. Three states on the wire (the DB CHECK constraint
 * also allows 'cancelled' for forward-compat but the handler does not
 * surface it).
 *   open    — default; can be matched / filled
 *   paused  — temporarily not accepting candidates
 *   filled  — all planned headcount is filled
 */
export const PositionStatusSchema = z.enum(['open', 'paused', 'filled']);

/** Title seniority band. Optional — unlevelled positions are allowed. */
export const TitleLevelSchema = z.enum(['junior', 'mid', 'senior', 'staff']);

/** Single position response row — mirrors `project_positions`. */
export const PositionRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  required_skills: z.array(z.string()),
  title_level: z.string().nullable(),
  industry: z.string().nullable(),
  salary_min: z.number().int().nullable(),
  salary_max: z.number().int().nullable(),
  status: PositionStatusSchema,
  headcount_planned: z.number().int().nonnegative(),
  headcount_filled: z.number().int().nonnegative(),
  /** unix ms */
  created_at: z.number().int(),
}).strict();

/** Position + derived stats (used by GET /v1/pm/positions/:id). */
export const PositionDetailSchema = z.object({
  position: PositionRowSchema,
  stats: z.object({
    headcount_planned: z.number().int().nonnegative(),
    headcount_filled: z.number().int().nonnegative(),
    /** headcount_filled >= headcount_planned (and status === 'filled' if you want to gate UI). */
    is_complete: z.boolean(),
  }),
}).strict();

/** GET /v1/pm/projects/:projectId/positions?status=&limit=&offset= */
export const ListPositionsQuerySchema = z.object({
  status: PositionStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
}).strict();

/** POST /v1/pm/projects/:projectId/positions */
export const CreatePositionSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  required_skills: z.array(z.string().min(1).max(100)).max(50).optional(),
  title_level: TitleLevelSchema.optional(),
  industry: z.string().max(100).optional(),
  salary_min: z.number().int().nonnegative().optional(),
  salary_max: z.number().int().nonnegative().optional(),
  headcount_planned: z.number().int().min(1).default(1),
}).strict();

/** PATCH /v1/pm/positions/:id — partial of create + status + headcount_filled */
export const UpdatePositionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  required_skills: z.array(z.string().min(1).max(100)).max(50).nullable().optional(),
  title_level: TitleLevelSchema.nullable().optional(),
  industry: z.string().max(100).nullable().optional(),
  salary_min: z.number().int().nonnegative().nullable().optional(),
  salary_max: z.number().int().nonnegative().nullable().optional(),
  headcount_planned: z.number().int().min(1).optional(),
  headcount_filled: z.number().int().nonnegative().optional(),
  status: PositionStatusSchema.optional(),
}).strict();

/** POST /v1/pm/projects/:projectId/positions/bulk — body for AI decompose path. */
export const BulkCreatePositionsSchema = z.object({
  items: z.array(CreatePositionSchema).min(1).max(50),
}).strict();

/** Aggregate stats for a project's positions (used by ProjectDetailPage Overview tab). */
export const PositionStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  paused: z.number().int().nonnegative(),
  filled: z.number().int().nonnegative(),
  headcount_planned_total: z.number().int().nonnegative(),
  headcount_filled_total: z.number().int().nonnegative(),
}).strict();

export type CreatePositionInput = z.infer<typeof CreatePositionSchema>;
export type UpdatePositionInput = z.infer<typeof UpdatePositionSchema>;
export type ListPositionsQuery = z.infer<typeof ListPositionsQuerySchema>;
export type BulkCreatePositionsInput = z.infer<typeof BulkCreatePositionsSchema>;
export type PositionStats = z.infer<typeof PositionStatsSchema>;

// ===== Positions — response shapes =====

export const PositionCreateResponseSchema = z.object({
  ok: z.literal(true),
  data: PositionRowSchema,
}).strict();

export const PositionListResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    positions: z.array(PositionRowSchema),
    total: z.number().int().nonnegative(),
  }),
}).strict();

export const PositionUpdateResponseSchema = z.object({
  ok: z.literal(true),
  data: PositionRowSchema,
}).strict();

export const PositionDeleteResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({ deleted: z.literal(true) }),
}).strict();

export const PositionBulkCreateResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    positions: z.array(PositionRowSchema),
  }),
}).strict();

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
 *
 * Reuses `PositionRowSchema` (defined above) so the wire shape is the
 * same here and on the dedicated positions endpoints.
 */
const ProjectPositionSchema = PositionRowSchema;

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

// ===== AI Decompose (Task 6) =====
//
// The PM clicks "智能拆岗位" → we run the keyword heuristic on the project's
// `target` text → return suggested positions + persist a history row. The UI
// then lets the PM edit the suggestions inline before committing (which
// bulk-creates the actual `project_positions` rows).
//
// Two endpoints:
//   - POST /v1/pm/projects/:projectId/decompose
//       → runs heuristic, stores history, returns suggestions to preview
//   - POST /v1/pm/projects/:projectId/decompose/:decompositionId/commit
//       → bulk-creates the positions recorded in the decomposition row
//
// Response shapes mirror `PositionRowSchema` for the commit payload (so the
// UI can refresh its position table in place).

/** Mirrors DecomposedPosition in src/main/lib/ai-decompose.ts. */
export const DecomposedPositionSchema = z.object({
  title: z.string().min(1).max(200),
  skills: z.array(z.string().min(1).max(100)).max(50),
  title_level: z.enum(['junior', 'mid', 'senior', 'staff']),
  headcount: z.number().int().min(1),
  /** Non-empty rationale — per plan's Self-Review "AI 启发式必须有理由,不能黑盒". */
  rationale: z.string().min(1).max(500),
}).strict();

/** History row — one per decompose call. */
export const DecompositionRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  source_text: z.string(),
  positions_json: z.array(DecomposedPositionSchema),
  source: z.enum(['ai_heuristic', 'manual']),
  /** unix ms */
  created_at: z.number().int(),
}).strict();

/**
 * POST /v1/pm/projects/:projectId/decompose — has no body (target is read
 * from the project row), but we still declare an empty-object schema for
 * future-proofing (lets us add `override_text` etc. later without a schema
 * migration).
 */
export const DecomposeRequestSchema = z.object({}).strict();

export const DecomposeResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    decomposition: DecompositionRowSchema,
    suggestions: z.array(DecomposedPositionSchema),
  }),
}).strict();

/**
 * POST /v1/pm/projects/:projectId/decompose/:decompositionId/commit
 *
 * Body is the (possibly edited) suggestions the PM wants to commit. We
 * re-validate them server-side — the UI can rename / re-skill / re-headcount
 * suggestions before commit, but the schema is the same as the heuristic
 * output so the contract stays uniform.
 */
export const CommitDecompositionRequestSchema = z.object({
  positions: z.array(DecomposedPositionSchema).min(1).max(50),
}).strict();

export const CommitDecompositionResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    positions: z.array(PositionRowSchema),
    decomposition: DecompositionRowSchema,
  }),
}).strict();

/** GET /v1/pm/projects/:projectId/decompositions (history view). */
export const ListDecompositionsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    decompositions: z.array(DecompositionRowSchema),
    total: z.number().int().nonnegative(),
  }),
}).strict();

export type DecomposedPositionInput = z.infer<typeof DecomposedPositionSchema>;
export type DecompositionRow = z.infer<typeof DecompositionRowSchema>;
export type CommitDecompositionInput = z.infer<typeof CommitDecompositionRequestSchema>;

// ===== Staffing Plans (Task 7) =====
//
// A plan is a named staffing scenario attached to a project. Each
// project starts with one auto-selected default plan (created in
// projects.insert); subsequent plans are drafts until the PM clicks
// "select", which atomically swaps the is_selected flag (only one
// selected plan per project — uniqueness is enforced in the repo
// inside a BEGIN/COMIT, NOT in this schema layer).
//
// Wire shape:
//   - is_selected is INTEGER 0|1 (SQLite convention); keep that
//     on the wire so the client doesn't have to do a type-coerce
//     dance. The UI can render it as a boolean.
//   - positions_json is a typed array of { position_id, count };
//     these reference project_positions rows by id. The repo
//     stringifies on write, parses on read.
//   - total_headcount is a non-negative integer.
//   - estimated_cost is an optional non-negative integer (omit to
//     mean "PM hasn't estimated yet" — distinct from 0 which would
//     mean "estimated to zero").

/** Single entry in `plan.positions_json`. */
const PlanPositionSpecSchema = z.object({
  position_id: z.string().min(1).max(200),
  count: z.number().int().min(1).max(10000),
}).strict();

/** Mirrors `PlanRow` in db/repositories/staffing-plans.ts. */
export const PlanRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  total_headcount: z.number().int().nonnegative(),
  estimated_cost: z.number().int().nullable(),
  positions_json: z.array(PlanPositionSpecSchema),
  is_selected: z.number().int().min(0).max(1),
  created_at: z.number().int(),
}).strict();

/** GET /v1/pm/projects/:projectId/plans?limit=&offset= */
export const ListPlansQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
}).strict();

/** POST /v1/pm/projects/:projectId/plans */
export const CreatePlanSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  total_headcount: z.number().int().nonnegative().default(0),
  estimated_cost: z.number().int().nonnegative().optional(),
  positions_json: z.array(PlanPositionSpecSchema).default([]),
}).strict();

/** PATCH /v1/pm/plans/:id — partial of create + is_selected */
//
// is_selected is exposed on the update endpoint even though
// setSelectedPlan is the canonical way to flip it — allowing direct
// PATCH is convenient for tests and admin tooling. Uniqueness is
// still enforced because setSelectedPlan runs through the repo's
// transactional unselect-all+select-one path; direct PATCH of
// is_selected=1 on a second plan would technically violate the
// invariant, so we intentionally OMIT is_selected from this schema
// and route selection through the dedicated endpoint.
export const UpdatePlanSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  total_headcount: z.number().int().nonnegative().optional(),
  estimated_cost: z.number().int().nonnegative().nullable().optional(),
  positions_json: z.array(PlanPositionSpecSchema).nullable().optional(),
}).strict();

// ===== Staffing Plans — response shapes =====

export const PlanCreateResponseSchema = z.object({
  ok: z.literal(true),
  data: PlanRowSchema,
}).strict();

export const PlanListResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    plans: z.array(PlanRowSchema),
    total: z.number().int().nonnegative(),
  }),
}).strict();

export const PlanDetailResponseSchema = z.object({
  ok: z.literal(true),
  data: PlanRowSchema,
}).strict();

export const PlanUpdateResponseSchema = z.object({
  ok: z.literal(true),
  data: PlanRowSchema,
}).strict();

export const PlanDeleteResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({ deleted: z.literal(true) }),
}).strict();

export const PlanSelectResponseSchema = z.object({
  ok: z.literal(true),
  data: PlanRowSchema,
}).strict();

// ===== Sandbox (Task 9) =====
//
// The PM Sandbox page aggregates hunter-side `recommendations` for a
// single project_position, grouped by the 6 pipeline stages (submitted →
// screen_passed → interview → offer → onboarded + rejected). Each stage
// carries its candidate count, a per-stage risk-flag summary, and (for
// the expanded view) the candidate list with display name + stage
// entry timestamp + per-candidate risk flags.
//
// Risk flags:
//   - stuck_long       — in current stage > 30 days
//   - stuck_very_long  — in current stage > 60 days
//   (Future flags can be added without schema changes — see Zod z.array(z.string()).)
//
// The pipeline_stage enum mirrors the one in src/main/lib/hunter-pipeline.ts
// so a `stage` value here is exactly what the hunter kanban uses.

/** Mirrors `PipelineStage` from src/main/lib/hunter-pipeline.ts. */
const SandboxStageEnum = z.enum([
  'submitted', 'screen_passed', 'interview', 'offer', 'onboarded', 'rejected',
]);

/** Single candidate row inside a sandbox stage (anonymized display). */
export const SandboxCandidateSchema = z.object({
  recommendation_id: z.string(),
  candidate_user_id: z.string(),
  /** Anonymized via maskName() — at most 4 chars + '***' exposed. */
  candidate_display_name: z.string(),
  /** unix ms — when the candidate entered the current pipeline_stage. */
  stage_entered_at: z.number().int(),
  /** Risk flag identifiers. Empty array = no flags. */
  risk_flags: z.array(z.string()),
}).strict();

/** Risk-flag summary for a single stage. Counts the candidates carrying each flag. */
export const SandboxStageRiskCountSchema = z.object({
  stuck_long: z.number().int().nonnegative(),
  stuck_very_long: z.number().int().nonnegative(),
}).strict();

/** Single pipeline-stage bucket in the sandbox response. */
export const SandboxStageSchema = z.object({
  stage: SandboxStageEnum,
  count: z.number().int().nonnegative(),
  /** Per-stage risk-flag counts (denormalised from `candidates`). */
  risk_count: SandboxStageRiskCountSchema,
  /** Up to 20 candidates in this stage (sorted oldest stage_entered_at first). */
  candidates: z.array(SandboxCandidateSchema),
}).strict();

/** Full sandbox response for a single position. */
export const SandboxResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    position: z.object({
      id: z.string(),
      title: z.string(),
      total_headcount_planned: z.number().int().nonnegative(),
      total_headcount_filled: z.number().int().nonnegative(),
    }).strict(),
    stages: z.array(SandboxStageSchema),
    /** Sum of all per-stage counts (= total candidates in funnel). */
    total: z.number().int().nonnegative(),
  }),
}).strict();

export type SandboxStage = z.infer<typeof SandboxStageSchema>;
export type SandboxCandidate = z.infer<typeof SandboxCandidateSchema>;
export type SandboxStageRiskCount = z.infer<typeof SandboxStageRiskCountSchema>;
export type SandboxResponse = z.infer<typeof SandboxResponseSchema>;

export type CreatePlanInput = z.infer<typeof CreatePlanSchema>;
export type UpdatePlanInput = z.infer<typeof UpdatePlanSchema>;
export type ListPlansQuery = z.infer<typeof ListPlansQuerySchema>;
export type PlanRow = z.infer<typeof PlanRowSchema>;
export type PlanPositionSpec = z.infer<typeof PlanPositionSpecSchema>;

// ===== Matches (Task 10) =====
//
// A match is a scored candidate↔position pairing computed by
// src/main/lib/weighted-match.ts. Matches are recomputed on demand
// (`POST /v1/pm/positions/:id/matches/recompute`) and listed with a
// min_score filter + pagination (`GET /v1/pm/positions/:id/matches`).
//
// Wire shape:
//   - reasons / gaps are flat string[] arrays (parsed server-side from
//     JSON columns)
//   - candidate_display_name and headline are hydrated server-side via a
//     JOIN to candidates_anonymized + users; the match row itself only
//     stores candidate_user_id (no FK denormalisation)
//   - score is integer 0-100

/** Mirrors `MatchRow` in db/repositories/matches.ts. */
export const MatchRowSchema = z.object({
  match_id: z.number().int(),
  position_id: z.string(),
  candidate_user_id: z.string(),
  score: z.number().int().min(0).max(100),
  reasons: z.array(z.string()),
  gaps: z.array(z.string()),
  /** unix ms */
  created_at: z.number().int(),
}).strict();

/**
 * List-row variant: MatchRow + display data hydrated from
 * candidates_anonymized + users. This is what the GET endpoint returns.
 */
export const MatchListItemSchema = MatchRowSchema.extend({
  /** User.name hydrated via JOIN candidates_anonymized → candidates_private → users. */
  candidate_display_name: z.string().nullable(),
}).strict();

/** GET /v1/pm/positions/:id/matches?min_score=&limit=&offset= */
export const ListMatchesQuerySchema = z.object({
  min_score: z.coerce.number().int().min(0).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
}).strict();

/** Top-N entry returned inside recompute's response (no pagination, small N). */
export const TopMatchSchema = z.object({
  candidate_user_id: z.string(),
  score: z.number().int().min(0).max(100),
  reasons: z.array(z.string()),
  gaps: z.array(z.string()),
  candidate_display_name: z.string().nullable(),
}).strict();

export const RecomputeMatchesResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    computed_count: z.number().int().nonnegative(),
    top_matches: z.array(TopMatchSchema),
  }),
}).strict();

export const ListMatchesResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    matches: z.array(MatchListItemSchema),
    total: z.number().int().nonnegative(),
  }),
}).strict();

export type MatchListItem = z.infer<typeof MatchListItemSchema>;
export type TopMatch = z.infer<typeof TopMatchSchema>;
export type ListMatchesQuery = z.infer<typeof ListMatchesQuerySchema>;

// ===== Global Snapshot (Task 12 / S1) =====
//
// The Global Snapshot is a single-page dashboard for the PM. It aggregates
// every project (and the projects' positions, candidates, matches) the
// PM owns into a 4-stage funnel, then appends a real-time activity feed
// of HR-relevant events from the last 24 hours.
//
// Funnel semantics:
//   - projects:    total + by_status (planning / active / paused / completed / cancelled)
//   - positions:   total + by_status (open / paused / filled) + headcount planned/filled
//   - candidates:  total + distinct (the same candidate across multiple positions
//                  is counted ONCE — the PM cares about people, not pairs)
//   - matches:     total + avg_score (across every match tied to the PM's positions)
//
// Activity feed sources:
//   - `recommendations.created_at` for new applications / pickups (last 24h)
//   - `matches.created_at` for new matches (last 24h)
//   - We do NOT surface position-fill transitions in v1 (no easy
//     audit trail; out of scope for this task).
//   - Sorted DESC by `occurred_at`, capped at 50 events.

/** Status bucket for `projects` — one row per ProjectStatus enum. */
export const ProjectStatusBucketSchema = z.object({
  planning: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  paused: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
}).strict();

/** Status bucket for `project_positions` — open / paused / filled (cancelled omitted from wire). */
export const PositionStatusBucketSchema = z.object({
  open: z.number().int().nonnegative(),
  paused: z.number().int().nonnegative(),
  filled: z.number().int().nonnegative(),
}).strict();

/** Project-side aggregates — total + by_status. */
export const ProjectsFunnelSchema = z.object({
  total: z.number().int().nonnegative(),
  by_status: ProjectStatusBucketSchema,
}).strict();

/** Position-side aggregates — total + by_status + headcount planned/filled. */
export const PositionsFunnelSchema = z.object({
  total: z.number().int().nonnegative(),
  by_status: PositionStatusBucketSchema,
  headcount_planned_total: z.number().int().nonnegative(),
  headcount_filled_total: z.number().int().nonnegative(),
}).strict();

/** Candidate-side aggregates — total + distinct count (de-duplicated across positions). */
export const CandidatesFunnelSchema = z.object({
  total: z.number().int().nonnegative(),
  /** Distinct candidate_user_id count across all matches tied to the PM's positions. */
  distinct: z.number().int().nonnegative(),
}).strict();

/** Match-side aggregates — total + average score. */
export const MatchesFunnelSchema = z.object({
  total: z.number().int().nonnegative(),
  /** Mean score across all the PM's matches; 0 when total = 0. */
  avg_score: z.number().int().min(0).max(100),
}).strict();

/** Whole funnel — projects → positions → candidates → matches. */
export const SnapshotFunnelSchema = z.object({
  projects: ProjectsFunnelSchema,
  positions: PositionsFunnelSchema,
  candidates: CandidatesFunnelSchema,
  matches: MatchesFunnelSchema,
}).strict();

/** Single event in the activity feed. */
export const ActivityEventTypeSchema = z.enum([
  'application',     // new recommendation row (candidate applies / hunter recommends)
  'pickup',          // headhunter claimed a self-apply (pickup_headhunter_id set)
  'match_created',   // new match row
  // 'position_filled' // intentionally omitted in v1 (no audit trail)
]);

/**
 * Single HR activity event from the last 24 hours.
 * `summary` is a pre-formatted Chinese sentence (e.g. "张*三 申请了 高级前端工程师")
 * so the frontend doesn't have to do its own name-masking / formatting.
 */
export const ActivityEventSchema = z.object({
  event_type: ActivityEventTypeSchema,
  /** unix ms — when the underlying row was created. */
  occurred_at: z.number().int(),
  project_id: z.string().nullable(),
  position_id: z.string().nullable(),
  candidate_user_id: z.string().nullable(),
  /** Pre-rendered Chinese summary (handles masking + interpolation). */
  summary: z.string(),
}).strict();

/** GET /v1/pm/snapshot response. */
export const SnapshotResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    funnel: SnapshotFunnelSchema,
    /** Last 24h of HR activity, ordered by `occurred_at` DESC; capped at 50 events. */
    activity: z.array(ActivityEventSchema),
    /** unix ms — server timestamp; useful for the UI to compute "refresh in N seconds". */
    generated_at: z.number().int(),
  }),
}).strict();

export type SnapshotFunnel = z.infer<typeof SnapshotFunnelSchema>;
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;
export type ActivityEventType = z.infer<typeof ActivityEventTypeSchema>;
export type SnapshotResponse = z.infer<typeof SnapshotResponseSchema>;