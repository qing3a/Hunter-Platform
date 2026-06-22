# Phase 8 Admin Bug Fixes + Schema-Shape Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 admin production bugs (handlers return wrong shape → 500 under Phase 6 strict mode) and refactor `schema-shape.test.ts` to delete 21 duplicate skip entries. After Phase 8, the schema-shape conformance suite has 0 skipped tests (down from 24).

**Architecture:** Each bug fix is a single handler change (1-line modification of the return statement or return-type signature). The refactor is a structural cleanup: delete skip logic from the main `schema-shape.test.ts` file since the 21 skipped capabilities now live exclusively in dedicated sibling files. After the fixes, the 3 previously-skipped production-bug tests in `schema-shape-admin-precondition.test.ts` are unskipped.

**Tech Stack:** TypeScript, zod, vitest. No new dependencies.

**Design spec:** `docs/superpowers/specs/2026-06-22-phase8-admin-bug-fixes-and-refactor.md`

---

## File Structure

### Modified files (5)
| File | Change |
|---|---|
| `src/main/modules/admin/handlers/candidates.ts` | Bug 1: `removeFromPool` returns `removed: true` |
| `src/main/modules/admin/handlers/rate-limit.ts` | Bug 2: `clearForUser` returns `cleared: true` |
| `src/main/modules/admin/handlers/placements.ts` | Bug 3: `summary` returns 5 schema fields (new field names) |
| `tests/integration/skill-md-conformance/schema-shape.test.ts` | Delete 21 duplicate skip entries + 4 conditional blocks |
| `tests/integration/skill-md-conformance/schema-shape-admin-precondition.test.ts` | Un-skip 3 admin capabilities (now that bugs are fixed) |

### Untouched
- All other production code
- All other test files
- `package.json`, `tsconfig.json`
- Phase 7 changes

---

## Task 1: Fix Bug 1 — `admin.remove_from_pool` returns `removed: true`

**Files:**
- Modify: `src/main/modules/admin/handlers/candidates.ts:29-35`

- [ ] **Step 1.1: Read the current handler**

Read `src/main/modules/admin/handlers/candidates.ts` lines 29-35. Confirm the current `removeFromPool` method returns `{ anonymized_id, is_public_pool: 0 }`.

- [ ] **Step 1.2: Verify the schema expects `removed: true`**

Read `src/main/schemas/admin.ts` lines 112-114. Confirm the schema declares `{ anonymized_id: IdString, removed: z.literal(true) }`.

- [ ] **Step 1.3: Replace the handler return type and return statement**

In `src/main/modules/admin/handlers/candidates.ts`, change the `removeFromPool` method:

**Old (lines 29-35):**
```ts
    removeFromPool(anonymized_id: string): { anonymized_id: string; is_public_pool: number } {
      const c = candidates.findById(anonymized_id);
      if (!c) throw Errors.notFound('Candidate not found');
      db.prepare("UPDATE candidates_anonymized SET is_public_pool = 0, updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), anonymized_id);
      return { anonymized_id, is_public_pool: 0 };
    },
```

**New:**
```ts
    removeFromPool(anonymized_id: string): { anonymized_id: string; removed: true } {
      const c = candidates.findById(anonymized_id);
      if (!c) throw Errors.notFound('Candidate not found');
      db.prepare("UPDATE candidates_anonymized SET is_public_pool = 0, updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), anonymized_id);
      return { anonymized_id, removed: true };
    },
```

- [ ] **Step 1.4: Run typecheck**

Run: `cd /d/dev/hunter-platform && pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 1.5: Run admin-precondition test to verify the fix**

Run: `cd /d/dev/hunter-platform && pnpm test tests/integration/skill-md-conformance/schema-shape-admin-precondition 2>&1 | tail -20`
Expected: the `admin.remove_from_pool` test still skips (it's still in the skip list for now). No regression. The next tasks will unskip it.

- [ ] **Step 1.6: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/modules/admin/handlers/candidates.ts
git commit -m "fix(admin): remove_from_pool returns removed:true (schema match)"
```

---

## Task 2: Fix Bug 2 — `admin.clear_user_rate_limit` returns `cleared: true`

**Files:**
- Modify: `src/main/modules/admin/handlers/rate-limit.ts:23-26`

- [ ] **Step 2.1: Read the current handler**

Read `src/main/modules/admin/handlers/rate-limit.ts` lines 23-26. Confirm the current `clearForUser` method returns `{ user_id, deleted: Number(changes) }`.

