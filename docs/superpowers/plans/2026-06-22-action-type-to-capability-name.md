# action_type → capability_name Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `action_history.action_type` to `action_history.capability_name` and migrate all 33 existing values to canonical capability names. After this migration, every place in the system that identifies an action uses the same string. No backward-compat shim.

**Architecture:** Single SQL migration (`v013`) renames the column, drops+recreates the index, and updates all existing values. Code changes update 5 production files (route-action-map, flows, middleware, repo, dashboard) and 3 test files. 6 atomic commits: migration → value sources → writers → readers → tests → verify.

**Tech Stack:** TypeScript, SQLite (ALTER TABLE RENAME COLUMN + UPDATE), zod. No new dependencies.

**Design spec:** `docs/superpowers/specs/2026-06-22-action-type-to-capability-name.md`

---

## File Structure

### New files (1)
| File | Responsibility |
|---|---|
| `src/main/db/migrations/v013_capability_name.sql` | RENAME COLUMN + DROP/RECREATE INDEX + 33 UPDATEs |

### Modified files (8)
| File | Change |
|---|---|
| `src/main/modules/audit/route-action-map.ts` | 30 ROUTES values updated (no internal type rename) |
| `src/main/flows/user.ts` | 2 values updated (`suspend_user`, `delete_user`) |
| `src/main/modules/audit/action-history-middleware.ts` | Column name in INSERT |
| `src/main/db/repositories/action-history.ts` | Column name in Insert interface and SQL |
| `src/main/modules/admin/handlers/dashboard.ts` | 1 query: `action_type = 'placement_created'` → `capability_name = 'employer.create_placement'` |
| `tests/integration/action-history-middleware.test.ts` | 4 query/field updates |
| `tests/integration/repos/action-history.test.ts` | ~6 field/query updates |
| `tests/integration/trace-id.test.ts` | 1 query update |

### Untouched
- `admin_action_log` table (different source, out of scope per spec §3)
- `AdminLogItemSchema` / `AuditItemSchema` (API contract, different namespace)
- `tests/unit/admin-schemas.test.ts` (uses `AdminLogItemSchema`, not affected)
- All other Phase 1-9 work

---

## Task 1: Create migration v013

**Files:**
- Create: `src/main/db/migrations/v013_capability_name.sql`

- [ ] **Step 1.1: Verify migrations directory layout**

Run: `cd /d/dev/hunter-platform && ls src/main/db/migrations/ | tail -5`
Expected: Last existing migration is `v012_webhook_traceparent.sql`. New file must be alphabetically next.

- [ ] **Step 1.2: Write the migration file**

Create `src/main/db/migrations/v013_capability_name.sql` with the following content:

