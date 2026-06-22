// examples/hunter-client.ts
//
// A minimal, copy-paste-able TypeScript client for the Hunter Platform API.
// One file. No build step. The only dependency is `zod` (a standard TypeScript
// schema library; you can remove it and use `as T` casts if you don't want it).
//
// Usage:
//   import { HunterClient, HunterError } from './hunter-client';
//   const client = new HunterClient('http://localhost:3000', process.env.HP_KEY!);
//   const me = await client.getCapabilities();
//
// See examples/README.md for full examples and docs/superpowers/skill.md for
// the complete API reference.

import { z, type ZodTypeAny } from 'zod';

// =============================================================================
// Error type
// =============================================================================

export class HunterError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly traceId: string | null,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HunterError';
  }
}

// =============================================================================
// Client class
// =============================================================================

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RequestOptions {
  body?: unknown;
  /** Optional zod schema. If provided, response.data is parsed and validated. */
  schema?: ZodTypeAny;
}

export type UserType = 'candidate' | 'headhunter' | 'employer';

export class HunterClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  /**
   * Low-level request. Use the typed wrappers below for the common flows;
   * use this for any other endpoint documented in skill.md.
   *
   * @throws {HunterError} on any 4xx or 5xx response.
   */
  async request<T = unknown>(
    method: HttpMethod,
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    // x-trace-id is on every response (Phase 2). Capture for log correlation.
    const traceId = res.headers.get('x-trace-id');
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      data?: T;
      error?: { code: string; message: string; details?: unknown };
    } | null;

    if (!res.ok || data?.ok === false) {
      throw new HunterError(
        res.status,
        data?.error?.code ?? 'UNKNOWN',
        data?.error?.message ?? `HTTP ${res.status}`,
        traceId,
        data?.error?.details,
      );
    }

    const payload = (data?.data ?? null) as T;
    if (opts.schema) return opts.schema.parse(payload) as T;
    return payload;
  }

  // ---------------------------------------------------------------------------
  // Typed convenience methods — the most common flows an external agent needs
  // in the first 5 minutes of integration. Use client.request() for anything
  // not listed here.
  // ---------------------------------------------------------------------------

  /** Discover your own available capabilities + remaining quota. Always call this first. */
  getCapabilities() {
    return this.request('GET', '/v1/capabilities/me');
  }

  /** Register a new user. The `api_key` in the response is shown only once — store it. */
  register(userType: UserType, name: string, contact?: string) {
    return this.request('POST', '/v1/auth/register', {
      body: { user_type: userType, name, contact },
    });
  }

  /** Get a user's status (quota, reputation, account state). Caller provides the user_id. */
  getMyStatus(userId: string) {
    return this.request('GET', `/v1/users/${encodeURIComponent(userId)}/status`);
  }

  /**
   * Headhunter: upload a candidate. `candidateUserId` is the ID of the candidate's
   * own user account (must be registered first via `register('candidate', ...)`).
   */
  uploadCandidate(
    candidateUserId: string,
    data: { name: string; phone: string; email: string },
  ) {
    return this.request('POST', '/v1/headhunter/candidates', {
      body: { candidate_user_id: candidateUserId, ...data },
    });
  }

  /** Headhunter: recommend an anonymized candidate to a job. */
  recommend(anonymizedCandidateId: string, jobId: string) {
    return this.request('POST', '/v1/headhunter/recommendations', {
      body: { anonymized_candidate_id: anonymizedCandidateId, job_id: jobId },
    });
  }

  /** Headhunter: list your submitted recommendations. */
  listMyRecommendations() {
    return this.request('GET', '/v1/headhunter/recommendations');
  }

  /** Employer: express interest in a recommendation (advances state machine pending → employer_interested). */
  expressInterest(recommendationId: string) {
    return this.request(
      'POST',
      `/v1/employer/recommendations/${encodeURIComponent(recommendationId)}/express-interest`,
    );
  }

  /** Employer: unlock contact info after candidate approval (state machine candidate_approved → unlocked). */
  unlockContact(recommendationId: string) {
    return this.request(
      'POST',
      `/v1/employer/recommendations/${encodeURIComponent(recommendationId)}/unlock-contact`,
    );
  }
}
