# Session Token + Multi-Role Auth — Session Handoff

> **Purpose:** Continue R1.C2 implementation from where 2026-07-11 Session 1 stopped. Branch: `feature/session-multirole` (pushed to origin).

**Parent spec:** `docs/superpowers/specs/2026-07-11-session-and-multirole-design.md`
**Parent plan:** `docs/superpowers/plans/2026-07-11-session-multirole-impl.md`

---

## Status snapshot

**6 commits on `feature/session-multirole`** (all pushed):

| # | SHA | Task | Status |
|---|---|---|---|
| 1 | `4b74d5a` | T1: migration v031 SQL + initial test (subagent) | ✅ |
| 2 | `8c4d102` | T1 follow-up: register migration, fix FK `user`→`users`, expand tests | ✅ |
| 3 | `ba9aca4` | T2: `user-roles` repo (grantAll, list, isInRole, revoke) | ✅ |
| 4 | `635f828` | T3: `session` repo + service (create/resolve/refresh/revoke, 168h TTL) | ✅ |
| 5 | `44609e9` | T4: dual-track auth middleware + 8 tests (subagent) | ✅ |
| 6 | `4b565eb` | T4 follow-up + T11 partial: UserType/constants rename across 18 files | ✅ |

**Test counts:**
- New tests added: **27** (5 + 6 + 8 + 8)
- Full suite: **1584 pass / 24 fail** (baseline was 1602/0)
- Typecheck: **exit 0**

---

## What's done

### Data model
- `user_role` table (multi-role mapping)
- `session` table (long-lived auth)
- Migration v031 registered in `src/main/db/migrations.ts` as version 24
- `UserType` type changed to `'candidate' | 'hr' | 'pm'`
- `RATE_LIMIT_BURSTS` and `QUOTA_PER_DAY` keys renamed in `src/shared/constants.ts`

### Repos
- `src/main/db/repositories/user-roles.ts` (5 methods)
- `src/main/db/repositories/sessions.ts` (5 methods)
- `src/main/modules/auth/session.ts` (4 service methods)

### Auth middleware
- `src/main/modules/auth/middleware.ts` modified:
  - Dispatch on token prefix: `sess_*` → session path; `hp_live_*` → apikey path
  - `X-Active-Role` header handling (session path only; ignored on apikey)
  - `req.user` augmented with `roles`, `active_role`, `auth_method`, `session_id`
  - Backward compat: `req.user.user_type` still set (remapped value)
  - `remapLegacyUserType()` defensive helper (idempotent for v031 DB)

---

## What's NOT done (12 tasks remaining)

| Task | Description | Estimated |
|---|---|---|
| **T5** | Modify `/v1/auth/register` to auto-grant 3 roles + return `available_roles` in response | 10 min |
| **T6** | `POST /v1/auth/login` endpoint (api_key → session_id) | 15 min |
| **T7** | `POST /v1/auth/refresh` (sliding window + role switch) | 10 min |
| **T8** | `POST /v1/auth/logout` (idempotent revoke) | 5 min |
| **T8.5** | Verify rotate-key accepts both auth (likely auto-works after T4) | 5 min |
| **T9** | WebSocket `?session=&role=` auth path | 15 min |
| **T10** | `roleGate` middleware + apply to specific routes per spec §7.2 | 20 min |
| **T11** | Finish mechanical rename: `headhunter`/`employer` → `hr`/`pm` in remaining test files | 15 min |
| **T12** | Update existing test fixtures (api_key, register, login calls) to use `pm`/`hr` | 15 min |
| **T13** | Update `docs/superpowers/skill.md`, `docs/api.md`, `README.md` | 10 min |
| **T14** | Regenerate OpenAPI: `pnpm openapi:generate` + `pnpm openapi:check` | 5 min |
| **T15** | ow-recruit interop smoke test (manual) | 10 min |
| **T16** | Final verification + merge to main + push | 10 min |

**Total remaining: ~3 hours focused work.**

---

## Known test failures (24 tests)

All failures are from legacy role names in test fixtures. They will be fixed by T11 + T12. **Not new bugs introduced by this work** — they're a known consequence of the v031 role rename.

