# Phase 7 — Fill Skipped Schema-Shape Tests Design Spec

**Date:** 2026-06-22
**Status:** Approved
**Project:** hunter-platform
**Branch:** main
**Author:** ZCode (brainstorming session)
**Depends on:** Phase 6 commit `5a4e9a0` (admin schema fixes that un-skipped 3 capabilities)

## 1. Background & Goal

After Phase 5+6, the `schema-shape` conformance test runs 46 tests (one per capability), of which **22 are skipped**. These skips fall into four clear categories:

- **Category A — destructive side-effects (2 tests):** `auth.rotate_key` and `candidate.delete_my_data`. They mutate shared state (rotating API key, wiping PII) and break the shared `beforeAll` setup.
- **Category B — already-exercised-in-beforeAll (1 test):** `headhunter.recommend_candidate`. Called once in beforeAll to set up downstream tests; calling again in the loop would 409.
- **Category C — multi-step prerequisite flow (7 tests):** `employer.express_interest`, `employer.unlock_contact`, `employer.placement` (or `create_placement`), `employer.claim_job`, `employer.reject_job`, `candidate.approve_unlock`, `candidate.reject_unlock`. Each requires a recommendation to be in a specific state (`pending` → `employer_interested` → `candidate_approved`).
- **Category D — needs pre-existing DB records (11 tests):** admin endpoints that operate on rows that don't exist on a fresh DB (placement, queued webhook, rate-limit bucket, public-pool candidate, etc.).
- **Category E — test-helper bug (1 test):** `admin.adjust_user_quota` is skipped because `pathParamsFor()` doesn't have a case for it, so the path becomes `/v1/admin/users//adjust-quota` (empty `:id`) and the route returns 404. This is a **test bug, not a production bug**.

**Goal:** Convert all 22 skipped tests into real passing tests. After Phase 7, every declared capability has a passing schema-shape test (or is moved to an explicitly-named destructive-side-effect file with a documented reason).

## 2. Scope

**Total work:** 22 skipped tests converted → 0 skipped. New test files for destructive-side-effect cases. One small fix to the test helper.

**Out of scope** (deferred to Phase 8+):
- Filling the 46 `it.todo` stubs in `_generated.test.ts` (these are intentional; coverage is from real tests).
- Fixing the underlying admin endpoints that 500 on bare DB (those work correctly when records exist; the test just needs to create records).
- Adding tests for the destructive side-effects themselves (e.g., a test that asserts `auth.rotate_key` actually invalidates the old key — that test already exists in `auth.test.ts`; this spec just moves the schema-shape test to a different file).

## 3. Architecture

### 3.1 Test file reorganization

**Current:** all 46 tests live in one monolithic `tests/integration/skill-md-conformance/schema-shape.test.ts` with a single shared `beforeAll`.

**Target:** split into 4 files based on test isolation needs:

| File | Tests | beforeAll |
|---|---|---|
| `schema-shape.test.ts` (existing, modified) | 36 capabilities that don't share-mutate state | Single shared beforeAll, unchanged |
| `schema-shape-destructive.test.ts` (new) | 2 destructive side-effects (auth.rotate_key, candidate.delete_my_data) | Per-test freshApp — each `it()` gets its own DB |
| `schema-shape-flow.test.ts` (new) | 7 multi-step flow capabilities (Category C) | Shared beforeAll builds the full pending→approved flow |
| `schema-shape-admin-precondition.test.ts` (new) | 11 admin capabilities that need pre-existing records (Category D) | Shared beforeAll pre-creates rows via raw SQL |

The `schema-shape` index file becomes a thin re-exporter of these 4 files (or vitest picks them up automatically since they all live in the same directory).

### 3.2 Per-category fix strategy

#### Category A: Destructive side-effects → new `schema-shape-destructive.test.ts`

Each test gets a fresh `freshApp()` in its own `it()` block (no shared beforeAll). The test exists purely to verify the **response shape** is correct (envelope + zod schema match), not the side-effect behavior. Side-effect behavior is covered by the original test files in this directory.