- [ ] **Step 2.2: Verify the schema expects `cleared: true`**

Read `src/main/schemas/admin.ts` lines 121-123. Confirm the schema declares `{ user_id: IdString, cleared: z.literal(true) }`.

- [ ] **Step 2.3: Replace the handler return type and return statement**

In `src/main/modules/admin/handlers/rate-limit.ts`, change the `clearForUser` method:

**Old (lines 23-26):**
```ts
    clearForUser(user_id: string): { user_id: string; deleted: number } {
      const result = db.prepare('DELETE FROM rate_limit_buckets WHERE user_id = ?').run(user_id);
      return { user_id, deleted: Number(result.changes ?? 0) };
    },
```

**New:**
```ts
    clearForUser(user_id: string): { user_id: string; cleared: true } {
      db.prepare('DELETE FROM rate_limit_buckets WHERE user_id = ?').run(user_id);
      return { user_id, cleared: true };
    },
```

- [ ] **Step 2.4: Run typecheck and admin-precondition test**

Run:
```bash
cd /d/dev/hunter-platform
pnpm typecheck && pnpm test tests/integration/skill-md-conformance/schema-shape-admin-precondition 2>&1 | tail -10
```
Expected: 0 typecheck errors. Test still passes (the relevant test is still skipped at this point).

- [ ] **Step 2.5: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/modules/admin/handlers/rate-limit.ts
git commit -m "fix(admin): clear_user_rate_limit returns cleared:true (schema match)"
```

---

## Task 3: Fix Bug 3 — `admin.placements_summary` returns 5 schema fields

**Files:**
- Modify: `src/main/modules/admin/handlers/placements.ts:68-86`

- [ ] **Step 3.1: Read the current handler**

Read `src/main/modules/admin/handlers/placements.ts` lines 68-86. Confirm the current `summary` method returns `{ pending_count, paid_count, total_paid_amount, total_platform_revenue, total_hunter_payout }`.

- [ ] **Step 3.2: Verify the schema expects 5 different fields**

Read `src/main/schemas/admin.ts` lines 95-101. Confirm the schema declares:
```ts
{
  total_count: z.number().int(),
  pending_payment_count: z.number().int(),
  paid_count: z.number().int(),
  cancelled_count: z.number().int(),
  total_revenue: z.number().int(),
}
```

- [ ] **Step 3.3: Search for any internal callers that might depend on the old field names**

Run: `cd /d/dev/hunter-platform && grep -rn "pending_count\|total_paid_amount\|total_hunter_payout" --include="*.ts" . 2>&1 | grep -v node_modules | head -10`
Expected: 0 matches outside of `placements.ts` and `admin.ts` (the schema file). If any test or handler uses these old fields, update them to use the new names.

- [ ] **Step 3.4: Replace the handler with the new field set**

In `src/main/modules/admin/handlers/placements.ts`, change the `summary` method:

**Old (lines 68-86):**
```ts
    summary(): {
      pending_count: number; paid_count: number; total_paid_amount: number;
      total_platform_revenue: number; total_hunter_payout: number;
    } {
      const rows = db.prepare(
        "SELECT status, COUNT(*) as cnt, COALESCE(SUM(platform_fee), 0) as total_fee, COALESCE(SUM(primary_share), 0) as total_primary, COALESCE(SUM(referrer_share), 0) as total_referrer FROM placements GROUP BY status"
      ).all() as { status: string; cnt: number; total_fee: number; total_primary: number; total_referrer: number }[];
      let pending_count = 0, paid_count = 0, total_platform_revenue = 0, total_hunter_payout = 0;
      for (const r of rows) {
        if (r.status === 'pending_payment') pending_count = r.cnt;
        if (r.status === 'paid') paid_count = r.cnt;
        total_platform_revenue += r.total_fee;
        total_hunter_payout += r.total_primary + r.total_referrer;
      }
      return {
        pending_count, paid_count, total_paid_amount: total_hunter_payout,
        total_platform_revenue, total_hunter_payout,
      };
    },
```

**New:**
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

- [ ] **Step 3.5: Run typecheck and admin-precondition test**

Run:
```bash
cd /d/dev/hunter-platform
pnpm typecheck && pnpm test tests/integration/skill-md-conformance/schema-shape-admin-precondition 2>&1 | tail -10
```
Expected: 0 typecheck errors. Test still passes.

- [ ] **Step 3.6: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/modules/admin/handlers/placements.ts
git commit -m "fix(admin): placements_summary returns 5 schema fields (total_count + cancelled_count added, renamed total_revenue)"
```

