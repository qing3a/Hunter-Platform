# Phase 6 — Admin Schema Fixes Design Spec

**Date:** 2026-06-22
**Status:** Approved (brainstorming complete)
**Project:** hunter-platform
**Branch:** main
**Author:** ZCode (brainstorming session)
**Depends on:** Phase 5 commit `7f9b22e` (skill-md conformance tests that surfaced the bugs)

## 1. Background & Goal

Phase 5 conformance testing surfaced 3 explicit admin schema-drift bugs and exposed 5 additional admin list endpoints using the same `SELECT *` pattern. Investigation revealed the root cause is two-fold:

1. **Silent data leakage** — `respond()` defaults to `strict: false`, which silently strips unknown keys. This means handlers returning `SELECT *` inadvertently leak PII (`contact`, `agent_endpoint`) and secrets (`api_key_hash`, `api_key_prefix`, `prev_api_key_*`) until those columns happen to be added to the schema. It also means real schema drift goes undetected.

2. **Schema-handler mismatches** — 3 admin response schemas (`RateLimitBucketSchema`, `AdminPlacementSchema`, `AdminLogItemSchema`) declare fields that don't exist in the underlying tables, and omit columns that do exist. Today this is masked by the silent-strip behavior.

**Goal:** Make all 8 admin list endpoints honor their declared response schemas, fix the 3 detached schemas by adapting the handlers, and lock the contract by enabling `strict: true` on all admin routes. After Phase 6, schema-shape conformance testing is a real contract test (not a status-code check), and external agents consuming `skill.md` get the shapes they expect.

## 2. Scope

**8 admin endpoints to fix:**

| # | Endpoint | Bug class | Severity |
|---|---|---|---|
| 1 | `GET /v1/admin/dashboard/stats` | Nested handler output doesn't match flat schema → 500 | HIGH |
| 2 | `GET /v1/admin/users` | `SELECT *` returns 18 cols including PII + secret hashes; schema declares 9 safe cols | MEDIUM (silent leak today) |
| 3 | `GET /v1/admin/candidates` | `SELECT *` from `candidates_anonymized`; schema declares 8 cols | LOW (no PII but shape drift) |
| 4 | `GET /v1/admin/audit` | `SELECT *` from `unlock_audit_log`; schema matches but extra cols stripped silently | LOW |
| 5 | `GET /v1/admin/webhooks/dead-letter` | `SELECT *` from `webhook_delivery_queue`; `DeadLetterItemSchema` declares subset | LOW |
| 6 | `GET /v1/admin/rate-limit/buckets` | Schema field names don't match table; `bucket_key` doesn't exist | MEDIUM (functionally broken) |
| 7 | `GET /v1/admin/placements` | Schema declares `employer_id` (not in table); missing `candidate_user_id`, `candidate_bonus` | MEDIUM |
| 8 | `GET /v1/admin/admin-log` | Schema declares `actor`/`action_type`/`reason` as top-level; table has `admin_user_id`/`action`/`details_json` | MEDIUM |

**Cross-cutting change:** All 8 routes get `{ strict: true }` on their `respond()` calls. New admin routes added in the future should follow this pattern (document in code review checklist, no enforcement at code level — the strict mode surfaces the issue on first call).

## 3. Architecture

### 3.1 Per-endpoint fix pattern

```
Current:    handler.db.prepare("SELECT * FROM <table>") → return rows
            route.respond(res, Schema, { ok: true, data: rows })
                                              ↑ silent strip in non-strict mode

Target:     handler.db.prepare("SELECT <projected cols> FROM <table>")
            handler.postProcess(rows) ← only for schemas that need transformation
            route.respond(res, Schema, { ok: true, data: rows }, { strict: true })
                                              ↑ any drift → loud ZodError → 500
```

### 3.2 Dashboard adapter (route layer)

`src/main/routes/admin.ts:47-49` currently does:
```ts
respond(res, DashboardStatsResponseSchema, { ok: true, data: dashboard.getStats() });
```

`dashboard.getStats()` returns the nested IPC shape (`{ users: {...}, jobs: {...}, ... }`) used by `dashboardIpc` and `tests/integration/e2e-m3-admin.test.ts`. Changing `getStats()` would break those callers.

**Fix:** Adapter in the route. `getStats()` keeps its nested shape for internal callers; the route maps to the flat 7-field schema:

```ts
const s = dashboard.getStats();
const db = openDb(...);  // need DB handle for active_placements + daily_quota_used
respond(res, DashboardStatsResponseSchema, {
  ok: true,
  data: {
    total_users: s.users.total,
    total_candidates: candidateCount(db),     // SELECT COUNT(*) FROM candidates_anonymized
    total_jobs: s.jobs.total,
    open_jobs: s.jobs.open,
    active_placements: activePlacementCount(db),  // SELECT COUNT(*) FROM placements WHERE status IN ('pending_payment','paid')
    daily_quota_used: dailyQuotaUsed(db),          // SELECT COALESCE(SUM(quota_used),0) FROM users
    webhook_dead_letters: s.webhooks.dead_letter,
  },
}, { strict: true });
```

**Constraint:** The route already has `db` available via the handler's `createAdminDashboardHandler(db).getStats()` factory. The two extra SQL queries (`candidateCount`, `activePlacementCount`, `dailyQuotaUsed`) are added as small private functions in the same route file (or a new `src/main/modules/admin/dashboard-queries.ts` if preferred — see spec §6 for decision).

### 3.3 Projection patterns for the 7 SELECT * endpoints

#### Endpoints 2–5: simple column projection (no transformation)
For `list_users`, `list_candidates`, `list_audit`, `listDeadLetter`, the table columns are a superset of (or equal to) the schema fields. The fix is a straight `SELECT col1, col2, ...` in the handler:

```ts
// users.ts (line 30-38)
list(filter): UserPublic[] {
  const sql = `
    SELECT id, user_type, name, quota_per_day, quota_used, quota_reset_at,
           reputation, status, created_at
    FROM users WHERE 1=1`;
  // ... existing filter + LIMIT logic ...
  return db.prepare(sql).all(...params) as UserPublic[];
}
```

**Note on `reputation`:** v001 already added the column. No migration needed.

#### Endpoint 6: rate-limit buckets — name remapping + derived `bucket_key`

Table columns: `id, user_id, window_start, window_seconds, request_count, expires_at`
Schema declares: `user_id, bucket_key, count, window_started_at`

Handler:
```ts
listBuckets(user_id?): RateLimitBucket[] {
  let sql = `SELECT user_id, window_start, request_count FROM rate_limit_buckets WHERE 1=1`;
  const params: any[] = [];
  if (user_id) { sql += ' AND user_id = ?'; params.push(user_id); }
  const rows = db.prepare(sql).all(...params) as Array<{ user_id: string; window_start: string; request_count: number }>;
  return rows.map((r) => ({
    user_id: r.user_id,
    bucket_key: `${r.user_id}:${r.window_start}`,
    count: r.request_count,
    window_started_at: r.window_start,
  }));
}
```

#### Endpoint 7: placements — JOIN to jobs for `employer_id`

Table: `placements(id, job_id, anonymized_candidate_id, candidate_user_id, primary_headhunter_id, referrer_headhunter_id, annual_salary, platform_fee, primary_share, referrer_share, candidate_bonus, status, created_at, updated_at)` — no `employer_id`.
Schema declares: `id, job_id, employer_id, anonymized_candidate_id, primary_headhunter_id, referrer_headhunter_id, annual_salary, platform_fee, primary_share, referrer_share, status, created_at, updated_at` — missing `candidate_user_id`, `candidate_bonus`.

Handler: JOIN `placements` to `jobs` to get `employer_id = jobs.employer_user_id` (verified name in `jobs` migration). Add the two missing fields. Drop nothing.

```ts
list(filter): AdminPlacement[] {
  const sql = `
    SELECT p.id, p.job_id, j.employer_user_id AS employer_id,
           p.anonymized_candidate_id, p.candidate_user_id, p.candidate_bonus,
           p.primary_headhunter_id, p.referrer_headhunter_id,
           p.annual_salary, p.platform_fee, p.primary_share, p.referrer_share,
           p.status, p.created_at, p.updated_at
    FROM placements p
    JOIN jobs j ON j.id = p.job_id
    WHERE 1=1`;
  // ... existing filter + LIMIT logic ...
  return db.prepare(sql).all(...params) as AdminPlacement[];
}
```

**Verification step (executor):** Before writing the SQL, confirm the actual column name in `jobs` table by reading `src/main/db/migrations/*.sql`. The Explore report used `employer_user_id` as a guess; it could also be `employer_id` or `created_by`. Update the SQL to match reality.

#### Endpoint 8: admin-log — flatten `details_json`

Table: `admin_action_log(id, admin_user_id, action, target_type, target_id, details_json, created_at)`
Schema declares: `id, actor, action_type, target_type, target_id, reason, created_at`