```typescript
// tests/integration/skill-md-conformance/schema-shape-destructive.test.ts
import { describe, it, expect } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient } from './_setup';
import { RotateKeyResponseSchema } from '../../../src/main/schemas/auth';

describe('schema-shape: destructive side-effects (isolated DB per test)', () => {
  it('auth.rotate_key: POST /v1/auth/rotate-key', async () => {
    const f = await freshApp('shape-destr-rotate');
    try {
      const client = new ConformanceClient(f.app);
      const reg = await client.request({
        method: 'POST', path: '/v1/auth/register',
        body: { user_type: 'candidate', name: 'DestrC', contact: 'd@x.com' },
      });
      const key = reg.data.data.api_key as string;
      const r = await client.request({
        method: 'POST', path: '/v1/auth/rotate-key', auth: key,
        schema: RotateKeyResponseSchema,
      });
      expect(r.status).toBe(200);
    } finally { cleanupDb('shape-destr-rotate'); }
  });

  it('candidate.delete_my_data: POST /v1/candidate/delete-my-data', async () => {
    // Similar — fresh app, register candidate, call delete-my-data, verify response.
  });
});
```

#### Category B: Already-exercised → un-skip in place

`headhunter.recommend_candidate` is called in beforeAll. The current `it.skip` should become a real `it()` that re-uses the recommendation id from the shared beforeAll and just calls the endpoint again... but that would 409 (duplicate). **Better approach:** change the existing `it.skip` to assert that the existing rec from beforeAll has a valid response shape by directly calling `findCapabilityByEndpoint` and validating the response was already captured. Or simpler: re-issue a recommend with a different candidate (use the second one we can create in beforeAll).

**Simplest path:** keep the skip in the main file (it really is duplicate), and add the schema-shape test to `schema-shape-flow.test.ts` instead, which builds a fresh flow.

#### Category C: Multi-step flows → new `schema-shape-flow.test.ts`

Build a complete `pending → employer_interested → candidate_approved` recommendation in beforeAll, then exercise each step endpoint with the right preconditions.

```typescript
// tests/integration/skill-md-conformance/schema-shape-flow.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient } from './_setup';
// Import the relevant response schemas for each flow capability.

describe('schema-shape: multi-step flow (shared flow setup)', () => {
  let client: ConformanceClient;
  let hKey: string, eKey: string, cKey: string;
  let eJobId: string;
  let recId: string;     // recommendation in 'candidate_approved' state

  beforeAll(async () => {
    const f = await freshApp('shape-flow');
    client = new ConformanceClient(f.app);
    hKey = await client.register('headhunter', 'FlowH', 'fh@x.com');
    eKey = await client.register('employer', 'FlowE', 'fe@x.com');
    cKey = await client.register('candidate', 'FlowC', 'fc@x.com');

    // Build the full flow
    const candRes = await client.request({
      method: 'POST', path: '/v1/headhunter/candidates', auth: hKey,
      body: { name: 'FlowCand', phone: '13800000010', email: 'fc10@x.com' },
    });
    const candAnonId = candRes.data.data.anonymized_id;

    const eJobRes = await client.request({
      method: 'POST', path: '/v1/employer/jobs', auth: eKey,
      body: { title: 'FlowJob', description: 'd' },
    });
    eJobId = eJobRes.data.data.id;

    const recRes = await client.request({
      method: 'POST', path: '/v1/headhunter/recommendations', auth: hKey,
      body: { anonymized_candidate_id: candAnonId, job_id: eJobId },
    });
    recId = recRes.data.data.id;

    // Advance to 'employer_interested' so unlock_contact and candidate.* have meaningful coverage
    await client.request({
      method: 'POST', path: `/v1/employer/recommendations/${recId}/express-interest`,
      auth: eKey,
    });
    await client.request({
      method: 'POST', path: `/v1/candidate/recommendations/${recId}/approve-unlock`,
      auth: cKey,
    });
  });
  afterAll(() => cleanupDb('shape-flow'));

  it('employer.express_interest: POST /v1/employer/recommendations/:id/express-interest', async () => {
    // Build a fresh rec in 'pending' state and call express_interest
    // (the shared rec is now past this point). Or just verify the existing call's response.
  });

  // ... 6 more tests for the other flow capabilities
});
```

The cleanest pattern: each test creates **its own fresh rec** if the state prerequisite differs from the shared one. For example, `express_interest` test needs a `pending` rec, but the shared rec is already in `candidate_approved`. The test creates a new rec in beforeEach, calls the endpoint, then asserts.

**Revised pattern:** use `beforeEach` to create a fresh rec per test, then call the endpoint being tested. beforeAll only does the one-time user/job registration. This avoids the "shared rec is in wrong state" problem.

#### Category D: Admin pre-existing records → new `schema-shape-admin-precondition.test.ts`

