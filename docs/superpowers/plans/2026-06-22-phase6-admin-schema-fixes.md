# Phase 6 Admin Schema Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 8 admin endpoint schema-drift bugs and lock the contract by enabling `strict: true` on all admin route `respond()` calls. After Phase 6, admin response shapes are enforced by zod; future drift is caught loudly (ZodError → 500) rather than silently (extra fields stripped, PII leaked).

**Architecture:** Two complementary changes per endpoint: (1) handler column projection / reshape to match the declared zod schema, (2) `{ strict: true }` flag on the route's `respond()` call. The dashboard endpoint uses a route-level adapter (preserves the handler's nested IPC shape for internal callers). All other 7 endpoints project columns inside the handler.

**Tech Stack:** TypeScript, zod, vitest, better-sqlite3 (via `node:sqlite`). Same as existing admin code.

**Design spec:** `docs/superpowers/specs/2026-06-22-phase6-admin-schema-fixes.md`

---

## File Structure

### New files (2)
| File | Responsibility |
|---|---|
| `tests/integration/admin-strict-mode.test.ts` | Verifies `strict: true` rejects unknown-key payloads with 500, not 200 |
| `src/main/modules/admin/dashboard-queries.ts` (optional) | `candidateCount`, `activePlacementCount`, `dailyQuotaUsed` — 3 small SQL helpers used by the dashboard route adapter. Inline in route if you prefer; spec §3.2 allows either. |

### Modified files (10)
| File | Tasks |
|---|---|
| `src/main/routes/admin.ts` | 1, 2, 3, 4, 5, 6, 7, 8 (strict mode + dashboard adapter) |
| `src/main/modules/admin/handlers/users.ts` | 2 (column projection) |
| `src/main/modules/admin/handlers/candidates.ts` | 3 (column projection) |
| `src/main/modules/admin/handlers/audit.ts` | 4 (column projection) |
| `src/main/modules/admin/handlers/webhooks.ts` | 5 (column projection) |
| `src/main/modules/admin/handlers/rate-limit.ts` | 6 (column remap + `bucket_key` derivation) |
| `src/main/modules/admin/handlers/placements.ts` | 7 (JOIN to jobs for `employer_id`; add 2 missing fields) |
| `src/main/modules/admin/handlers/admin-log.ts` | 8 (`details_json` flatten) |
| `tests/integration/skill-md-conformance/schema-shape.test.ts` | 10 (un-skip 3 admin caps) |
| `tests/unit/admin-schemas.test.ts` | 11 (add fixtures for 3 detached schemas) |

### Untouched
- `src/main/responses.ts` (no change to `respond()` itself)
- All 8 schema definitions in `src/main/schemas/admin.ts`
- All migrations
- `src/main/modules/admin/handlers/dashboard.ts` (nested IPC shape preserved)

---

## Task 1: Fix `admin.dashboard_stats` (route-level adapter + strict)

**Files:**
- Modify: `src/main/routes/admin.ts:43-49`

- [ ] **Step 1.1: Read the current dashboard route and handler**

Read `src/main/routes/admin.ts` lines 43-49 and `src/main/modules/admin/handlers/dashboard.ts` lines 27-86. Confirm:
- The route's current `respond()` signature
- The handler returns `{ users: {total, candidate, headhunter, employer}, jobs: {total, open, paused, closed, filled}, recommendations: {...}, candidates: {in_pool}, webhooks: {pending, dead_letter}, activity: {placements_today}, timestamp }`
- The `getStats()` method is `createAdminDashboardHandler(db).getStats()`

- [ ] **Step 1.2: Verify the actual column names in `candidates_anonymized` and `placements` tables**

Read `src/main/db/migrations/v001.sql` (candidates_anonymized) and `src/main/db/migrations/v003.sql` (placements). Confirm:
- `candidates_anonymized` has columns `{id, source_private_id, source_headhunter_id, industry, title_level, years_experience, salary_range, education_tier, skills_json, is_public_pool, unlock_status, created_at, updated_at}`. `SELECT COUNT(*)` for `total_candidates` is straightforward.
- `placements` has columns including `status` with values in `('pending_payment','paid','cancelled')`. `active_placements = COUNT(*) WHERE status IN ('pending_payment','paid')`.
- `users` has a `quota_used` column (yes — v001). `daily_quota_used = COALESCE(SUM(quota_used), 0) FROM users`.

- [ ] **Step 1.3: Replace the dashboard route with the adapter**

In `src/main/routes/admin.ts`, find the block:

```ts
router.get('/dashboard/stats', (_req, res, next) => {
  try { respond(res, DashboardStatsResponseSchema, { ok: true, data: dashboard.getStats() }); } catch (e) { next(e); }
});
```

Replace with:

```ts
router.get('/dashboard/stats', (_req, res, next) => {
  try {
    const s = dashboard.getStats();
    // Flatten the IPC nested shape to the 7-field schema. The handler
    // is unchanged because dashboardIpc + e2e-m3-admin.test.ts depend
    // on the nested shape. Two scalars aren't in getStats(); compute
    // them inline (3 small SELECTs).
    const candidateCount = (db.prepare('SELECT COUNT(*) AS c FROM candidates_anonymized').get() as { c: number }).c;
    const activePlacementCount = (db.prepare("SELECT COUNT(*) AS c FROM placements WHERE status IN ('pending_payment','paid')").get() as { c: number }).c;
    const dailyQuotaUsed = (db.prepare('SELECT COALESCE(SUM(quota_used), 0) AS s FROM users').get() as { s: number }).s;
    respond(res, DashboardStatsResponseSchema, {
      ok: true,
      data: {
        total_users: s.users.total,
        total_candidates: candidateCount,
        total_jobs: s.jobs.total,
        open_jobs: s.jobs.open,
        active_placements: activePlacementCount,
        daily_quota_used: dailyQuotaUsed,
        webhook_dead_letters: s.webhooks.dead_letter,
      },
    }, { strict: true });
  } catch (e) { next(e); }
});
```

**NOTE on `db`:** This route currently does NOT have `db` in scope. Check the file: `dashboard` is created via `const dashboard = createAdminDashboardHandler(db)` at module top, and `db` is in scope. The 3 small SQL queries use the same `db` reference. If `db` is not in scope (i.e., `dashboard` is constructed lazily inside the route), refactor: add a `const db = openDb(process.env.DATABASE_PATH!)` at module top, or pass it through. Use whichever pattern matches the rest of the file.

- [ ] **Step 1.4: Run the existing dashboard test to verify it still passes**

Run: `cd /d/dev/hunter-platform && pnpm test tests/integration/e2e-m3-admin.test.ts 2>&1 | tail -20`
Expected: PASS. The IPC call `dashboardIpc.getStats()` is unchanged (handler untouched).

- [ ] **Step 1.5: Hit the endpoint manually to confirm 200 + correct shape**

Run:
```bash
cd /d/dev/hunter-platform
node --env-file=.env --import tsx -e "
import { freshApp, ConformanceClient, adminAuthHeader } from './tests/integration/skill-md-conformance/_setup.ts';
import { EnvelopeSchema } from './src/main/schemas/common.ts';
import { DashboardStatsResponseSchema } from './src/main/schemas/admin.ts';
const f = await freshApp('phase6-verify-dash');
const c = new ConformanceClient(f.app);
const r = await c.request({ method: 'GET', path: '/v1/admin/dashboard/stats', auth: adminAuthHeader(), schema: DashboardStatsResponseSchema });
console.log('STATUS:', r.status);
console.log('DATA:', JSON.stringify(r.data.data));
"
```
Expected: `STATUS: 200`, `DATA: {"total_users":0,"total_candidates":0,...}`. All 7 fields present as numbers.

