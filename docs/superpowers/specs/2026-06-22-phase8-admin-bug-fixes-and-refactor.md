# Phase 8 — Admin Bug Fixes + Schema-Shape Refactor Design Spec

**Date:** 2026-06-22
**Status:** Approved
**Project:** hunter-platform
**Branch:** main
**Author:** ZCode (brainstorming session)
**Depends on:** Phase 7 commit `31098d0` (which surfaced the 3 admin bugs)

## 1. Background & Goal

Phase 7 conformance testing surfaced 3 real production bugs in admin endpoints (all 500-ing under Phase 6's strict-mode). Phase 7 also left a structural issue: the main `schema-shape.test.ts` file contains 21 `it.skip` entries that point to dedicated sibling files, creating a "duplicate skip" pattern that obscures which tests provide real coverage.

**Goal:**
1. Fix the 3 admin production bugs (handler outputs don't match zod schemas).
2. Refactor `schema-shape.test.ts` to delete the 21 duplicate skip entries; the 25 simple capabilities stay in the main file, the 21 complex ones live only in their dedicated sibling files.
3. After Phase 8, the schema-shape conformance suite has 0 skipped tests (down from 24).

## 2. Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| SDK for external consumers | **Dropped** | AI agents (the primary consumer) use raw HTTP, not npm. SDK had limited ROI. |
| Bug fix strategy | **Handler outputs match schema** (schema is source of truth, per Phase 6 principle) | Phase 1 + 6 established schema as API contract |
| Refactor strategy | **Delete 21 duplicate skips from main file** | Cleaner than "duplicate skip" pattern; main file becomes 25 simple tests |
| `placements_summary` redesign | **Add 2 missing fields** (total_count, cancelled_count) to handler | Schema is the contract; handler needs to compute and return them |

## 3. Scope (3 Production Bugs + 1 Refactor)

### 3.1 Bug 1: `admin.remove_from_pool` (500)

**File:** `src/main/modules/admin/handlers/candidates.ts:29-34`

**Current (broken):**
```ts
removeFromPool(anonymized_id: string): { anonymized_id: string; is_public_pool: number } {
  const c = candidates.findById(anonymized_id);
  if (!c) throw Errors.notFound('Candidate not found');
  db.prepare("UPDATE candidates_anonymized SET is_public_pool = 0, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), anonymized_id);
  return { anonymized_id, is_public_pool: 0 };
},
```

**Expected (per `RemoveFromPoolResponseSchema`):**
```ts
{ anonymized_id: IdString, removed: z.literal(true) }
```

**Fix:** Return `removed: true` instead of `is_public_pool: 0`.

```ts
removeFromPool(anonymized_id: string): { anonymized_id: string; removed: true } {
  const c = candidates.findById(anonymized_id);
  if (!c) throw Errors.notFound('Candidate not found');
  db.prepare("UPDATE candidates_anonymized SET is_public_pool = 0, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), anonymized_id);
  return { anonymized_id, removed: true };
},
```

### 3.2 Bug 2: `admin.clear_user_rate_limit` (500)

**File:** `src/main/modules/admin/handlers/rate-limit.ts:23-26`

**Current (broken):**
```ts
clearForUser(user_id: string): { user_id: string; deleted: number } {
  const result = db.prepare('DELETE FROM rate_limit_buckets WHERE user_id = ?').run(user_id);
  return { user_id, deleted: Number(result.changes ?? 0) };
},
```

**Expected (per `ClearRateLimitResponseSchema`):**
```ts
{ user_id: IdString, cleared: z.literal(true) }
```

**Fix:** Return `cleared: true` instead of `deleted: N`.

```ts
clearForUser(user_id: string): { user_id: string; cleared: true } {
  db.prepare('DELETE FROM rate_limit_buckets WHERE user_id = ?').run(user_id);
  return { user_id, cleared: true };
},
```

(Note: the `Number(result.changes ?? 0)` is also dropped — schema doesn't need a count. The side effect of deleting rows still happens; the response just doesn't surface the count.)

### 3.3 Bug 3: `admin.placements_summary` (500)

**File:** `src/main/modules/admin/handlers/placements.ts:68-86`

**Current (broken) returns:**
```ts
{
  pending_count, paid_count,
  total_paid_amount: total_hunter_payout,
  total_platform_revenue, total_hunter_payout,
}
```

**Expected (per `PlacementsSummarySchema`):**
```ts
{
  total_count: number,
  pending_payment_count: number,
  paid_count: number,
  cancelled_count: number,
  total_revenue: number,
}
```

**Fix:** Rewrite `summary()` to compute and return the 5 schema fields.

```ts
summary(): {
  total_count: number; pending_payment_count: number; paid_count: number;
  cancelled_count: number; total_revenue: number;
} {
  const rows = db.prepare(
    "SELECT status, COUNT(*) as cnt, COALESCE(SUM(platform_fee), 0) as total_fee FROM placements GROUP BY status"
  ).all() as { status: string; cnt: number; total_fee: number }[];
  let total_count = 0, pending_payment_count = 0, paid_count = 0, cancelled_count = 0, total_revenue = 0;
  for (const r of rows) {
    total_count += r.cnt;
    total_revenue += r.total_fee;
    if (r.status === 'pending_payment') pending_payment_count = r.cnt;
    if (r.status === 'paid') paid_count = r.cnt;
    if (r.status === 'cancelled') cancelled_count = r.cnt;
  }
  return { total_count, pending_payment_count, paid_count, cancelled_count, total_revenue };
},
```

**Mapping changes from old → new:**
- `pending_count` → `pending_payment_count`
- `paid_count` (unchanged)
- `total_paid_amount: total_hunter_payout` (was incorrectly using `SUM(primary_share) + SUM(referrer_share)`) → DROP
- `total_platform_revenue` → `total_revenue` (rename)
- `total_hunter_payout` (was also a sum) → DROP
- NEW: `total_count` = sum of all rows
- NEW: `cancelled_count` = rows with status='cancelled'

### 3.4 Refactor: Delete 21 duplicate skips from main `schema-shape.test.ts`

**File:** `tests/integration/skill-md-conformance/schema-shape.test.ts`

**Current structure:** 46 tests (one per capability), 25 pass, 21 skip. The 21 skips are "duplicate" entries that point to sibling files (e.g., `auth.rotate_key` is skipped in main file with a comment saying "covered in schema-shape-destructive.test.ts").

**Target structure:** 25 tests (only the simple capabilities stay), 0 skip. The 21 complex capabilities live exclusively in their sibling files (destructive / flow / admin-precondition).

**Concrete changes:**

1. **In the auth describe block:** Remove the `it.skip` for `auth.rotate_key` (lines 174-176 in the current file). After the change, the auth describe block has only 1 test (auth.register).

2. **In the headhunter describe block:** Remove the `skipHeadhunter` Set entirely. Keep the comment explaining why `recommend_candidate` is exercised elsewhere. After the change, the headhunter describe block has 7 tests (all headhunter caps except recommend_candidate).

3. **In the employer describe block:** Remove the `isMultiStep` check entirely. After the change, the employer describe block has 4 tests (create_job + 3 simple ones; the 5 multi-step ones move to flow file).

4. **In the candidate describe block:** Remove the `isMultiStep` and `delete_my_data` checks. After the change, the candidate describe block has 3 tests (opportunities, access_log, export_my_data; the 3 complex ones move to flow/destructive).

5. **In the admin describe block:** Remove the `skipAdmin` Set entirely (replaced by an empty Set or just removed). After the change, the admin describe block has 8-9 tests (only the simple ones; the 11-12 admin-precondition ones live in admin-precondition file).

6. **In `schema-shape-admin-precondition.test.ts`:** Remove the 3 `it.skip` entries for `remove_from_pool`, `clear_user_rate_limit`, `placements_summary` (now that Phase 8A fixes them, they should pass).

**Net result:**
- Main file: 46 tests → 25 tests (0 skipped)
- Destructive file: 2 tests (unchanged)
- Flow file: 7 tests (unchanged)
- Admin-precondition file: 12 tests → 9 tests (12 - 3 unskipped) wait, that math is wrong. After un-skipping 3, file has 12 tests, all pass.
- Grand total: 25 + 2 + 7 + 12 = 46 tests, 0 skipped (was 67 with 24 skipped, now 46 with 0 skipped — fewer total because the 21 duplicates are removed)

## 4. File Manifest

### Modified files (5)
| File | Change |
|---|---|
| `src/main/modules/admin/handlers/candidates.ts` | Bug 1 fix: `removeFromPool` returns `removed: true` |
| `src/main/modules/admin/handlers/rate-limit.ts` | Bug 2 fix: `clearForUser` returns `cleared: true` |
| `src/main/modules/admin/handlers/placements.ts` | Bug 3 fix: `summary` returns 5-field shape with new field names |
| `tests/integration/skill-md-conformance/schema-shape.test.ts` | Delete 21 duplicate skip entries (refactor 3.4) |
| `tests/integration/skill-md-conformance/schema-shape-admin-precondition.test.ts` | Remove 3 production-bug skip entries (now that bugs are fixed) |

### Untouched
- All other Phase 1-7 changes
- OpenAPI spec (no SDK generation this phase)
- `package.json` (no version bump)
- `examples/reference-agent/` (already marked @deprecated in Phase 5)

## 5. Test count projection

| Before Phase 8 | After Phase 8 |
|---|---|
| `pnpm test` total: 776 pass, 24 skip, 46 todo (846) | `pnpm test` total: 797 pass, 0 skip, 46 todo (843) |
| Conformance: 25 + 2 + 7 + (9 + 3 skip) = 43 pass, 24 skip | Conformance: 25 + 2 + 7 + 12 = 46 pass, 0 skip |
| 3 endpoints return 500 | All 3 return 200 with correct shape |

Net: +21 pass, -24 skip, -3 todo (none, just rearranged). The 3 production bugs are fixed.

## 6. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Changing `summary()` field semantics (`total_paid_amount` → `total_revenue`) might break a downstream consumer | Low | Medium | The schema-shape conformance test will catch any drift. There are no internal callers of `summary()` other than the route. The dashboard adapter doesn't use it. |
| After deleting 21 main-file skips, the test count drops, but the "coverage" is preserved by sibling files | Low | Low | The coverage gate (`pnpm conformance:check`) checks that every capability has SOMEWHERE in the conformance dir, not in any specific file. So coverage stays at 46/46. |
| `remove_from_pool` schema says `removed: z.literal(true)` — making it a constant `true` rather than a computed field is semantically odd | Low | Low | It's documenting "this operation succeeded" — same pattern as `cleared: z.literal(true)`. Matches existing `MarkPaidResponseSchema` which uses `status: z.literal('paid')`. |
| `placements_summary` change drops the `total_hunter_payout` field — if any admin UI uses it, they need to migrate | Low | Medium | The Phase 6 strict mode would have already 500'd this endpoint (since the response was schema-incompatible), so any UI consuming it is already broken. The fix un-breaks it. |
| Some existing integration test might check the OLD field names (`pending_count`, `total_paid_amount`, etc.) | Low | Medium | Executor searches for these names in `tests/` before changing; if found, the test is updated. |

## 7. Success Criteria

- [ ] `pnpm test` shows 797+ passed, 0 skipped, 0 failures
- [ ] `pnpm typecheck` clean
- [ ] `pnpm conformance:check` still 46/46
- [ ] `pnpm capabilities:check` still 46/46
- [ ] `pnpm openapi:check` clean
- [ ] `curl` of `POST /v1/admin/candidates/:id/remove-from-pool` returns 200 with `data.removed: true`
- [ ] `curl` of `POST /v1/admin/rate-limit/users/:id/clear` returns 200 with `data.cleared: true`
- [ ] `curl` of `GET /v1/admin/placements/summary` returns 200 with the 5 schema fields
- [ ] 5 atomic commits on main branch
- [ ] No other test files modified beyond the 2 listed

## 8. Out of Scope (deferred to Phase 9+)

- OpenAPI → Typed SDK (dropped per user decision)
- Filling the 46 `it.todo` stubs in `_generated.test.ts`
- Refactoring other test files (e2e-m3-admin.test.ts, etc.)
- `package.json` version bump
- v1.8 release notes

## 9. Effort Estimate

~1.5 working days (3 hours for 3 bug fixes + 1 day for refactor + verification). 5 atomic commits.

## 10. Open Questions for Executor

1. **Does the `placements_summary` endpoint have any external (out-of-test) consumer that depends on the old `total_paid_amount` / `total_hunter_payout` fields?** Search the codebase and `docs/` for these field names. If found, decide whether to keep them as additional fields or migrate the consumer.
2. **Are there any integration tests for the 3 fixed endpoints that assert the old field names?** Check `tests/integration/admin-endpoints.test.ts` and `tests/integration/e2e-m3-admin.test.ts`. If found, update them.
3. **Is there a `--` or other flag that re-introduces the 21 deleted tests as smoke-only checks?** No — the design is to fully delete them.