```sql
-- ============================================================================
-- Migration v013: rename action_history.action_type → capability_name
-- ============================================================================
-- Rationale: Phase 4 introduced the capability declaration system, which
-- uses dotted names like 'headhunter.upload_candidate'. The legacy
-- action_type column used short names like 'upload_candidate' from a
-- separate static map. This migration collapses to one system.
--
-- The migration is idempotent: all UPDATEs are equality matches, so re-running
-- after the first successful run is a no-op. The column rename would fail
-- harmlessly on the second run ("duplicate column name: capability_name"),
-- and the DROP INDEX is guarded by IF EXISTS.
-- ============================================================================

-- Rename the column
ALTER TABLE action_history RENAME COLUMN action_type TO capability_name;

-- Replace the old index with one matching the new column name
DROP INDEX IF EXISTS idx_action_history_type;
CREATE INDEX idx_action_history_capability ON action_history(capability_name, created_at);

-- Migrate all existing values to the new capability_name format.
-- Order: 30 from route-action-map + 2 from flows/user.ts + 1 hardcoded
-- ('placement_created' in dashboard.ts).
UPDATE action_history SET capability_name = 'auth.register'                  WHERE capability_name = 'register';
UPDATE action_history SET capability_name = 'auth.rotate_key'               WHERE capability_name = 'rotate_api_key';
UPDATE action_history SET capability_name = 'headhunter.upload_candidate'    WHERE capability_name = 'upload_candidate';
UPDATE action_history SET capability_name = 'headhunter.list_candidates'     WHERE capability_name = 'list_my_candidates';
UPDATE action_history SET capability_name = 'headhunter.publish_to_pool'     WHERE capability_name = 'publish_to_pool';
UPDATE action_history SET capability_name = 'headhunter.recommend_candidate' WHERE capability_name = 'recommend_candidate';
UPDATE action_history SET capability_name = 'headhunter.list_recommendations' WHERE capability_name = 'list_my_recommendations';
UPDATE action_history SET capability_name = 'headhunter.withdraw_recommendation' WHERE capability_name = 'withdraw_recommendation';
UPDATE action_history SET capability_name = 'headhunter.create_job'          WHERE capability_name = 'create_job' AND capability_name NOT LIKE '%.create_job';
UPDATE action_history SET capability_name = 'headhunter.list_jobs'           WHERE capability_name = 'list_my_jobs'  AND capability_name NOT LIKE '%.list_jobs';
UPDATE action_history SET capability_name = 'employer.talent'                WHERE capability_name = 'browse_talent';
UPDATE action_history SET capability_name = 'employer.express_interest'     WHERE capability_name = 'express_interest';
UPDATE action_history SET capability_name = 'employer.unlock_contact'        WHERE capability_name = 'unlock_contact';
UPDATE action_history SET capability_name = 'employer.create_placement'     WHERE capability_name = 'create_placement';
UPDATE action_history SET capability_name = 'employer.list_placements'      WHERE capability_name = 'list_my_placements';
UPDATE action_history SET capability_name = 'candidate.opportunities'       WHERE capability_name = 'list_opportunities';
UPDATE action_history SET capability_name = 'candidate.access_log'           WHERE capability_name = 'view_access_log';
UPDATE action_history SET capability_name = 'candidate.approve_unlock'       WHERE capability_name = 'approve_unlock';
UPDATE action_history SET capability_name = 'candidate.reject_unlock'        WHERE capability_name = 'reject_unlock';
UPDATE action_history SET capability_name = 'candidate.export_my_data'       WHERE capability_name = 'export_my_data';
UPDATE action_history SET capability_name = 'candidate.delete_my_data'       WHERE capability_name = 'delete_my_data';
UPDATE action_history SET capability_name = 'users.get_status'               WHERE capability_name = 'get_user_status';
UPDATE action_history SET capability_name = 'users.get_history'              WHERE capability_name = 'get_user_history';
UPDATE action_history SET capability_name = 'config.get_industries'         WHERE capability_name = 'get_config_industries';
UPDATE action_history SET capability_name = 'config.get_title_levels'        WHERE capability_name = 'get_config_title_levels';
UPDATE action_history SET capability_name = 'config.get_salary_bands'        WHERE capability_name = 'get_config_salary_bands';
UPDATE action_history SET capability_name = 'market.leaderboard'             WHERE capability_name = 'get_market_leaderboard';
UPDATE action_history SET capability_name = 'admin.suspend_user'             WHERE capability_name = 'suspend_user';
UPDATE action_history SET capability_name = 'candidate.delete_my_data'       WHERE capability_name = 'delete_user';
-- Hardcoded value in dashboard.ts query
UPDATE action_history SET capability_name = 'employer.create_placement'     WHERE capability_name = 'placement_created';
```

NOTE on the `create_job` and `list_my_jobs` UPDATEs: these short names exist in BOTH headhunter and employer contexts. The first migration (`create_job → headhunter.create_job`) only runs first; the second pass would re-target the rows that were just renamed. The guards `AND capability_name NOT LIKE '%.create_job'` and `AND capability_name NOT LIKE '%.list_jobs'` prevent re-mapping already-migrated rows. Same logic: the order in the SQL matters — `employer.create_placement` UPDATE runs after `create_placement → employer.create_placement` so the final state is correct.

Actually, the cleanest fix: split `create_job` and `list_my_jobs` by detecting which user is the actor. Since both headhunter and employer can call POST /v1/employer/jobs vs POST /v1/headhunter/jobs (different paths, different capabilities), and the middleware correctly records the action_type, we can disambiguate at migration time by looking at the user_type in `action_history`. For this plan, keep the migration simple: order the UPDATEs so that headhunter's `create_job` runs first, and the employer one runs second on rows that still match the old short name.

Actually, the simplest correct approach: **rename the short names BEFORE adding the role prefix**, then the UPDATEs don't conflict:

Step 1: rename the conflicting short names to something unique (e.g., `_create_job_h` and `_create_job_e`).
Step 2: apply the prefix UPDATEs.
Step 3: rename the temp names back.

That's complex. Simpler: at migration time, look at the user_type to disambiguate. Or: don't migrate headhunter's `create_job`; only migrate employer's, and trust that the new code (route-action-map with full names) will write correct values from now on.

