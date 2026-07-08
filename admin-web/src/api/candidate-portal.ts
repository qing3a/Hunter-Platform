import { getAuthHeader, clearSession } from '../lib/candidate-session';

const BASE = '/v1/candidate-portal';

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  const auth = getAuthHeader();
  if (auth) headers['Authorization'] = auth;

  const res = await fetch(BASE + path, { ...init, headers });
  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401) clearSession();
    throw new ApiError(
      json.error?.code ?? 'UNKNOWN_ERROR',
      json.error?.message ?? `HTTP ${res.status}`,
      res.status
    );
  }
  return json.data;
}

// PM was added in PM Workbench Task 3 (login reuses the candidate-portal OTP
// endpoint); employer is reserved for the upcoming employer portal. The server
// only hardcodes branching for candidate vs headhunter today, but accepting
// the extra values here keeps the client-side contract aligned with the
// broader role taxonomy in `candidate-session.ts`.
export type OtpUserType = 'candidate' | 'headhunter' | 'pm' | 'employer';

export const otp = {
  /**
   * Request an OTP for the given email.
   *
   * `user_type` is optional — omitting it is treated as the historical
   * candidate-portal behaviour (`user_type='candidate'`). The hunter portal
   * passes `user_type='headhunter'` so the verify step auto-creates a
   * headhunter user (instead of a candidate) on first login.
   *
   * In console mode the server returns a `dev_code` so local tests can
   * verify without a real SMTP hop.
   */
  request: (email: string, user_type?: OtpUserType) =>
    request<{ expires_in: number; dev_code?: string }>('/auth/otp/request', {
      method: 'POST', body: JSON.stringify({ email, user_type }),
    }),
  /**
   * Verify an OTP. On success returns the bearer API key + user id, plus a
   * `user_type` echo that tells the client which portal (`/candidate/home`
   * vs `/hunter/workspace`) to redirect to.
   */
  verify: (email: string, code: string, user_type?: OtpUserType) =>
    request<{
      api_key: string;
      user_id: string;
      profile_complete: boolean;
      user_type: OtpUserType;
    }>('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ email, code, user_type }) }),
};

export const jobs = {
  browse: (params: { industry?: string; keyword?: string; cursor?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v != null && q.set(k, String(v)));
    return request<{ items: any[]; next_cursor: number | null }>(`/jobs/browse?${q}`);
  },
  recommended: (limit: number = 20) =>
    request<Array<{ job_id: string; score: number }>>(`/jobs/recommended?limit=${limit}`),
  detail: (id: string) => request<any>(`/jobs/${id}`),
  apply: (id: string, note?: string) =>
    request<{ application_id: number; recommendation_id: string }>(`/jobs/${id}/apply`, {
      method: 'POST', body: JSON.stringify({ note }),
    }),
};

export const applications = {
  list: (limit: number = 20, offset: number = 0) =>
    request<any[]>(`/applications?limit=${limit}&offset=${offset}`),
  detail: (id: number) => request<any>(`/applications/${id}`),
  respond: (id: number, action: 'withdraw' | 'consider_offer' | 'accept_offer' | 'decline_offer') =>
    request<{ status: string }>(`/applications/${id}/respond`, {
      method: 'POST', body: JSON.stringify({ action }),
    }),
};

export const profile = {
  view: () => request<any>('/profile'),
  update: (input: { skills?: string[]; expectations?: object; visibility?: 'public' | 'invitation_only' | 'hidden' }) =>
    request<{ updated: boolean }>('/profile', { method: 'PUT', body: JSON.stringify(input) }),
  auditLog: (limit: number = 50) => request<any[]>(`/profile/audit-log?limit=${limit}`),
};

export const messages = {
  list: (opts: { box?: 'inbox' | 'sent'; unread_only?: boolean; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(opts).forEach(([k, v]) => v != null && q.set(k, String(v)));
    return request<{ items: any[]; unread_count: number; box: string }>(`/messages?${q}`);
  },
  send: (input: { to_user_id: string; content: string; application_id?: number }) =>
    request<{ message_id: number }>('/messages', {
      method: 'POST', body: JSON.stringify(input),
    }),
};
