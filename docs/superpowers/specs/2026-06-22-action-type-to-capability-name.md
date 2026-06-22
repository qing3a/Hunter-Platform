# action_type → capability_name Migration Design Spec

**Date:** 2026-06-22
**Status:** Approved
**Project:** hunter-platform
**Branch:** main
**Author:** ZCode
**Depends on:** Phase 4 (capability declarations), v1.8 (commit `6081d72`)

## 1. Background & Goal

The platform has two parallel naming systems for "what an endpoint does":

| System | Examples | Source | Used by |
|---|---|---|---|
| `action_type` (legacy) | `'register'`, `'upload_candidate'`, `'express_interest'` | `src/main/modules/audit/route-action-map.ts` (static map, 30 entries) | `action_history.action_type` column, all `action_history`-based queries, test assertions |
| `capability_name` (Phase 4) | `'auth.register'`, `'headhunter.upload_candidate'`, `'employer.express_interest'` | `src/main/capabilities/{auth,headhunter,employer,candidate,admin}.ts` (declarations) | `x-capability-name` response header, `/v1/capabilities` endpoint, `canInvoke()` preconditions |

**Goal:** Collapse to one system. Use `capability_name` everywhere — column renamed, values aligned, all readers/writers updated, no backward-compat shim. After this migration, every place in the system that identifies an action uses the same string.

## 2. Decisions (already approved)

| Decision | Choice |
|---|---|
| Column name | **`action_type` → `capability_name`** (rename via `ALTER TABLE ... RENAME COLUMN`) |
| Old data | **Clean migrate** — single SQL `UPDATE` in the same migration to convert all 30 old values to new capability names. No `legacy_*` column, no shim code |
| Dashboard / analytics queries | **Synchronous** — updated in the same commit as the column rename. No follow-up backlog |

## 3. Scope

**In scope** (this migration):
- `action_history` table: column rename + value migrate
- `route-action-map.ts`: 30 values updated
- `flows/user.ts`: 2 values updated (`suspend_user`, `delete_user`)
- `action-history-middleware.ts`: writes to new column
- `db/repositories/action-history.ts`: insert with new column
- `dashboard.ts`: 1 query updated
- Tests: ~10 occurrences across 4 test files

**Out of scope** (deferred to a separate phase if needed):
- `admin_action_log.action` column rename — different table, different source (manual writes not from middleware). The `admin_log` endpoint's response field stays `action_type` (mapped from `admin_action_log.action`) because the `AdminLogItemSchema` is the API contract. Renaming it would be a breaking API change requiring schema + handler + tests + capability declaration updates.
- The hardcoded `'placement_created'` value in `dashboard.ts` — replaced with the canonical capability name `'employer.create_placement'`. Other ad-hoc action_type values in any other files (none found beyond this one).

## 4. Architecture

### 4.1 The new mapping (30 entries from route-action-map)

The route-action-map currently maps URL patterns to short names. After this migration, the right side becomes the canonical capability name. Examples:

| Old `action_type` | New `capability_name` |
|---|---|
| `register` | `auth.register` |
| `rotate_api_key` | `auth.rotate_key` |
| `upload_candidate` | `headhunter.upload_candidate` |
| `list_my_candidates` | `headhunter.list_candidates` |
| `publish_to_pool` | `headhunter.publish_to_pool` |
| `recommend_candidate` | `headhunter.recommend_candidate` |
| `list_my_recommendations` | `headhunter.list_recommendations` |
| `withdraw_recommendation` | `headhunter.withdraw_recommendation` |
| `create_job` (headhunter) | `headhunter.create_job` |
| `list_my_jobs` (headhunter) | `headhunter.list_jobs` |
| `create_job` (employer) | `employer.create_job` |
| `list_my_jobs` (employer) | `employer.list_jobs` |
| `browse_talent` | `employer.talent` |
| `express_interest` | `employer.express_interest` |
| `unlock_contact` | `employer.unlock_contact` |
| `create_placement` | `employer.create_placement` |
| `list_my_placements` | `employer.list_placements` |
| `list_opportunities` | `candidate.opportunities` |
| `view_access_log` | `candidate.access_log` |
| `approve_unlock` | `candidate.approve_unlock` |
| `reject_unlock` | `candidate.reject_unlock` |
| `export_my_data` | `candidate.export_my_data` |
| `delete_my_data` | `candidate.delete_my_data` |
| `get_user_status` | `users.get_status` |
| `get_user_history` | `users.get_history` |
| `get_config_industries` | `config.get_industries` |
| `get_config_title_levels` | `config.get_title_levels` |
| `get_config_salary_bands` | `config.get_salary_bands` |
| `get_market_leaderboard` | `market.leaderboard` |