- [ ] **Step 1.6: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/routes/admin.ts
git commit -m "fix(admin): dashboard_stats route adapter + strict mode (flat 7-field shape)"
```

---

## Task 2: Fix `admin.list_users` (column projection + strict)

**Files:**
- Modify: `src/main/modules/admin/handlers/users.ts:30-38` (handler SELECT)
- Modify: `src/main/routes/admin.ts:52-60` (route: add strict)

- [ ] **Step 2.1: Read current handler and route**

Read `src/main/modules/admin/handlers/users.ts` lines 30-38 and `src/main/routes/admin.ts` lines 52-60.

- [ ] **Step 2.2: Replace the `list` method's `SELECT *` with explicit columns**

In `users.ts`, replace the `list` method body. The current code starts with `let sql = 'SELECT * FROM users WHERE 1=1';`. Change it to:

```ts
list(filter: { user_type?: string; status?: string; limit?: number }): Array<{
  id: string; user_type: 'candidate' | 'headhunter' | 'employer'; name: string;
  quota_per_day: number; quota_used: number; quota_reset_at: string;
  reputation: number; status: 'active' | 'suspended' | 'deleted';
  created_at: string;
}> {
  // Project only the UserPublicSchema fields. Stripping PII (contact, agent_endpoint)
  // and secrets (api_key_hash, api_key_prefix, api_key_expires_at, prev_api_key_*) is
  // the security-critical reason for this change.
  let sql = `
    SELECT id, user_type, name, quota_per_day, quota_used, quota_reset_at,
           reputation, status, created_at
    FROM users WHERE 1=1`;
  const params: any[] = [];
  if (filter.user_type) { sql += ' AND user_type = ?'; params.push(filter.user_type); }
  if (filter.status) { sql += ' AND status = ?'; params.push(filter.status); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(filter.limit ?? 100);
  return db.prepare(sql).all(...params) as any;
},
```

- [ ] **Step 2.3: Add `strict: true` to the route's `respond()` call**

In `src/main/routes/admin.ts` line 58, change:
```ts
respond(res, ListUsersResponseSchema, { ok: true, data: users.list(filter) });
```
to:
```ts
respond(res, ListUsersResponseSchema, { ok: true, data: users.list(filter) }, { strict: true });
```

- [ ] **Step 2.4: Run existing list_users test to verify**

Run: `cd /d/dev/hunter-platform && pnpm test tests/integration/skill-md-conformance/admin-endpoints.test.ts 2>&1 | tail -15`
Expected: PASS. The test uses `ListUsersResponseSchema` via `ConformanceClient.request({ schema })`, which now succeeds for real (no silent strip).

- [ ] **Step 2.5: Run the broader admin test suite**

Run: `cd /d/dev/hunter-platform && pnpm test tests/integration/admin-endpoints.test.ts 2>&1 | tail -15`
Expected: PASS (loose `Array.isArray` checks still satisfied).

- [ ] **Step 2.6: Verify PII / secret columns are NOT in the response**

Run:
```bash
cd /d/dev/hunter-platform
node --env-file=.env --import tsx -e "
import { freshApp, ConformanceClient, adminAuthHeader } from './tests/integration/skill-md-conformance/_setup.ts';
const f = await freshApp('phase6-verify-users');
const c = new ConformanceClient(f.app);
const r = await c.request({ method: 'GET', path: '/v1/admin/users', auth: adminAuthHeader() });
console.log('STATUS:', r.status);
const first = r.data.data[0] ?? {};
console.log('KEYS:', Object.keys(first).sort());
console.log('HAS contact?', 'contact' in first);
console.log('HAS api_key_hash?', 'api_key_hash' in first);
console.log('HAS api_key_prefix?', 'api_key_prefix' in first);
"
```
Expected: `STATUS: 200`, `KEYS: [created_at, id, name, quota_per_day, quota_reset_at, quota_used, reputation, status, user_type]` (9 fields). All 3 security checks return `false`.

- [ ] **Step 2.7: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/modules/admin/handlers/users.ts src/main/routes/admin.ts
git commit -m "fix(admin): list_users column projection (strip PII/secrets) + strict mode"
```

---

## Task 3: Fix `admin.list_candidates` (column projection + strict)

**Files:**
- Modify: `src/main/modules/admin/handlers/candidates.ts:9-17` (handler SELECT)
- Modify: `src/main/routes/admin.ts:84-93` (route: add strict)

- [ ] **Step 3.1: Read current handler and route**

Read `src/main/modules/admin/handlers/candidates.ts` lines 9-17 and `src/main/routes/admin.ts` lines 84-93.

- [ ] **Step 3.2: Replace the `list` method's `SELECT *` with explicit columns**

In `candidates.ts`, replace the `list` method body. Change `let sql = 'SELECT * FROM candidates_anonymized WHERE 1=1';` to:

```ts
list(filter: { in_pool?: boolean; unlock_status?: string; limit?: number }): Array<{
  anonymized_id: string; candidate_user_id: string; headhunter_id: string;
  industry: string | null; title_level: string | null;
  is_public_pool: 0 | 1; unlock_status: string; created_at: string;
}> {
  // Project only the AdminCandidateSchema fields.
  let sql = `
    SELECT anonymized_id, candidate_user_id, source_headhunter_id AS headhunter_id,
           industry, title_level, is_public_pool, unlock_status, created_at
    FROM candidates_anonymized WHERE 1=1`;
  const params: any[] = [];
  if (filter.in_pool !== undefined) { sql += ' AND is_public_pool = ?'; params.push(filter.in_pool ? 1 : 0); }
  if (filter.unlock_status) { sql += ' AND unlock_status = ?'; params.push(filter.unlock_status); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(filter.limit ?? 100);
  return db.prepare(sql).all(...params) as any;
},
```

**NOTE:** The `candidates_anonymized` table has `source_headhunter_id` (per the explore report), but the schema expects `headhunter_id`. The SQL aliases `source_headhunter_id AS headhunter_id` so the response key matches. Verify the actual column name by reading `src/main/db/migrations/v001.sql` (the explore report confirmed `source_headhunter_id`); if different, update.

- [ ] **Step 3.3: Add `strict: true` to the route's `respond()` call**

In `src/main/routes/admin.ts` line 91, change:
```ts
respond(res, ListCandidatesResponseSchema, { ok: true, data: candidates.list(filter) });
```
to:
```ts
respond(res, ListCandidatesResponseSchema, { ok: true, data: candidates.list(filter) }, { strict: true });
```

- [ ] **Step 3.4: Run admin candidates test**

Run: `cd /d/dev/hunter-platform && pnpm test tests/integration/skill-md-conformance 2>&1 | tail -10`
Expected: All previously-passing tests still pass.

- [ ] **Step 3.5: Verify the response has the expected fields**

Run:
```bash
cd /d/dev/hunter-platform
node --env-file=.env --import tsx -e "
import { freshApp, ConformanceClient, adminAuthHeader } from './tests/integration/skill-md-conformance/_setup.ts';
const f = await freshApp('phase6-verify-cand');
const c = new ConformanceClient(f.app);
const r = await c.request({ method: 'GET', path: '/v1/admin/candidates', auth: adminAuthHeader() });
console.log('STATUS:', r.status);
console.log('KEYS:', r.data.data.length > 0 ? Object.keys(r.data.data[0]).sort() : '[] (empty)');
"
```
Expected: `STATUS: 200`. Either `[]` (no candidates) or keys exactly: `[anonymized_id, candidate_user_id, headhunter_id, industry, title_level, is_public_pool, unlock_status, created_at]`.

- [ ] **Step 3.6: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/modules/admin/handlers/candidates.ts src/main/routes/admin.ts
git commit -m "fix(admin): list_candidates column projection + strict mode"
```

---

## Task 4: Fix `admin.audit_log` (column projection + strict)

**Files:**
- Modify: `src/main/modules/admin/handlers/audit.ts:8` (handler SELECT)
- Modify: `src/main/routes/admin.ts:99-107` (route: add strict)

- [ ] **Step 4.1: Read current handler and route**

Read `src/main/modules/admin/handlers/audit.ts` (around line 8) and `src/main/routes/admin.ts` lines 99-107.

- [ ] **Step 4.2: Replace `SELECT *` with explicit columns matching `AuditItemSchema`**

The schema declares: `{id, recommendation_id, actor_user_id, action, ip_address, user_agent, created_at}`. Change the handler's SQL to:

```ts
list(filter): Array<{
  id: number; recommendation_id: string | null; actor_user_id: string | null;
  action: string; ip_address: string | null; user_agent: string | null;
  created_at: string;
}> {
  let sql = `
    SELECT id, recommendation_id, actor_user_id, action, ip_address, user_agent, created_at
    FROM unlock_audit_log WHERE 1=1`;
  // ... existing filter + ORDER BY + LIMIT logic unchanged ...
  return db.prepare(sql).all(...params) as any;
}
```

Keep the existing filter, ORDER BY, and LIMIT clauses intact — only the `SELECT` list changes.

- [ ] **Step 4.3: Add `strict: true` to the route's `respond()` call**

In `src/main/routes/admin.ts` (the audit route), change:
```ts
respond(res, AuditListResponseSchema, { ok: true, data: audit.list(filter) });
```
to:
```ts
respond(res, AuditListResponseSchema, { ok: true, data: audit.list(filter) }, { strict: true });
```

- [ ] **Step 4.4: Run admin audit test**

Run: `cd /d/dev/hunter-platform && pnpm test tests/integration/skill-md-conformance 2>&1 | tail -10`
Expected: All previously-passing tests still pass.

- [ ] **Step 4.5: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/modules/admin/handlers/audit.ts src/main/routes/admin.ts
git commit -m "fix(admin): audit_log column projection + strict mode"
```

---

## Task 5: Fix `admin.webhook_dead_letter` (column projection + strict)

**Files:**
- Modify: `src/main/modules/admin/handlers/webhooks.ts:9` (handler SELECT)
- Modify: `src/main/routes/admin.ts:110-115` (route: add strict)

- [ ] **Step 5.1: Read current handler and route**

Read `src/main/modules/admin/handlers/webhooks.ts` (the `listDeadLetter` method) and `src/main/routes/admin.ts` lines 110-115.

- [ ] **Step 5.2: Replace `SELECT *` with explicit columns matching `DeadLetterItemSchema`**

The schema declares: `{id, target_user_id, event_type, attempt_count, last_error, next_retry_at, created_at, updated_at}`. The dead-letter rows come from `webhook_delivery_queue WHERE status = 'dead_letter'`. Change the SQL to:

```ts
listDeadLetter(limit = 50): Array<{
  id: number; target_user_id: string; event_type: string;
  attempt_count: number; last_error: string | null; next_retry_at: string | null;
  created_at: string; updated_at: string;
}> {
  const sql = `
    SELECT id, target_user_id, event_type, attempt_count, last_error, next_retry_at, created_at, updated_at
    FROM webhook_delivery_queue
    WHERE status = 'dead_letter'
    ORDER BY created_at DESC LIMIT ?`;
  return db.prepare(sql).all(limit) as any;
}
```

(Adjust the `WHERE status = 'dead_letter'` if the current implementation uses a different filter — preserve existing logic, only change the column list.)

- [ ] **Step 5.3: Add `strict: true` to the route's `respond()` call**

In `src/main/routes/admin.ts` (the dead-letter route), change:
```ts
respond(res, DeadLetterListResponseSchema, { ok: true, data: webhooks.listDeadLetter(limit) });
```
to:
```ts
respond(res, DeadLetterListResponseSchema, { ok: true, data: webhooks.listDeadLetter(limit) }, { strict: true });
```

- [ ] **Step 4.4: Run webhooks test**

Run: `cd /d/dev/hunter-platform && pnpm test tests/integration/admin-endpoints.test.ts 2>&1 | tail -10`
Expected: PASS (loose `Array.isArray` check on line 200-206 still satisfied).

- [ ] **Step 5.5: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/modules/admin/handlers/webhooks.ts src/main/routes/admin.ts
git commit -m "fix(admin): webhook_dead_letter column projection + strict mode"
```

---

## Task 6: Fix `admin.rate_limit_buckets` (column remap + `bucket_key` + strict)

**Files:**
- Modify: `src/main/modules/admin/handlers/rate-limit.ts:6` (handler reshape)
- Modify: `src/main/routes/admin.ts:125-130` (route: add strict)

- [ ] **Step 6.1: Read current handler and route**

Read `src/main/modules/admin/handlers/rate-limit.ts` (the `listBuckets` method) and `src/main/routes/admin.ts` lines 125-130.

- [ ] **Step 6.2: Replace the handler with column remap + `bucket_key` derivation**

The schema declares: `{user_id, bucket_key, count, window_started_at}`. The table has: `{id, user_id, window_start, window_seconds, request_count, expires_at}`. Map:

```ts
listBuckets(user_id?: string): Array<{
  user_id: string; bucket_key: string; count: number; window_started_at: string;
}> {
  let sql = `SELECT user_id, window_start, request_count FROM rate_limit_buckets WHERE 1=1`;
  const params: any[] = [];
  if (user_id) { sql += ' AND user_id = ?'; params.push(user_id); }
  sql += ' ORDER BY window_start DESC LIMIT 100';
  const rows = db.prepare(sql).all(...params) as Array<{
    user_id: string; window_start: string; request_count: number;
  }>;
  return rows.map((r) => ({
    user_id: r.user_id,
    bucket_key: `${r.user_id}:${r.window_start}`,
    count: r.request_count,
    window_started_at: r.window_start,
  }));
}
```

Preserve any existing filter logic (e.g., `user_id` parameter). Only the SELECT + return type change.

- [ ] **Step 6.3: Add `strict: true` to the route's `respond()` call**

In `src/main/routes/admin.ts` (the rate-limit buckets route), change:
```ts
respond(res, RateLimitBucketsResponseSchema, { ok: true, data: rateLimit.listBuckets(user_id) });
```
to:
```ts
respond(res, RateLimitBucketsResponseSchema, { ok: true, data: rateLimit.listBuckets(user_id) }, { strict: true });
```

- [ ] **Step 6.4: Run rate-limit test**

Run: `cd /d/dev/hunter-platform && pnpm test tests/integration/admin-endpoints.test.ts 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 6.5: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/modules/admin/handlers/rate-limit.ts src/main/routes/admin.ts
git commit -m "fix(admin): rate_limit_buckets column remap + bucket_key derivation + strict mode"
```

---

## Task 7: Fix `admin.list_placements` (JOIN to jobs + strict)

**Files:**
- Modify: `src/main/modules/admin/handlers/placements.ts:14` (handler JOIN)
- Modify: `src/main/routes/admin.ts:144-153` (route: add strict)

- [ ] **Step 7.1: Read current handler, route, and `jobs` table migrations**

Read `src/main/modules/admin/handlers/placements.ts` (the `list` method) and `src/main/routes/admin.ts` lines 144-153.

Then read `src/main/db/migrations/*.sql` to find the `jobs` table definition. **Confirm the exact column name for the employer user ID** (likely `employer_user_id` but verify). The explore report guessed this name; the executor MUST verify.

- [ ] **Step 7.2: Replace handler with JOIN-based column projection**

The schema declares: `{id, job_id, employer_id, anonymized_candidate_id, primary_headhunter_id, referrer_headhunter_id, annual_salary, platform_fee, primary_share, referrer_share, status, created_at, updated_at}`. The placements table has `candidate_user_id` and `candidate_bonus` that the schema omits. Map:

```ts
list(filter): Array<{
  id: string; job_id: string; employer_id: string;
  anonymized_candidate_id: string; primary_headhunter_id: string | null;
  referrer_headhunter_id: string | null; annual_salary: number;
  platform_fee: number; primary_share: number; referrer_share: number;
  status: 'pending_payment' | 'paid' | 'cancelled';
  created_at: string; updated_at: string;
}> {
  // JOIN jobs to get employer_id (placements table does not store it directly).
  // Replace <EMPLOYER_COL> below with the actual column name from the jobs table
  // (e.g. 'employer_user_id' or 'employer_id' depending on the migration).
  const sql = `
    SELECT p.id, p.job_id, j.<EMPLOYER_COL> AS employer_id,
           p.anonymized_candidate_id, p.candidate_user_id,
           p.primary_headhunter_id, p.referrer_headhunter_id,
           p.annual_salary, p.platform_fee, p.primary_share, p.referrer_share,
           p.candidate_bonus, p.status, p.created_at, p.updated_at
    FROM placements p
    JOIN jobs j ON j.id = p.job_id
    WHERE 1=1`;
  // ... existing filter + ORDER BY + LIMIT logic unchanged ...
  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map((r) => ({
    id: r.id,
    job_id: r.job_id,
    employer_id: r.employer_id,
    anonymized_candidate_id: r.anonymized_candidate_id,
    primary_headhunter_id: r.primary_headhunter_id,
    referrer_headhunter_id: r.referrer_headhunter_id,
    annual_salary: r.annual_salary,
    platform_fee: r.platform_fee,
    primary_share: r.primary_share,
    referrer_share: r.referrer_share,
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}
```

**CRITICAL:** Replace `<EMPLOYER_COL>` with the actual column name you confirmed in Step 7.1. If the column doesn't exist or has a different name, the test in Step 7.4 will surface it.

The `candidate_user_id` and `candidate_bonus` columns are selected but excluded from the final return — they exist in the table and we must SELECT them (or the row will be incomplete) but the schema doesn't expose them. The `.map()` strips them.

- [ ] **Step 7.3: Add `strict: true` to the route's `respond()` call**

In `src/main/routes/admin.ts` (the placements list route), change:
```ts
respond(res, AdminPlacementsListResponseSchema, { ok: true, data: placements.list(filter) });
```
to:
```ts
respond(res, AdminPlacementsListResponseSchema, { ok: true, data: placements.list(filter) }, { strict: true });
```

- [ ] **Step 7.4: Run placement test**

Run: `cd /d/dev/hunter-platform && pnpm test tests/integration/skill-md-conformance 2>&1 | tail -10`
Expected: PASS. If the column name in Step 7.1 was wrong, this test will surface a SQL error (e.g., "no such column: j.employer_user_id"). Fix the column name and re-run.

- [ ] **Step 7.5: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/modules/admin/handlers/placements.ts src/main/routes/admin.ts
git commit -m "fix(admin): list_placements JOIN to jobs for employer_id + strict mode"
```

---

## Task 8: Fix `admin.admin_log` (JSON flatten + strict)

**Files:**
- Modify: `src/main/modules/admin/handlers/admin-log.ts:8` (handler JSON flatten)
- Modify: `src/main/routes/admin.ts:165-172` (route: add strict)

- [ ] **Step 8.1: Read current handler and route**

Read `src/main/modules/admin/handlers/admin-log.ts` (the `list` method) and `src/main/routes/admin.ts` lines 165-172.

Also read `src/main/modules/admin/handlers/users.ts` line 24 (where `details_json: JSON.stringify({ reason: effect.reason ?? '' })` is written) to confirm the JSON shape.

- [ ] **Step 8.2: Replace handler with JSON flatten**

The schema declares: `{id, actor, action_type, target_type, target_id, reason, created_at}`. The table has: `{id, admin_user_id, action, target_type, target_id, details_json, created_at}`. Map:

```ts
list(filter): Array<{
  id: number; actor: string; action_type: string;
  target_type: string | null; target_id: string | null;
  reason: string | null; created_at: string;
}> {
  let sql = `
    SELECT id, admin_user_id, action, target_type, target_id, details_json, created_at
    FROM admin_action_log WHERE 1=1`;
  // ... existing filter + ORDER BY + LIMIT logic unchanged ...
  const rows = db.prepare(sql).all(...params) as Array<{
    id: number; admin_user_id: string; action: string;
    target_type: string | null; target_id: string | null;
    details_json: string | null; created_at: string;
  }>;
  return rows.map((r) => {
    let reason: string | null = null;
    if (r.details_json) {
      try {
        const parsed = JSON.parse(r.details_json);
        if (typeof parsed.reason === 'string') reason = parsed.reason;
      } catch { /* malformed JSON, leave reason as null */ }
    }
    return {
      id: r.id,
      actor: r.admin_user_id,
      action_type: r.action,
      target_type: r.target_type,
      target_id: r.target_id,
      reason,
      created_at: r.created_at,
    };
  });
}
```

- [ ] **Step 8.3: Add `strict: true` to the route's `respond()` call**

In `src/main/routes/admin.ts` (the admin-log route), change:
```ts
respond(res, AdminLogListResponseSchema, { ok: true, data: adminLog.list(filter) });
```
to:
```ts
respond(res, AdminLogListResponseSchema, { ok: true, data: adminLog.list(filter) }, { strict: true });
```

- [ ] **Step 8.4: Run admin-log test**

Run: `cd /d/dev/hunter-platform && pnpm test tests/integration/repos/admin-action-log.test.ts 2>&1 | tail -10`
Expected: PASS (this test reads raw rows, not the route).

- [ ] **Step 8.5: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/modules/admin/handlers/admin-log.ts src/main/routes/admin.ts
git commit -m "fix(admin): admin_log details_json flatten + strict mode"
```

