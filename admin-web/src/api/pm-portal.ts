import { getAuthHeader, clearSession } from '../lib/candidate-session';

// PM Workbench — base path for the dedicated PM router that Task 17 will mount
// at `/v1/pm/*` in admin-server. The auth (OTP) flow still goes through the
// legacy `/v1/candidate-portal/auth/otp/*` endpoints because that route already
// supports `user_type='pm'` (see Task 1b, commit e6084f7). Don't be tempted to
// route auth through `/v1/pm/auth/*` — it doesn't exist yet.
const BASE = '/v1/pm';

// Fallback base path for the auth (OTP) endpoints. They live on the legacy
// candidate-portal router — same machine, same auth model, same response shape
// — but the path prefix differs. Re-declared here (not imported from
// candidate-portal.ts) so the PM client owns its own network surface and
// later tasks can audit call-sites with a single grep.
const AUTH_BASE = '/v1/candidate-portal';

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

async function request<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  const auth = getAuthHeader();
  if (auth) headers['Authorization'] = auth;

  const res = await fetch(base + path, { ...init, headers });
  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401) clearSession();
    throw new ApiError(
      json.error?.code ?? 'UNKNOWN_ERROR',
      json.error?.message ?? `HTTP ${res.status}`,
      res.status,
    );
  }
  return json.data;
}

// ===== Type definitions matching backend Zod schemas =====

export type ProjectStatus = 'planning' | 'active' | 'completed' | 'paused' | 'cancelled';

/**
 * Chinese display labels for the five ProjectStatus values. The lifecycle
 * states mirror the CHECK constraint introduced in v028 (pm_workbench),
 * so any new state added to the backend must be added here too — the
 * record type enforces exhaustiveness at compile time.
 */
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: '筹备中',
  active: '进行中',
  paused: '已暂停',
  completed: '已完成',
  cancelled: '已取消',
};

/**
 * Position lifecycle. Three states on the wire (the DB CHECK constraint
 * also allows 'cancelled' for forward-compat but the handler does not
 * surface it).
 */
export type PositionStatus = 'open' | 'paused' | 'filled';

export const POSITION_STATUS_LABELS: Record<PositionStatus, string> = {
  open: '招聘中',
  paused: '已暂停',
  filled: '已招满',
};

/** Title seniority band. */
export type TitleLevel = 'junior' | 'mid' | 'senior' | 'staff';

export const TITLE_LEVEL_LABELS: Record<TitleLevel, string> = {
  junior: '初级',
  mid: '中级',
  senior: '高级',
  staff: '资深',
};

export type PlanTaskStatus = 'todo' | 'doing' | 'blocked' | 'done';

export type DecomposeRunStatus =
  | 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/**
 * Title seniority band. Mirrors the server's
 * `DecomposeTitleLevel` (in src/main/lib/ai-decompose.ts).
 */
export type DecomposeTitleLevel = 'junior' | 'mid' | 'senior' | 'staff';

/**
 * Single position suggestion returned by the AI heuristic endpoint
 * (POST /v1/pm/projects/:id/decompose). Mirrors the server's
 * `DecomposedPosition`.
 *
 * The PM can edit any of these inline in the modal before committing;
 * the server re-validates everything on commit so a tampered client
 * still has to satisfy the same Zod schema.
 */
export interface DecomposedPosition {
  title: string;
  skills: string[];
  title_level: DecomposeTitleLevel;
  headcount: number;
  rationale: string;
}

/**
 * History row returned by the decompose endpoint + history endpoint. Mirrors
 * the server's `DecompositionRowSchema` (src/main/schemas/pm.ts).
 */
export interface DecompositionHistoryItem {
  id: string;
  project_id: string;
  source_text: string;
  positions_json: DecomposedPosition[];
  source: 'ai_heuristic' | 'manual';
  /** unix ms */
  created_at: number;
}

/**
 * Result of a successful decompose call — the saved history row plus the
 * suggestions to preview. UI edits suggestions, then sends the (edited)
 * list to the commit endpoint together with `decomposition.id`.
 */
