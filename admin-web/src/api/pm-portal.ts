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
  list: (projectId: string) =>
    request<{ plans: PlanSummary[] }>(BASE, `/projects/${projectId}/plans`),
  get: (id: string) =>
    request<PlanSummary & { tasks: PlanTask[] }>(BASE, `/plans/${id}`),
  create: (projectId: string, input: { title: string; description?: string | null }) =>
    request<PlanSummary>(BASE, `/projects/${projectId}/plans`, {
      method: 'POST', body: JSON.stringify(input),
    }),
  updateTask: (planId: string, taskId: string, patch: Partial<{
    title: string;
    description: string | null;
    status: PlanTaskStatus;
    position: number;
    due_at: number | null;
    assignee_user_id: string | null;
  }>) =>
    request<PlanTask>(BASE, `/plans/${planId}/tasks/${taskId}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    }),
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
  list: (projectId: string, params?: { limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([k, v]) => v != null && q.set(k, String(v)));
    const qs = q.toString();
    return request<{ matches: MatchSuggestion[]; total: number }>(
      BASE, `/projects/${projectId}/matches${qs ? `?${qs}` : ''}`,
    );
  },
  accept: (matchId: string) =>
    request<MatchSuggestion>(BASE, `/matches/${matchId}/accept`, { method: 'POST' }),
  reject: (matchId: string, reason?: string) =>
    request<MatchSuggestion>(BASE, `/matches/${matchId}/reject`, {
      method: 'POST', body: JSON.stringify({ reason }),
    }),
};