---

## Task 9: Add strict-mode contract test

**Files:**
- Create: `tests/integration/admin-strict-mode.test.ts`

- [ ] **Step 9.1: Write the strict-mode contract test**

This test verifies that `respond({ strict: true })` rejects payloads with extra fields. Use a temporary route or a pre-seeded extra column approach. The cleanest test: hit an admin list endpoint and confirm that adding a column to the row that the schema doesn't declare results in 500 (ZodError), not 200 (silent strip).

```typescript
// tests/integration/admin-strict-mode.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient, adminAuthHeader } from './skill-md-conformance/_setup';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

describe('admin strict-mode contract', () => {
  let app: import('express').Express;
  let dbPath: string;
  let client: ConformanceClient;
  let db: InstanceType<typeof DatabaseSync>;

  beforeAll(async () => {
    const f = await freshApp('strict-mode');
    app = f.app;
    dbPath = f.dbPath;
    client = new ConformanceClient(app);
    db = new DatabaseSync(dbPath);
  });
  afterAll(() => {
    db.close();
    cleanupDb('strict-mode');
  });

  it('strict:true rejects users row with extra contact field → 500 (not 200 with strip)', async () => {
    // Pre-condition: at least one user exists.
    db.prepare("INSERT OR IGNORE INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix, quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at) VALUES ('strict_test_user', 'candidate', 'StrictT', 'leaked@x.com', 'hash', 'prefix', 100, 0, '2026-06-22T00:00:00Z', 50, 'active', '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z')").run();
    // If the handler were still using SELECT *, it would include `contact`,
    // which is not in UserPublicSchema. With strict:true, respond() throws
    // ZodError → 500. With strict:false, the row would be silently stripped
    // and the response would be 200 with the leaked field removed.
    const r = await client.request({ method: 'GET', path: '/v1/admin/users', auth: adminAuthHeader() });
    // The endpoint is now strict; even if some other field triggers it, we
    // should see 500, NOT 200. If this returns 200, the strict mode is
    // NOT in effect — that's the contract violation.
    expect(r.status).not.toBe(200);
  });

  it('strict:true still returns 200 for clean rows (no extra fields)', async () => {
    // Add a clean row (no PII / no secrets / no extra fields).
    db.prepare("INSERT OR IGNORE INTO users (id, user_type, name, api_key_hash, api_key_prefix, quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at) VALUES ('strict_clean_user', 'candidate', 'CleanT', 'hash2', 'prefix2', 100, 0, '2026-06-22T00:00:00Z', 50, 'active', '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z')").run();
    const r = await client.request({ method: 'GET', path: '/v1/admin/users', auth: adminAuthHeader() });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.data)).toBe(true);
  });
});
```

