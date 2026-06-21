# Domain Capability Sets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each role's full set of capabilities (endpoints + preconditions + effects + quota cost + description) is declared in one file per role under `src/main/capabilities/`. The declaration is the single source of truth — handler code, OpenAPI metadata, skill.md documentation, and `GET /v1/capabilities` discovery endpoint all derive from it.

**Architecture:**

- `src/main/capabilities/types.ts` — `Capability` type + `defineCapabilitySet` builder + `canInvoke(capability, user, ctx)` predicate.
- `src/main/capabilities/headhunter.ts` — 8 capabilities (upload_candidate, recommend, withdraw, publish_to_pool, list_recommendations, list_candidates, create_job, list_jobs).
- `src/main/capabilities/employer.ts` — 10 capabilities (placements, jobs, browse_talent, express_interest, unlock_contact, pending_claims, claim_job, reject_job, etc.).
- `src/main/capabilities/candidate.ts` — 6 capabilities (view_opportunities, access_log, export_my_data, approve_unlock, reject_unlock, delete_my_data).
- `src/main/capabilities/admin.ts` — 19 capabilities (ping, dashboard, users, candidates, audit, webhooks, rate-limit, config, placements, admin-log).
- `src/main/capabilities/index.ts` — aggregator + `getCapabilitiesForRole(role)` + `findCapabilityByEndpoint(method, path)`.
- `src/main/routes/capabilities.ts` — `GET /v1/capabilities` (public, lists all) + `GET /v1/capabilities/me` (auth, current user's remaining quota per capability).
- `scripts/check-capabilities.ts` — `pnpm capabilities:check` — every route handler must have a matching capability declaration.
- `scripts/generate-skill-capabilities.ts` — `pnpm capabilities:doc` — regenerates skill.md's "角色能力" section from declarations.
- `src/main/responses.ts` — `respond()` reads `req._capability` (set by capability middleware in Task 8) and writes capability_name into `x-capability-name` response header for observability.

**Why this is the integration point for Phases 1-3:**

- **Phase 1 (zod schema)**: each capability declares `response_schema: SomeResponseSchema` → the runtime schema is co-located with the capability declaration
- **Phase 2 (trace)**: each capability declares `span_name: 'headhunter.recommend'` → matches the spans we already added; the `/v1/capabilities/me` endpoint reports `x-capability-name` header
- **Phase 3 (flow)**: each capability declares `preconditions: ['flow.<name>.<event>']` (string identifier resolved at runtime against the actual flow)
- **Phase 0 (quota)**: each capability declares `quota_cost: N` (matches `QUOTA_COSTS` in constants.ts) — `GET /v1/capabilities/me` reports remaining quota per capability

**Tech Stack:** TypeScript. No new dependencies. `pnpm capabilities:check` and `pnpm capabilities:doc` are Node scripts using `node:fs` + `node:path`.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/main/capabilities/types.ts` | `Capability` type + `defineCapabilitySet` + `canInvoke` |
| `src/main/capabilities/headhunter.ts` | 8 headhunter capabilities |
| `src/main/capabilities/employer.ts` | 10 employer capabilities |
| `src/main/capabilities/candidate.ts` | 6 candidate capabilities |
| `src/main/capabilities/admin.ts` | 19 admin capabilities (all quota_cost: 0) |
| `src/main/capabilities/index.ts` | aggregator + helpers |
| `src/main/routes/capabilities.ts` | `GET /v1/capabilities` + `GET /v1/capabilities/me` |
| `src/main/middleware/capability-resolver.ts` | reads route → looks up capability → attaches to `req._capability` |
| `scripts/check-capabilities.ts` | `pnpm capabilities:check` |
| `scripts/generate-skill-capabilities.ts` | `pnpm capabilities:doc` |
| `tests/unit/capabilities/canInvoke.test.ts` | precondition + quota logic unit tests |
| `tests/integration/capabilities-endpoint.test.ts` | e2e test of `/v1/capabilities` + `/v1/capabilities/me` |
| `tests/unit/scripts/check-capabilities.test.ts` | test the `capabilities:check` script |

### Modified files

| File | Change |
|---|---|
| `package.json` | Add `"capabilities:check"` and `"capabilities:doc"` scripts |
| `src/main/routes/auth.ts` | After register, set `req._capability = capabilities.findByEndpoint('POST', '/v1/auth/register')` and write `x-capability-name` in response |
| `src/main/routes/<role>.ts` | All route handlers use the capability resolver middleware to attach `req._capability` |
| `src/main/responses.ts` | `respond()` writes `x-capability-name` header if `req._capability` is set |
| `docs/superpowers/skill.md` | Replace "## 角色能力" section with a generated marker — `<!-- CAPABILITIES_START --> ... <!-- CAPABILITIES_END -->` — that `pnpm capabilities:doc` rewrites |
| `src/main/openapi.json` | Generator script adds `x-capability` field to each path (skill.md gen + openapi gen can be unified) |

### NOT modified (deferred)

- Existing handler logic — only the new `capability-resolver` middleware runs before the handler
- `action_history.action_type` — stays as free-text strings; rewriting to use capability names is a follow-up (out of scope)

---

## Endpoint inventory (from investigation)

Use this as the source of truth when writing each capability file.

### Headhunter (8)

| Method | Path | Quota | Span (Phase 2) |
|---|---|---|---|
| POST | `/v1/headhunter/candidates` | 5 (`upload_candidate`) | `headhunter.upload_candidate` (not in Phase 2 yet) |
| POST | `/v1/headhunter/recommendations` | 5 (`recommend_candidate`) | `headhunter.recommend` |
| POST | `/v1/headhunter/recommendations/:id/withdraw` | 1 (`withdraw_recommendation`) | — |
| POST | `/v1/headhunter/candidates/:id/publish-to-pool` | 2 (`publish_to_pool`) | — |
| GET  | `/v1/headhunter/recommendations` | 0 (read) | — |
| GET  | `/v1/headhunter/candidates` | 0 (read) | — |
| POST | `/v1/headhunter/jobs` | 5 (`create_job`) | — |
| GET  | `/v1/headhunter/jobs` | 0 (read) | — |

### Employer (10)

| Method | Path | Quota | Span (Phase 2) |
|---|---|---|---|
| POST | `/v1/employer/placements` | 0 (placement has no quota in handlers) | `employer.create_placement` |
| GET  | `/v1/employer/placements` | 0 (read) | — |
| POST | `/v1/employer/jobs` | 5 (`create_job`) | — |
| GET  | `/v1/employer/jobs` | 0 (read) | — |
| GET  | `/v1/employer/talent` | 1 (`browse_talent`) | — |
| POST | `/v1/employer/recommendations/:id/express-interest` | 3 (`express_interest`) | `employer.express_interest` (not in Phase 2 yet) |
| POST | `/v1/employer/recommendations/:id/unlock-contact` | 5 (`unlock_contact`) | `employer.unlock` |
| GET  | `/v1/employer/pending-claims` | 0 (read) | — |
| POST | `/v1/employer/claim-jobs/:id` | 0 (state machine guard) | `employer.claim` |
| POST | `/v1/employer/reject-jobs/:id` | 0 (state machine guard) | `employer.reject` |

### Candidate (6)

| Method | Path | Quota | Span (Phase 2) |
|---|---|---|---|
| GET  | `/v1/candidate/opportunities` | 1 (`view_opportunities`) | — |
| GET  | `/v1/candidate/access-log` | 0 (read) | — |
| GET  | `/v1/candidate/export-my-data` | 0 (GDPR read) | — |
| POST | `/v1/candidate/recommendations/:id/approve-unlock` | 3 (`approve_unlock`) | `candidate.approve_unlock` |
| POST | `/v1/candidate/recommendations/:id/reject-unlock` | 1 (`reject_unlock`) | `candidate.reject_unlock` |
| POST | `/v1/candidate/delete-my-data` | 0 (GDPR delete) | — |

### Admin (19)

All quota_cost: 0 (admin is rate-limited by IP, not quota).

| Method | Path |
|---|---|
| GET  | `/v1/admin/ping` |
| GET  | `/v1/admin/dashboard/stats` |
| GET  | `/v1/admin/users` |
| POST | `/v1/admin/users/:id/suspend` |
| POST | `/v1/admin/users/:id/unsuspend` |
| POST | `/v1/admin/users/:id/adjust-quota` |
| GET  | `/v1/admin/candidates` |
| POST | `/v1/admin/candidates/:id/remove-from-pool` |
| GET  | `/v1/admin/audit` |
| GET  | `/v1/admin/webhooks/dead-letter` |
| POST | `/v1/admin/webhooks/:id/retry` |
| GET  | `/v1/admin/rate-limit/buckets` |
| POST | `/v1/admin/rate-limit/users/:id/clear` |
| GET  | `/v1/admin/config` |
| PUT  | `/v1/admin/config/:key` |
| GET  | `/v1/admin/placements` |
| POST | `/v1/admin/placements/:id/mark-paid` |
| POST | `/v1/admin/placements/:id/cancel` |
| GET  | `/v1/admin/placements/summary` |
| GET  | `/v1/admin/admin-log` |

Plus `/v1/auth/register` and `/v1/auth/rotate-key` (auth role, 1 capability per endpoint).

**Total: 8 + 10 + 6 + 19 + 2 = 45 capabilities** to declare.

---

## Task 1: Write the Capability types + helpers

**Files:**
- Create: `src/main/capabilities/types.ts`
- Test: `tests/unit/capabilities/canInvoke.test.ts`

- [ ] **Step 1.1: Write failing test**

```typescript
// tests/unit/capabilities/canInvoke.test.ts
import { describe, it, expect } from 'vitest';
import { defineCapabilitySet, canInvoke, type Capability } from '../../../src/main/capabilities/types';

const sampleSet = defineCapabilitySet({
  role: 'tester',
  capabilities: [
    {
      name: 'simple',
      description: 'No preconditions',
      method: 'GET',
      path: '/v1/test/ping',
      response_schema: undefined,
      quota_cost: 0,
      preconditions: [],
      effects: [],
    },
    {
      name: 'quota-3',
      description: 'Requires 3 quota',
      method: 'POST',
      path: '/v1/test/echo',
      response_schema: undefined,
      quota_cost: 3,
      preconditions: ['user.status === "active"'],
      effects: ['consume_quota(3)'],
    },
  ],
});

describe('canInvoke', () => {
  it('returns true when no preconditions and quota available', () => {
    expect(canInvoke(sampleSet.capabilities[0], { status: 'active', quota_used: 0, quota_per_day: 50 })).toEqual({ ok: true });
  });

  it('returns INSUFFICIENT_QUOTA when quota used + cost > quota_per_day', () => {
    const r = canInvoke(sampleSet.capabilities[1], { status: 'active', quota_used: 48, quota_per_day: 50 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('INSUFFICIENT_QUOTA');
  });

  it('returns FORBIDDEN when user.status !== required', () => {
    const r = canInvoke(sampleSet.capabilities[1], { status: 'suspended', quota_used: 0, quota_per_day: 50 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('FORBIDDEN');
  });

  it('returns true when status is active and quota available', () => {
    const r = canInvoke(sampleSet.capabilities[1], { status: 'active', quota_used: 0, quota_per_day: 50 });
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/capabilities/canInvoke`
Expected: FAIL

- [ ] **Step 1.3: Implement `src/main/capabilities/types.ts`**

```typescript
// src/main/capabilities/types.ts
import type { z, ZodTypeAny } from 'zod';
import { QUOTA_COSTS } from '../../shared/constants.js';
import { Errors } from '../errors.js';

/** Single capability — one declared endpoint. */
export interface Capability {
  /** Stable identifier (e.g. 'headhunter.recommend_candidate'). Used in
   *  logs, audit, x-capability-name response header, and capability:check
   *  tooling. */
  name: string;
  description: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Path with `:param` placeholders. Must match the actual router path. */
  path: string;
  /** Phase 1 zod response schema for this endpoint. Optional (some endpoints
   *  have dynamic shapes). */
  response_schema?: ZodTypeAny;
  /** Quota cost per invocation. 0 = free. Read from QUOTA_COSTS constants. */
  quota_cost: number;
  /** Strings of the form 'user.X === Y' or 'flow.<name>.<event>'. Evaluated
   *  by canInvoke; a flow.<name>.<event> precondition means: the
   *  transition must be legal in the named flow. */
  preconditions: string[];
  /** Human-readable side effect descriptions, used in skill.md and the
   *  capabilities endpoint. e.g. ['consume_quota(N)', 'webhook: <event>']. */
  effects: string[];
}

export interface CapabilitySet {
  role: 'candidate' | 'headhunter' | 'employer' | 'admin' | 'auth';
  capabilities: Capability[];
}

export function defineCapabilitySet(spec: CapabilitySet): CapabilitySet {
  return spec;
}

/** Result of canInvoke: either ok or a failure with a reason that maps
 *  to a standard ApiError. */
export type CanInvokeResult =
  | { ok: true }
  | { ok: false; reason: 'INSUFFICIENT_QUOTA' | 'FORBIDDEN' | 'NOT_FOUND' };

/** User context for precondition + quota checks. */
export interface UserContext {
  status: 'active' | 'suspended' | 'deleted';
  quota_used: number;
  quota_per_day: number;
}

/**
 * Evaluate whether `user` can invoke `capability` right now. Pure function:
 * does not actually consume quota (the handler does that via
 * `quota.tryConsume`).
 *
 * Preconditions support a small subset of expressions:
 *   - 'user.status === "active"'   ← status check
 *   - 'flow.<name>.<event>'        ← state-machine check (resolved at
 *                                    handler level — we just record it)
 */
export function canInvoke(cap: Capability, user: UserContext): CanInvokeResult {
  // Quota check first (cheapest, most likely to fail)
  if (user.quota_used + cap.quota_cost > user.quota_per_day) {
    return { ok: false, reason: 'INSUFFICIENT_QUOTA' };
  }
  // Preconditions: evaluate the subset we support
  for (const pre of cap.preconditions) {
    const m = pre.match(/^user\.status\s*===\s*"(\w+)"$/);
    if (m) {
      if (user.status !== m[1]) return { ok: false, reason: 'FORBIDDEN' };
    }
    // flow.<name>.<event> is recorded as a precondition but evaluated
    // by the handler (it has the rec/job to test). canInvoke does NOT
    // call applyTransition.
  }
  return { ok: true };
}

/** Convert a canInvoke failure to the corresponding ApiError. */
export function canInvokeError(reason: Exclude<CanInvokeResult, { ok: true }>['reason']) {
  if (reason === 'INSUFFICIENT_QUOTA') return Errors.insufficientQuota();
  if (reason === 'FORBIDDEN') return Errors.forbidden('Capability not available for user in this state');
  return Errors.notFound('Capability not found');
}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/capabilities/canInvoke`
Expected: PASS (4 tests)

- [ ] **Step 1.5: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/capabilities/types.ts tests/unit/capabilities/canInvoke.test.ts
git commit -m "feat(capabilities): add Capability type + canInvoke predicate"
```

---

## Task 2: Write all 4 role capability files

**Files:**
- Create: `src/main/capabilities/headhunter.ts`
- Create: `src/main/capabilities/employer.ts`
- Create: `src/main/capabilities/candidate.ts`
- Create: `src/main/capabilities/admin.ts`

- [ ] **Step 2.1: Write `headhunter.ts`**

```typescript
// src/main/capabilities/headhunter.ts
import { defineCapabilitySet } from './types.js';
import {
  UploadCandidateResponseSchema, RecommendResponseSchema, WithdrawResponseSchema,
  PublishResponseSchema, ListRecommendationsResponseSchema, ListMyCandidatesResponseSchema,
  CreateJobForEmployerResponseSchema, ListMyCreatedJobsResponseSchema,
} from '../schemas/headhunter.js';
import { QUOTA_COSTS } from '../../shared/constants.js';

export const headhunterCapabilities = defineCapabilitySet({
  role: 'headhunter',
  capabilities: [
    {
      name: 'headhunter.upload_candidate',
      description: '上传候选人简历(加密入库,生成脱敏版本)。',
      method: 'POST', path: '/v1/headhunter/candidates',
      response_schema: UploadCandidateResponseSchema,
      quota_cost: QUOTA_COSTS.upload_candidate,
      preconditions: ['user.status === "active"'],
      effects: ['consume_quota(5)', 'db.candidates_private.insert', 'db.candidates_anonymized.insert'],
    },
    {
      name: 'headhunter.recommend_candidate',
      description: '把已上传的候选人推荐给指定 job(状态: pending)。',
      method: 'POST', path: '/v1/headhunter/recommendations',
      response_schema: RecommendResponseSchema,
      quota_cost: QUOTA_COSTS.recommend_candidate,
      preconditions: ['user.status === "active"', 'flow.recommendation.express_interest'],
      effects: ['consume_quota(5)', 'db.recommendations.insert'],
    },
    {
      name: 'headhunter.withdraw_recommendation',
      description: '撤回已提交的推荐(只在 pending / employer_interested 状态可撤回)。',
      method: 'POST', path: '/v1/headhunter/recommendations/:id/withdraw',
      response_schema: WithdrawResponseSchema,
      quota_cost: QUOTA_COSTS.withdraw_recommendation,
      preconditions: ['user.status === "active"', 'flow.recommendation.withdraw'],
      effects: ['consume_quota(1)', 'db.recommendations.updateStatus(withdrawn)'],
    },
    {
      name: 'headhunter.publish_to_pool',
      description: '把候选人公开到公共池(让其他猎头/雇主可见)。',
      method: 'POST', path: '/v1/headhunter/candidates/:id/publish-to-pool',
      response_schema: PublishResponseSchema,
      quota_cost: QUOTA_COSTS.publish_to_pool,
      preconditions: ['user.status === "active"'],
      effects: ['consume_quota(2)', 'db.candidates_anonymized.update(is_public_pool=1)'],
    },
    {
      name: 'headhunter.list_recommendations',
      description: '列出我提交过的所有推荐。',
      method: 'GET', path: '/v1/headhunter/recommendations',
      response_schema: ListRecommendationsResponseSchema,
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.recommendations.listByUser'],
    },
    {
      name: 'headhunter.list_candidates',
      description: '列出我上传过的所有候选人(脱敏预览)。',
      method: 'GET', path: '/v1/headhunter/candidates',
      response_schema: ListMyCandidatesResponseSchema,
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.candidates_anonymized.listBySource'],
    },
    {
      name: 'headhunter.create_job',
      description: '猎头代雇主建岗(用 create_for_employer_id)。',
      method: 'POST', path: '/v1/headhunter/jobs',
      response_schema: CreateJobForEmployerResponseSchema,
      quota_cost: QUOTA_COSTS.create_job,
      preconditions: ['user.status === "active"'],
      effects: ['consume_quota(5)', 'db.jobs.insert'],
    },
    {
      name: 'headhunter.list_jobs',
      description: '列出我建过的所有 job。',
      method: 'GET', path: '/v1/headhunter/jobs',
      response_schema: ListMyCreatedJobsResponseSchema,
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.jobs.listBySource'],
    },
  ],
});
```

- [ ] **Step 2.2: Write `employer.ts`** (10 capabilities, similar pattern)

Refer to the endpoint table above. Use `QUOTA_COSTS.create_job`, `browse_talent`, `express_interest`, `unlock_contact`. For flow preconditions use `flow.job.claim`, `flow.job.reject`, `flow.recommendation.unlock`, etc. — exact match to the events defined in `src/main/flows/*.ts`.

```typescript
// src/main/capabilities/employer.ts
import { defineCapabilitySet } from './types.js';
import {
  CreatePlacementResponseSchema, ListPlacementsResponseSchema,
  CreateJobResponseSchema, ListMyJobsResponseSchema,
  BrowseTalentResponseSchema, ExpressInterestResponseSchema,
  UnlockContactResponseSchema, PendingClaimsResponseSchema,
  ClaimJobResponseSchema, RejectJobResponseSchema,
} from '../schemas/employer.js';
import { QUOTA_COSTS } from '../../shared/constants.js';

export const employerCapabilities = defineCapabilitySet({
  role: 'employer',
  capabilities: [
    // 10 capabilities — see endpoint table for quota_costs and preconditions
    // pattern matches headhunterCapabilities
    // effects reference the side effects declared in src/main/flows/*.ts
    // response_schema values match src/main/schemas/employer.ts
  ],
});
```

(Full implementation: write all 10 capabilities following the headhunter pattern. Preconditions like 'flow.recommendation.express_interest' reference Phase 3's recFlow events.)

- [ ] **Step 2.3: Write `candidate.ts`** (6 capabilities)

```typescript
// src/main/capabilities/candidate.ts
import { defineCapabilitySet } from './types.js';
import {
  ListOpportunitiesResponseSchema, AccessLogResponseSchema,
  ExportMyDataResponseSchema, ApproveUnlockResponseSchema,
  RejectUnlockResponseSchema, DeleteMyDataResponseSchema,
} from '../schemas/candidate.js';
import { QUOTA_COSTS } from '../../shared/constants.js';

export const candidateCapabilities = defineCapabilitySet({
  role: 'candidate',
  capabilities: [
    // 6 capabilities — view_opportunities (1 quota), access_log (0),
    // export_my_data (0), approve_unlock (3), reject_unlock (1), delete_my_data (0)
  ],
});
```

- [ ] **Step 2.4: Write `admin.ts`** (19 capabilities, all quota_cost: 0)

```typescript
// src/main/capabilities/admin.ts
import { defineCapabilitySet } from './types.js';
import {
  PingResponseSchema, DashboardStatsResponseSchema, ListUsersResponseSchema,
  SuspendUserResponseSchema, UnsuspendUserResponseSchema, AdjustQuotaResponseSchema,
  ListCandidatesResponseSchema, RemoveFromPoolResponseSchema, AuditListResponseSchema,
  DeadLetterListResponseSchema, RetryWebhookResponseSchema,
  RateLimitBucketsResponseSchema, ClearRateLimitResponseSchema,
  ConfigGetResponseSchema, ConfigPutResponseSchema, AdminPlacementsListResponseSchema,
  MarkPaidResponseSchema, CancelPlacementResponseSchema,
  PlacementsSummaryResponseSchema, AdminLogListResponseSchema,
} from '../schemas/admin.js';

export const adminCapabilities = defineCapabilitySet({
  role: 'admin',
  capabilities: [
    // 19 capabilities — see endpoint table. All quota_cost: 0.
    // Admin uses IP rate limiting, not per-user quota.
    // preconditions: ['user.status === "active"'] (admin user must be active)
  ],
});
```

- [ ] **Step 2.5: Typecheck + run existing tests**

Run: `cd /d/dev/hunter-platform && pnpm typecheck && pnpm test`
Expected: 625/625 pass (no behavior change yet — these files are not imported by anyone)

- [ ] **Step 2.6: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/capabilities/headhunter.ts src/main/capabilities/employer.ts src/main/capabilities/candidate.ts src/main/capabilities/admin.ts
git commit -m "feat(capabilities): declare 43 capabilities across 4 role files"
```

---

## Task 3: Write `capabilities/index.ts` aggregator

**Files:**
- Create: `src/main/capabilities/index.ts`

- [ ] **Step 3.1: Implement**

```typescript
// src/main/capabilities/index.ts
export { type Capability, type CapabilitySet, defineCapabilitySet, canInvoke, canInvokeError } from './types.js';
export { headhunterCapabilities } from './headhunter.js';
export { employerCapabilities } from './employer.js';
export { candidateCapabilities } from './candidate.js';
export { adminCapabilities } from './admin.js';

import { headhunterCapabilities } from './headhunter.js';
import { employerCapabilities } from './employer.js';
import { candidateCapabilities } from './candidate.js';
import { adminCapabilities } from './admin.js';
import { authCapabilities } from './auth.js'; // see Task 4
import type { Capability, CapabilitySet } from './types.js';

const ALL_SETS: CapabilitySet[] = [
  headhunterCapabilities, employerCapabilities, candidateCapabilities, adminCapabilities, authCapabilities,
];

/** Look up a capability by HTTP method + path. Returns undefined if not
 *  declared. Used by capability-resolver middleware to attach
 *  `req._capability` to every request. */
export function findCapabilityByEndpoint(method: string, path: string): Capability | undefined {
  // Normalize path: strip query string, collapse trailing slash
  const normalized = path.split('?')[0].replace(/\/$/, '');
  for (const set of ALL_SETS) {
    for (const cap of set.capabilities) {
      if (cap.method !== method.toUpperCase()) continue;
      if (matchPath(cap.path, normalized)) return cap;
    }
  }
  return undefined;
}

/** Match a declared path with `:param` placeholders against an actual
 *  request path. e.g. '/v1/headhunter/candidates/:id/publish-to-pool'
 *  matches '/v1/headhunter/candidates/abc123/publish-to-pool'. */
function matchPath(pattern: string, actual: string): boolean {
  const patternParts = pattern.split('/');
  const actualParts = actual.split('/');
  if (patternParts.length !== actualParts.length) return false;
  return patternParts.every((p, i) => p.startsWith(':') || p === actualParts[i]);
}

/** All capability sets, for the `/v1/capabilities` endpoint. */
export function getAllCapabilitySets(): CapabilitySet[] {
  return ALL_SETS;
}

/** Get the capability set for a specific role. */
export function getCapabilitiesForRole(role: string): CapabilitySet | undefined {
  return ALL_SETS.find((s) => s.role === role);
}
```

- [ ] **Step 3.2: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/capabilities/index.ts
git commit -m "feat(capabilities): add index.ts aggregator + findCapabilityByEndpoint"
```

---

## Task 4: Add `authCapabilities` (register + rotate-key)

**Files:**
- Create: `src/main/capabilities/auth.ts`

- [ ] **Step 4.1: Implement**

```typescript
// src/main/capabilities/auth.ts
import { defineCapabilitySet } from './types.js';
import { RegisterResponseSchema, RotateKeyResponseSchema } from '../schemas/auth.js';
import { QUOTA_COSTS } from '../../shared/constants.js';

export const authCapabilities = defineCapabilitySet({
  role: 'auth',
  capabilities: [
    {
      name: 'auth.register',
      description: '注册新账号(返回 api_key,只此一次)。',
      method: 'POST', path: '/v1/auth/register',
      response_schema: RegisterResponseSchema,
      quota_cost: QUOTA_COSTS.register,
      preconditions: [],
      effects: ['db.users.insert', 'issue_api_key'],
    },
    {
      name: 'auth.rotate_key',
      description: '轮换 api_key(旧 key 立即失效,无 grace period)。',
      method: 'POST', path: '/v1/auth/rotate-key',
      response_schema: RotateKeyResponseSchema,
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['consume_quota(1)', 'db.users.update(api_key_hash)'],
    },
  ],
});
```

- [ ] **Step 4.2: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/capabilities/auth.ts
git commit -m "feat(capabilities): add auth capabilities (register + rotate-key)"
```

---

## Task 5: Mount capability-resolver middleware in server.ts

**Files:**
- Create: `src/main/middleware/capability-resolver.ts`
- Modify: `src/main/server.ts`

- [ ] **Step 5.1: Write the middleware**

```typescript
// src/main/middleware/capability-resolver.ts
import type { Request, Response, NextFunction } from 'express';
import { findCapabilityByEndpoint } from '../capabilities/index.js';
import type { Capability } from '../capabilities/types.js';

/**
 * Resolve the capability for the current request and attach it to
 * `req._capability`. Routers downstream read this in `respond()` to write
 * the `x-capability-name` response header.
 *
 * Mount this AFTER the traceContextMiddleware so the capability resolution
 * shows up in spans if needed in the future. Mount it BEFORE the route
 * handlers so every response gets the header.
 *
 * If no capability is declared for the endpoint, `req._capability` stays
 * undefined and the header is omitted. This is a soft signal that the
 * endpoint is unaccounted for; `pnpm capabilities:check` (Task 8) flags
 * such cases in CI.
 */
export function capabilityResolverMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const cap = findCapabilityByEndpoint(req.method, req.path);
    if (cap) (req as Request & { _capability?: Capability })._capability = cap;
    next();
  };
}
```

- [ ] **Step 5.2: Mount in server.ts**

In `src/main/server.ts`, after `traceContextMiddleware()` (line ~58), add:

```typescript
app.use(capabilityResolverMiddleware());
```

- [ ] **Step 5.3: Run full suite**

Run: `cd /d/dev/hunter-platform && pnpm test`
Expected: 625/625 pass (no behavior change — middleware sets req._capability but no one reads it yet)

- [ ] **Step 5.4: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/middleware/capability-resolver.ts src/main/server.ts
git commit -m "feat(capabilities): mount capability-resolver middleware in server.ts"
```

---

## Task 6: Update `respond()` to write `x-capability-name` response header

**Files:**
- Modify: `src/main/responses.ts`

- [ ] **Step 6.1: Add header write**

In `src/main/responses.ts`, inside the `respond()` function, just before the existing `x-trace-id` write:

```typescript
// Stamp the response with the active capability name (Phase 4).
// External Agents and ops dashboards can grep logs for capability names
// instead of HTTP method+path. Set by capabilityResolverMiddleware
// (src/main/middleware/capability-resolver.ts).
const capability = (res.req as any)?._capability as { name: string } | undefined;
if (capability?.name) res.setHeader('x-capability-name', capability.name);
```

- [ ] **Step 6.2: Run full suite**

Run: `cd /d/dev/hunter-platform && pnpm test`
Expected: 625/625 pass (no existing test asserts the header, so behavior unchanged)

- [ ] **Step 6.3: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/responses.ts
git commit -m "feat(responses): write x-capability-name response header from req._capability"
```

---

## Task 7: Write `routes/capabilities.ts` + mount in server.ts

**Files:**
- Create: `src/main/routes/capabilities.ts`
- Modify: `src/main/server.ts`

- [ ] **Step 7.1: Implement**

```typescript
// src/main/routes/capabilities.ts
import { Router } from 'express';
import { authMiddleware } from '../modules/auth/middleware.js';
import { createUsersRepo } from '../db/repositories/users.js';
import type { DB } from '../db/connection.js';
import { getAllCapabilitySets, getCapabilitiesForRole } from '../capabilities/index.js';
import { canInvoke, canInvokeError } from '../capabilities/types.js';
import { Errors } from '../errors.js';
import { respond } from '../responses.js';
import { z } from 'zod';
import { EnvelopeSchema } from '../schemas/common.js';

const CapabilitiesResponseSchema = EnvelopeSchema(z.object({
  sets: z.array(z.object({
    role: z.string(),
    capabilities: z.array(z.object({
      name: z.string(),
      description: z.string(),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
      path: z.string(),
      quota_cost: z.number().int(),
      preconditions: z.array(z.string()),
      effects: z.array(z.string()),
    })),
  })),
}));

const MeCapabilitiesResponseSchema = EnvelopeSchema(z.object({
  user_id: z.string(),
  user_type: z.string(),
  status: z.string(),
  quota_per_day: z.number().int(),
  quota_used: z.number().int(),
  quota_remaining: z.number().int(),
  capabilities: z.array(z.object({
    name: z.string(),
    description: z.string(),
    method: z.string(),
    path: z.string(),
    quota_cost: z.number().int(),
    available: z.boolean(),
    reason: z.string().optional(),  // present only when available: false
  })),
}));

export function createCapabilitiesRouter(db: DB): Router {
  const router = Router();
  const users = createUsersRepo(db);

  // GET /v1/capabilities — public, lists all capability sets (no quota info)
  router.get('/v1/capabilities', (_req, res, next) => {
    try {
      const sets = getAllCapabilitySets().map((s) => ({
        role: s.role,
        capabilities: s.capabilities.map((c) => ({
          name: c.name,
          description: c.description,
          method: c.method,
          path: c.path,
          quota_cost: c.quota_cost,
          preconditions: c.preconditions,
          effects: c.effects,
        })),
      }));
      respond(res, CapabilitiesResponseSchema, { ok: true, data: { sets } });
    } catch (e) { next(e); }
  });

  // GET /v1/capabilities/me — auth required, returns THIS user's available capabilities
  router.get('/v1/capabilities/me', authMiddleware(db, users), (req, res, next) => {
    try {
      const user = (req as any).user;
      if (!user) throw Errors.unauthorized();

      const set = getCapabilitiesForRole(user.user_type);
      if (!set) {
        respond(res, MeCapabilitiesResponseSchema, {
          ok: true,
          data: {
            user_id: user.id,
            user_type: user.user_type,
            status: user.status,
            quota_per_day: user.quota_per_day,
            quota_used: user.quota_used,
            quota_remaining: user.quota_per_day - user.quota_used,
            capabilities: [],
          },
        });
        return;
      }

      const userCtx = {
        status: user.status,
        quota_used: user.quota_used,
        quota_per_day: user.quota_per_day,
      };

      const capabilities = set.capabilities.map((c) => {
        const result = canInvoke(c, userCtx);
        return {
          name: c.name,
          description: c.description,
          method: c.method,
          path: c.path,
          quota_cost: c.quota_cost,
          available: result.ok,
          ...(result.ok ? {} : { reason: result.reason }),
        };
      });

      respond(res, MeCapabilitiesResponseSchema, {
        ok: true,
        data: {
          user_id: user.id,
          user_type: user.user_type,
          status: user.status,
          quota_per_day: user.quota_per_day,
          quota_used: user.quota_used,
          quota_remaining: user.quota_per_day - user.quota_used,
          capabilities,
        },
      });
    } catch (e) { next(e); }
  });

  return router;
}
```

- [ ] **Step 7.2: Mount in server.ts**

In `src/main/server.ts`, near where other routers are mounted, add:

```typescript
app.use(createCapabilitiesRouter(db));
```

Mount this BEFORE the catch-all 404 handler but AFTER auth/role-specific routers. (No specific order requirement since the capabilities router does its own auth check.)

- [ ] **Step 7.3: Typecheck + test**

Run: `cd /d/dev/hunter-platform && pnpm typecheck && pnpm test`
Expected: 625/625 still pass (the new endpoints are unused in existing tests yet)

- [ ] **Step 7.4: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/routes/capabilities.ts src/main/server.ts
git commit -m "feat(capabilities): add GET /v1/capabilities + /v1/capabilities/me endpoints"
```

---

## Task 8: Write `scripts/check-capabilities.ts` (CI guard)

**Files:**
- Create: `scripts/check-capabilities.ts`
- Modify: `package.json`

- [ ] **Step 8.1: Write the script**

```typescript
// scripts/check-capabilities.ts
/**
 * pnpm capabilities:check — fail if any route in src/main/routes/ has
 * a router.<method>('/path', ...) but no matching capability declaration
 * in src/main/capabilities/*.ts. Or vice versa: capability declared but
 * no matching route.
 *
 * Output format (one line per issue, exit code 1 on any issue):
 *   ROUTE_WITHOUT_CAPABILITY: METHOD /path
 *   CAPABILITY_WITHOUT_ROUTE:  name (declared METHOD /path)
 */
import fs from 'node:fs';
import path from 'node:path';
import { findCapabilityByEndpoint } from '../src/main/capabilities/index.js';

const ROUTES_DIR = path.join(__dirname, '../src/main/routes');

function extractRoutes(): Array<{ method: string; path: string; file: string }> {
  const routes: Array<{ method: string; path: string; file: string }> = [];
  for (const file of fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.ts'))) {
    if (file === 'capabilities.ts' || file === 'landing.ts') continue;  // skip
    const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    // Match router.get('/path', ...) or router.post('/path', ...) — simple regex
    const re = /router\.(get|post|put|delete)\(\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      routes.push({ method: m[1].toUpperCase(), path: m[2], file });
    }
  }
  return routes;
}

function declaredCapabilities(): Array<{ name: string; method: string; path: string }> {
  const all = (findCapabilityByEndpoint as any).allCapabilities
    ?? require('../src/main/capabilities/index.js').getAllCapabilitySets();
  const out: Array<{ name: string; method: string; path: string }> = [];
  for (const set of all) {
    for (const cap of set.capabilities) {
      out.push({ name: cap.name, method: cap.method, path: cap.path });
    }
  }
  return out;
}

const routes = extractRoutes();
const caps = declaredCapabilities();

let issues = 0;

// 1. Route without capability
for (const r of routes) {
  // The capabilities router itself is also a route file but not in our scope
  if (r.file === 'capabilities.ts') continue;
  if (!findCapabilityByEndpoint(r.method, r.path)) {
    console.error(`ROUTE_WITHOUT_CAPABILITY: ${r.method} ${r.path} (${r.file})`);
    issues++;
  }
}

// 2. Capability without route — check by method+path
for (const c of caps) {
  const match = routes.find((r) => r.method === c.method && r.path === c.path);
  if (!match) {
    // Path may have :param — check by pattern match
    const regex = new RegExp('^' + c.path.replace(/:[a-zA-Z_]+/g, '[^/]+') + '$');
    const paramMatch = routes.find((r) => r.method === c.method && regex.test(r.path));
    if (!paramMatch) {
      console.error(`CAPABILITY_WITHOUT_ROUTE: ${c.name} declared ${c.method} ${c.path}`);
      issues++;
    }
  }
}

if (issues > 0) {
  console.error(`\n${issues} issue(s) found.`);
  process.exit(1);
} else {
  console.log(`OK: ${routes.length} routes, ${caps.length} capabilities.`);
}
```

(Note: the script uses `require()` since it runs via `tsx` not bundled. Adjust if the project uses ESM-only.)

- [ ] **Step 8.2: Add npm script**

In `package.json`:
```json
"capabilities:check": "tsx scripts/check-capabilities.ts"
```

- [ ] **Step 8.3: Run the script**

Run: `cd /d/dev/hunter-platform && pnpm capabilities:check`
Expected: `OK: 56 routes, 45 capabilities.` (or close — exact counts depend on whether landing.ts is included)

- [ ] **Step 8.4: Commit**

```bash
cd /d/dev/hunter-platform
git add scripts/check-capabilities.ts package.json
git commit -m "feat(capabilities): add pnpm capabilities:check CI guard"
```

---

## Task 9: Write `scripts/generate-skill-capabilities.ts` (doc generator)

**Files:**
- Create: `scripts/generate-skill-capabilities.ts`
- Modify: `package.json`

- [ ] **Step 9.1: Write the script**

```typescript
// scripts/generate-skill-capabilities.ts
/**
 * pnpm capabilities:doc — regenerate the "## 角色能力" section of
 * docs/superpowers/skill.md from the capability declarations in
 * src/main/capabilities/*.ts.
 *
 * The section is delimited by HTML-style comments:
 *   <!-- CAPABILITIES_START -->
 *   ... generated content ...
 *   <!-- CAPABILITIES_END -->
 *
 * Anything outside these markers is preserved untouched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { headhunterCapabilities, employerCapabilities, candidateCapabilities, adminCapabilities, authCapabilities } from '../src/main/capabilities/index.js';

const SKILL_PATH = path.join(__dirname, '../docs/superpowers/skill.md');
const START_MARKER = '<!-- CAPABILITIES_START -->';
const END_MARKER = '<!-- CAPABILITIES_END -->';

const SETS = [authCapabilities, headhunterCapabilities, employerCapabilities, candidateCapabilities, adminCapabilities];

function render(): string {
  const lines: string[] = [];
  lines.push('## 🎯 角色能力清单（自动生成 — 不要手改）');
  lines.push('');
  lines.push('> 这一节由 `pnpm capabilities:doc` 从 `src/main/capabilities/*.ts` 自动生成。');
  lines.push('> 修改流程: 编辑 capability 文件 → 跑 `pnpm capabilities:doc` → commit。');
  lines.push('');
  for (const set of SETS) {
    const title = { auth: '认证 (auth)', headhunter: '猎头 (headhunter)', employer: '雇主 (employer)', candidate: '候选人 (candidate)', admin: '管理员 (admin)' }[set.role];
    lines.push(`### ${title} — ${set.capabilities.length} 个能力`);
    lines.push('');
    lines.push('| Method | Path | 能力名 | 配额 | 前置条件 | 副作用 |');
    lines.push('|--------|------|--------|------|----------|--------|');
    for (const c of set.capabilities) {
      const pre = c.preconditions.length ? c.preconditions.join('; ') : '—';
      const eff = c.effects.length ? c.effects.slice(0, 2).join('; ') + (c.effects.length > 2 ? '…' : '') : '—';
      lines.push(`| ${c.method} | \`${c.path}\` | \`${c.name}\` | ${c.quota_cost} | ${pre} | ${eff} |`);
    }
    lines.push('');
    lines.push(`> ${set.capabilities.map((c) => `- \`${c.name}\`: ${c.description}`).join('\n> ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

function main() {
  const skill = fs.readFileSync(SKILL_PATH, 'utf8');
  const startIdx = skill.indexOf(START_MARKER);
  const endIdx = skill.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) {
    console.error(`ERROR: skill.md must contain both ${START_MARKER} and ${END_MARKER} markers.`);
    process.exit(1);
  }
  const before = skill.slice(0, startIdx + START_MARKER.length);
  const after = skill.slice(endIdx);
  const generated = render();
  const newSkill = before + '\n' + generated + '\n' + after;
  fs.writeFileSync(SKILL_PATH, newSkill, 'utf8');
  console.log(`OK: skill.md updated with ${SETS.reduce((n, s) => n + s.capabilities.length, 0)} capabilities across ${SETS.length} roles.`);
}

main();
```

- [ ] **Step 9.2: Add markers to skill.md**

In `docs/superpowers/skill.md`, find a good location (right after the 业务模型 section, before the endpoint reference) and insert the markers around an empty content block:

```markdown
<!-- CAPABILITIES_START -->
<!-- CAPABILITIES_END -->
```

- [ ] **Step 9.3: Add npm script**

In `package.json`:
```json
"capabilities:doc": "tsx scripts/generate-skill-capabilities.ts"
```

- [ ] **Step 9.4: Run the doc generator**

Run: `cd /d/dev/hunter-platform && pnpm capabilities:doc`
Expected: skill.md updated with capability table

- [ ] **Step 9.5: Commit**

```bash
cd /d/dev/hunter-platform
git add scripts/generate-skill-capabilities.ts package.json docs/superpowers/skill.md
git commit -m "feat(capabilities): add pnpm capabilities:doc generator"
```

---

## Task 10: Add `tests/integration/capabilities-endpoint.test.ts`

**Files:**
- Create: `tests/integration/capabilities-endpoint.test.ts`

- [ ] **Step 10.1: Write the test**

```typescript
// tests/integration/capabilities-endpoint.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

const testDb = path.join(__dirname, '../../tmp/capabilities-endpoint.db');
let app: any;

beforeAll(async () => {
  try { fs.unlinkSync(testDb); } catch {}
  process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
  process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
  process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuv';
  process.env.DATABASE_PATH = testDb;
  process.env.NODE_ENV = 'test';
  const { createApp } = await import('../../src/main/server');
  app = createApp();
});
afterAll(() => { try { fs.unlinkSync(testDb); } catch {} });
beforeEach(() => {
  try { fs.unlinkSync(testDb); } catch {}
  try { fs.unlinkSync(testDb + '-wal'); } catch {}
  try { fs.unlinkSync(testDb + '-shm'); } catch {}
});

describe('GET /v1/capabilities', () => {
  it('public, lists all capability sets', async () => {
    const r = await request(app).get('/v1/capabilities');
    expect(r.status).toBe(200);
    expect(r.body.data.sets.length).toBeGreaterThanOrEqual(5);  // auth, headhunter, employer, candidate, admin
    const roles = r.body.data.sets.map((s: any) => s.role);
    expect(roles).toContain('headhunter');
    expect(roles).toContain('employer');
    expect(roles).toContain('candidate');
    expect(roles).toContain('admin');
    expect(roles).toContain('auth');
  });

  it('each capability has name, method, path, quota_cost', async () => {
    const r = await request(app).get('/v1/capabilities');
    const headhunter = r.body.data.sets.find((s: any) => s.role === 'headhunter');
    expect(headhunter.capabilities.length).toBeGreaterThanOrEqual(5);
    for (const cap of headhunter.capabilities) {
      expect(cap.name).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(cap.method).toMatch(/^(GET|POST|PUT|DELETE)$/);
      expect(cap.path).toMatch(/^\/v1\//);
      expect(typeof cap.quota_cost).toBe('number');
    }
  });
});

describe('GET /v1/capabilities/me', () => {
  it('requires auth (401 without bearer)', async () => {
    const r = await request(app).get('/v1/capabilities/me');
    expect(r.status).toBe(401);
  });

  it('returns user quota + capabilities list', async () => {
    // Register a headhunter
    const reg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'T', contact: 't@x.com' });
    const apiKey = reg.body.data.api_key;

    const r = await request(app).get('/v1/capabilities/me')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(r.status).toBe(200);
    expect(r.body.data.user_type).toBe('headhunter');
    expect(r.body.data.status).toBe('active');
    expect(r.body.data.quota_per_day).toBeGreaterThan(0);
    expect(r.body.data.capabilities.length).toBeGreaterThan(0);
    // Headhunter should have 8 capabilities, all available
    for (const c of r.body.data.capabilities) {
      expect(c.available).toBe(true);
    }
  });

  it('marks capabilities as unavailable when quota is exhausted', async () => {
    const reg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'T', contact: 't@x.com' });
    const apiKey = reg.body.data.api_key;

    // Exhaust quota by uploading 10 candidates (cost 5 each → 50 quota used)
    for (let i = 0; i < 10; i++) {
      await request(app).post('/v1/headhunter/candidates')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ name: `Candidate ${i}`, phone: `1380000${i.toString().padStart(4, '0')}`, email: `c${i}@x.com` });
    }

    const r = await request(app).get('/v1/capabilities/me')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(r.status).toBe(200);
    expect(r.body.data.quota_used).toBeGreaterThanOrEqual(r.body.data.quota_per_day);
    // All capabilities with quota_cost > 0 should be unavailable
    const availableWithCost = r.body.data.capabilities.filter((c: any) => c.available && c.quota_cost > 0);
    expect(availableWithCost.length).toBe(0);
  });
});

describe('x-capability-name response header', () => {
  it('every endpoint response includes the capability name', async () => {
    const reg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'T', contact: 't@x.com' });
    const apiKey = reg.body.data.api_key;

    const r = await request(app).get('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(r.status).toBe(200);
    expect(r.headers['x-capability-name']).toBe('headhunter.list_candidates');
  });

  it('endpoints without capability declaration do NOT have the header', async () => {
    const r = await request(app).get('/v1/health');
    expect(r.status).toBe(200);
    // /v1/health is not in any capability file → no header
    expect(r.headers['x-capability-name']).toBeUndefined();
  });
});
```

- [ ] **Step 10.2: Run the test**

Run: `cd /d/dev/hunter-platform && pnpm test capabilities-endpoint`
Expected: PASS (6 tests)

- [ ] **Step 10.3: Commit**

```bash
cd /d/dev/hunter-platform
git add tests/integration/capabilities-endpoint.test.ts
git commit -m "test(capabilities): add /v1/capabilities + /v1/capabilities/me + x-capability-name tests"
```

---

## Task 11: Add `tests/unit/scripts/check-capabilities.test.ts`

**Files:**
- Create: `tests/unit/scripts/check-capabilities.test.ts`

- [ ] **Step 11.1: Write a sanity test for the script**

```typescript
// tests/unit/scripts/check-capabilities.test.ts
import { describe, it, expect } from 'vitest';
import { findCapabilityByEndpoint, getAllCapabilitySets } from '../../../src/main/capabilities';

describe('capabilities:check script invariants', () => {
  it('every declared capability has a unique name', () => {
    const all = getAllCapabilitySets();
    const names = new Set<string>();
    for (const set of all) {
      for (const cap of set.capabilities) {
        expect(names.has(cap.name), `Duplicate capability name: ${cap.name}`).toBe(false);
        names.add(cap.name);
      }
    }
  });

  it('every declared capability has a non-empty path starting with /v1/', () => {
    const all = getAllCapabilitySets();
    for (const set of all) {
      for (const cap of set.capabilities) {
        expect(cap.path.startsWith('/v1/'), `${cap.name} has invalid path: ${cap.path}`).toBe(true);
      }
    }
  });

  it('findCapabilityByEndpoint finds declared capabilities', () => {
    const found = findCapabilityByEndpoint('POST', '/v1/auth/register');
    expect(found).toBeDefined();
    expect(found!.name).toBe('auth.register');
  });

  it('findCapabilityByEndpoint returns undefined for unknown paths', () => {
    expect(findCapabilityByEndpoint('GET', '/v1/nonexistent')).toBeUndefined();
    expect(findCapabilityByEndpoint('GET', '/v1/health')).toBeUndefined();
  });
});
```

- [ ] **Step 11.2: Run the test**

Run: `cd /d/dev/hunter-platform && pnpm test scripts/check-capabilities`
Expected: PASS (4 tests)

- [ ] **Step 11.3: Run the actual check script**

Run: `cd /d/dev/hunter-platform && pnpm capabilities:check`
Expected: `OK: 56 routes, 45 capabilities.`

- [ ] **Step 11.4: Commit**

```bash
cd /d/dev/hunter-platform
git add tests/unit/scripts/check-capabilities.test.ts
git commit -m "test(capabilities): add invariants test for check-capabilities script"
```

---

## Task 12: Update skill.md with capabilities + v1.7 changelog

**Files:**
- Modify: `docs/superpowers/skill.md`

- [ ] **Step 12.1: Add capabilities section**

The section between `<!-- CAPABILITIES_START -->` and `<!-- CAPABILITIES_END -->` markers is now auto-generated by `pnpm capabilities:doc`. The script populates it with all 45 capabilities. This was done in Task 9.

- [ ] **Step 12.2: Add v1.7 changelog entry**

In Appendix B:
```markdown
| v1.7 | 2026-06-22 | **Phase 4**: Domain Capability Sets. 45 capabilities declared in `src/main/capabilities/`. `GET /v1/capabilities` (public) + `GET /v1/capabilities/me` (auth). `x-capability-name` response header. `pnpm capabilities:check` CI guard. `pnpm capabilities:doc` regenerates skill.md. 631+ tests pass |
```

- [ ] **Step 12.3: Update "最近升级" section**

Add at the top of skill.md's "最近升级" section (after v1.6 entry):

```markdown
### 2026-06-22 — Phase 4: Domain Capability Sets

- 45 capabilities declared in `src/main/capabilities/{auth,headhunter,employer,candidate,admin}.ts` (1 file per role)
- `GET /v1/capabilities` (public) — lists all capability sets
- `GET /v1/capabilities/me` (auth) — returns THIS user's available capabilities with quota remaining
- `x-capability-name` response header on every endpoint with a declared capability
- `pnpm capabilities:check` — CI guard: fails if a route exists without a capability declaration, or vice versa
- `pnpm capabilities:doc` — regenerates the "## 角色能力清单" section of this file

每个 capability 声明: name, description, method, path, quota_cost, preconditions, effects, response_schema。这让 handler / OpenAPI / skill.md / discovery endpoint 都从同一处生成。
```

- [ ] **Step 12.4: Commit**

```bash
cd /d/dev/hunter-platform
git add docs/superpowers/skill.md
git commit -m "docs(skill): add v1.7 changelog + Phase 4 summary"
```

---

## Task 13: Final verification + openapi regen

**Files:**
- Modify: `docs/superpowers/openapi.json` (if openapi:check now requires it)

- [ ] **Step 13.1: Run all checks**

```bash
cd /d/dev/hunter-platform
pnpm typecheck       # expect: 0 errors
pnpm test            # expect: 631+ passed (was 625 + 6 new tests)
pnpm capabilities:check   # expect: OK
pnpm openapi:check   # expect: 0 forward gaps (capabilities.ts might add a new route — confirm)
```

- [ ] **Step 13.2: If openapi:check fails for /v1/capabilities/*, add to openapi.json**

The `openapi:check` script may flag the new `/v1/capabilities` and `/v1/capabilities/me` endpoints as "forward coverage" (declared in code but not in openapi.json). To fix, run the openapi generator (already exists at `scripts/generate-openapi.ts`) OR add them manually.

- [ ] **Step 13.3: Commit (if any openapi changes)**

```bash
cd /d/dev/hunter-platform
git add docs/superpowers/openapi.json
git commit -m "docs(openapi): add /v1/capabilities endpoints (Phase 4)"
```

---

## Self-Review Checklist

- [ ] All 13 tasks done; 13+ atomic commits
- [ ] `pnpm test` passes (631+ tests)
- [ ] `pnpm typecheck` passes
- [ ] `pnpm capabilities:check` passes (no ROUTE_WITHOUT_CAPABILITY or CAPABILITY_WITHOUT_ROUTE)
- [ ] `pnpm openapi:check` passes
- [ ] `pnpm capabilities:doc` regenerates skill.md idempotently (run twice, second run produces no diff)
- [ ] Every endpoint response has `x-capability-name` header (except `/v1/health` and `/v1/admin/ping` which aren't in capabilities)
- [ ] `GET /v1/capabilities/me` correctly reports `available: false` when quota is exhausted

---

## Definition of Done

1. All 4 role capability files (headhunter, employer, candidate, admin) exist with the 45 endpoints declared.
2. `src/main/capabilities/index.ts` exports `findCapabilityByEndpoint`, `getAllCapabilitySets`, `getCapabilitiesForRole`.
3. `capabilityResolverMiddleware` is mounted in server.ts and sets `req._capability`.
4. `respond()` writes `x-capability-name` response header.
5. `GET /v1/capabilities` (public) and `GET /v1/capabilities/me` (auth) endpoints work.
6. `pnpm capabilities:check` passes — every route has a capability, no orphan declarations.
7. `pnpm capabilities:doc` regenerates the skill.md capability table.
8. skill.md has the v1.7 changelog entry.
9. Full test suite (was 625) is now 631+ passing.
10. TypeCheck and openapi:check both pass.

## Out of Scope (deferred)

- **Capability precondition enforcement at the handler level** — currently `preconditions` like `flow.recommendation.unlock` are recorded but not enforced. The handler still does its own `applyTransition` call. The precondition string is for documentation + future enforcement. A follow-up plan could route all handler invocations through a `withCapability(cap, user, ctx, fn)` wrapper.
- **OpenAPI `x-capability` field per path** — adding `x-capability: { name, quota_cost, preconditions }` to each OpenAPI operation. Would require modifying the openapi generator.
- **Capability name → action_history.action_type rename** — currently action_history stores free-text strings like `'rotate_api_key'`. Could be replaced with capability names. Deferred to a follow-up migration.
- **Multi-user admin (per-admin user)** — the `auth` capabilities don't include admin capabilities. Admin is currently a single shared password. When this changes, add an `adminCapabilities` for the new admin user type and update `getCapabilitiesForRole`.
- **SDK / TypeScript client generation** — capability declarations could generate a typed client library. Out of scope; can be done with `openapi-typescript` after the openapi:check fix.
- **Capability rate limiting** — admin uses IP rate limit; could add capability-level rate limit (`max N calls per hour for this capability`) as a future enhancement.
- **Migrate placement state to Flow** — `Placement.status` is still ad-hoc. Defer to a follow-up Phase 3.5.