```typescript
// tests/integration/skill-md-conformance/schema-shape-admin-precondition.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { freshApp, cleanupDb, ConformanceClient, adminAuthHeader } from './_setup';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

describe('schema-shape: admin endpoints needing pre-existing records', () => {
  let client: ConformanceClient;
  let db: InstanceType<typeof DatabaseSync>;
  let candidateAnonId: string;
  let placementId: string;
  let webhookId: number;

  beforeAll(async () => {
    const f = await freshApp('shape-admin');
    client = new ConformanceClient(f.app);
    db = new DatabaseSync(f.dbPath);

    // Pre-create the rows that the admin endpoints need to operate on.

    // 1. Register a candidate via the public API so we have a valid candidate_user_id
    const hKey = await client.register('headhunter', 'AdminH', 'ah@x.com');
    const cReg = await client.register('candidate', 'AdminC', 'ac@x.com');
    const candRes = await client.request({
      method: 'POST', path: '/v1/headhunter/candidates', auth: hKey,
      body: { name: 'AdminCand', phone: '13800000020', email: 'ac20@x.com' },
    });
    candidateAnonId = candRes.data.data.anonymized_id;

    // 2. Create a placement row via direct DB insert (no public API for this in tests)
    db.prepare(`
      INSERT INTO placements (id, job_id, anonymized_candidate_id, candidate_user_id, primary_headhunter_id, status, annual_salary, platform_fee, primary_share, referrer_share, created_at, updated_at)
      VALUES ('placement_test_1', 'job_test_1', ?, ?, ?, 'pending_payment', 1000000, 100000, 70000, 0, '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z')
    `).run(candidateAnonId, cReg.split('_').slice(-1)[0], hKey.split('_').slice(-1)[0]);
    placementId = 'placement_test_1';

    // 3. Create a webhook dead-letter row
    db.prepare(`
      INSERT INTO webhook_delivery_queue (target_user_id, event_type, payload_enc, contains_pii, status, attempt_count, max_attempts, last_error, created_at, updated_at)
      VALUES (?, 'candidate.unlocked', 'enc_blob', 1, 'dead_letter', 3, 3, 'HTTP 500', '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z')
    `).run(cReg);
    webhookId = Number(db.prepare("SELECT last_insert_rowid() as id").get().id);

    // 4. Create a rate-limit bucket row so listBuckets returns ≥1
    db.prepare(`
      INSERT INTO rate_limit_buckets (user_id, window_start, window_seconds, request_count, expires_at)
      VALUES (?, '2026-06-22T00:00:00Z', 86400, 5, '2026-06-23T00:00:00Z')
    `).run(cReg);

    // 5. Add a config key for put_config
    db.prepare(`
      INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('test_key', '"test_value"', '2026-06-22T00:00:00Z')
    `).run();
  });
  afterAll(() => {
    db.close();
    cleanupDb('shape-admin');
  });

  it('admin.remove_from_pool: POST /v1/admin/candidates/:id/remove-from-pool', async () => {
    const r = await client.request({
      method: 'POST', path: `/v1/admin/candidates/${candidateAnonId}/remove-from-pool`,
      auth: adminAuthHeader(),
    });
    expect(r.status).toBe(200);
  });

  // ... 10 more tests
});
```

For the 3 admin endpoints currently noted as "500 on bare DB" (`rate_limit_buckets`, `clear_user_rate_limit`, `placements_summary`), pre-creating the right rows will turn the 500 into a 200.

For `admin.suspend_user` (currently "409 if not active") and `admin.unsuspend_user` (currently "409 if not suspended"): register a fresh candidate in the right state for each.

For `admin.adjust_user_quota`: the test helper bug fix (Category E).

### 3.3 Category E: test helper bug fix (trivial)

In `tests/integration/skill-md-conformance/schema-shape.test.ts`, add to `pathParamsFor`:

```typescript
case 'admin.adjust_user_quota':
  return { id: client.ids.get('candidate') ?? '' };
```

Then remove `'admin.adjust_user_quota'` from the `skipAdmin` Set.

## 4. File Manifest

### New files (3)
| File | Responsibility |
|---|---|
| `tests/integration/skill-md-conformance/schema-shape-destructive.test.ts` | 2 destructive-side-effect tests (auth.rotate_key, candidate.delete_my_data) with per-test freshApp |
| `tests/integration/skill-md-conformance/schema-shape-flow.test.ts` | 7 multi-step flow tests with shared beforeAll that builds the full flow |
| `tests/integration/skill-md-conformance/schema-shape-admin-precondition.test.ts` | 11 admin tests that need pre-created records |