- [ ] **Step 9.2: Run the new test**

Run: `cd /d/dev/hunter-platform && pnpm test tests/integration/admin-strict-mode.test.ts 2>&1 | tail -20`
Expected: PASS (2 tests).

**If the first test fails (returns 200 instead of expected 500):** that means strict mode is NOT actually applied. Check `src/main/routes/admin.ts` to confirm every `respond()` call for admin routes has `{ strict: true }`. This is a critical regression — do NOT proceed without fixing.

- [ ] **Step 9.3: Commit**

```bash
cd /d/dev/hunter-platform
git add tests/integration/admin-strict-mode.test.ts
git commit -m "test(admin): strict-mode contract test (rejects unknown keys loudly)"
```

---

## Task 10: Un-skip the 3 admin capabilities in schema-shape test

**Files:**
- Modify: `tests/integration/skill-md-conformance/schema-shape.test.ts:263-278`

- [ ] **Step 10.1: Read the current `skipAdmin` set**

Read `tests/integration/skill-md-conformance/schema-shape.test.ts` lines 263-278.

- [ ] **Step 10.2: Remove the 3 SCHEMA DRIFT entries**

In the `skipAdmin` Set, remove these three lines:

```ts
    'admin.dashboard_stats',      // SCHEMA DRIFT: live response shape differs from response_schema
    'admin.list_users',           // SCHEMA DRIFT: live response shape differs from response_schema
    'admin.list_candidates',      // SCHEMA DRIFT: live response shape differs from response_schema
```