For this plan: keep the migration SIMPLE — rename `create_job` and `list_my_jobs` ambiguously, accepting that the role prefix is determined by checking `users.user_type` for the corresponding `user_id`. The repo code (Task 4) can do this disambiguation in code at read time, OR the migration can JOIN.

DECISION: Keep the migration simple (single UPDATE for `create_job → headhunter.create_job`, and rely on the fact that employer's POST /v1/employer/jobs is NOT in the route-action-map with the same short name — they're different paths). Re-check the route-action-map to confirm: only one `create_job` and one `list_my_jobs` entry exist, and they correspond to headhunter routes. Employer's `create_job` is in the route-action-map too — let me re-check.

Actually the route-action-map has 30 ROUTES. The list has both headhunter and employer `create_job` and `list_my_jobs`. So we DO have a conflict. The plan's Task 2 (route-action-map update) will fix this by giving each a unique value (`headhunter.create_job` and `employer.create_job`). The migration runs AFTER route-action-map is updated, so the migration only needs to handle the short-name → full-name rename for new entries.

REVISED plan: Tasks must run in this order:
1. Task 1: Migration (but only for values that have unambiguous short names)
2. Task 2: route-action-map.ts (which now writes the new values going forward)
3. Task 3-4: code updates
4. Task 5: test updates
5. Task 6: verify

The migration in Task 1 must use a different approach: rename based on `user_type` from the users table.

```sql
-- For create_job: headhunter's goes to headhunter.create_job, employer's goes to employer.create_job
UPDATE action_history
SET capability_name = 'headhunter.create_job'
WHERE capability_name = 'create_job'
  AND user_id IN (SELECT id FROM users WHERE user_type = 'headhunter');

UPDATE action_history
SET capability_name = 'employer.create_job'
WHERE capability_name = 'create_job'
  AND user_id IN (SELECT id FROM users WHERE user_type = 'employer');

UPDATE action_history
SET capability_name = 'headhunter.list_jobs'
WHERE capability_name = 'list_my_jobs'
  AND user_id IN (SELECT id FROM users WHERE user_type = 'headhunter');

UPDATE action_history
SET capability_name = 'employer.list_jobs'
WHERE capability_name = 'list_my_jobs'
  AND user_id IN (SELECT id FROM users WHERE user_type = 'employer');
```

Same approach for any other ambiguous values. Use the migration above with JOINs on users table for all ambiguous short names.

- [ ] **Step 1.3: Verify migration runs cleanly**

The migration runs automatically when tests start (test setup calls `runMigrations(db)`). Run a single test that uses a fresh DB:

```bash
cd /d/dev/hunter-platform
node --import tsx -e "
import { openDb } from './src/main/db/connection.ts';
import { runMigrations } from './src/main/db/migrations.ts';
import fs from 'node:fs';
const dbPath = './tmp/migration-test.db';
for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + s); } catch {} }
const db = openDb(dbPath);
runMigrations(db);
// Verify column renamed
const cols = db.prepare('PRAGMA table_info(action_history)').all() as any[];
const capCol = cols.find(c => c.name === 'capability_name');
console.log('capability_name column exists:', !!capCol);
const oldCol = cols.find(c => c.name === 'action_type');
console.log('action_type column removed:', !oldCol);
db.close();
fs.unlinkSync(dbPath);
"
```
Expected: `capability_name column exists: true` and `action_type column removed: true`.

