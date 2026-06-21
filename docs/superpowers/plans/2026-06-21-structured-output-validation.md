# Structured Output Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every API response must be validated against an explicit zod schema before being sent, so handler drift, missing-field bugs, and schema/spec drift are caught at runtime — not by external Agents three months later.

**Architecture:**

- Create `src/main/schemas/` containing one zod schema per response shape, named `<domain><Action>ResponseSchema`.
- Add `src/main/responses.ts` exporting `respond(res, schema, payload, opts)` — wraps `res.json()` with `schema.parse(payload)` first.
- Replace every `res.json({ ok: true, data: ... })` in routes with `respond(res, SomeResponseSchema, { ok: true, data: ... })`.
- Add `pnpm test schemas` that asserts every route file references a response schema for every endpoint (no regressions where someone adds `res.json` without `respond`).
- Existing input zod schemas stay where they are (input validation is already correct). Only output gets the new treatment.

**Tech Stack:** TypeScript, zod 3.23, Express 4, vitest. No new dependencies.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/main/responses.ts` | `respond()` helper that validates and sends; `EnvelopeSchema` for `{ok:true,data:T}` |
| `src/main/schemas/common.ts` | Shared response primitives (`IdResponse`, `StatusResponse`, `UserPublicResponse`, etc.) |
| `src/main/schemas/auth.ts` | `RegisterResponseSchema`, `RotateKeyResponseSchema` |
| `src/main/schemas/users.ts` | `UserStatusResponseSchema`, `UserHistoryResponseSchema` |
| `src/main/schemas/headhunter.ts` | One schema per headhunter endpoint (see Task 5) |
| `src/main/schemas/employer.ts` | One schema per employer endpoint (see Task 6) |
| `src/main/schemas/candidate.ts` | One schema per candidate endpoint (see Task 7) |
| `src/main/schemas/admin.ts` | One schema per admin endpoint (see Task 8) |
| `src/main/schemas/market.ts` | `LeaderboardResponseSchema`, `JobsListResponseSchema` |
| `src/main/schemas/config.ts` | `IndustriesResponseSchema`, `TitleLevelsResponseSchema`, `SalaryBandsResponseSchema` |
| `tests/unit/responses.test.ts` | Unit tests for `respond()` helper |
| `tests/unit/schema-coverage.test.ts` | Asserts every `res.json` in routes/ has a matching schema |

### Modified files

| File | Change |
|---|---|
| `src/main/routes/auth.ts` | Replace `res.json(...)` calls with `respond(...)` |
| `src/main/routes/users.ts` | Same |
| `src/main/routes/headhunter.ts` | Same |
| `src/main/routes/employer.ts` | Same |
| `src/main/routes/candidate.ts` | Same |
| `src/main/routes/admin.ts` | Same |
| `src/main/routes/market.ts` | Same |
| `src/main/routes/config.ts` | Same |
| `package.json` | Add `"test:schemas": "vitest run tests/unit/schema-coverage.test.ts"` |

---

## Task 1: Create the `respond()` helper + `EnvelopeSchema`

**Files:**
- Create: `src/main/responses.ts`
- Test: `tests/unit/responses.test.ts`

- [ ] **Step 1.1: Write failing test for `respond()`**

```typescript
// tests/unit/responses.test.ts
import { describe, it, expect, vi } from 'vitest';
import { respond, EnvelopeSchema } from '../../src/main/responses';
import { z } from 'zod';