Handler:
```ts
list(filter): AdminLogItem[] {
  const sql = `SELECT id, admin_user_id, action, target_type, target_id, details_json, created_at FROM admin_action_log WHERE 1=1`;
  // ... existing filter + ORDER BY + LIMIT logic ...
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

### 3.4 `strict: true` on all admin routes

In `src/main/routes/admin.ts`, append `, { strict: true }` to every `respond()` call. There are 20 call sites in this file (per the Explore report). Order:

1. Apply strict + simple projections together (Tasks 2–5 in plan) so the `schema-shape` test for each endpoint passes the moment we flip the switch.
2. Apply strict + complex projections last (Tasks 6–8) so the `RateLimitBucketSchema`/`AdminPlacementSchema`/`AdminLogItemSchema` schemas are honored.

**Per-task: strict mode is enabled on the SAME commit as the column projection.** This way, if a projection is wrong, the failure is loud in the test for that endpoint specifically, not masked by silent-strip elsewhere.

## 4. Test Strategy

### 4.1 Existing tests to update

| Test file | Change |
|---|---|
| `tests/integration/skill-md-conformance/schema-shape.test.ts:274-276` | Remove `admin.dashboard_stats`, `admin.list_users`, `admin.list_candidates` from `skipAdmin` Set. Each `it.skip` becomes a real `it` that runs the zod validation via `cap.response_schema`. |
| `tests/integration/e2e-m3-admin.test.ts:35-39` | If dashboard handler is touched (it shouldn't be — adapter is in route), update. Otherwise no change. |
| `tests/integration/skill-md-conformance/admin-endpoints.test.ts:37-44` | `GET /v1/admin/users` already uses `ListUsersResponseSchema` via `client.request`. With `strict: true` it will keep passing IF projection is correct. If projection is wrong, the test surfaces the error loudly — that's the desired behavior. |
| `tests/unit/admin-schemas.test.ts` | Add happy-path fixtures for the 3 detached schemas (`RateLimitBucketSchema`, `AdminPlacementSchema`, `AdminLogItemSchema`) and for `DashboardStatsResponseSchema` if not already present. |

### 4.2 New tests to add

| File | Purpose |
|---|---|
| `tests/integration/admin-strict-mode.test.ts` (new) | Smoke test: with `strict: true`, a handler that returns a row with an extra column not in the schema produces a 500 (not a 200 with stripped data). One test per route. Validates the strict-mode contract. |
| Add to `tests/integration/skill-md-conformance/schema-shape.test.ts` (not new file) | Un-skip the 3 admin capabilities and add new schema-shape tests for the other 5 list endpoints (audit, webhooks/dead-letter, rate-limit/buckets, placements, admin-log) — they pass today only by accident under silent-strip; we want them passing for real. |

### 4.3 Negative test for strict mode

A new test that exercises the failure path:

```ts
// tests/integration/admin-strict-mode.test.ts
it('respond() with strict=true rejects payloads with unknown keys', async () => {
  // Call an admin list endpoint after injecting an extra column via DB write
  // (e.g., add a row with a custom field, or mock the handler)
  // Expect: 500 with a ZodError mentioning the unknown key
});
```

This guards against accidental fallback to lenient mode.

## 5. Migration / DB impact

**No new migrations needed.** `reputation` already exists in `users` (v001). All other schema-table gaps are handled in the handler (projection + remapping).

## 6. Files To Change

### Modified
- `src/main/routes/admin.ts` — adapter for dashboard (Task 1) + 20 `respond(..., { strict: true })` additions (Tasks 2–8 inline)
- `src/main/modules/admin/handlers/dashboard.ts` — NO CHANGE (nested shape preserved for IPC callers)
- `src/main/modules/admin/handlers/users.ts` — `SELECT` column projection (Task 2)
- `src/main/modules/admin/handlers/candidates.ts` — `SELECT` column projection (Task 3)
- `src/main/modules/admin/handlers/audit.ts` — `SELECT` column projection (Task 4)
- `src/main/modules/admin/handlers/webhooks.ts` — `SELECT` column projection (Task 5)
- `src/main/modules/admin/handlers/rate-limit.ts` — column remap + `bucket_key` derivation (Task 6)
- `src/main/modules/admin/handlers/placements.ts` — JOIN to jobs for `employer_id`; add 2 missing fields (Task 7)
- `src/main/modules/admin/handlers/admin-log.ts` — JSON flatten (Task 8)
- `tests/integration/skill-md-conformance/schema-shape.test.ts` — un-skip 3 admin caps; add 5 more
- `tests/unit/admin-schemas.test.ts` — add happy-path fixtures for 3 detached schemas

### New
- `tests/integration/admin-strict-mode.test.ts` — strict-mode contract test
- `src/main/modules/admin/dashboard-queries.ts` (optional) — `candidateCount`, `activePlacementCount`, `dailyQuotaUsed` helpers. Can also be inline in `routes/admin.ts` if preferred.

### Untouched
- `src/main/responses.ts` (no change to `respond()` itself)
- All 5 capability declaration files (response_schema unchanged — schema is the source of truth)
- All 8 schema definitions in `src/main/schemas/admin.ts` (unchanged — we adapt handlers to schemas)
- All migrations

## 7. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `jobs.employer_user_id` column name is wrong (e.g., it's `employer_id` or `created_by`) | Medium | High (placements broken) | Executor MUST read `src/main/db/migrations/*.sql` to confirm the column name before writing the JOIN. The Explore report used a guess. |
| `admin_action_log.details_json` contains `reason` in nested form (e.g., `details_json = '{"payload": {"reason": "x"}}'`) | Low | Medium | The current `users.suspend` handler writes `details_json: JSON.stringify({ reason: ... })` flat. Verify by reading other call sites; if nested, add a recursive lookup. |
| `e2e-m3-admin.test.ts` asserts `stats.users.headhunter` — this is the IPC nested shape, NOT the route response. | Low | Low | The dashboard adapter is in the route, not the handler. `getStats()` returns unchanged. Test continues to pass. |
| Adding `{ strict: true }` to a route whose handler is buggy breaks a test the agent didn't know about. | Medium | Medium | Run `pnpm test` after EACH route's strict-mode flip (per the plan's commit granularity). If breakage: fix the handler before moving on. |
| `e2e-m3-admin.test.ts:47-53` asserts `result.status === 'pending'` on dead-letter list raw rows — this is a repo-level test, not an HTTP test. | Low | Low | No change to dead-letter repo function needed; only `listDeadLetter` (the admin handler) is touched. |
| Other places call `respond()` with non-strict that we don't want to touch (e.g., Phase 2 OTel code, error middleware) | Low | High | The plan restricts strict additions to `src/main/routes/admin.ts` only. Future PRs can extend to other route files in a follow-up. |

## 8. Out of Scope

- Applying `strict: true` to non-admin routes (Phase 7 follow-up)
- Adding a `respondList()` helper to dedupe envelope wrapping (Phase 7 follow-up)
- Fixing the dashboard IPC to return flat shape (would break `dashboardIpc` callers)
- New migrations (none required)
- Renaming capability names like `admin.dashboard_stats` (stable, don't break external agents)
- Updating `package.json` version (still 1.4.1; do this in Phase 7 v1.8 release)

## 9. Success Criteria

- [ ] `pnpm test` passes with 0 failures
- [ ] `pnpm typecheck` → 0 errors
- [ ] `pnpm conformance:check` → still 46/46
- [ ] `pnpm conformance:gen` → still idempotent
- [ ] All 8 admin list endpoints return shapes that match their declared zod schemas (verified by un-skipped schema-shape tests)
- [ ] `tests/integration/admin-strict-mode.test.ts` exists and passes
- [ ] `pnpm capabilities:check` → 46/46
- [ ] `pnpm openapi:check` → clean
- [ ] `git diff` restricted to: `src/main/routes/admin.ts`, 7 handler files, 2 test files, optionally 1 new helper file
- [ ] No new migrations added
- [ ] No changes to `src/main/responses.ts` or any schema definition

## 10. Effort Estimate

~0.5 working day. 8 atomic commits (one per endpoint) + 1 commit for strict-mode contract test + 1 commit for un-skipping schema-shape tests = ~10 commits total. Aligns with the design exploration above.

## 11. Open Questions for Executor

These are NOT blockers — the executor should resolve them by reading the actual code:

1. **Exact column name in `jobs` table for employer ID.** The Explore report guessed `employer_user_id`. Read `src/main/db/migrations/*.sql` to confirm.
2. **Whether `admin_action_log.details_json` is always a JSON object with a top-level `reason` field, or sometimes nested.** If nested, the flatten function in the admin-log handler needs a deeper search. Read all call sites of `admin_action_log` insert to verify.
3. **Whether the dashboard `getStats()` IPC output ever includes `active_placements` or `daily_quota_used` in its nested shape.** If so, the new SQL queries can be dropped; otherwise the spec §3.2 adapter is needed.