---

## Task 4: Un-skip 3 admin capabilities in admin-precondition test

**Files:**
- Modify: `tests/integration/skill-md-conformance/schema-shape-admin-precondition.test.ts`

- [ ] **Step 4.1: Find the 3 currently-skipped admin capabilities**

Read `tests/integration/skill-md-conformance/schema-shape-admin-precondition.test.ts` and find the 3 `it.skip` entries for:
- `admin.remove_from_pool`
- `admin.clear_user_rate_limit`
- `admin.placements_summary`

The agent in Phase 7 likely wrapped them in a `it.skip` block (rather than the test having a permanent skip list). Find the exact pattern.

- [ ] **Step 4.2: Replace the `it.skip` with real `it()` blocks**

For each of the 3 capabilities, change `it.skip(...)` to `it(...)` and ensure the test makes a real API call to verify the response shape matches the schema. The existing skip comment should have noted the production bug; remove that comment.

- [ ] **Step 4.3: Run the admin-precondition test**

Run: `cd /d/dev/hunter-platform && pnpm test tests/integration/skill-md-conformance/schema-shape-admin-precondition 2>&1 | tail -20`
Expected: All 12 tests pass (3 previously-skipped now passing). Total: 9 + 3 = 12 pass, 0 skip.

- [ ] **Step 4.4: Commit**

```bash
cd /d/dev/hunter-platform
git add tests/integration/skill-md-conformance/schema-shape-admin-precondition.test.ts
git commit -m "test(conformance): un-skip 3 admin capabilities now that production bugs are fixed"
```

---

## Task 5: Refactor main `schema-shape.test.ts` — delete 21 duplicate skips

**Files:**
- Modify: `tests/integration/skill-md-conformance/schema-shape.test.ts`

- [ ] **Step 5.1: Read the current main file to find the 4 conditional blocks**

Read `tests/integration/skill-md-conformance/schema-shape.test.ts` and find the 4 places where the main file conditionally skips capabilities:
1. **auth describe block**: `if (cap.name === 'auth.rotate_key') { it.skip(...) }`
2. **headhunter describe block**: `const skipHeadhunter = new Set(['headhunter.recommend_candidate'])` + check inside the loop
3. **employer describe block**: `const isMultiStep = ...` + check inside the loop
4. **candidate describe block**: `const isMultiStep = ...` + `if (cap.name === 'candidate.delete_my_data')` + checks
5. **admin describe block**: `const skipAdmin = new Set([...])` + check inside the loop

- [ ] **Step 5.2: Remove the auth skip block**

In the auth describe block, delete the `if (cap.name === 'auth.rotate_key') { it.skip(...); continue; }` block. The auth describe block now iterates all 2 auth capabilities with no skips (auth.register is exercised normally; auth.rotate_key still loops, but since it has a destructive side effect on `hKey`, the test may fail at runtime — see Step 5.7 verification).

- [ ] **Step 5.3: Remove the headhunter skip set and check**

In the headhunter describe block:
- Delete the `const skipHeadhunter = new Set(['headhunter.recommend_candidate']);` line
- Delete the `if (skipHeadhunter.has(cap.name)) { it.skip(...); continue; }` block

The 8 headhunter capabilities now all loop without skips. The `recommend_candidate` test will call the endpoint, which may 409 because beforeAll already created a recommendation. This is acceptable; see Step 5.7 for verification.

- [ ] **Step 5.4: Remove the employer isMultiStep check**

In the employer describe block:
- Delete the `const isMultiStep = cap.name.includes('unlock_contact') || cap.name.includes('placement') || cap.name === 'employer.express_interest' || cap.name === 'employer.claim_job' || cap.name === 'employer.reject_job';` line
- Delete the `if (isMultiStep) { it.skip(...); continue; }` block

The 9 employer capabilities now all loop. The 5 multi-step ones may fail at runtime (because the main file's beforeAll doesn't set up the state machine properly). See Step 5.7.

- [ ] **Step 5.5: Remove the candidate isMultiStep and delete_my_data checks**

In the candidate describe block:
- Delete the `const isMultiStep = cap.name.includes('approve_unlock') || cap.name.includes('reject_unlock');` line
- Delete the `if (isMultiStep) { it.skip(...); continue; }` block
- Delete the `if (cap.name === 'candidate.delete_my_data') { it.skip(...); continue; }` block