### Modified files (1)
| File | Change |
|---|---|
| `tests/integration/skill-md-conformance/schema-shape.test.ts` | Remove skip entries (Category A, B, C, D, E); add 1 line to `pathParamsFor` for `admin.adjust_user_quota`; remove 1 line from `skipAdmin` Set |

### Untouched
- All production code (this is test-only work)
- All Phase 1-6 changes

## 5. Test count projection

| Before Phase 7 | After Phase 7 |
|---|---|
| `schema-shape` suite: 46 tests, 22 skipped, 24 pass | `schema-shape` suite: 46 tests, 0 skipped, 46 pass (across 4 files, but vitest sees them as one suite via filename glob) |
| `pnpm test` total: 757 pass, 22 skip, 46 todo | `pnpm test` total: 779 pass, 0 skip, 46 todo (+22 net pass) |

## 6. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Pre-creating rows via raw SQL drifts from production code (e.g., a column rename) | Executor MUST read the actual migrations (v001-v012) before writing INSERT statements. The schema-shape test will catch drift loudly because of Phase 6's `strict: true`. |
| `beforeAll` for the flow test reuses user keys across tests, so one test's POST could affect another's state | Use `beforeEach` (not beforeAll) for the per-test setup, so each test gets a fresh rec/job. |
| The `headhunter.recommend_candidate` test would 409 if re-called with the same candidate+job | Move it to the flow test where the new per-test rec is created. Keep the main `schema-shape.test.ts` un-skip list NOT including `headhunter.recommend_candidate` (leave as `it.skip` with a clear comment, or remove and add to flow test). |
| `placements` table has required columns we may not know (e.g., `candidate_bonus` from Phase 6 spec §3.3) | Executor reads `src/main/db/migrations/v003.sql` to confirm column list before writing INSERT. |
| `webhook_delivery_queue` requires encryption (payload_enc) — direct DB insert with a fake blob may not work if the test path needs to decode | Read `src/main/modules/webhooks/handlers.ts` to see how tests elsewhere insert webhook rows. |
| `config` table might have a different column name or schema | Read the `config` table migration before INSERT. |
| 3 of the 11 admin tests (rate_limit_buckets, clear_user_rate_limit, placements_summary) currently 500 on bare DB; we want them to pass with pre-created records, but if the underlying handler bug remains they may still 500 | Run each test individually; if a 500 persists, the test fails loudly and the executor investigates. Do not paper over with assertions like `expect(200 or 500)`. |

## 7. Success Criteria

- [ ] `pnpm test` shows 779+ passed, 0 skipped (in the conformance tests specifically; the 46 todo are unchanged)
- [ ] All 22 originally-skipped tests are now real `it()` blocks with passing assertions
- [ ] No production code modified
- [ ] `pnpm typecheck` clean
- [ ] `pnpm conformance:check` still 46/46
- [ ] 4 atomic commits on main branch (one per file: 3 new + 1 modified)

## 8. Out of Scope (deferred to Phase 8+)

- Filling the 46 `it.todo` stubs in `_generated.test.ts` (intentional placeholders)
- Adding a real test for the destructive side-effect behavior of `auth.rotate_key` and `candidate.delete_my_data` (already exists in `auth.test.ts`)
- Refactoring the existing `schema-shape.test.ts` to be smaller/more focused (this PR adds 3 sibling files, doesn't refactor the existing one beyond un-skipping)
- Speeding up the new tests (each takes ~1-2s for the flow; 22 tests ≈ 30-60s added; acceptable)
- Adding more precondition categories (e.g., webhook-with-PII vs webhook-without-PII)

## 9. Effort Estimate

~0.5-1 working day. 4 atomic commits. Aligns with the brainstorming discussion.

## 10. Open Questions for Executor

These are NOT blockers — the executor should resolve them by reading the actual code:

1. **Exact column list for the `placements` table after v008 GDPR rebuild** — confirm with `src/main/db/migrations/v008*.sql` and any later migrations. The Phase 6 spec's column list may be out of date.
2. **Whether `webhook_delivery_queue.payload_enc` requires encryption setup at insert time** — read `src/main/modules/webhooks/handlers.ts` to see if tests elsewhere insert webhook rows.
3. **Whether `config` table exists and its schema** — the `admin.put_config` endpoint takes a key + value; the pre-create may not even be needed if the endpoint can create the row on first call (test asserts only the response shape, not that the row pre-exists).
4. **Whether `placements` can be created via the public API** — there's a `POST /v1/employer/placements` endpoint. If so, use it instead of raw SQL for placement creation.