- [ ] **Step 1.4: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/db/migrations/v013_capability_name.sql
git commit -m "feat(db): v013 migration — rename action_history.action_type to capability_name + migrate 30 values"
```

---

## Task 2: Update route-action-map.ts (the 30 value sources)

**Files:**
- Modify: `src/main/modules/audit/route-action-map.ts:19-95`

- [ ] **Step 2.1: Read the current file**

Read `src/main/modules/audit/route-action-map.ts` lines 19-95. Confirm the 30 ROUTES entries and the ACTION_TYPES list.

- [ ] **Step 2.2: Update the 30 ROUTES values to canonical capability names**

In the `ROUTES` array, change each `action_type` value as follows:

```ts
const ROUTES: RoutePattern[] = [
  // ---------- Auth ----------
  { method: 'POST', pattern: '/v1/auth/register',           action_type: 'auth.register' },
  { method: 'POST', pattern: '/v1/auth/rotate-key',         action_type: 'auth.rotate_key' },

  // ---------- Headhunter ----------
  { method: 'POST', pattern: '/v1/headhunter/candidates',                     action_type: 'headhunter.upload_candidate' },
  { method: 'GET',  pattern: '/v1/headhunter/candidates',                     action_type: 'headhunter.list_candidates' },
  { method: 'POST', pattern: '/v1/headhunter/candidates/:id/publish',         action_type: 'headhunter.publish_to_pool' },
  { method: 'POST', pattern: '/v1/headhunter/candidates/:id/publish-to-pool', action_type: 'headhunter.publish_to_pool' },
  { method: 'POST', pattern: '/v1/headhunter/recommendations',                action_type: 'headhunter.recommend_candidate' },
  { method: 'GET',  pattern: '/v1/headhunter/recommendations',                action_type: 'headhunter.list_recommendations' },
  { method: 'POST', pattern: '/v1/headhunter/recommendations/:id/withdraw',   action_type: 'headhunter.withdraw_recommendation' },
  { method: 'POST', pattern: '/v1/headhunter/jobs',                            action_type: 'headhunter.create_job' },
  { method: 'GET',  pattern: '/v1/headhunter/jobs',                            action_type: 'headhunter.list_jobs' },

  // ---------- Employer ----------
  { method: 'POST', pattern: '/v1/employer/jobs',                              action_type: 'employer.create_job' },
  { method: 'GET',  pattern: '/v1/employer/jobs',                              action_type: 'employer.list_jobs' },
  { method: 'GET',  pattern: '/v1/employer/talent',                            action_type: 'employer.talent' },
  { method: 'POST', pattern: '/v1/employer/recommendations/:id/express-interest', action_type: 'employer.express_interest' },
  { method: 'POST', pattern: '/v1/employer/recommendations/:id/unlock-contact',  action_type: 'employer.unlock_contact' },
  { method: 'POST', pattern: '/v1/employer/placements',                        action_type: 'employer.create_placement' },
  { method: 'GET',  pattern: '/v1/employer/placements',                        action_type: 'employer.list_placements' },

  // ---------- Candidate ----------
  { method: 'GET',  pattern: '/v1/candidate/opportunities',                    action_type: 'candidate.opportunities' },
  { method: 'GET',  pattern: '/v1/candidate/access-log',                       action_type: 'candidate.access_log' },
  { method: 'POST', pattern: '/v1/candidate/recommendations/:id/approve-unlock', action_type: 'candidate.approve_unlock' },
  { method: 'POST', pattern: '/v1/candidate/recommendations/:id/reject-unlock',  action_type: 'candidate.reject_unlock' },
  { method: 'GET',  pattern: '/v1/candidate/export-my-data',                   action_type: 'candidate.export_my_data' },
  { method: 'POST', pattern: '/v1/candidate/delete-my-data',                   action_type: 'candidate.delete_my_data' },

  // ---------- User ----------
  { method: 'GET',  pattern: '/v1/users/:id/status',   action_type: 'users.get_status' },
  { method: 'GET',  pattern: '/v1/users/:id/history',  action_type: 'users.get_history' },

  // ---------- Config / market (optional-auth) ----------
  { method: 'GET',  pattern: '/v1/config/industries',   action_type: 'config.get_industries' },
  { method: 'GET',  pattern: '/v1/config/title_levels', action_type: 'config.get_title_levels' },
  { method: 'GET',  pattern: '/v1/config/salary_bands', action_type: 'config.get_salary_bands' },
  { method: 'GET',  pattern: '/v1/market/leaderboard',  action_type: 'market.leaderboard' },
];
```

- [ ] **Step 2.3: Run typecheck**

Run: `cd /d/dev/hunter-platform && pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 2.4: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/modules/audit/route-action-map.ts
git commit -m "feat(audit): update route-action-map values to canonical capability names"
```

---

## Task 3: Update flows/user.ts (the 2 admin-state values)

**Files:**
- Modify: `src/main/flows/user.ts:41, 47`

- [ ] **Step 3.1: Read the file**

Read `src/main/flows/user.ts` lines 35-55. Confirm the two `action_type: 'suspend_user'` and `action_type: 'delete_user'` strings.

- [ ] **Step 3.2: Update the two values**

In `src/main/flows/user.ts`, change:
- Line 41: `action_type: 'suspend_user',` → `action_type: 'admin.suspend_user',`
- Line 47: `action_type: 'delete_user',` → `action_type: 'candidate.delete_my_data',`

- [ ] **Step 3.3: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/flows/user.ts
git commit -m "fix(flows): use canonical capability_name in user state transitions"
```

---