(Leave all other skip reasons intact — those are for endpoints that need pre-existing records, not schema drift.)

- [ ] **Step 10.3: Run the schema-shape test**

Run: `cd /d/dev/hunter-platform && pnpm test tests/integration/skill-md-conformance/schema-shape 2>&1 | tail -20`
Expected: All unskipped tests pass. The 3 newly-unskipped tests now exercise the real schema. The total pass count should increase by 3, skipped count should decrease by 3.

- [ ] **Step 10.4: Commit**

```bash
cd /d/dev/hunter-platform
git add tests/integration/skill-md-conformance/schema-shape.test.ts
git commit -m "test(conformance): un-skip 3 admin capabilities now that schema drift is fixed"
```

---

## Task 11: Add unit test fixtures for 3 detached schemas

**Files:**
- Modify: `tests/unit/admin-schemas.test.ts`

- [ ] **Step 11.1: Read the current file structure**

Read `tests/unit/admin-schemas.test.ts` (entire file, ~50 lines).

- [ ] **Step 11.2: Add happy-path fixtures for `RateLimitBucketsResponseSchema`, `AdminPlacementsListResponseSchema`, `AdminLogListResponseSchema`**

Append to the file (before any closing brace if there is one, or at end):

```typescript
  it('RateLimitBucketsResponseSchema accepts a valid bucket', () => {
    const r = RateLimitBucketsResponseSchema.safeParse({
      ok: true,
      data: [{
        user_id: 'user_1',
        bucket_key: 'user_1:2026-06-22T00:00:00Z',
        count: 5,
        window_started_at: '2026-06-22T00:00:00Z',
      }],
    });
    expect(r.success).toBe(true);
  });

  it('AdminPlacementsListResponseSchema accepts a valid placement', () => {
    const r = AdminPlacementsListResponseSchema.safeParse({
      ok: true,
      data: [{
        id: 'placement_1',
        job_id: 'job_1',
        employer_id: 'employer_1',
        anonymized_candidate_id: 'cand_anon_1',
        primary_headhunter_id: 'h_1',
        referrer_headhunter_id: null,
        annual_salary: 1000000,
        platform_fee: 100000,
        primary_share: 70000,
        referrer_share: 0,
        status: 'pending_payment',
        created_at: '2026-06-22T00:00:00Z',
        updated_at: '2026-06-22T00:00:00Z',
      }],
    });
    expect(r.success).toBe(true);
  });

  it('AdminLogListResponseSchema accepts a valid log entry', () => {
    const r = AdminLogListResponseSchema.safeParse({
      ok: true,
      data: [{
        id: 1,
        actor: 'admin_1',
        action_type: 'suspend_user',
        target_type: 'user',
        target_id: 'user_x',
        reason: 'spam',
        created_at: '2026-06-22T00:00:00Z',
      }],
    });
    expect(r.success).toBe(true);
  });
```

