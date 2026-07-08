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

export type PlanTaskStatus = 'todo' | 'doing' | 'blocked' | 'done';

export type DecomposeRunStatus =
  | 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ProjectSummary {
  id: string;
  pm_user_id: string;
  title: string;
  company_name: string | null;
  status: ProjectStatus;
  job_count: number;
  plan_count: number;
  created_at: number;
  updated_at: number;
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
  get: (id: string) =>
    request<ProjectSummary & { plans: PlanSummary[] }>(BASE, `/projects/${id}`),
  create: (input: {
    title: string;
    company_name?: string | null;
    description?: string | null;
  }) =>
    request<ProjectSummary>(BASE, '/projects', {
      method: 'POST', body: JSON.stringify(input),
    }),
  update: (id: string, patch: Partial<{
    title: string;
    company_name: string | null;
    status: ProjectStatus;
  }>) =>
    request<ProjectSummary>(BASE, `/projects/${id}`, {
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

export const pmDecompose = {
  start: (input: { project_id: string; job_ids: string[] }) =>
    request<DecomposeRun>(BASE, '/decompose', {
      method: 'POST', body: JSON.stringify(input),
    }),
  get: (runId: string) =>
    request<DecomposeRun>(BASE, `/decompose/${runId}`),
  cancel: (runId: string) =>
    request<DecomposeRun>(BASE, `/decompose/${runId}/cancel`, { method: 'POST' }),
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