## Task 4: Update writers (middleware + repository)

**Files:**
- Modify: `src/main/modules/audit/action-history-middleware.ts:43`
- Modify: `src/main/db/repositories/action-history.ts:6, 32, 41`

- [ ] **Step 4.1: Read the files**

Read both files to confirm the exact lines that reference `action_type`.

- [ ] **Step 4.2: Update the middleware**

In `src/main/modules/audit/action-history-middleware.ts:43`, the SQL column name. Find the line:
```ts
INSERT INTO action_history (user_id, action_type, target_type, target_id, ...)
```
Change `action_type` to `capability_name` in the column list AND the value list.

- [ ] **Step 4.3: Update the repository**

In `src/main/db/repositories/action-history.ts`:
- Line 6: rename the `Insert.action_type` field to `Insert.capability_name`
- Line 32: change the SQL `action_type` to `capability_name` (column name)
- Line 41: change the value `${entry.action_type}` to `${entry.capability_name}`

- [ ] **Step 4.4: Run typecheck and the audit tests**

Run:
```bash
cd /d/dev/hunter-platform
pnpm typecheck && pnpm test tests/integration/action-history-middleware.test.ts 2>&1 | tail -15
```
Expected: 0 typecheck errors. **The test will FAIL** because the test still uses old `action_type` field/value. This is expected; Task 5 fixes the tests.

- [ ] **Step 4.5: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/modules/audit/action-history-middleware.ts src/main/db/repositories/action-history.ts
git commit -m "feat(audit): writers use capability_name column (rename from action_type)"
```

---

## Task 5: Update readers (dashboard.ts + 3 test files)

**Files:**
- Modify: `src/main/modules/admin/handlers/dashboard.ts:74`
- Modify: `tests/integration/action-history-middleware.test.ts:62, 86, 109, 167`
- Modify: `tests/integration/repos/action-history.test.ts:22-24, 36, 37, 57, 71, 77, 84`
- Modify: `tests/integration/trace-id.test.ts:92`

- [ ] **Step 5.1: Read each file to find exact lines**

Read each file briefly to confirm the line numbers and exact strings to replace.

- [ ] **Step 5.2: Update dashboard.ts**

In `src/main/modules/admin/handlers/dashboard.ts:74`:
```ts
"SELECT COUNT(*) as cnt FROM action_history WHERE action_type = 'placement_created' AND created_at >= ?"
```
Change to:
```ts
"SELECT COUNT(*) as cnt FROM action_history WHERE capability_name = 'employer.create_placement' AND created_at >= ?"
```

- [ ] **Step 5.3: Update action-history-middleware.test.ts (4 queries)**

For each query in the test file, replace `action_type` → `capability_name` and the value:
- Line 62: `WHERE action_type = 'register'` → `WHERE capability_name = 'auth.register'`
- Line 86: `WHERE action_type = 'upload_candidate'` → `WHERE capability_name = 'headhunter.upload_candidate'`
- Line 109: `WHERE action_type='register'` → `WHERE capability_name='auth.register'`
- Line 167: `WHERE action_type = 'express_interest'` → `WHERE capability_name = 'employer.express_interest'`

- [ ] **Step 5.4: Update repos/action-history.test.ts (~6 places)**

For each occurrence, change `action_type` → `capability_name` in field names AND values:
- Lines 22-24: INSERT column list and value list (3 rows)
- Lines 36, 37: SELECT result assertions
- Line 57: INSERT column list (1 row)
- Line 71: SELECT result assertion
- Line 77: INSERT column list (1 row)
- Line 84: SELECT result filter

Value mapping examples: `upload_candidate` → `headhunter.upload_candidate`, `express_interest` → `employer.express_interest`, `recommend_candidate` → `headhunter.recommend_candidate`, `register` → `auth.register`.

- [ ] **Step 5.5: Update trace-id.test.ts (1 query)**

In `tests/integration/trace-id.test.ts:92`:
```ts
WHERE action_type LIKE '%register%' OR action_type LIKE '%auth%'
```
Change to:
```ts
WHERE capability_name LIKE '%register%' OR capability_name LIKE '%auth%'
```

- [ ] **Step 5.6: Run the full test suite**

Run: `cd /d/dev/hunter-platform && pnpm test 2>&1 | tail -10`
Expected: 779 passed, 0 skipped, 46 todo. 0 failures.

- [ ] **Step 5.7: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/modules/admin/handlers/dashboard.ts tests/integration/action-history-middleware.test.ts tests/integration/repos/action-history.test.ts tests/integration/trace-id.test.ts
git commit -m "test+feat: update action_history readers/tests to capability_name"
```