export interface DecompositionResult {
  decomposition: DecompositionHistoryItem;
  suggestions: DecomposedPosition[];
}

/**
 * Mirrors the backend `ProjectRow` shape (see
 * src/main/db/repositories/projects.ts → ProjectRow). Returned by the
 * create / update / get (detail) endpoints. The list endpoint adds two
 * aggregate counts on top — see `ProjectSummary` below.
 *
 * NOTE: `target` is the project's recruitment target / scope blurb
 * (renamed from earlier "description" wording in the design doc). The
 * 名称 displayed in the UI is the `name` field.
 */
export interface Project {
  id: string;
  pm_user_id: string;
  name: string;
  target: string | null;
  budget_total: number | null;
  /** unix ms */
  start_at: number | null;
  /** unix ms */
  end_at: number | null;
  current_team: { role: string; count: number }[] | null;
  status: ProjectStatus;
  /** unix ms */
  created_at: number;
  /** unix ms */
  updated_at: number;
}

/**
 * List-row shape for projects: `Project` plus two aggregate counts
 * (`position_count`, `plan_count`). Returned only by the `list` endpoint
 * — create / update / get all return `Project` (the row alone, no
 * aggregates).
 */
export interface ProjectSummary extends Project {
  position_count: number;
  plan_count: number;
}