- [ ] **Step 5.6: Remove the admin skip set**

In the admin describe block:
- Delete the `const skipAdmin = new Set([...]);` line
- Delete the `if (skipAdmin.has(cap.name)) { it.skip(...); continue; }` block
- The `skipAdmin` comment lines (the 11-entry list explaining each skip) can also be deleted.

- [ ] **Step 5.7: Run the main schema-shape test**

Run: `cd /d/dev/hunter-platform && pnpm test tests/integration/skill-md-conformance/schema-shape 2>&1 | tail -30`
Expected: The simple capabilities pass. The complex ones (multi-step, destructive, pre-existing records) may fail at runtime. **This is expected** — the refactor is to delete the duplicate skips, and the failures demonstrate why the sibling files exist.

- [ ] **Step 5.8: Fix the runtime failures by adding capability checks in the main file's it() block**

The simplest fix: wrap each `it()` call in the main file with a check that bails out if the capability is one of the "complex" ones (already covered in sibling files). Replace the per-describe skip logic with a single `COMPLEX_CAPS` set at the top of the file:

```typescript
// Capabilities that need pre-existing records, state-machine preconditions,
// or destructive side-effects. These are tested in dedicated sibling files
// (schema-shape-destructive.test.ts, schema-shape-flow.test.ts,
// schema-shape-admin-precondition.test.ts). Listed here ONLY so the main
// file's loop can skip them — they are not skipped via it.skip, just
// filtered before the loop, so test counts are accurate.
const COMPLEX_CAPS = new Set([
  'auth.rotate_key',
  'headhunter.recommend_candidate',
  'employer.unlock_contact',
  'employer.create_placement',  // or whatever the placement cap is named
  'employer.express_interest',
  'employer.claim_job',
  'employer.reject_job',
  'candidate.approve_unlock',
  'candidate.reject_unlock',
  'candidate.delete_my_data',
  'admin.remove_from_pool',
  'admin.mark_placement_paid',
  'admin.cancel_placement',
  'admin.retry_webhook',
  'admin.rate_limit_buckets',
  'admin.clear_user_rate_limit',
  'admin.placements_summary',
  'admin.put_config',
  'admin.suspend_user',
  'admin.unsuspend_user',
  'admin.adjust_user_quota',
]);
```

(Verify the exact list by counting what was in the original skip sets. The 21 skipped capabilities = 2 (destructive) + 1 (recommend) + 5 (employer flow) + 2 (candidate unlock) + 1 (delete_my_data) + 11 (admin) - 1 (admin.adjust_user_quota, which is now in admin-precondition file). Adjust the list to match exactly 21.)

In each of the 5 describe blocks, change the for-loop:
```typescript
for (const cap of getAllCapabilitySets().find((s) => s.role === 'auth')!.capabilities) {
  if (COMPLEX_CAPS.has(cap.name)) continue;
  it(`${cap.name}: ${cap.method} ${cap.path}`, async () => { ... });
}
```

This way the complex capabilities are NOT exercised in the main file at all (no `it.skip`, no `it`), so the test count is accurate.

- [ ] **Step 5.9: Re-run the main schema-shape test**

Run: `cd /d/dev/hunter-platform && pnpm test tests/integration/skill-md-conformance/schema-shape 2>&1 | tail -15`
Expected: All non-COMPLEX_CAPS tests pass. Total: 25 tests, 0 skipped.

- [ ] **Step 5.10: Run the full test suite**

Run: `cd /d/dev/hunter-platform && pnpm test 2>&1 | tail -10`
Expected: 797+ passed, 0 skipped (was 776/24/46). Net: +21 pass, -24 skip.

- [ ] **Step 5.11: Run all CI gates**

Run:
```bash
cd /d/dev/hunter-platform
pnpm typecheck && pnpm conformance:check && pnpm capabilities:check && pnpm openapi:check
```
Expected: All clean.

- [ ] **Step 5.12: Commit**

```bash
cd /d/dev/hunter-platform
git add tests/integration/skill-md-conformance/schema-shape.test.ts
git commit -m "refactor(test): delete 21 duplicate skip entries in main schema-shape (now filtered via COMPLEX_CAPS set)"
```

---

## Task 6: Final verification

**Files:** None modified.

- [ ] **Step 6.1: Verify all 3 fixed endpoints return 200 with correct shape**