**Note on `delete_user` and `suspend_user` from `flows/user.ts`:**
- `suspend_user` flow runs from `POST /v1/admin/users/:id/suspend` → maps to `admin.suspend_user`
- `delete_user` flow runs from `POST /v1/candidate/delete-my-data` → maps to `candidate.delete_my_data`

These are NOT in route-action-map.ts (which only handles request-side auto-audit); they're in flows/ for state-machine side-effect audit. Both need updating.

**Note on `'placement_created'` in dashboard.ts:**
- This is the ONLY non-route-action-map value in the action_history table (verified via grep). The handler hardcodes it for the "placements today" count.
- Maps to `employer.create_placement`.

### 4.2 Migration SQL (`v013_capability_name.sql`)

```sql
-- Rename the column
ALTER TABLE action_history RENAME COLUMN action_type TO capability_name;

-- Update the index that references the old column name
DROP INDEX IF EXISTS idx_action_history_type;
CREATE INDEX idx_action_history_capability ON action_history(capability_name, created_at);

-- Migrate all existing values to the new capability_name format
UPDATE action_history SET capability_name = 'auth.register'               WHERE capability_name = 'register';
UPDATE action_history SET capability_name = 'auth.rotate_key'            WHERE capability_name = 'rotate_api_key';
UPDATE action_history SET capability_name = 'headhunter.upload_candidate'   WHERE capability_name = 'upload_candidate';
UPDATE action_history SET capability_name = 'headhunter.list_candidates'    WHERE capability_name = 'list_my_candidates';
UPDATE action_history SET capability_name = 'headhunter.publish_to_pool'    WHERE capability_name = 'publish_to_pool';
UPDATE action_history SET capability_name = 'headhunter.recommend_candidate' WHERE capability_name = 'recommend_candidate';
UPDATE action_history SET capability_name = 'headhunter.list_recommendations' WHERE capability_name = 'list_my_recommendations';
UPDATE action_history SET capability_name = 'headhunter.withdraw_recommendation' WHERE capability_name = 'withdraw_recommendation';
UPDATE action_history SET capability_name = 'employer.create_job'          WHERE capability_name = 'create_job';
UPDATE action_history SET capability_name = 'employer.list_jobs'           WHERE capability_name = 'list_my_jobs';
UPDATE action_history SET capability_name = 'employer.talent'              WHERE capability_name = 'browse_talent';
UPDATE action_history SET capability_name = 'employer.express_interest'    WHERE capability_name = 'express_interest';
UPDATE action_history SET capability_name = 'employer.unlock_contact'      WHERE capability_name = 'unlock_contact';
UPDATE action_history SET capability_name = 'employer.create_placement'    WHERE capability_name = 'create_placement';
UPDATE action_history SET capability_name = 'employer.list_placements'     WHERE capability_name = 'list_my_placements';
UPDATE action_history SET capability_name = 'candidate.opportunities'      WHERE capability_name = 'list_opportunities';
UPDATE action_history SET capability_name = 'candidate.access_log'         WHERE capability_name = 'view_access_log';
UPDATE action_history SET capability_name = 'candidate.approve_unlock'     WHERE capability_name = 'approve_unlock';
UPDATE action_history SET capability_name = 'candidate.reject_unlock'      WHERE capability_name = 'reject_unlock';
UPDATE action_history SET capability_name = 'candidate.export_my_data'     WHERE capability_name = 'export_my_data';
UPDATE action_history SET capability_name = 'candidate.delete_my_data'     WHERE capability_name = 'delete_my_data';
UPDATE action_history SET capability_name = 'users.get_status'             WHERE capability_name = 'get_user_status';
UPDATE action_history SET capability_name = 'users.get_history'            WHERE capability_name = 'get_user_history';
UPDATE action_history SET capability_name = 'config.get_industries'       WHERE capability_name = 'get_config_industries';
UPDATE action_history SET capability_name = 'config.get_title_levels'      WHERE capability_name = 'get_config_title_levels';
UPDATE action_history SET capability_name = 'config.get_salary_bands'      WHERE capability_name = 'get_config_salary_bands';
UPDATE action_history SET capability_name = 'market.leaderboard'           WHERE capability_name = 'get_market_leaderboard';
UPDATE action_history SET capability_name = 'admin.suspend_user'           WHERE capability_name = 'suspend_user';
UPDATE action_history SET capability_name = 'candidate.delete_my_data'     WHERE capability_name = 'delete_user';
-- 'placement_created' (hardcoded in dashboard.ts) was being used to count
-- placements created today; rename to the canonical capability name.
UPDATE action_history SET capability_name = 'employer.create_placement'    WHERE capability_name = 'placement_created';
```