export interface PlanTask {
  id: string;
  plan_id: string;
  title: string;
  description: string | null;
  status: PlanTaskStatus;
  position: number;
  due_at: number | null;
  assignee_user_id: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Mirrors the backend `PlanRowSchema` (see
 * src/main/schemas/pm.ts and src/main/db/repositories/staffing-plans.ts).
 * Returned by the list / create / get / update / select endpoints.
 *
 * NOTE: this is the actual wire shape — it differs from the legacy
 * PlanSummary above (which was a planned-but-not-shipped Task-7+ design
 * with `task_count`). Task 8's UI will replace PlanSummary references
 * with this `Plan` type as the comparison page lands.
 */
export interface Plan {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  total_headcount: number;
  estimated_cost: number | null;
  positions_json: Array<{ position_id: string; count: number }>;
  /** 0 = draft, 1 = currently selected plan for the project. */
  is_selected: number;
  created_at: number;
}

export interface PlanSummary {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  task_count: number;
  created_at: number;
  updated_at: number;
}

export interface DecomposeJobRef {
  job_id: string;
  job_title: string | null;
}

export interface DecomposeRun {
  id: string;
  project_id: string;
  pm_user_id: string;
  status: DecomposeRunStatus;
  jobs: DecomposeJobRef[];
  result_plan_id: string | null;
  error_message: string | null;
  started_at: number | null;
  finished_at: number | null;
  created_at: number;
}

export interface MatchSuggestion {
  id: string;
  project_id: string;
  plan_id: string | null;
  candidate_user_id: string;
  candidate_name: string | null;
  job_id: string;
  job_title: string | null;
  match_score: number;
  rationale: string | null;
  created_at: number;
}

/**
 * Mirrors backend `MatchListItemSchema` (see
 * src/main/schemas/pm.ts and src/main/db/repositories/matches.ts).
 * Returned by the `GET /v1/pm/positions/:id/matches` endpoint.
 *
 * The `headline` field is optional/nullable: it is reserved for the
 * candidate's anonymised one-liner (e.g. "5 年前端 · React / TS")
 * and will surface in a later Task once the candidates_anonymized
 * schema exposes it. Until then the UI gracefully renders an
 * empty headline block.
 */
export interface MatchListItem {
  match_id: number;
  position_id: string;
  candidate_user_id: string;
  /** 0-100 inclusive (integer on the wire). */
  score: number;
  /** Positive signals from weighted-match. */
  reasons: string[];
  /** Negative signals from weighted-match. */
  gaps: string[];
  /** unix ms */
  created_at: number;
  /** Hydrated via JOIN candidates_anonymized → users. Nullable. */
  candidate_display_name: string | null;
  /** Reserved — populated by future anonymization enrichment. */
  headline: string | null;
}

/**
 * Mirrors backend `TopMatchSchema`. Returned inside the recompute
 * response (POST /v1/pm/positions/:id/matches/recompute). Does not
 * include `match_id` or `created_at` — recompute returns a transient
 * view of the freshly-scored top-N, not the persisted rows.
 */
export interface TopMatch {
  candidate_user_id: string;
  score: number;
  reasons: string[];
  gaps: string[];
  candidate_display_name: string | null;
}

/** Payload returned by `POST /v1/pm/positions/:id/matches/recompute`. */
export interface RecomputeMatchesResponse {
  computed_count: number;
  top_matches: TopMatch[];
}

/**
 * Mirrors backend `PositionRow` (see
 * src/main/db/repositories/project-positions.ts). Returned by
 * list / create / get / update / bulkCreate endpoints.
 */
export interface Position {
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

/** Aggregate position stats for a single project. */
export interface PositionStats {
  total: number;
  open: number;
  paused: number;
  filled: number;
  headcount_planned_total: number;
  headcount_filled_total: number;
}

/** Input shape for creating / bulk-creating positions. */
export interface CreatePositionInput {
  title: string;
  description?: string;
  required_skills?: string[];
  title_level?: TitleLevel;
  industry?: string;
  salary_min?: number;
  salary_max?: number;
  headcount_planned?: number;
}

/** Input shape for updating a position (all fields optional). */
export interface UpdatePositionInput {
  title?: string;
  description?: string | null;
  required_skills?: string[] | null;
  title_level?: TitleLevel | null;
  industry?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  headcount_planned?: number;
  headcount_filled?: number;
  status?: PositionStatus;
}

// ===== Auth (reuse candidate-portal OTP) =====

export const pmAuth = {
  /**
   * Request an OTP for the given PM email.
   *
   * The verify step auto-creates a `pm` user (instead of a candidate) the
   * first time the email is seen — same behaviour the hunter portal relies on
   * for headhunter users, controlled by the `user_type` discriminator.
   */
  requestOtp: (email: string) =>
    request<{ expires_in: number; dev_code?: string }>(AUTH_BASE, '/auth/otp/request', {
      method: 'POST',
      body: JSON.stringify({ email, user_type: 'pm' }),
    }),

  /**
   * Verify the OTP. On success returns the bearer API key + user id, a
   * server-echoed `user_type: 'pm'` and a `profile_complete` flag (currently
   * always false for PM users — there is no onboarding step on the PM side).
   */
  verifyOtp: (email: string, code: string) =>
    request<{
      api_key: string;
      user_id: string;
      profile_complete: boolean;
      user_type: 'pm';
    }>(AUTH_BASE, '/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code, user_type: 'pm' }),
    }),
};

// ===== Project / plan / decompose / matches namespaces =====
//
// Filled in incrementally by subsequent tasks (4-onwards). Each method is a
// `noThrow`-style stub so the build stays green before the backend lands the
// matching routes in admin-server. Replace the body — not the call-site —
// when the endpoint ships.

export const pmProjects = {
  list: (params?: { status?: ProjectStatus; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([k, v]) => v != null && q.set(k, String(v)));
    const qs = q.toString();
    return request<{ projects: ProjectSummary[]; total: number }>(
      BASE, `/projects${qs ? `?${qs}` : ''}`,
    );
  },
  /**
   * Project detail — returns the project row + positions + plans + stats.
   * Mirrors backend `ProjectDetail` (see src/main/modules/pm/projects.ts).
   */
  get: (id: string) =>
    request<{
      project: Project;
      positions: Position[];
      plans: PlanSummary[];
      stats: {
        total_positions: number;
        filled_positions: number;
        total_plans: number;
        selected_plan_id: string | null;
      };
    }>(BASE, `/projects/${id}`),
  create: (input: {
    name: string;
    target?: string;
    budget_total?: number;
    start_at?: number;
    end_at?: number;
    current_team?: Array<{ role: string; count: number }>;
  }) =>
    request<Project>(BASE, '/projects', {
      method: 'POST', body: JSON.stringify(input),
    }),
  update: (id: string, patch: Partial<{
    name: string;
    target: string | null;
    budget_total: number | null;
    start_at: number | null;
    end_at: number | null;
    current_team: Array<{ role: string; count: number }> | null;
    status: ProjectStatus;
  }>) =>
    request<Project>(BASE, `/projects/${id}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    }),
};

export const pmPlans = {
  /**
   * GET /v1/pm/projects/:projectId/plans?limit=&offset=
   * Mirrors backend `listPlans` (createPlansHandler in
   * src/main/modules/pm/plans.ts).
   */
  list: (
    projectId: string,
    params?: { limit?: number; offset?: number },
  ) => {
    const q = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([k, v]) => v != null && q.set(k, String(v)));
    const qs = q.toString();
    return request<{ plans: Plan[]; total: number }>(
      BASE, `/projects/${projectId}/plans${qs ? `?${qs}` : ''}`,
    );
  },
  /** GET /v1/pm/plans/:id */
  get: (id: string) =>
    request<Plan>(BASE, `/plans/${id}`),
  /** POST /v1/pm/projects/:projectId/plans */
  create: (
    projectId: string,
    input: {
      name: string;
      description?: string;
      total_headcount?: number;
      estimated_cost?: number;
      positions_json?: Array<{ position_id: string; count: number }>;
    },
  ) =>
    request<Plan>(BASE, `/projects/${projectId}/plans`, {
      method: 'POST', body: JSON.stringify(input),
    }),
  /** PATCH /v1/pm/plans/:id — partial of create (is_selected is NOT
   *  exposed here; callers must use select() so the unselect-all +
   *  select-one writes run transactionally). */
  update: (id: string, patch: Partial<{
    name: string;
    description: string | null;
    total_headcount: number;
    estimated_cost: number | null;
    positions_json: Array<{ position_id: string; count: number }> | null;
  }>) =>
    request<Plan>(BASE, `/plans/${id}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    }),
  /** DELETE /v1/pm/plans/:id */
  delete: (id: string) =>
    request<{ deleted: true }>(BASE, `/plans/${id}`, { method: 'DELETE' }),
  /**
   * POST /v1/pm/plans/:id/select — mark this plan as the project's
   * selected plan. Uniqueness (only one selected plan per project)
   * is enforced atomically by the backend in a BEGIN/COMMIT.
   */
  select: (id: string) =>
    request<Plan>(BASE, `/plans/${id}/select`, { method: 'POST' }),
};

