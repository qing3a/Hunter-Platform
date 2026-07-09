import { getAuthHeader, clearSession } from '../lib/candidate-session';

// Employer Portal — base path for the dedicated employer router that Task 3
// mounted at `/v1/employer-panel` in admin-server (see src/main/routes/
// employer-panel.ts). The auth (OTP) flow still goes through the legacy
// `/v1/candidate-portal/auth/otp/*` endpoints because that route already
// supports `user_type='employer'` (same machine, same auth model, same
// response shape). Don't be tempted to route auth through
// `/v1/employer-panel/auth/*` — it doesn't exist yet.
const BASE = '/v1/employer-panel';

// Fallback base path for the auth (OTP) endpoints. They live on the legacy
// candidate-portal router — same machine, same auth model, same response
// shape — but the path prefix differs. Re-declared here (not imported from
// candidate-portal.ts) so the employer client owns its own network surface
// and later tasks can audit call-sites with a single grep.
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

/**
 * Mirror of the candidate-portal OTP verify response shape. The
 * `user_type` discriminator is `'employer'` instead of `'pm'` /
 * `'headhunter'` so RequireEmployerAuth accepts the session.
 */
export type EmployerSession = {
  api_key: string;
  user_id: string;
  profile_complete: boolean;
  user_type: 'employer';
  role: 'employer';
};

/**
 * Mirrors backend `DashboardDataSchema` (see src/main/schemas/
 * employer-panel.ts → `getDashboard` handler in src/main/modules/employer/
 * dashboard.ts). Returned by GET /v1/employer-panel/dashboard.
 *
 * Counts are server-side scoped to the caller — every join keys on
 * `jobs.employer_id = me` so cross-employer isolation is enforced by SQL.
 */
export interface DashboardData {
  /** Jobs with status='open' AND employer_id=me. */
  active_jobs: number;
  /** MVP: equals active_jobs (no headcount_planned column on jobs). */
  open_positions: number;
  /** unlock_audit_log rows in the last 30 days where I am the actor. */
  candidates_viewed_this_month: number;
  /** recommendations.status='employer_interested' for my jobs. */
  interested_count: number;
  /** recommendations.status='candidate_approved' for my jobs. */
  unlocked_count: number;
  /** placements joined to my jobs. */
  placements_count: number;
  /** SUM(platform_fee+primary_share+referrer_share) over placements for me,
   *  created in the last 30 days. Stored in CNY cents (integer). */
  spend_this_month: number;
}

/** Wraps a `DashboardData` under the standard `data` envelope field. */
export interface DashboardResponse {
  data: DashboardData;
}

// ============================================================================
// Job types (reuse /v1/employer/jobs — see docs/employer-api-inventory.md §2)
// ============================================================================

/** Mirror of `JobSchema` in src/main/schemas/common.ts → common types. */
export interface Job {
  id: string;
  employer_id: string;
  source_headhunter_id: string | null;
  created_for_employer_id: string | null;
  title: string;
  description: string | null;
  required_skills: string[];
  salary_min: number | null;
  salary_max: number | null;
  status: 'open' | 'claimed' | 'paused' | 'closed' | 'filled';
  priority: 'low' | 'normal' | 'high' | 'urgent' | null;
  deadline: string | null;
  industry: string | null;
  created_at: string;
  updated_at: string;
}

/** Input shape for `POST /v1/employer/jobs` (CreateJobSchema). */
export interface CreateJobInput {
  title: string;
  description?: string;
  required_skills?: string[];
  salary_min?: number;
  salary_max?: number;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  deadline?: string;
  industry?: string;
}

/**
 * Input shape for `PATCH /v1/employer/jobs/:id`. The full edit set is
 * the union of the create fields minus the keys that must not be edited
 * (employer_id, source_headhunter_id, created_for_employer_id, status —
 * status is mutated through the dedicated `pause` / `resume` / `close`
 * endpoints). All keys are optional; the backend re-validates the
 * merged result against CreateJobSchema.
 */
export type JobUpdateInput = Partial<
  Pick<
    CreateJobInput,
    'title' | 'description' | 'required_skills' | 'salary_min' | 'salary_max' | 'priority' | 'deadline' | 'industry'
  >
>;

/** Discriminated union of the five lifecycle states a Job can occupy. */
export type JobStatus = Job['status'];

/** Input shape for `POST /v1/employer/reject-jobs/:id` (RejectJobSchema). */
export interface RejectJobInput {
  reason?: string;
}

// ============================================================================
// Candidate browse (talent preview) — /v1/employer/talent
// ============================================================================