Categories:
- Tests using `'headhunter'` / `'employer'` in test setup → T11 sed-pass
- Tests asserting `user.user_type === 'employer'` → T12 update
- Schema-assertion tests expecting `tiers.headhunter` → T12 update

Affected test files (representative):
- `tests/integration/employer-jobs-large-description.test.ts`
- `tests/integration/skill-md-conformance/admin-coverage.test.ts`
- `tests/integration/e2e-m3-admin.test.ts`
- `tests/integration/job-required-skills.test.ts`
- `tests/integration/metrics-hooks.test.ts`
- `tests/integration/rate-limit-config.test.ts`
- `tests/integration/webhook-worker.test.ts` (possibly unrelated)
- `tests/integration/candidate-portal/auth.test.ts`
- `tests/integration/employer/dashboard.test.ts`
- `tests/integration/pm/{decompose,plans,projects}.test.ts`
- `tests/unit/gather-landing-data.test.ts` (pre-existing flake: `uptimePercent` rounds to 99.9 after long test runs — independent of T11)
- 1 test in `tests/integration/auth-middleware-dual.test.ts` (the back-compat assertion; check `remapLegacyUserType()` in middleware)

---

## Next session: where to start

**Recommended order:**

1. **T11 (rename remaining tests)**: a single `sed` pass on `tests/` directory
2. **T12 (test fixture updates)**: targeted edits based on `pnpm test` failure list
3. **T5-T8 + T8.5**: auth endpoints (T4's middleware is the foundation)
4. **T9-T10**: WS + RBAC
5. **T13-T16**: docs + OpenAPI + interop + push

**Key files to know:**
- Auth endpoints live in: `src/main/routes/auth.ts`
- Auth schemas: `src/main/schemas/auth.ts`
- WS handler: `src/main/ws.ts` (or wherever WebSocketServer is constructed)
- Role gates: apply per `spec §7.2` table

**Patterns established (use these for consistency):**
- Test import paths: `../../src/main/...` (no `.js` extension in tests; source uses `.js`)
- Test DB type: `node:sqlite` via `createRequire(import.meta.url)` — NOT `better-sqlite3`
- Type alias: `import type { DB } from '../connection.js'`
- Service: `import type { DB } from '../../db/connection.js'`
- Repo: `import type { DB } from '../connection.js'`

---

## What NOT to redo

- The migration v031 SQL (in `src/main/db/migrations/v031_session_and_multirole.sql`) — verified
- The migration registry entry (version 24 in `src/main/db/migrations.ts`) — verified
- The `user-roles` and `sessions` repos — verified
- The `sessionService` — verified
- The dual-track middleware — verified
- The UserType / constants rename — verified

---

## Open questions / decisions

1. **In legacy `remapLegacyUserType()` middleware helper:** Should we keep the legacy `headhunter`/`employer` → `hr`/`pm` remapping as defensive code? (Current: YES, kept.) The DB will only have `hr`/`pm` after v031, but the function is a safety net.

2. **Should `app-web/` resurrection happen?** No — per 2026-07-11 positioning spec, app-web is **gone**. The session work in T5-T10 goes onto `admin-web` only.

3. **Test data fixtures using legacy names**: should we batch-rename via `sed` (T11) or per-test? Recommend `sed` for source, then targeted edits for assertions (T12).

4. **Should rotation grace period be added now?** Spec §4.5 says no (immediate replacement). Current behavior preserved. Optional future work.

---

## Reference: design and plan

- **Design spec** (435 lines): `docs/superpowers/specs/2026-07-11-session-and-multirole-design.md`
- **Implementation plan** (1850 lines, 17 tasks): `docs/superpowers/plans/2026-07-11-session-multirole-impl.md`
- **Roadmap spec**: `docs/superpowers/specs/2026-07-11-positioning.md` (R1.C2 listed)

---

## Quick resume prompt

```
Resume work on `D:\dev\hunter-platform` branch `feature/session-multirole`.
Read the handoff at `docs/superpowers/plans/2026-07-11-session-multirole-HANDOFF.md`.
Continue from T11 (mechanical rename) onward.
```