Note: the last `UPDATE` for `delete_user` and `placement_created` may match zero rows if those values were never written — that's fine. The migration is idempotent (safe to re-run).

### 4.3 Code changes summary

| File | Change |
|---|---|
| `src/main/db/migrations/v013_capability_name.sql` | NEW: SQL above |
| `src/main/modules/audit/route-action-map.ts` | Change all 30 ROUTES values; rename `action_type` field to `capability_name`; rename `ACTION_TYPES` to `CAPABILITY_NAMES` (export name); rename function `lookupActionType` to `lookupCapabilityName` |
| `src/main/flows/user.ts` | Change `suspend_user` → `admin.suspend_user`, `delete_user` → `candidate.delete_my_data` |
| `src/main/modules/audit/action-history-middleware.ts` | Write to `capability_name` column instead of `action_type` |
| `src/main/db/repositories/action-history.ts` | Insert with `capability_name`; rename `Insert` interface field |
| `src/main/modules/admin/handlers/dashboard.ts` | Update query: `WHERE capability_name = 'employer.create_placement'` (was `action_type = 'placement_created'`) |

### 4.4 Test changes

| File | Change |
|---|---|
| `tests/integration/action-history-middleware.test.ts` | Update 4 query assertions: `action_type` → `capability_name`, values like `'register'` → `'auth.register'` |
| `tests/integration/repos/action-history.test.ts` | Update field name in INSERTs and SELECTs (~6 places) |
| `tests/integration/trace-id.test.ts` | Update 1 query: `action_type` → `capability_name` |
| `tests/unit/admin-schemas.test.ts` | **No change** — `AdminLogItemSchema` is for `admin_action_log` (different table), out of scope |
| `tests/integration/skill-md-conformance/*` | Verify no `action_type` references (search confirms none) |

## 5. File Manifest

### New files (1)
| File | Content |
|---|---|
| `src/main/db/migrations/v013_capability_name.sql` | The SQL above |

### Modified files (8)
| File | Change |
|---|---|
| `src/main/modules/audit/route-action-map.ts` | 30 value updates + 1 function rename + 1 export rename |
| `src/main/flows/user.ts` | 2 value updates |
| `src/main/modules/audit/action-history-middleware.ts` | Column name update |
| `src/main/db/repositories/action-history.ts` | Column name update |
| `src/main/modules/admin/handlers/dashboard.ts` | 1 query update |
| `tests/integration/action-history-middleware.test.ts` | 4 query updates |
| `tests/integration/repos/action-history.test.ts` | ~6 field/query updates |
| `tests/integration/trace-id.test.ts` | 1 query update |

### Untouched
- `admin_action_log` table (out of scope per §3)
- `AdminLogItemSchema` (out of scope)
- All Phase 1-9 work