/** Mirror of `TalentPreviewSchema` in src/main/schemas/employer.ts. */
export interface TalentPreview {
  anonymized_id: string;
  industry: string | null;
  title_level: string | null;
  years_experience: number | null;
  salary_range: string | null;
  education_tier: string | null;
  skills: string[];
}

/** Query params accepted by `GET /v1/employer/talent`. */
export interface BrowseTalentParams {
  industry?: string;
  title_level?: string;
  min_years?: number;
  max_years?: number;
  /** CSV of skill names — sent as a comma-joined string. */
  skills?: string[];
  min_salary?: number;
  max_salary?: number;
}

// ============================================================================
// Recommendations
// ============================================================================

export type RecommendationStatus =
  | 'pending_pickup'
  | 'pending'
  | 'employer_interested'
  | 'considering_offer'
  | 'candidate_approved'
  | 'unlocked'
  | 'withdrawn'
  | 'rejected'
  | 'placed';

// ============================================================================
// Placements (reuse /v1/employer/placements)
// ============================================================================

export type PlacementStatus = 'pending_payment' | 'paid' | 'cancelled';

/** Mirror of `PlacementSchema` in src/main/schemas/employer.ts. */
export interface Placement {
  id: string;
  job_id: string;
  candidate_user_id: string;
  primary_headhunter_id: string;
  referrer_headhunter_id: string | null;
  anonymized_candidate_id: string;
  annual_salary: number;
  platform_fee: number;
  primary_share: number;
  referrer_share: number;
  candidate_bonus: number;
  status: PlacementStatus;
  created_at: string;
  updated_at: string;
}

/** Input shape for `POST /v1/employer/placements`. */
export interface CreatePlacementInput {
  anonymized_candidate_id: string;
  job_id: string;
  annual_salary: number;
}

// ============================================================================
// Auth (reuse candidate-portal OTP, discriminated by user_type='employer')
// ============================================================================

export const employerAuth = {
  /**
   * Request an OTP for the given employer email.
   *
   * The verify step auto-creates an `employer` user (instead of a candidate)
   * the first time the email is seen — same behaviour the PM / hunter portals
   * rely on, controlled by the `user_type` discriminator.
   */
  requestOtp: (email: string) =>
    request<{ expires_in: number; dev_code?: string }>(AUTH_BASE, '/auth/otp/request', {
      method: 'POST',
      body: JSON.stringify({ email, user_type: 'employer' }),
    }),

  /**
   * Verify the OTP. On success returns the bearer API key + user id, a
   * server-echoed `user_type: 'employer'` and a `profile_complete` flag.
   *
   * The backend currently always echoes `profile_complete: false` for
   * employer users (no onboarding step on this side), but we still pass the
   * value verbatim so the CandidateSession contract is satisfied.
   */
  verifyOtp: (email: string, code: string) =>
    request<EmployerSession>(AUTH_BASE, '/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code, user_type: 'employer' }),
    }),
};

// ============================================================================
// Dashboard (Task 3 endpoint, live at a2d59fe)
// ============================================================================

export const employerDashboard = {
  /**
   * GET /v1/employer-panel/dashboard
   *
   * Single-call aggregate for the SPA home/landing view. Returns the seven
   * counters surfaced on EmployerDashboardPage.
   *
   * Mirrors backend `getDashboard` (src/main/modules/employer/dashboard.ts).
   */
  get: () => request<DashboardData>(BASE, '/dashboard'),
};

// ============================================================================
// Jobs, candidates, placements, pending-claims namespaces (Tasks 5-9 stubs).
//
// These endpoints already live under /v1/employer/* (see docs/employer-api-
// inventory.md §2). They are wired here so the build stays green before
// Tasks 5-9 land; the call-sites match the real route paths so swapping the
// body in is mechanical when each subsequent task lands.
// ============================================================================