Also add the missing imports at the top of the file:

```typescript
import {
  RateLimitBucketsResponseSchema,
  AdminPlacementsListResponseSchema,
  AdminLogListResponseSchema,
} from '../../src/main/schemas/admin';
```

- [ ] **Step 11.3: Run the unit test**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/admin-schemas.test.ts 2>&1 | tail -15`
Expected: PASS (all existing tests + 3 new ones).

- [ ] **Step 11.4: Commit**

```bash
cd /d/dev/hunter-platform
git add tests/unit/admin-schemas.test.ts
git commit -m "test(admin-schemas): add happy-path fixtures for 3 detached schemas"
```

---

## Task 12: Final verification

**Files:** None modified.

- [ ] **Step 12.1: Run typecheck**

Run: `cd /d/dev/hunter-platform && pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 12.2: Run the full test suite**

Run: `cd /d/dev/hunter-platform && pnpm test 2>&1 | tail -15`
Expected:
- `Test Files: 140+ passed` (was 139; +1 from admin-strict-mode.test.ts)
- `Tests: 750+ passed` (was 750; +2 from strict-mode test, +3 un-skipped = +5; 24-3 = 21 skipped)
- 0 failures
- Duration: <60s

- [ ] **Step 12.3: Run all CI gates**

Run:
```bash
cd /d/dev/hunter-platform
pnpm conformance:check && pnpm capabilities:check && pnpm openapi:check
```
Expected: All three exit 0 with their respective OK messages.