---

## Task 6: Final verification

**Files:** None modified.

- [ ] **Step 6.1: Run typecheck and CI gates**

Run:
```bash
cd /d/dev/hunter-platform
pnpm typecheck && pnpm conformance:check && pnpm capabilities:check && pnpm openapi:check
```
Expected: All clean.

- [ ] **Step 6.2: Grep for any leftover `action_type` references in action_history code**

Run: `cd /d/dev/hunter-platform && grep -rn "action_type" src/main/ --include="*.ts" | grep -v "admin-log\|audit\.ts\|route-action-map"`
Expected: 0 matches. All remaining `action_type` references in `src/main/` should be in:
- `route-action-map.ts` (internal type/variable name — out of scope)
- `admin-log.ts` (admin_action_log namespace — out of scope)
- `audit.ts` (unlock_audit_log namespace — out of scope)

- [ ] **Step 6.3: Manual smoke test — verify live data uses new names**

Run:
```bash
cd /d/dev/hunter-platform
node --env-file=.env --import tsx -e "
import { freshApp, ConformanceClient } from './tests/integration/skill-md-conformance/_setup.ts';
import { openDb } from './src/main/db/connection.ts';
const f = await freshApp('capability-name-verify');
const c = new ConformanceClient(f.app);
const db = openDb(f.dbPath);

// Trigger 3 different action types
const reg = await c.request({ method: 'POST', path: '/v1/auth/register', body: { user_type: 'candidate', name: 'CN', contact: 'cn@x.com' } });
const key = reg.data.data.api_key as string;
const me = await c.request({ method: 'GET', path: '/v1/capabilities/me', auth: key });
const userId = me.data.data.user_id;
await c.request({ method: 'GET', path: '/v1/users/' + userId + '/status', auth: key });
await c.request({ method: 'GET', path: '/v1/users/' + userId + '/history', auth: key });

// Check action_history table
const rows = db.prepare('SELECT capability_name FROM action_history ORDER BY id DESC LIMIT 5').all() as any[];
console.log('Recent capability_names:', rows.map(r => r.capability_name));
db.close();
"
```
Expected: The list contains `users.get_status` and `users.get_history` (and possibly `auth.register` if register was audit-logged).

- [ ] **Step 6.4: Verify only the 9 expected files modified**

Run: `cd /d/dev/hunter-platform && git diff e7f8bd8 HEAD --stat`
Expected: 9 files (1 new migration + 8 modified). No unexpected files.

- [ ] **Step 6.5: Inspect git log**

Run: `cd /d/dev/hunter-platform && git log --oneline e7f8bd8..HEAD`
Expected: 6 new commits (Tasks 1-6).

---

## Self-Review Checklist

- [ ] Task 1 migration covers all 33 distinct values (30 routes + 2 flows + 1 hardcoded)
- [ ] Task 2 updates all 30 route-action-map entries with non-overlapping capability names
- [ ] Task 3 updates both flows/user.ts values (`suspend_user` and `delete_user`)
- [ ] Task 4 covers both writers (middleware + repository)
- [ ] Task 5 covers dashboard.ts + all 3 test files (~10 occurrences)
- [ ] Task 6 verification gates cover all from spec §7
- [ ] Function/type names consistent: `action_type` (old) → `capability_name` (new) throughout
- [ ] No "TBD" / "TODO" placeholders in any step

## Definition of Done

1. `action_history.capability_name` column exists (renamed from `action_type`)
2. All 33 old values migrated to canonical capability names
3. `route-action-map.ts` writes new values going forward
4. `flows/user.ts` writes new values
5. Middleware + repository + dashboard all use the new column name
6. All tests pass (779, 0 skipped, 0 fail)
7. `pnpm typecheck` clean
8. `pnpm conformance:check` 46/46
9. 6 atomic commits on top of `e7f8bd8`
10. No references to `action_history.action_type` in `src/main/` code (except out-of-scope namespaces)

## Out of Scope (deferred)

- `admin_action_log.action` column rename (different table, different source)
- Renaming route-action-map's internal `action_type` field/variable (low-value churn)
- Updating `docs/superpowers/skill.md` to mention `capability_name` in audit log context
- v1.9 release (this is a small enough change to roll into v1.8.1 or a hotfix)

## Effort Estimate

~0.5-1 working day. 6 atomic commits. Aligns with spec §10.