export const employerJobs = {
  /** GET /v1/employer/jobs?status= */
  list: (params?: { status?: Job['status'] }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    const qs = q.toString();
    return request<Job[]>(`/v1/employer`, `/jobs${qs ? `?${qs}` : ''}`);
  },
  /**
   * GET /v1/employer/jobs/:id — single-job detail endpoint. Added in
   * the 🟡 EXTEND gap from `docs/employer-api-inventory.md` §2; the
   * backend (admin-server) handler was wired alongside Task 5 so the
   * edit form can hydrate from a canonical payload rather than the
   * filtered `list` row.
   */
  get: (id: string) => request<Job>(`/v1/employer`, `/jobs/${id}`),
  /** POST /v1/employer/jobs */
  create: (input: CreateJobInput) =>
    request<Job>(`/v1/employer`, '/jobs', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /**
   * PATCH /v1/employer/jobs/:id — edit-form submission. Returns the
   * updated Job. Owner-only enforced server-side (the existing
   * `jobs.listByEmployer` scope lives on the create / list paths; the
   * PATCH route inherits the same `user_type === 'employer'` check +
   * ownership via `employer_id = me`).
   */
  update: (id: string, input: JobUpdateInput) =>
    request<Job>(`/v1/employer`, `/jobs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  /**
   * POST /v1/employer/jobs/:id/pause — flips `open` / `claimed` →
   * `paused`. Audit + quota-free (status flips only).
   */
  pause: (id: string) =>
    request<{ status: 'paused' }>(`/v1/employer`, `/jobs/${id}/pause`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  /**
   * POST /v1/employer/jobs/:id/resume — flips `paused` → `open`.
   */
  resume: (id: string) =>
    request<{ status: 'open' }>(`/v1/employer`, `/jobs/${id}/resume`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  /**
   * POST /v1/employer/jobs/:id/close — hard-closes the job
   * (`open` / `claimed` / `paused` → `closed`). Terminal state.
   */
  close: (id: string) =>
    request<{ status: 'closed' }>(`/v1/employer`, `/jobs/${id}/close`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  /**
   * POST /v1/employer/reject-jobs/:id — closes a pending claim with an
   * optional reason. Audit row is written server-side (capability
   * `employer.reject_job`).
   */
  reject: (id: string, input: RejectJobInput = {}) =>
    request<{ status: 'closed' }>(`/v1/employer`, `/reject-jobs/${id}`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};

export const employerCandidates = {
  /** GET /v1/employer/talent — anonymized previews; unlock via Task 5. */
  browse: (params?: BrowseTalentParams) => {
    const q = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([k, v]) => {
      if (v == null) return;
      if (k === 'skills' && Array.isArray(v)) {
        q.set('skills', v.join(','));
      } else {
        q.set(k, String(v));
      }
    });
    const qs = q.toString();
    return request<TalentPreview[]>(
      `/v1/employer`,
      `/talent${qs ? `?${qs}` : ''}`,
    );
  },
  /**
   * POST /v1/employer/recommendations/:id/express-interest — flips a rec to
   * `employer_interested`, writes unlock_audit_log row, enqueues webhook.
   */
  expressInterest: (recommendationId: string) =>
    request<{ status: 'employer_interested' }>(
      `/v1/employer`,
      `/recommendations/${recommendationId}/express-interest`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  /**
   * POST /v1/employer/recommendations/:id/unlock-contact — decrypts PII and
   * enqueues the deliver_contact webhook. Returns the (server-decrypted)
   * contact so the SPA can show name / phone / email.
   */
  unlockContact: (recommendationId: string) =>
    request<{ status: 'unlocked' }>(
      `/v1/employer`,
      `/recommendations/${recommendationId}/unlock-contact`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
};

export const employerPlacements = {
  /** GET /v1/employer/placements?status= */
  list: (params?: { status?: PlacementStatus }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    const qs = q.toString();
    return request<Placement[]>(
      `/v1/employer`,
      `/placements${qs ? `?${qs}` : ''}`,
    );
  },
  /** POST /v1/employer/placements — requires unlocked rec + own job. */
  create: (input: CreatePlacementInput) =>
    request<Placement>(`/v1/employer`, '/placements', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};

export const employerPendingClaims = {
  /** GET /v1/employer/pending-claims — `open` jobs claimable by me. */
  list: () => request<Job[]>(`/v1/employer`, '/pending-claims'),
  /** POST /v1/employer/claim-jobs/:id — idempotent if already own claimed. */
  claim: (id: string) =>
    request<Job>(`/v1/employer`, `/claim-jobs/${id}`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};

// ============================================================================
// Convenience helpers
// ============================================================================

/**
 * Format an integer CNY-cent amount as a human-readable ¥ string with
 * thousands separators. The dashboard's `spend_this_month` is stored as
 * CNY cents (integer), so 120000 → "¥1,200" and 1234567 → "¥12,346"
 * (the trailing sub-yuan is rounded so the tile shows an actionable
 * whole-yuan number).
 *
 * Used by EmployerDashboardPage for the "本月花费" KPI tile.
 */
export function formatCnyCents(cents: number): string {
  const yuan = Math.round(cents / 100);
  return `¥${yuan.toLocaleString('zh-CN')}`;
}