describe('respond()', () => {
  it('validates payload against schema and calls res.json with parsed value', () => {
    const schema = EnvelopeSchema(z.object({ id: z.string(), count: z.number() }));
    const res = { json: vi.fn() } as any;
    respond(res, schema, { ok: true, data: { id: 'x', count: 3 } });
    expect(res.json).toHaveBeenCalledWith({ ok: true, data: { id: 'x', count: 3 } });
  });

  it('throws ZodError when payload does not match schema', () => {
    const schema = EnvelopeSchema(z.object({ id: z.string() }));
    const res = { json: vi.fn() } as any;
    expect(() => respond(res, schema, { ok: true, data: { id: 123 } } as any)).toThrow();
  });

  it('strips extra fields when opts.strict is false (default)', () => {
    const schema = EnvelopeSchema(z.object({ id: z.string() }));
    const res = { json: vi.fn() } as any;
    respond(res, schema, { ok: true, data: { id: 'x', extra: 'leak' } } as any);
    expect(res.json).toHaveBeenCalledWith({ ok: true, data: { id: 'x' } });
  });

  it('rejects extra fields when opts.strict is true', () => {
    const schema = EnvelopeSchema(z.object({ id: z.string() }));
    const res = { json: vi.fn() } as any;
    expect(() =>
      respond(res, schema, { ok: true, data: { id: 'x', extra: 'leak' } } as any, { strict: true })
    ).toThrow();
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `cd /d/dev/hunter-platform && pnpm test responses`
Expected: FAIL with "Cannot find module '../../src/main/responses'"

- [ ] **Step 1.3: Implement `respond()`**

```typescript
// src/main/responses.ts
import type { Response } from 'express';
import { z, type ZodTypeAny } from 'zod';

/**
 * Standard API response envelope: either { ok: true, data: T } or
 * { ok: false, error: { code, message, details? } }. Error responses are
 * built by errors.ts middleware and intentionally NOT wrapped here.
 *
 * Helper, not a wrapper: we want every route to declare its data schema
 * explicitly. The route passes the full envelope schema to `respond()`.
 */
export function EnvelopeSchema<T extends ZodTypeAny>(dataSchema: T) {
  return z.object({
    ok: z.literal(true),
    data: dataSchema,
  });
}

/**
 * Error envelope schema — used by routes that return inline errors
 * (rare; most errors flow through errors.ts → error middleware).
 */
export const ErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

export interface RespondOptions {
  /** When true, payload is rejected if it contains fields not in the schema.
   *  Default false (extra fields are stripped, matching existing lenient
   *  behavior — internal callers may add fields for forward-compat). */
  strict?: boolean;
}

/**
 * Validate `payload` against `schema`, then send via `res.json()`.
 *
 * Strips unknown keys by default (z.safeParse → take only declared fields),
 * so handlers can't accidentally leak extra fields to API clients.
 *
 * Throws ZodError on schema mismatch. The error middleware in server.ts
 * converts ZodError into 500 INTERNAL_ERROR with details — log + alert.
 */
export function respond<T extends ZodTypeAny>(
  res: Response,
  schema: T,
  payload: unknown,
  opts: RespondOptions = {},
): void {
  const result = opts.strict
    ? schema.parse(payload)
    : schema.safeParse(payload);

  if (!result.success) {
    if (opts.strict) throw result.error;
    // safeParse failed but strict=false: fall back to permissive send with console.warn
    console.error('[respond] schema mismatch (stripping unknown fields failed too):', result.error.issues);
    throw result.error;
  }

  res.json(result.data);
}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `cd /d/dev/hunter-platform && pnpm test responses`
Expected: PASS (4 tests)

- [ ] **Step 1.5: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/responses.ts tests/unit/responses.test.ts
git commit -m "feat(responses): add respond() helper with zod envelope validation"
```

---

## Task 2: Create shared response primitives

**Files:**
- Create: `src/main/schemas/common.ts`

- [ ] **Step 2.1: Write the shared schemas**

```typescript
// src/main/schemas/common.ts
import { z } from 'zod';

/** ISO 8601 datetime string */
export const ISODateTime = z.string().refine(
  (s) => !Number.isNaN(new Date(s).getTime()),
  { message: 'must be ISO 8601 datetime' }
);

/** Generic ID-shaped string (e.g. user_xxx, job_xxx, rec_xxx) */
export const IdString = z.string().min(1).max(64);

export const OkResponse = z.object({ ok: z.literal(true) });

export const StatusResponse = z.object({ status: z.string() });

export const ErrorEnvelope = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

/** User profile fields safe to expose to any authenticated caller. */
export const UserPublicSchema = z.object({
  id: IdString,
  user_type: z.enum(['candidate', 'headhunter', 'employer']),
  name: z.string(),
  quota_per_day: z.number().int(),
  quota_used: z.number().int(),
  quota_reset_at: ISODateTime,
  reputation: z.number().int(),
  status: z.enum(['active', 'suspended', 'deleted']),
  created_at: ISODateTime,
});
```

- [ ] **Step 2.2: Verify it compiles**

Run: `cd /d/dev/hunter-platform && pnpm typecheck`
Expected: no errors

- [ ] **Step 2.3: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/schemas/common.ts
git commit -m "feat(schemas): add common response primitives"
```

---

## Task 3: Migrate `routes/auth.ts` (register + rotate-key)

**Files:**
- Create: `src/main/schemas/auth.ts`
- Modify: `src/main/routes/auth.ts`

- [ ] **Step 3.1: Write response schemas**

```typescript
// src/main/schemas/auth.ts
import { z } from 'zod';
import { EnvelopeSchema, ISODateTime, IdString } from './common.js';

export const RegisterResponseSchema = EnvelopeSchema(
  z.object({
    id: IdString,
    api_key: z.string().regex(/^hp_live_/),
    quota_per_day: z.number().int().positive(),
    user_type: z.enum(['candidate', 'headhunter', 'employer']),
  })
);

export const RotateKeyResponseSchema = EnvelopeSchema(
  z.object({
    new_api_key: z.string().regex(/^hp_live_/),
    new_prefix: z.string().length(12),
  })
);
```

- [ ] **Step 3.2: Update `routes/auth.ts` to use `respond()`**

Replace the body of each handler in `src/main/routes/auth.ts`. Find:

```typescript
// register handler
res.json({
  ok: true,
  data: {
    id: user.id,
    api_key: user.api_key,
    quota_per_day: user.quota_per_day,
    user_type: user.user_type,
  },
});
```

Replace with:

```typescript
import { respond } from '../responses.js';
import { RegisterResponseSchema, RotateKeyResponseSchema } from '../schemas/auth.js';
// ...inside register handler:
respond(res, RegisterResponseSchema, {
  ok: true,
  data: {
    id: user.id,
    api_key: user.api_key,
    quota_per_day: user.quota_per_day,
    user_type: user.user_type,
  },
});
```

Find the rotate-key handler `res.json({...})` block (after Bug 1 fix it returns `{ new_api_key, new_prefix }`) and replace with:

```typescript
respond(res, RotateKeyResponseSchema, {
  ok: true,
  data: { new_api_key: key, new_prefix: prefix },
});
```

- [ ] **Step 3.3: Run auth tests to verify no regression**

Run: `cd /d/dev/hunter-platform && pnpm test auth rotate-key`
Expected: PASS

- [ ] **Step 3.4: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/schemas/auth.ts src/main/routes/auth.ts
git commit -m "refactor(auth): use respond() with zod response schemas"
```

---

## Task 4: Migrate `routes/users.ts` (status + history)

**Files:**
- Create: extend `src/main/schemas/users.ts`
- Modify: `src/main/routes/users.ts`

- [ ] **Step 4.1: Write response schemas**

```typescript
// src/main/schemas/users.ts
import { z } from 'zod';
import { EnvelopeSchema, ISODateTime, IdString, UserPublicSchema } from './common.js';

export const UserStatusResponseSchema = EnvelopeSchema(UserPublicSchema);

export const ActionHistoryItemSchema = z.object({
  id: z.number().int(),
  user_id: IdString,
  action_type: z.string(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  request_summary_json: z.string().nullable(),
  error_code: z.string().nullable(),
  status: z.enum(['success', 'error']),
  duration_ms: z.number().int().nullable(),
  created_at: ISODateTime,
});

export const UserHistoryResponseSchema = EnvelopeSchema(
  z.array(ActionHistoryItemSchema)
);
```

- [ ] **Step 4.2: Update both handlers in `routes/users.ts`**

```typescript
// at top of file:
import { respond } from '../responses.js';
import { UserStatusResponseSchema, UserHistoryResponseSchema } from '../schemas/users.js';

// inside GET /:id/status handler, replace res.json({...}) with:
respond(res, UserStatusResponseSchema, {
  ok: true,
  data: {
    id: u.id, user_type: u.user_type, name: u.name,
    quota_per_day: u.quota_per_day, quota_used: u.quota_used,
    quota_reset_at: u.quota_reset_at, reputation: u.reputation,
    status: u.status, created_at: u.created_at,
  },
});

// inside GET /:id/history handler, replace res.json({...}) with:
respond(res, UserHistoryResponseSchema, { ok: true, data: list });
```

- [ ] **Step 4.3: Run tests**

Run: `cd /d/dev/hunter-platform && pnpm test users status history`
Expected: PASS

- [ ] **Step 4.4: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/schemas/users.ts src/main/routes/users.ts
git commit -m "refactor(users): use respond() with zod response schemas"
```

---

## Task 5: Migrate `routes/headhunter.ts` (7 endpoints)

**Files:**
- Create: `src/main/schemas/headhunter.ts`
- Modify: `src/main/routes/headhunter.ts`

- [ ] **Step 5.1: Write response schemas**

```typescript
// src/main/schemas/headhunter.ts
import { z } from 'zod';
import { EnvelopeSchema, ISODateTime, IdString } from './common.js';

const SkillListSchema = z.array(z.string());
const SalaryRangeSchema = z.string().nullable();

const RecommendationSchema = z.object({
  id: IdString,
  headhunter_id: IdString,
  employer_id: IdString,
  anonymized_candidate_id: IdString,
  job_id: IdString,
  status: z.enum([
    'pending', 'employer_interested', 'candidate_approved',
    'unlocked', 'rejected_employer', 'rejected_candidate',
    'withdrawn', 'placed',
  ]),
  commission_split_json: z.string().nullable(),
  referrer_headhunter_id: IdString.nullable(),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});

const JobSchema = z.object({
  id: IdString,
  employer_id: IdString.nullable(),
  source_headhunter_id: IdString.nullable(),
  created_for_employer_id: IdString.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  required_skills: z.array(z.string()),
  salary_min: z.number().int().nullable(),
  salary_max: z.number().int().nullable(),
  status: z.enum(['open', 'claimed', 'paused', 'closed', 'filled']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  deadline: z.string().nullable(),
  industry: z.string().nullable(),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});

const AnonymizedCandidatePreviewSchema = z.object({
  anonymized_id: IdString,
  industry: z.string().nullable(),
  title_level: z.string().nullable(),
  years_experience: z.number().int().nullable(),
  salary_range: SalaryRangeSchema,
  education_tier: z.string().nullable(),
  skills: SkillListSchema,
});

export const UploadCandidateResponseSchema = EnvelopeSchema(
  z.object({
    anonymized_id: IdString,
    preview: AnonymizedCandidatePreviewSchema,
  })
);

export const RecommendResponseSchema = EnvelopeSchema(RecommendationSchema);

export const WithdrawResponseSchema = EnvelopeSchema(
  z.object({ status: z.literal('withdrawn') })
);

export const PublishResponseSchema = EnvelopeSchema(
  z.object({ published: z.literal(true) })
);

export const ListRecommendationsResponseSchema = EnvelopeSchema(
  z.array(RecommendationSchema)
);

export const ListMyCandidatesResponseSchema = EnvelopeSchema(
  z.array(AnonymizedCandidatePreviewSchema.extend({
    headhunter_id: IdString,
    is_public_pool: z.union([z.literal(0), z.literal(1)]),
    unlock_status: z.string(),
    created_at: ISODateTime,
    updated_at: ISODateTime,
  }))
);

export const CreateJobForEmployerResponseSchema = EnvelopeSchema(JobSchema);

export const ListMyCreatedJobsResponseSchema = EnvelopeSchema(z.array(JobSchema));
```

- [ ] **Step 5.2: Update `routes/headhunter.ts`**

At top of file:
```typescript
import { respond } from '../responses.js';
import {
  UploadCandidateResponseSchema, RecommendResponseSchema,
  WithdrawResponseSchema, PublishResponseSchema,
  ListRecommendationsResponseSchema, ListMyCandidatesResponseSchema,
  CreateJobForEmployerResponseSchema, ListMyCreatedJobsResponseSchema,
} from '../schemas/headhunter.js';
```

Replace each `res.json({ ok: true, data: ... })` with the matching `respond()`:

- POST /candidates → `UploadCandidateResponseSchema`
- POST /recommendations → `RecommendResponseSchema`
- POST /recommendations/:id/withdraw → `WithdrawResponseSchema`
- POST /candidates/:id/publish-to-pool → `PublishResponseSchema`
- GET /recommendations → `ListRecommendationsResponseSchema`
- GET /candidates → `ListMyCandidatesResponseSchema`
- POST /jobs → `CreateJobForEmployerResponseSchema`
- GET /jobs → `ListMyCreatedJobsResponseSchema`

For GET /candidates the handler currently builds `data` as:
```typescript
const data = list.map((c) => { const { id, skills_json, ...rest } = c; return { ...rest, anonymized_id: id, skills: ... }; });
```

Replace the final `res.json({ ok: true, data })` with:
```typescript
respond(res, ListMyCandidatesResponseSchema, { ok: true, data });
```

- [ ] **Step 5.3: Run headhunter tests**

Run: `cd /d/dev/hunter-platform && pnpm test headhunter`
Expected: PASS

- [ ] **Step 5.4: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/schemas/headhunter.ts src/main/routes/headhunter.ts
git commit -m "refactor(headhunter): use respond() with zod response schemas"
```

---

## Task 6: Migrate `routes/employer.ts` (10 endpoints)

**Files:**
- Create: `src/main/schemas/employer.ts`
- Modify: `src/main/routes/employer.ts`

- [ ] **Step 6.1: Write response schemas**

```typescript
// src/main/schemas/employer.ts
import { z } from 'zod';
import { EnvelopeSchema, ISODateTime, IdString, SkillListSchema } from './common.js';

const JobSchema = z.object({
  id: IdString,
  employer_id: IdString.nullable(),
  source_headhunter_id: IdString.nullable(),
  created_for_employer_id: IdString.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  required_skills: SkillListSchema,
  salary_min: z.number().int().nullable(),
  salary_max: z.number().int().nullable(),
  status: z.enum(['open', 'claimed', 'paused', 'closed', 'filled']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  deadline: z.string().nullable(),
  industry: z.string().nullable(),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});

const TalentPreviewSchema = z.object({
  anonymized_id: IdString,
  industry: z.string().nullable(),
  title_level: z.string().nullable(),
  years_experience: z.number().int().nullable(),
  salary_range: z.string().nullable(),
  education_tier: z.string().nullable(),
  skills: SkillListSchema,
});

const PlacementSchema = z.object({
  id: IdString,
  job_id: IdString,
  anonymized_candidate_id: IdString,
  primary_headhunter_id: IdString.nullable(),
  referrer_headhunter_id: IdString.nullable(),
  employer_id: IdString,
  candidate_user_id: IdString.nullable(),
  annual_salary: z.number().int().positive(),
  platform_fee: z.number().int(),
  primary_share: z.number().int(),
  referrer_share: z.number().int(),
  status: z.enum(['pending_payment', 'paid', 'cancelled']),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});

export const CreatePlacementResponseSchema = EnvelopeSchema(PlacementSchema);
export const ListPlacementsResponseSchema = EnvelopeSchema(z.array(PlacementSchema));
export const CreateJobResponseSchema = EnvelopeSchema(JobSchema);
export const ListMyJobsResponseSchema = EnvelopeSchema(z.array(JobSchema));
export const BrowseTalentResponseSchema = EnvelopeSchema(z.array(TalentPreviewSchema));
export const ExpressInterestResponseSchema = EnvelopeSchema(
  z.object({ status: z.literal('employer_interested') })
);
export const UnlockContactResponseSchema = EnvelopeSchema(
  z.object({ status: z.literal('unlocked') })
);
export const PendingClaimsResponseSchema = EnvelopeSchema(z.array(JobSchema));
export const ClaimJobResponseSchema = EnvelopeSchema(JobSchema);
export const RejectJobResponseSchema = EnvelopeSchema(
  z.object({ status: z.enum(['closed']) })
);
```

- [ ] **Step 6.2: Update `routes/employer.ts`**

```typescript
import { respond } from '../responses.js';
import {
  CreatePlacementResponseSchema, ListPlacementsResponseSchema,
  CreateJobResponseSchema, ListMyJobsResponseSchema,
  BrowseTalentResponseSchema, ExpressInterestResponseSchema,
  UnlockContactResponseSchema, PendingClaimsResponseSchema,
  ClaimJobResponseSchema, RejectJobResponseSchema,
} from '../schemas/employer.js';
```

Replace each handler's `res.json({ ok: true, data: ... })` with the matching `respond()`.

- [ ] **Step 6.3: Run employer tests**

Run: `cd /d/dev/hunter-platform && pnpm test employer`
Expected: PASS

- [ ] **Step 6.4: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/schemas/employer.ts src/main/routes/employer.ts
git commit -m "refactor(employer): use respond() with zod response schemas"
```

---

## Task 7: Migrate `routes/candidate.ts` (5 endpoints + export-my-data privacy)

**Files:**
- Create: `src/main/schemas/candidate.ts`
- Modify: `src/main/routes/candidate.ts`

- [ ] **Step 7.1: Write response schemas**

```typescript
// src/main/schemas/candidate.ts
import { z } from 'zod';
import { EnvelopeSchema, ISODateTime, IdString } from './common.js';

const OpportunitySchema = z.object({
  recommendation_id: IdString,
  job_id: IdString,
  job_title: z.string(),
  job_salary_min: z.number().int().nullable(),
  job_salary_max: z.number().int().nullable(),
  employer_id: IdString,
  status: z.string(),
  requested_at: ISODateTime,
});

const UnlockAuditItemSchema = z.object({
  id: z.number().int(),
  recommendation_id: IdString,
  actor_user_id: IdString,
  action: z.enum(['express_interest', 'unlock_delivery', 'approve_unlock', 'reject_unlock']),
  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  created_at: ISODateTime,
});

const ExportedDataSchema = z.object({
  user: z.object({
    id: IdString, user_type: z.string(), name: z.string().nullable(),
    contact: z.string().nullable(), agent_endpoint: z.string().nullable(),
    reputation: z.number().int(), status: z.string(), created_at: ISODateTime,
  }),
  candidates_private: z.array(z.union([
    // self-submitted row — full PII
    z.object({
      id: IdString, headhunter_id: IdString,
      name: z.string(), phone: z.string(), email: z.string(),
      current_company: z.string().nullable(), current_title: z.string().nullable(),
      expected_salary: z.number().int().nullable(),
      years_experience: z.number().int().nullable(),
      education_school: z.string().nullable(),
      skills: z.array(z.string()),
      created_at: ISODateTime,
    }),
    // third-party-submitted row — redacted
    z.object({
      id: IdString,
      submitted_by_headhunter_id: IdString,
      notice: z.literal('third_party_submitted_data_about_you_redacted'),
      fields_available: z.array(z.string()),
      created_at: ISODateTime,
    }),
  ])),
  candidates_anonymized: z.array(z.unknown()),
  recommendations: z.array(z.unknown()),
  audit_log_entries: z.array(z.unknown()),
  exported_at: ISODateTime,
  format_version: z.string(),
});

export const ListOpportunitiesResponseSchema = EnvelopeSchema(z.array(OpportunitySchema));
export const AccessLogResponseSchema = EnvelopeSchema(z.array(UnlockAuditItemSchema));
export const ExportMyDataResponseSchema = EnvelopeSchema(ExportedDataSchema);
export const ApproveUnlockResponseSchema = EnvelopeSchema(
  z.object({ status: z.literal('candidate_approved') })
);
export const RejectUnlockResponseSchema = EnvelopeSchema(
  z.object({ status: z.literal('rejected_candidate') })
);
export const DeleteMyDataResponseSchema = EnvelopeSchema(
  z.object({
    anonymized_rows_preserved: z.number().int(),
    recommendations_withdrawn: z.number().int(),
    private_pii_rows_cleared: z.number().int(),
    deleted_at: ISODateTime,
  })
);
```

- [ ] **Step 7.2: Update `routes/candidate.ts`**

```typescript
import { respond } from '../responses.js';
import {
  ListOpportunitiesResponseSchema, AccessLogResponseSchema,
  ExportMyDataResponseSchema, ApproveUnlockResponseSchema,
  RejectUnlockResponseSchema, DeleteMyDataResponseSchema,
} from '../schemas/candidate.js';
```

Replace each `res.json(...)` with matching `respond(...)`. Note that `exportMyData` returns plain JSON (not envelope) — current route wraps it manually:

```typescript
res.setHeader('Content-Disposition', 'attachment; filename="my-data.json"');
res.json({ ok: true, data });   // ← replace with:
respond(res, ExportMyDataResponseSchema, { ok: true, data });
```

- [ ] **Step 7.3: Run candidate tests**

Run: `cd /d/dev/hunter-platform && pnpm test candidate`
Expected: PASS (the existing privacy tests in candidate-export.test.ts will validate the union schema).

- [ ] **Step 7.4: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/schemas/candidate.ts src/main/routes/candidate.ts
git commit -m "refactor(candidate): use respond() with zod response schemas (incl. privacy union)"
```

---

## Task 8: Migrate `routes/admin.ts` (15 endpoints)

**Files:**
- Create: `src/main/schemas/admin.ts`
- Modify: `src/main/routes/admin.ts`

- [ ] **Step 8.1: Write response schemas (bulk admin endpoints)**

```typescript
// src/main/schemas/admin.ts
import { z } from 'zod';
import { EnvelopeSchema, ISODateTime, IdString, UserPublicSchema } from './common.js';

const SuspendResultSchema = z.object({
  user_id: IdString,
  status: z.literal('suspended'),
  reason: z.string(),
  suspended_at: ISODateTime,
});
const UnsuspendResultSchema = z.object({
  user_id: IdString,
  status: z.literal('active'),
  unsuspended_at: ISODateTime,
});
const AdjustQuotaResultSchema = z.object({
  user_id: IdString,
  quota_per_day: z.number().int(),
  adjusted_at: ISODateTime,
});

const AdminCandidateSchema = z.object({
  anonymized_id: IdString,
  candidate_user_id: IdString,
  headhunter_id: IdString,
  industry: z.string().nullable(),
  title_level: z.string().nullable(),
  is_public_pool: z.union([z.literal(0), z.literal(1)]),
  unlock_status: z.string(),
  created_at: ISODateTime,
});

const AuditItemSchema = z.object({
  id: z.number().int(),
  recommendation_id: IdString.nullable(),
  actor_user_id: IdString.nullable(),
  action: z.string(),
  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  created_at: ISODateTime,
});

const DeadLetterItemSchema = z.object({
  id: z.number().int(),
  target_user_id: IdString,
  event_type: z.string(),
  attempt_count: z.number().int(),
  last_error: z.string().nullable(),
  next_retry_at: ISODateTime.nullable(),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});

const RateLimitBucketSchema = z.object({
  user_id: IdString,
  bucket_key: z.string(),
  count: z.number().int(),
  window_started_at: ISODateTime,
});

const AdminPlacementSchema = z.object({
  id: IdString,
  job_id: IdString,
  employer_id: IdString,
  anonymized_candidate_id: IdString,
  primary_headhunter_id: IdString.nullable(),
  referrer_headhunter_id: IdString.nullable(),
  annual_salary: z.number().int(),
  platform_fee: z.number().int(),
  primary_share: z.number().int(),
  referrer_share: z.number().int(),
  status: z.enum(['pending_payment', 'paid', 'cancelled']),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});

const AdminLogItemSchema = z.object({
  id: z.number().int(),
  actor: z.string(),
  action_type: z.string(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  reason: z.string().nullable(),
  created_at: ISODateTime,
});

const DashboardStatsSchema = z.object({
  total_users: z.number().int(),
  total_candidates: z.number().int(),
  total_jobs: z.number().int(),
  open_jobs: z.number().int(),
  active_placements: z.number().int(),
  daily_quota_used: z.number().int(),
  webhook_dead_letters: z.number().int(),
});

const ConfigEntrySchema = z.object({
  key: z.string(),
  value: z.unknown(),
  updated_at: ISODateTime,
});

const PlacementsSummarySchema = z.object({
  total_count: z.number().int(),
  pending_payment_count: z.number().int(),
  paid_count: z.number().int(),
  cancelled_count: z.number().int(),
  total_revenue: z.number().int(),
});

export const PingResponseSchema = EnvelopeSchema(
  z.object({ message: z.literal('admin pong') })
);
export const DashboardStatsResponseSchema = EnvelopeSchema(DashboardStatsSchema);
export const ListUsersResponseSchema = EnvelopeSchema(z.array(UserPublicSchema));
export const SuspendUserResponseSchema = EnvelopeSchema(SuspendResultSchema);
export const UnsuspendUserResponseSchema = EnvelopeSchema(UnsuspendResultSchema);
export const AdjustQuotaResponseSchema = EnvelopeSchema(AdjustQuotaResultSchema);
export const ListCandidatesResponseSchema = EnvelopeSchema(z.array(AdminCandidateSchema));
export const RemoveFromPoolResponseSchema = EnvelopeSchema(
  z.object({ anonymized_id: IdString, removed: z.literal(true) })
);
export const AuditListResponseSchema = EnvelopeSchema(z.array(AuditItemSchema));
export const DeadLetterListResponseSchema = EnvelopeSchema(z.array(DeadLetterItemSchema));
export const RetryWebhookResponseSchema = EnvelopeSchema(
  z.object({ id: z.number().int(), status: z.enum(['pending', 'in_flight']) })
);
export const RateLimitBucketsResponseSchema = EnvelopeSchema(z.array(RateLimitBucketSchema));
export const ClearRateLimitResponseSchema = EnvelopeSchema(
  z.object({ user_id: IdString, cleared: z.literal(true) })
);
export const ConfigGetResponseSchema = EnvelopeSchema(ConfigEntrySchema);
export const ConfigPutResponseSchema = EnvelopeSchema(ConfigEntrySchema);
export const AdminPlacementsListResponseSchema = EnvelopeSchema(z.array(AdminPlacementSchema));
export const MarkPaidResponseSchema = EnvelopeSchema(
  z.object({ id: IdString, status: z.literal('paid') })
);
export const CancelPlacementResponseSchema = EnvelopeSchema(
  z.object({ id: IdString, status: z.literal('cancelled') })
);
export const PlacementsSummaryResponseSchema = EnvelopeSchema(PlacementsSummarySchema);
export const AdminLogListResponseSchema = EnvelopeSchema(z.array(AdminLogItemSchema));
```

- [ ] **Step 8.2: Update `routes/admin.ts`**

```typescript
import { respond } from '../responses.js';
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
```

Replace each `res.json({ ok: true, data: ... })` with the matching `respond(...)`.

- [ ] **Step 8.3: Run admin tests**

Run: `cd /d/dev/hunter-platform && pnpm test admin-endpoints`
Expected: PASS

- [ ] **Step 8.4: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/schemas/admin.ts src/main/routes/admin.ts
git commit -m "refactor(admin): use respond() with zod response schemas"
```

---

## Task 9: Migrate `routes/market.ts` and `routes/config.ts`

**Files:**
- Create: `src/main/schemas/market.ts`, `src/main/schemas/config.ts`
- Modify: `src/main/routes/market.ts`, `src/main/routes/config.ts`

- [ ] **Step 9.1: Write market + config schemas**

```typescript
// src/main/schemas/market.ts
import { z } from 'zod';
import { EnvelopeSchema, IdString } from './common.js';

export const LeaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  id: IdString,
  name: z.string(),
  reputation: z.number().int(),
});
export const LeaderboardResponseSchema = EnvelopeSchema(z.array(LeaderboardEntrySchema));

const PublicJobSchema = z.object({
  id: IdString,
  employer_id: IdString,
  title: z.string(),
  description: z.string().nullable(),
  required_skills: z.array(z.string()),
  salary_min: z.number().int().nullable(),
  salary_max: z.number().int().nullable(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  industry: z.string().nullable(),
  created_at: z.string(),
});
export const JobsListResponseSchema = EnvelopeSchema(z.array(PublicJobSchema));
```

```typescript
// src/main/schemas/config.ts
import { z } from 'zod';
import { EnvelopeSchema } from './common.js';

export const IndustrySchema = z.object({
  id: z.string(),
  companies_count: z.number().int().nonnegative(),
});
export const IndustriesResponseSchema = EnvelopeSchema(z.array(IndustrySchema));

export const TitleLevelSchema = z.object({
  code: z.string(),
  match: z.string(),  // regex source
});
export const TitleLevelsResponseSchema = EnvelopeSchema(z.array(TitleLevelSchema));

export const SalaryBandSchema = z.object({
  label: z.string(),
  min: z.number().int().nullable(),
  max: z.number().int().nullable(),
});
export const SalaryBandsResponseSchema = EnvelopeSchema(z.array(SalaryBandSchema));
```

- [ ] **Step 9.2: Update both route files**

```typescript
// market.ts:
import { respond } from '../responses.js';
import { LeaderboardResponseSchema, JobsListResponseSchema } from '../schemas/market.js';
// replace res.json({ ok: true, data: rows }) and res.json({ ok: true, data: jobs })

// config.ts:
import { respond } from '../responses.js';
import {
  IndustriesResponseSchema, TitleLevelsResponseSchema, SalaryBandsResponseSchema,
} from '../schemas/config.js';
// replace three res.json({ ok: true, data: ... })
```

- [ ] **Step 9.3: Run tests**

Run: `cd /d/dev/hunter-platform && pnpm test market config`
Expected: PASS

- [ ] **Step 9.4: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/schemas/market.ts src/main/schemas/config.ts src/main/routes/market.ts src/main/routes/config.ts
git commit -m "refactor(market,config): use respond() with zod response schemas"
```

---

## Task 10: Add regression test — no `res.json` without `respond`

**Files:**
- Create: `tests/unit/schema-coverage.test.ts`
- Modify: `package.json`

- [ ] **Step 10.1: Write coverage test**

```typescript
// tests/unit/schema-coverage.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROUTES_DIR = path.join(__dirname, '../../src/main/routes');

describe('schema coverage: every res.json in routes uses respond()', () => {
  const files = fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.ts'));
  for (const file of files) {
    it(`${file} imports respond and has no bare res.json({ ok: true, data: ... })`, () => {
      const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');

      // Each route file must import respond
      expect(src, `${file} must import respond from '../responses.js'`).toMatch(
        /from ['"]\.\.\/responses\.js['"]/
      );

      // No bare res.json calls that look like response envelopes
      // (legitimate uses are res.status().json({ error }) or res.json({ view_url }) which we allow below)
      const bareResJson = src.match(/res\.json\(\s*\{\s*ok:\s*true/g) ?? [];
      expect(
        bareResJson.length,
        `${file} has ${bareResJson.length} bare res.json({ ok: true, ... }) calls — must use respond()`
      ).toBe(0);
    });
  }
});
```

- [ ] **Step 10.2: Add npm script**

In `package.json` under `"scripts"` add:

```json
"test:schemas": "vitest run tests/unit/schema-coverage.test.ts"
```

- [ ] **Step 10.3: Run coverage test**

Run: `cd /d/dev/hunter-platform && pnpm test:schemas`
Expected: PASS (all route files satisfy the assertion after Tasks 3-9)

- [ ] **Step 10.4: Run full test suite**

Run: `cd /d/dev/hunter-platform && pnpm test`
Expected: ALL PASS (was 509 before; should still be 509+ because we only added assertions, didn't change behavior)

- [ ] **Step 10.5: Commit**

```bash
cd /d/dev/hunter-platform
git add tests/unit/schema-coverage.test.ts package.json
git commit -m "test(schemas): add regression test ensuring all routes use respond()"
```

---

## Task 11: Document the pattern in skill.md

**Files:**
- Modify: `docs/superpowers/skill.md`

- [ ] **Step 11.1: Add "Adding a new endpoint" section**

Find the "API documentation" section in skill.md and add (before "## 设计文档"):

```markdown
## 📐 约定：所有响应必须经过 zod schema 校验

每个 endpoint 的 `data` 形状必须对应 `src/main/schemas/<domain>.ts` 中的一个 zod schema，并由 `respond()` 发送。任何裸 `res.json({ ok: true, data: ... })` 都会被 `tests/unit/schema-coverage.test.ts` 拦截。

新增 endpoint 时：
1. 在 `src/main/schemas/<domain>.ts` 中定义 `<Action>ResponseSchema = EnvelopeSchema(z.object({...}))`
2. 在 router 中 `respond(res, <Action>ResponseSchema, { ok: true, data: ... })`
3. 跑 `pnpm test:schemas` 验证
4. 跑 `pnpm test` 验证完整套件
```

- [ ] **Step 11.2: Commit**

```bash
cd /d/dev/hunter-platform
git add docs/superpowers/skill.md
git commit -m "docs(skill): document structured-output pattern"
```

---

## Self-Review Checklist (run before declaring done)

- [ ] All `res.json({ ok: true, ... })` in `src/main/routes/` have been replaced (no bare envelope)
- [ ] `pnpm test:schemas` passes
- [ ] `pnpm test` passes (509+ tests, no regressions)
- [ ] `pnpm typecheck` passes
- [ ] `pnpm openapi:check` still passes (we did NOT touch openapi.json — schema migration is independent; OpenAPI generation is a follow-up plan)
- [ ] `git log --oneline` shows 8 separate commits (one per task) for easy review
- [ ] Each commit's message starts with `feat(responses)`, `refactor(<domain>):`, or `test(schemas):`

---

## Definition of Done

1. All 8 route files use `respond()` instead of bare `res.json()`.
2. `tests/unit/schema-coverage.test.ts` passes and is wired into `pnpm test:schemas`.
3. Full vitest suite still passes (509+ tests).
4. `pnpm typecheck` and `pnpm openapi:check` both pass.
5. `docs/superpowers/skill.md` documents the pattern.
6. Commits are atomic per task — no mega-commit.

## Out of Scope (deferred)

- **Generating openapi.json FROM zod schemas** — covered in follow-up plan "OpenAPI Generation from Zod".
- **OpenAPI → Agent SDK generation** — separate concern, covered after OpenAPI is auto-generated.
- **Request-body schema migration** — already done with zod, no work needed.
- **Adding schemas to handlers in modules/** — only routes/ is touched in this plan; handlers can return whatever, `respond()` enforces the contract.