- [ ] **Step 12.4: Verify only the 10 expected files were modified**

Run: `cd /d/dev/hunter-platform && git diff 0dfa877 HEAD --stat`
Expected file list:
- `src/main/routes/admin.ts`
- `src/main/modules/admin/handlers/{users,candidates,audit,webhooks,rate-limit,placements,admin-log}.ts` (7 files)
- `tests/integration/admin-strict-mode.test.ts` (new)
- `tests/integration/skill-md-conformance/schema-shape.test.ts`
- `tests/unit/admin-schemas.test.ts`

No `src/main/responses.ts`, no `src/main/schemas/`, no migrations.

- [ ] **Step 12.5: Inspect git log**

Run: `cd /d/dev/hunter-platform && git log --oneline 0dfa877..HEAD`
Expected: 11 new commits (Tasks 1-8 fixes + Task 9 strict-mode test + Task 10 un-skip + Task 11 fixtures). Each with a clear `fix(admin):` or `test(admin):` or `test(conformance):` prefix.

- [ ] **Step 12.6: Manual smoke test of dashboard endpoint**

Run:
```bash
cd /d/dev/hunter-platform
node --env-file=.env --import tsx -e "
import { freshApp, ConformanceClient, adminAuthHeader } from './tests/integration/skill-md-conformance/_setup.ts';
const f = await freshApp('phase6-smoke-dash');
const c = new ConformanceClient(f.app);
const r = await c.request({ method: 'GET', path: '/v1/admin/dashboard/stats', auth: adminAuthHeader() });
console.log('DASHBOARD STATUS:', r.status, 'DATA:', JSON.stringify(r.data.data));
"
```
Expected: `DASHBOARD STATUS: 200 DATA: {"total_users":0,"total_candidates":0,"total_jobs":0,"open_jobs":0,"active_placements":0,"daily_quota_used":0,"webhook_dead_letters":0}`.

- [ ] **Step 12.7: Manual smoke test of users endpoint (PII absence)**

Run:
```bash
cd /d/dev/hunter-platform
node --env-file=.env --import tsx -e "
import { freshApp, ConformanceClient, adminAuthHeader } from './tests/integration/skill-md-conformance/_setup.ts';
const f = await freshApp('phase6-smoke-users');
const c = new ConformanceClient(f.app);
const r = await c.request({ method: 'GET', path: '/v1/admin/users', auth: adminAuthHeader() });
console.log('USERS STATUS:', r.status, 'KEYS:', r.data.data.length > 0 ? Object.keys(r.data.data[0]).sort() : '[]');
"
```
Expected: `USERS STATUS: 200 KEYS: [created_at,id,name,quota_per_day,quota_reset_at,quota_used,reputation,status,user_type]`. No `contact`, no `api_key_*`, no `agent_endpoint`.

---

## Self-Review Checklist

- [ ] All 8 endpoints from spec §2 have a corresponding task (Tasks 1-8).
- [ ] `strict: true` is added in the SAME commit as the projection for each endpoint (per spec §3.4).
- [ ] No "TBD" / "TODO" / "fill in" placeholders in any step.
- [ ] Function names match across tasks: `dashboard.getStats()`, `users.list()`, `candidates.list()`, etc.
- [ ] The `bucket_key` derivation in Task 6.2 uses the formula from spec §3.3.
- [ ] Task 7 includes the column name verification step (explore report's guess may be wrong).
- [ ] Task 9 verifies the strict-mode contract by checking 500 (not 200) on extra fields.
- [ ] Task 10 un-skips exactly the 3 capabilities from spec §4.1.
- [ ] Task 12 verification gates cover all 4 from spec §9.
- [ ] Commit count: 11 (Tasks 1-8 fix, Task 9 strict-mode test, Task 10 un-skip, Task 11 fixtures).

## Definition of Done

1. All 8 admin endpoints return shapes matching their declared zod schemas
2. `strict: true` is in effect for all admin routes
3. `pnpm test` passes (≥750 tests, 0 failures)
4. `pnpm typecheck` clean
5. `pnpm conformance:check` still 46/46
6. `pnpm capabilities:check` still 46/46
7. `pnpm openapi:check` clean
8. PII / secret columns are no longer present in `/v1/admin/users` response
9. 3 schema-shape tests un-skipped and passing
10. 11 atomic commits on top of `0dfa877`

## Out of Scope (deferred)

- Applying `strict: true` to non-admin routes (separate follow-up)
- Adding `respondList()` helper to dedupe envelope wrapping
- Flattening the dashboard IPC to match the API (breaks internal callers)
- `package.json` version bump (Phase 7 v1.8 release)
- Filling remaining 21 skipped schema-shape tests (those need pre-existing records, not schema drift)

## Effort Estimate

~0.5 working day. 11 atomic commits. Aligns with spec §10.