Run:
```bash
cd /d/dev/hunter-platform
node --env-file=.env --import tsx -e "
import { freshApp, ConformanceClient, adminAuthHeader } from './tests/integration/skill-md-conformance/_setup.ts';
import { openDb } from './src/main/db/connection.ts';
const f = await freshApp('phase8-verify');
const c = new ConformanceClient(f.app);
const db = openDb(f.dbPath);

const hKey = await c.register('headhunter', 'H', 'h@x.com');
const cKey = await c.register('candidate', 'C', 'c@x.com');
const cMe = await c.request({ method: 'GET', path: '/v1/capabilities/me', auth: cKey });
const candidateUserId = cMe.data.data.user_id;
const candRes = await c.request({ method: 'POST', path: '/v1/headhunter/candidates', auth: hKey, body: { candidate_user_id: candidateUserId, name: 'C', phone: '13800000099', email: 'c@x.com' } });
const candAnonId = candRes.data.data.anonymized_id;
db.prepare('UPDATE candidates_anonymized SET is_public_pool = 1 WHERE id = ?').run(candAnonId);
db.close();

console.log('=== Bug 1: remove_from_pool ===');
const r1 = await c.request({ method: 'POST', path: '/v1/admin/candidates/' + candAnonId + '/remove-from-pool', auth: adminAuthHeader() });
console.log('STATUS=' + r1.status, 'DATA=' + JSON.stringify(r1.data.data));

console.log('=== Bug 2: clear_user_rate_limit ===');
const r2 = await c.request({ method: 'POST', path: '/v1/admin/rate-limit/users/' + candidateUserId + '/clear', auth: adminAuthHeader(), body: {} });
console.log('STATUS=' + r2.status, 'DATA=' + JSON.stringify(r2.data.data));

console.log('=== Bug 3: placements_summary ===');
const r3 = await c.request({ method: 'GET', path: '/v1/admin/placements/summary', auth: adminAuthHeader() });
console.log('STATUS=' + r3.status, 'DATA=' + JSON.stringify(r3.data.data));
" 2>&1 | grep -E "===|STATUS=" | head -10
```
Expected: All 3 STATUS=200, with the correct field names (`removed: true`, `cleared: true`, 5-field summary object).

- [ ] **Step 6.2: Verify only the 5 expected files were modified**

Run: `cd /d/dev/hunter-platform && git diff d81366a HEAD --stat | tail -10`
Expected: 5 files only (3 handler + 2 test). No other files.

- [ ] **Step 6.3: Inspect git log**

Run: `cd /d/dev/hunter-platform && git log --oneline d81366a..HEAD`
Expected: 5 new commits (Tasks 1-5).

- [ ] **Step 6.4: Verify test count**

Run: `cd /d/dev/hunter-platform && pnpm test 2>&1 | grep -E "Test Files|Tests" | tail -3`
Expected: 797+ passed, 0 skipped, 46 todo. 0 failures.

---

## Self-Review Checklist

- [ ] All 3 bugs from spec §3.1-3.3 have a corresponding task (Tasks 1-3)
- [ ] Un-skip task (Task 4) covers the 3 admin bugs once fixed
- [ ] Refactor task (Task 5) deletes the 21 duplicate skips via a single COMPLEX_CAPS set
- [ ] No "TBD" / "TODO" placeholders in any step
- [ ] Function names match across tasks (`removeFromPool`, `clearForUser`, `summary`)
- [ ] The COMPLEX_CAPS set has exactly 21 entries (verify by counting what was in the original skip sets)
- [ ] Task 6 verification gates cover all from spec §7

## Definition of Done

1. All 3 admin endpoints return 200 with correct shape (verified via Step 6.1)
2. `pnpm test` shows 797+ passed, 0 skipped, 0 failed
3. `pnpm typecheck` clean
4. `pnpm conformance:check` still 46/46
5. `pnpm capabilities:check` still 46/46
6. `pnpm openapi:check` clean
7. 5 atomic commits on top of `d81366a`
8. Git diff restricted to 5 files (3 handler + 2 test)
9. No other test files modified

## Out of Scope (deferred)

- The 46 `it.todo` stubs in `_generated.test.ts`
- v1.8 release (separate phase)
- Reference client work (already done in Phase 9)
- Filling the rest of the 21 skipped tests with real flow code (the sibling files already do this; the main file just filters them out)

## Effort Estimate

~1.5 working days. 5 atomic commits. Aligns with spec §9.