## 6. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A row has a value that doesn't match any UPDATE pattern (e.g., legacy 'unknown_get_v1_...') | Medium | Low | These rows already have non-conforming values; they stay as-is. The migration is `=` matches only, so no harm. The middleware fallback (`unknown_<method>_<resource>`) should ideally become `unknown.<role>.<resource>` to be consistent — but that's a separate concern. |
| A test or query in another file references the old column name and breaks | Medium | High | The executor MUST grep for `action_type` after the migration and fix any remaining references. Pre-commit grep is part of Task 6. |
| `admin_action_log` also has values like `suspend_user` that should match the new `admin.suspend_user` | Low | Low | Out of scope (different table, different value source). The `admin-log` handler maps `r.action` (from `admin_action_log.action`) to the response field `action_type` (kept as-is per API contract). |
| Migration runs twice (re-run) | Low | Low | All UPDATEs are idempotent (same value → no-op after first run). RENAME COLUMN is also safe (would fail with "column already named X" but harmless). The DROP/CREATE INDEX is guarded by `IF EXISTS`. |
| `idx_action_history_type` doesn't exist on some test DBs (created by v001) | Low | Low | The `DROP INDEX IF EXISTS` handles this. |
| The `'placement_created'` value is only in dashboard.ts but maybe also in the column data | Low | Low | The migration includes a `WHERE capability_name = 'placement_created'` UPDATE. If 0 rows match, no harm. |

## 7. Success Criteria

- [ ] `pnpm test` shows 779 passed, 0 skipped, 0 failed (unchanged)
- [ ] `pnpm typecheck` clean
- [ ] `pnpm conformance:check` 46/46
- [ ] `pnpm capabilities:check` 46/46
- [ ] `pnpm openapi:check` clean
- [ ] `grep -rn "action_type" src/main/ --include="*.ts"` returns only legitimate references (admin-log handler, route-action-map internal variable name, etc. — see §8 below)
- [ ] `grep -rn "action_type" tests/integration/ --include="*.ts"` returns 0 matches in action_history-related tests
- [ ] Manual smoke: trigger a `POST /v1/auth/register` then query the DB and confirm the row's `capability_name` is `'auth.register'` (not the old `'register'`)
- [ ] Manual smoke: trigger a `POST /v1/headhunter/candidates` then query the DB and confirm `'headhunter.upload_candidate'`
- [ ] Manual smoke: trigger an employer `create_placement` flow (any path) and confirm `'employer.create_placement'`
- [ ] Dashboard endpoint still returns 200 with correct counts after the query update
- [ ] 6 atomic commits on main branch

## 8. Lingering `action_type` references (acceptable)

After the migration, these references remain and are CORRECT:
- `src/main/modules/admin/handlers/admin-log.ts:7, 39` — this is the `admin_action_log` (different table) handler, response field stays `action_type` per `AdminLogItemSchema` API contract
- `src/main/modules/admin/handlers/audit.ts:10` — same: `AuditItemSchema` field
- `src/main/modules/audit/route-action-map.ts` — internal type/variable name; we can rename to `capability_name` for full consistency, but the public API is the 30 ROUTES values (which we update)
- `docs/superpowers/skill.md` and `docs/CHANGELOG.md` — documentation, may mention `action_type` historically; not in scope

The plan does NOT touch these. They are different namespaces (admin_action_log.action → AdminLogItemSchema.action_type response field) that are correctly named and outside this migration's scope.

## 9. Out of Scope (deferred)

- `admin_action_log.action` column rename (different table, different source)
- Renaming the route-action-map file or its internal `action_type` TypeScript field (low-value churn)
- Updating `docs/superpowers/skill.md` or any external documentation to mention `capability_name` (the canonical name is in `skill.md` already, just not in the audit log)
- Filling the 46 `it.todo` stubs in `_generated.test.ts`
- v1.9 release (this is a small enough change to roll into v1.8.1 or a hotfix)

## 10. Effort Estimate

~0.5-1 working day. 6 atomic commits. Aligns with the brainstorming decision of "lowest-cost, low-regret roadmap item."

## 11. Open Questions for Executor

1. **Are there any external consumers (CLI tools, dashboards, exports) that read `action_history.action_type`?** Grep the codebase thoroughly. The plan covers internal code; if external tools exist, they break.
2. **Should the route-action-map's internal `interface RoutePattern { action_type: string }` be renamed to `capability_name`?** The plan says no (low-value churn). The executor can decide.
3. **Are there any test fixtures (in `tests/fixtures/` or similar) that use old action_type values?** Grep to confirm.