/**
 * Position CRUD namespace (Task 5). Mirrors the five endpoints exposed
 * by createPositionsHandler in src/main/modules/pm/positions.ts plus
 * the bulk and stats helpers used by Task 6 (AI decompose) and the
 * ProjectDetailPage Overview tab.
 */
export const pmPositions = {
  /** GET /v1/pm/projects/:projectId/positions?status=&limit=&offset= */
  list: (
    projectId: string,
    params?: { status?: PositionStatus; limit?: number; offset?: number },
  ) => {
    const q = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([k, v]) => v != null && q.set(k, String(v)));
    const qs = q.toString();
    return request<{ positions: Position[]; total: number }>(
      BASE, `/projects/${projectId}/positions${qs ? `?${qs}` : ''}`,
    );
  },
  /** POST /v1/pm/projects/:projectId/positions */
  create: (projectId: string, input: CreatePositionInput) =>
    request<Position>(BASE, `/projects/${projectId}/positions`, {
      method: 'POST', body: JSON.stringify(input),
    }),
  /** GET /v1/pm/positions/:id — also returns a tiny derived stats object. */
  get: (id: string) =>
    request<{
      position: Position;
      stats: {
        headcount_planned: number;
        headcount_filled: number;
        is_complete: boolean;
      };
    }>(BASE, `/positions/${id}`),
  /** PATCH /v1/pm/positions/:id */
  update: (id: string, patch: Partial<UpdatePositionInput>) =>
    request<Position>(BASE, `/positions/${id}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    }),
  /** DELETE /v1/pm/positions/:id */
  delete: (id: string) =>
    request<{ deleted: true }>(BASE, `/positions/${id}`, { method: 'DELETE' }),
  /** POST /v1/pm/projects/:projectId/positions/bulk — used by AI decompose. */
  bulkCreate: (projectId: string, items: CreatePositionInput[]) =>
    request<{ positions: Position[] }>(BASE, `/projects/${projectId}/positions/bulk`, {
      method: 'POST', body: JSON.stringify({ items }),
    }),
  /** GET /v1/pm/projects/:projectId/positions/stats */
  stats: (projectId: string) =>
    request<PositionStats>(BASE, `/projects/${projectId}/positions/stats`),
};

export const pmDecompose = {
  /**
   * POST /v1/pm/projects/:projectId/decompose
   *
   * Runs the keyword heuristic on project.target, persists a history row,
   * and returns the new decomposition id + suggestions for preview.
   * Network body is empty — the target text is read from the project row.
   */
  decompose: (projectId: string) =>
    request<{ decomposition: DecompositionHistoryItem; suggestions: DecomposedPosition[] }>(
      BASE,
      `/projects/${projectId}/decompose`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  /**
   * POST /v1/pm/projects/:projectId/decompose/:decompositionId/commit
   *
   * Bulk-creates the (possibly edited) suggestion list as project_positions.
   * Server re-validates each item via Zod before insert.
   */
  commit: (projectId: string, decompositionId: string, positions: DecomposedPosition[]) =>
    request<{ positions: Position[]; decomposition: DecompositionHistoryItem }>(
      BASE,
      `/projects/${projectId}/decompose/${decompositionId}/commit`,
      { method: 'POST', body: JSON.stringify({ positions }) },
    ),
  /**
   * GET /v1/pm/projects/:projectId/decompositions
   *
   * List historical decompose runs for a project (most-recent first).
   * Used by the history view / debugging tools (not on the v1 main flow).
   */
  history: (projectId: string, params?: { limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([k, v]) => v != null && q.set(k, String(v)));
    const qs = q.toString();
    return request<{ decompositions: DecompositionHistoryItem[]; total: number }>(
      BASE,
      `/projects/${projectId}/decompositions${qs ? `?${qs}` : ''}`,
    );
  },
};

export const pmMatches = {
  /**
   * GET /v1/pm/positions/:id/matches?min_score=&limit=&offset=
   *
   * Mirrors backend `listMatches` (createMatchesHandler in
   * src/main/modules/pm/matches.ts). The endpoint is position-scoped
   * — note the URL shape `/positions/:id/matches` (NOT
   * `/projects/:id/matches`). The legacy `MatchSuggestion` namespace
   * above is a separate flow and is not affected by this call.
   *
   * The response is already sorted by score DESC server-side (the
   * repo's `listByPosition` enforces `ORDER BY score DESC`).
   * `min_score` accepts 0..100; passing 0 disables filtering.
   */
  list: (
    positionId: string,
    params?: { min_score?: number; limit?: number; offset?: number },
  ) => {
    const q = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([k, v]) => v != null && q.set(k, String(v)));
    const qs = q.toString();
    return request<{ matches: MatchListItem[]; total: number }>(
      BASE, `/positions/${positionId}/matches${qs ? `?${qs}` : ''}`,
    );
  },
  /**
   * POST /v1/pm/positions/:id/matches/recompute
   *
   * Bulk UPSERTs matches for the position and returns the top-N
   * (by score DESC) immediately, hydrated with display name.
   * Mirrors backend `recomputeMatches`.
   *
   * The caller is expected to invalidate / refetch the list query
   * afterwards — recompute writes are idempotent so a follow-up
   * `list()` will reflect the fresh scores.
   */
  recompute: (positionId: string) =>
    request<RecomputeMatchesResponse>(
      BASE, `/positions/${positionId}/matches/recompute`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  accept: (matchId: string) =>
    request<MatchSuggestion>(BASE, `/matches/${matchId}/accept`, { method: 'POST' }),
  reject: (matchId: string, reason?: string) =>
    request<MatchSuggestion>(BASE, `/matches/${matchId}/reject`, {
      method: 'POST', body: JSON.stringify({ reason }),
    }),
};

// ============================================================================
// Sandbox (Task 9 / S3) — 5 阶段漏斗
// ============================================================================
//
// Mirrors the backend handler at /v1/pm/positions/:id/sandbox. The
// response aggregates every recommendation linked to the position
// (hunters' kanban-stage entries) into a 6-stage funnel with a
// per-stage count, a risk-flag summary, and an expandable candidate
// list.
//
// Stage ordering on the wire is the canonical pipeline order
// (submitted → screen_passed → interview → offer → onboarded, with
// `rejected` as a terminal trailing bucket). The frontend renders
// them in the same order via SANDBOX_STAGE_ORDER below.

// ----- Wire types -----

export type SandboxStage =
  | 'submitted' | 'screen_passed' | 'interview' | 'offer' | 'onboarded' | 'rejected';

/** Display labels mirror the hunter kanban so the funnel feels native. */
export const SANDBOX_STAGE_LABELS: Record<SandboxStage, string> = {
  submitted: '投递',
  screen_passed: '简历过',
  interview: '面试',
  offer: 'Offer',
  onboarded: '到岗',
  rejected: '已拒绝',
};

/**
 * Render order: the 5 active funnel stages first (left-to-right), with
 * `rejected` as a trailing terminal bucket. Matches the backend
 * PIPELINE_STAGES + 'rejected' ordering.
 */
export const SANDBOX_STAGE_ORDER: SandboxStage[] = [
  'submitted', 'screen_passed', 'interview', 'offer', 'onboarded', 'rejected',
];

/** Per-stage CSS accent key — keeps the funnel cards visually distinct. */
export const SANDBOX_STAGE_ACCENTS: Record<SandboxStage, 'blue' | 'purple' | 'pink' | 'amber' | 'green' | 'gray'> = {
  submitted: 'blue',
  screen_passed: 'purple',
  interview: 'pink',
  offer: 'amber',
  onboarded: 'green',
  rejected: 'gray',
};

export interface SandboxCandidate {
  recommendation_id: string;
  candidate_user_id: string;
  /** Masked display name (at most 4 chars + '***'). */
  candidate_display_name: string;
  /** unix ms — when the candidate entered the current pipeline_stage. */
  stage_entered_at: number;
  /** Risk flag identifiers. Empty array = no flags. */
  risk_flags: string[];
}

export interface SandboxStageRiskCount {
  stuck_long: number;
  stuck_very_long: number;
}

export interface SandboxStageBucket {
  stage: SandboxStage;
  count: number;
  risk_count: SandboxStageRiskCount;
  /** Up to 20 candidates (oldest stage_entered_at first). */
  candidates: SandboxCandidate[];
}

export interface SandboxSummary {
  position: {
    id: string;
    title: string;
    total_headcount_planned: number;
    total_headcount_filled: number;
  };
  stages: SandboxStageBucket[];
  total: number;
}

// ----- API namespace -----

export const pmSandbox = {
  /**
   * GET /v1/pm/positions/:id/sandbox
   *
   * Returns the 6-stage funnel for a single project_position. Each
   * stage carries a count + risk_count + a paginated candidate list
   * (max 20 per stage — the UI shows "查看全部" placeholder for the
   * rest, which is out-of-scope for v1).
   */
  get: (positionId: string) =>
    request<SandboxSummary>(BASE, `/positions/${positionId}/sandbox`),
};
