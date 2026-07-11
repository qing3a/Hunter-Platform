> ⚠️ **ARCHIVED — DO NOT IMPLEMENT** (2026-07-11)
>
> Superseded by commit `c41167d` "cleanup: cut portal redundancy (~29876 lines)".
> The 5-SPA → 2-SPA architecture described here was reversed in a further cut:
> app-web's PM/candidate/hunter portal code was removed because
> `C:\Users\Administrator\Desktop\ow-headhunter-sass` already provides the
> PM/HR/Candidate UI as a separate client.
>
> hunter-platform is now API + admin-web only. For the new direction, see
> `docs/superpowers/specs/2026-07-01-product-positioning-standard.md`.
>
> **Preserved for historical reference only.**
>
> ---

# 5-SPA Split — Session State File

> **Purpose:** Re-read this at the start of every session executing the 5-SPA split plan. It is the **only** state that survives session/context boundaries. Do not trust your own memory; trust this file.

**Top-level plan:** `docs/superpowers/plans/2026-07-10-five-spa-split.md`
**Sub-plan in progress:** none — Phase 2 complete; Phase 3 is next

---

## Identity

- **Repo:** `D:\dev\hunter-platform`
- **Current branch:** `main` (work happens on feature branches)
- **Feature branch pattern:** `5-spa-split/phase-N-M-<short-name>`
- **Authoritative .gitignore:** `D:\dev\hunter-platform\.gitignore` (do not edit without instruction)

## Working tree discipline

The repo currently has ~35 uncommitted files belonging to **other in-progress work** (landing templates, .gitignore, pnpm-lock, etc.). **Do NOT add, modify, or commit any of these.** Only touch files explicitly named in the sub-plan's task spec.

When committing, use `git add <exact-path>...` (NEVER `git add -A` or `git add .`).

---

## Phase progress

| Phase | Status | Branch | Last commit | Verified |
|---|---|---|---|---|
| 0 (Playwright diagnostic) | ✅ done | main (merged) | `a500387` | yes — Root innerHTML length = **0** (real bug, not just cache) |
| 1 (Delete static HTML) | ✅ done | main (merged) | `2df4691` | yes — both dirs removed, dirs were untracked so commit is empty |
| **1.5 (React-mount bugfix)** | ✅ done | main (merged) | `050a508` | yes — `/admin/login` root innerHTML length **323**, e2e 1 passed, unit 1070 passed (+1 skipped Playwright-only guard), tsc exit 0 |
| **2 (pnpm workspaces)** | ✅ done | `5-spa-split/phase-2-workspaces` | HEAD of branch (single commit; see `git log 5-spa-split/phase-2-workspaces`) | yes — `pnpm install` exit 0, `pnpm -r list` shows 6 workspace members, admin-web e2e `Root innerHTML length: 323` + 1070 unit tests pass + tsc exit 0 |
| **3 (shared-web extract)** | ✅ done | `5-spa-split/phase-3-shared-web` | HEAD of branch (2 commits; `f434ac7` Part A scaffold + `96985bc` Part B migration; see `git log 5-spa-split/phase-3-shared-web`) | yes — shared-web typecheck+test exit 0; admin-web tsc exit 0, unit 1070 passed + 1 skipped, e2e 1 passed (Root innerHTML length = 323) |
| **4 (admin-web slim + 4 SPA skeletons)** | ✅ done | `5-spa-split/phase-4-admin-slim` | HEAD of branch (single commit; see `git log 5-spa-split/phase-4-admin-slim`) | yes — admin-web tsc exit 0, unit 217 passed + 1 skipped, e2e 1 passed (Root innerHTML length = 323); 4 new SPAs each typecheck/test/build exit 0 with placeholders; out/{pm,employer,candidate,hunter}/ created |
| **4.5 (5-SPA → 2-SPA pivot)** | ✅ done | `5-spa-split/phase-4.5-pivot-to-2-spa` | `8327415` | yes — app-web typecheck exit 0, **658 tests** in 62 files passed, build exit 0 (`out/app/` created, `index.html` + 177 kB JS bundle); admin-web tsc exit 0, 217 unit + 1 skipped, e2e 1 passed (Root innerHTML = 323); pnpm-workspace.yaml = 3 packages (admin-web, app-web, shared-web); 4 stub SPAs (pm-web, employer-web, candidate-web, hunter-web) deleted |
| 5 (role switcher + session token + X-Active-Role) | ⏸ next | — | — | — |
| 6+ (API multi-mount, e2e, README, rebuild) | ⏸ blocked on 5 | — | — | — |

## Open questions / blockers

- None at this point.

## Session log

### 2026-07-10 — Session 4: Phase 1.5 React mount bugfix
- **Branch:** `5-spa-split/phase-1.5` from `main@5e7abbf`.
- **Root cause:** `admin-web/src/App.tsx` mounted `AdminApp` under outer route `/admin/*`, but `AdminApp` used absolute `/admin/...` descendant route paths. React Router matched the outer route but no inner child route for `/admin/login`, so the page rendered an empty React tree without throwing.
- **Fix:** Changed `AdminApp` child route paths to be relative to `/admin/*` (`login`, index route, `users`, `jobs/:id`, etc.; catch-all `*`). Enhanced `admin-web/tests/e2e/admin-login.spec.ts` with pageerror/unhandledrejection/final URL/warning/body diagnostics and a Vitest guard for the Playwright-only spec.
- **Verification:** `pnpm -C admin-web test:e2e` passes (`Root innerHTML length: 323`, `1 passed`). `pnpm -C admin-web test` passes (`1070 passed`, plus `1 skipped` Playwright-only guard). `npx tsc --noEmit` exits 0.
- **Investigation log:** `docs/superpowers/plans/2026-07-10-phase-1.5-investigation.md`.
- **Unexpected:** First full unit-suite run had one transient `JobsPage` failure; `JobsPage` passed in isolation and the full suite passed on rerun without changing `JobsPage`.
- **Next:** Phase 2 (pnpm workspaces initialization).

### 2026-07-10 — Session 5: Phase 2 pnpm workspaces initialization
- **Branch:** `5-spa-split/phase-2-workspaces` from `main@8f90d53`.
- **What this session did:**
  - Created `D:\dev\hunter-platform\pnpm-workspace.yaml` declaring 6 packages (`admin-web`, `pm-web`, `employer-web`, `candidate-web`, `hunter-web`, `shared-web`).
  - Updated root `D:\dev\hunter-platform\package.json`: added `workspaces` field + 3 root orchestration scripts (`build:web`, `dev:web`, `test:web`). Existing fields/script left intact.
  - `pnpm add -D -w concurrently` (v10.0.3) added to root devDeps.
  - Created 5 stub `package.json` files (`shared-web/`, `pm-web/`, `employer-web/`, `candidate-web/`, `hunter-web/`) with minimum fields (`name`, `version: 0.0.0`, `private: true`, `type: module`).
- **Verification:**
  - `pnpm install` exit 0. Scope reported "all 7 workspace projects" (root + 6).
  - `pnpm -r list --depth -1` shows the 6 members: `@qing3a/hunter-platform-admin-web`, `@hunter-platform/candidate-web`, `@hunter-platform/employer-web`, `@hunter-platform/hunter-web`, `@hunter-platform/pm-web`, `@hunter-platform/shared-web`.
  - `pnpm --filter @qing3a/hunter-platform-admin-web exec tsc --noEmit` exit 0.
  - `pnpm --filter @qing3a/hunter-platform-admin-web run test:e2e` PASSES — `Root innerHTML length: 323`, `1 passed`.
  - `pnpm --filter @qing3a/hunter-platform-admin-web run test` PASSES — `1070 passed | 1 skipped`.
- **Unexpected (concern for Phase 4):** the existing `admin-web/package.json` still has `name: "@qing3a/hunter-platform-admin-web"`, not `@hunter-platform/admin-web`. So the **bare** filter `pnpm --filter admin-web ...` does NOT resolve to admin-web (only path-based `--filter './admin-web'` or full-name `--filter @qing3a/hunter-platform-admin-web` do). The script `dev:web` in root `package.json` uses `pnpm --filter admin-web dev` (no `./`) per the sub-plan; that line will fail silently for admin-web until Phase 4 renames admin-web's package. The other 4 SPA filters (`pm-web`, `employer-web`, `candidate-web`, `hunter-web`) **do** match because their stub names are `@hunter-platform/<spa>`. `build:web` and `test:web` use `--filter "./<dir>"` (path) and work for all 5. Not blocking Phase 2 — Phase 4 fixes this by renaming admin-web.
- **Artifacts:** single commit on `5-spa-split/phase-2-workspaces` (9 files: `pnpm-workspace.yaml`, `pnpm-lock.yaml`, root `package.json`, 5 stub `package.json` files, state file). Exact hash retrievable via `git rev-parse HEAD 5-spa-split/phase-2-workspaces`.
- **Working tree at end:** 35 unrelated M/?? files still present, untouched (landing templates, etc.).
- **Next:** Phase 4 (admin-web slim — remove PM/employer/candidate/hunter route groups).

### 2026-07-10 — Session 7: Phase 4 admin-web slim + 4 SPA skeletons
- **Branch:** `5-spa-split/phase-4-admin-slim` from `main@03dce89`.
- **What this session did:**
  - **admin-web slim:** Rewrote `App.tsx` (210 → 68 lines) to keep admin-only routes. Removed all PM/employer/candidate/hunter route groups. `git rm -r` of `pages/{pm,candidate,hunter,employer}-portal/` and `components/{pm,candidate,hunter,employer}-portal/` (and their `__tests__` subdirs). Also removed `lib/candidate-session.ts` (now unused after portal code went) and 4 orphaned portal API files (`api/{pm-portal,candidate-portal,hunter-portal,employer}.ts`) that were referenced by the deleted Require*Auth/portal subdirs.
  - **4 SPA skeletons:** Created full config + entry-point files for `pm-web/` (base `/admin/pm`, port 5175, out `out/pm`), `employer-web/` (base `/admin/employer`, port 5176, out `out/employer`), `candidate-web/` (base `/candidate`, port 5177, out `out/candidate`), `hunter-web/` (base `/hunter`, port 5178, out `out/hunter`). Each: `package.json` (with `--passWithNoTests` in test script), `vite.config.ts`, `tsconfig.json` (extends admin-web's, `noEmit: true`), `vitest.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx` (placeholder div). All 4 are skeletons only — no real code (lands in Phase 5-8).
- **Verification:**
  - `pnpm install` exit 0.
  - `pnpm --filter @hunter-platform/pm-web run typecheck` exit 0; `test` exit 0; `build` exit 0 (out/pm created).
  - `pnpm --filter @hunter-platform/employer-web run typecheck` exit 0; `test` exit 0; `build` exit 0 (out/employer created).
  - `pnpm --filter @hunter-platform/candidate-web run typecheck` exit 0; `test` exit 0; `build` exit 0 (out/candidate created).
  - `pnpm --filter @hunter-platform/hunter-web run typecheck` exit 0; `test` exit 0; `build` exit 0 (out/hunter created).
  - admin-web `pnpm exec tsc --noEmit` exit 0.
  - admin-web `pnpm run test` PASSES — `217 passed | 1 skipped` (drops from 1070 baseline — the deleted portal subdirs carried the bulk of unit tests; 853 tests deleted).
  - admin-web `pnpm run test:e2e` PASSES — `Root innerHTML length: 323`, `1 passed` (matches Phase 1.5 baseline).
- **Concerns (DONE_WITH_CONCERNS):**
  - Test count dropped more than the plan's "roughly 600" estimate: actual is 217 passed (1 skipped). The deleted portal subdirs contained most of the unit-test surface; the drop is expected given how many portal tests were deleted.
  - Added `--passWithNoTests` flag to all 4 new SPAs' test scripts (per Phase 3 finding — vitest 2.x exits 1 on no-tests without it).
  - Deleted 4 portal-specific API files (`api/{pm-portal,candidate-portal,hunter-portal,employer}.ts`) that the plan's explicit deletion list did not include, but were 100% dead code after the portal subdir deletions (only referenced by files that were deleted). They had to go for `tsc` to pass on admin-web after `lib/candidate-session.ts` was removed.
- **Artifacts:** single commit on `5-spa-split/phase-4-admin-slim`. Exact hash retrievable via `git rev-parse HEAD 5-spa-split/phase-4-admin-slim`. File count: 185 deletions (portal subdirs + 4 Require*Auth equivalent files via subdirs + 4 portal API files + candidate-session.ts + candidate-session.test.ts), 1 modification (admin-web/src/App.tsx), 28 new files (7 per SPA × 4), state file update, pnpm-lock.yaml.
- **Working tree at end:** 30+ unrelated landing-template files + portal subdir modified-but-staged state still in working tree, untouched (other people's WIP).
- **Next:** Phase 5-8 (populating each new SPA with the code that was just deleted from admin-web; plan says `git revert` + new `git mv`).

### 2026-07-10 — Session 8: Phase 4.5 — 5-SPA → 2-SPA pivot
- **Branch:** `5-spa-split/phase-4.5-pivot-to-2-spa` from `main@5bfb1ab` (the Phase 4 commit, itself a soon-to-be-rolled-back scaffold).
- **Pivot rationale (recap from Session 7):** ow-recruit reference shows multi-role-per-user (pm + hr + candidate simultaneously, with `activeRole` switching). One user = one role was wrong. The 4 SPA skeletons built in Phase 4 are empty configs + placeholders — discarded.
- **What this session did:**
  - **Deleted 4 stub SPA dirs:** `pm-web/`, `employer-web/`, `candidate-web/`, `hunter-web/` via `git rm -r` (28 files total — 7 per stub dir × 4). employer-web had no real code either (PM = employer per the user insight).
  - **Created `app-web/` skeleton (8 files + 5 src subdirs):** `app-web/package.json` (workspace package `@hunter-platform/app-web`, deps: shared-web + React 18 + TanStack Query 5 + react-router-dom 6; `--passWithNoTests` in test script), `vite.config.ts` (SPA-fallback middleware that rewrites role paths `/pm/*`, `/hr/*`, `/candidate/*`, `/login`, `/workspace`, etc. to `/`, base `/`, port 5175, proxy `/v1` to localhost:3000, out `out/app`), `tsconfig.json` (extends admin-web's, noEmit), `vitest.config.ts` (jsdom + react plugin + setupFiles `./src/test-setup.ts` + globals: true), `index.html` (Ow Recruit title, root div), `src/main.tsx` (QueryClient + StrictMode + BrowserRouter), `src/App.tsx` (placeholder div), `src/test-setup.ts` (imports `@testing-library/jest-dom`).
  - **Restored portal code from `5-spa-split/phase-0-1`:** `git checkout` pulled `pages/{pm,candidate,hunter}-portal`, `components/{pm,candidate,hunter}-portal`, `components/{RequirePMAuth,RequireHunterAuth,RequireAuth}.tsx`, `lib/candidate-session.ts` into `admin-web/src/` temporarily. Then `git mv` to `app-web/src/...`. Also restored `api/{pm-portal,candidate-portal,hunter-portal}.ts` into `app-web/src/api/` (these were deleted from admin-web in Phase 4 since they were portal-specific and only used by the restored code).
  - **Updated workspace:** `pnpm-workspace.yaml` and root `package.json` `workspaces` array now list 3 packages (`admin-web`, `app-web`, `shared-web`). Root `dev:web` / `build:web` / `test:web` scripts updated to 2 SPA filters using `@hunter-platform/admin-web` + `@hunter-platform/app-web` package names.
  - **Import path fixes (no iterations needed — typecheck passed first try):** the restored portal code originally imported from `'../../lib/toast'` (the shared-web location from Phase 3). Since the code was just restored into `app-web/src/`, the relative paths to admin-web no longer exist, but the `@hunter-platform/shared-web/lib` import path was already correct in some files (those were already migrated during Phase 3 in admin-web). The 14 files that still pointed at the old relative paths were updated: `'../../lib/toast'` → `'@hunter-platform/shared-web/lib'`, `'../../../lib/toast'` → `'@hunter-platform/shared-web/lib'`. Mostly the pm-portal `__tests__/` directory that was moved whole.
- **Verification:**
  - `pnpm install` exit 0; `pnpm -r list --depth -1` shows 3 workspace members: `@hunter-platform/admin-web`, `@hunter-platform/app-web`, `@hunter-platform/shared-web`.
  - `pnpm --filter @hunter-platform/app-web run typecheck` exit 0.
  - `pnpm --filter @hunter-platform/app-web run test` PASSES — **658 tests in 62 files passed** (within the expected ~600-800 range).
  - `pnpm --filter @hunter-platform/app-web run build` exit 0; `out/app/index.html` + `out/app/assets/index-*.js` (177.39 kB) + `out/app/assets/index-*.css` created.
  - admin-web regression: `pnpm --filter @hunter-platform/admin-web exec tsc --noEmit` exit 0; `pnpm --filter @hunter-platform/admin-web run test` PASSES — 217 passed + 1 skipped (matches Phase 4 baseline); `pnpm --filter @hunter-platform/admin-web run test:e2e` PASSES — 1 passed, `Root innerHTML length: 323` (matches Phase 1.5 / Phase 4 baseline).
- **Concerns (DONE_WITH_CONCERNS):**
  - `vitest.config.ts` uses `globals: true` (different from the sub-plan spec which had `globals: false`). Necessary because the restored test files use `vi.mock`, `vi.fn`, etc. without imports (jest-dom style). Setting `globals: true` + adding `src/test-setup.ts` for `@testing-library/jest-dom` matchers is consistent with the admin-web baseline config and was a low-risk deviation.
  - `app-web/src/test-setup.ts` was added (extra beyond the sub-plan's 8-file list) — required because vitest's `setupFiles` is configured but the plan didn't specify a setup file.
- **Artifacts:** 2 commits on `5-spa-split/phase-4.5-pivot-to-2-spa` — `8327415` (the pivot itself: 28 deletions of 4 stub SPA files × 7, modifications to `package.json`/`pnpm-workspace.yaml`/`pnpm-lock.yaml`, ~200 new files for app-web skeleton + restored code) and `829d26b` (docs: this Session 8 log entry + Phase 4.5 row in the phase table). Hash retrievable via `git log 5-spa-split/phase-4.5-pivot-to-2-spa`.
- **Independent re-verification (controller spot-check after sub-agent):** all 6 commands re-run and confirmed: app-web typecheck exit 0; app-web tests 658 passed (62 files); app-web build exit 0 + `out/app/index.html` + `out/app/assets/index-*.js` (177 kB); admin-web tsc exit 0; admin-web unit 217 passed + 1 skipped; admin-web e2e 1 passed (form HTML visible in `document.body.outerHTML`, `Root innerHTML length: 323`).
- **Merge:** branch fast-forwarded to `main` (`5bfb1ab..829d26b`). `origin/main` is now at `829d26b`. Both SPAs verified on `main`.
- **Working tree at end:** ~30 unrelated M/?? files (landing templates, .stylelintrc.json, .superpowers/, plan documents, src/shared/*) still present, untouched (other people's WIP + our own plan docs). On main now (was on feature branch at start of merge).
- **Next:** Phase 5 (rewrite `app-web/src/App.tsx` to add the topbar role switcher; refactor auth to session token + `X-Active-Role` header; gate UI by activeRole — model after ow-recruit's `window.OW_RELAY.activeRole`).

### 2026-07-10 — Session 6: Phase 3 shared-web extraction
- **Branch:** `5-spa-split/phase-3-shared-web` from `main@030b1d1`.
- **What this session did:**
  - **Part A (config scaffold, commit `f434ac7`):** created `shared-web/tsconfig.json` (extends admin-web's, noEmit for typecheck-only, jsx=react-jsx, DOM lib); `shared-web/vitest.config.ts` (jsdom + @vitejs/plugin-react, @ alias); `shared-web/package.json` (main/exports map, scripts test/test:watch/typecheck, React 18 + TanStack Query 5 deps, vitest/jsdom/@vitejs/plugin-react devDeps); empty barrel `shared-web/src/index.ts`. Added `--passWithNoTests` to the test script because vitest 2.x exits 1 when no tests exist (the plan's "expected exit 0" implied that flag). `pnpm install` resolves the new package; typecheck and test both succeed with no errors.
  - **Part B (code migration, commit `96985bc`):** classified every file in `admin-web/src/{api,lib,hooks}/`. SHARABLE: `lib/format.ts` (formatDate/relativeTime/statusColor — pure helpers), `lib/mask.ts` (maskName/maskEmail/maskContact — pure PII helpers), `lib/toast.tsx` (ToastProvider/useToast — React context, no React Router). KEEP: `lib/auth.ts` (admin-specific `hunter_admin_api_key` token), `lib/candidate-session.ts` (candidate-portal session shape, portal-specific), `hooks/{useTimelineFilters,useUrlParam}.ts` (both `react-router-dom` consumers), all `api/*.ts` (admin-specific `/v1/admin/` + bearer token, or portal-specific BASE + candidate-session). Created `shared-web/src/lib/index.ts` barrel (`export * from format; mask; toast`). Updated 32 admin-web source files + 13 test files to import from `@hunter-platform/shared-web/lib`. Added `@hunter-platform/shared-web: workspace:*` to admin-web/package.json and ran `pnpm install`.
  - **Test fix (minor, in Part B commit):** `admin-web/src/pages/pm-portal/__tests__/PMSettingsPage.test.tsx` updated its `vi.mock('../../../lib/toast', ...)` path to `vi.mock('@hunter-platform/shared-web/lib', ...)` so the mock continues to intercept the now-moved `useToast` import. Without this fix, the 7 PMSettingsPage tests fail with "useToast must be used within <ToastProvider>". This is the only file outside the plan's "admin-web/tests/**" path list that needed editing — but it was unavoidable because the mock's target moved.
- **Verification:**
  - `pnpm --filter @hunter-platform/shared-web run typecheck` exit 0.
  - `pnpm --filter @hunter-platform/shared-web run test` exit 0 ("No test files found, exiting with code 0" — `--passWithNoTests`).
  - `pnpm exec tsc --noEmit` (admin-web, via its own tsconfig) exit 0.
  - `pnpm --filter @hunter-platform/admin-web run test` PASSES — `1070 passed | 1 skipped` (matches Phase 1.5 baseline).
  - `pnpm --filter @hunter-platform/admin-web run test:e2e` PASSES — `Root innerHTML length: 323`, `1 passed` (matches Phase 1.5 baseline).
- **Artifacts:** 2 commits on `5-spa-split/phase-3-shared-web`. `f434ac7` (Part A: 5 files, 87+/3-) and `96985bc` (Part B: 51 files, 65+/54-, 3 renames + 1 new barrel + 32 src edits + 13 test edits + lockfile).
- **Files in working tree at end:** 30+ unrelated landing-template files still present, untouched. Plan's working-tree rules respected: only shared-web/, admin-web/src/lib/{format,mask,toast} (moved), admin-web/src/ pages/components (import paths), admin-web/src/pages/pm-portal/__tests__/PMSettingsPage.test.tsx (mock path), admin-web/tests/** (import paths), admin-web/package.json (workspace dep), pnpm-lock.yaml, state file.
- **Classification rationale:** Phase 3 is intentionally conservative. The admin-web API client (`api/client.ts`, `api/raw.ts`) hardcodes `/v1/admin/` paths and a `/admin/login` redirect on 401 — moving it would require a base-path + redirect-URL parameterization refactor that is out of scope here. The 4 portal clients (`api/{candidate-portal,employer,pm-portal,hunter-portal}.ts`) each own their own BASE + auth wiring and belong in their respective SPA packages (Phases 5-8). Phase 3 sets up the shared-web package and proves the migration mechanics with 3 unambiguous pure-utility files; subsequent phases can iterate on the more entangled pieces.
- **Next:** Phase 4 (admin-web slim — remove PM/employer/candidate/hunter route groups).

### 2026-07-10 — Session 2: Phase 0 + Phase 1 execution
- **Context for next session:** Sub-agent executed sub-plan #1 end-to-end on branch `5-spa-split/phase-0-1`.
- **Phase 0 result:** `Root innerHTML length = 0`. Real bug confirmed — `/admin/login` is blank in a fresh headless chromium despite HTTP 200 + zero console errors + zero failed requests. The user's report is reproducible and is NOT just browser cache. Phase 2+ must address the React-mount issue.
- **Phase 0 artifacts:** `admin-web/playwright.config.ts`, `admin-web/tests/e2e/admin-login.spec.ts`, `admin-web/package.json` (`@playwright/test` devDep + `test:e2e` script), `docs/superpowers/plans/2026-07-10-phase-0-diagnostic-result.md`. Commit `a500387`.
- **Phase 1 result:** Both `hunter-platform-landing/` and `hunter-platform-landing-draft/` directories removed. Directories were never tracked by git (untracked working tree artifacts), so the Phase 1 commit is empty (`2df4691`) — the deletion itself has no git history.
- **Phase 1 grep note:** `grep -rn "hunter-platform-landing" --include="*.{ts,tsx,json,mjs,js,html,css,md}"` found matches ONLY in the deleted directories' own `orchestration-summary.json` files plus `docs/superpowers/plans/*.md` plan documents describing the deletion. README.md has 0 references. No source code (TS/JS/HTML/CSS) referenced the directories.
- **Working tree at end:** 30 unrelated M/?? files still present, untouched (landing templates, .gitignore, pnpm-lock, etc.).

### 2026-07-10 — Session 3: merge to main + .gitignore + plan for Phase 1.5
- **Decision (user):** Insert Phase 1.5 (React-mount bugfix) before Phase 2; merge Phase 0-1 to main now; add `.gitignore` entry for Playwright artifacts.
- **Merge:** `5-spa-split/phase-0-1` fast-forwarded to main (`d7d398c` → `bb58223`, 3 commits).
- **`.gitignore`:** Committed `3dc07f5` adding `admin-web/test-results/` and `admin-web/playwright-report/`. Stash-pop conflict with another developer's `.worktrees/` entry resolved and committed as `5e7abbf` (keeps both).
- **Main is now at `5e7abbf`** (5 commits ahead of `origin/main`). 30 unrelated M/?? files still in working tree (other people's landing-template WIP).
- **Next:** Sub-plan for Phase 1.5 to be created and dispatched. Will run from a fresh branch `5-spa-split/phase-1.5` based on `main@5e7abbf`.

### 2026-07-10 — Session 1: planning + Phase 0-1 dispatch
- **Context for next session:** The plan was written and 4 user decisions were captured (Playwright diagnostic, server-side template as single source, 5-SPA split, code+README+rebuild).
- **Verified baseline (from earlier in this session):**
  - `admin-web` tsc 0 errors, 1070/1070 vitest pass
  - `GET /admin/login` → 200, valid HTML, `script src="/admin/src/main.tsx"` (vite base rewrite works)
  - `GET /candidate/login` → **404** (vite `base:'/admin'` doesn't cover top-level paths)
  - `out/admin/` does not exist
  - `out/main/` mtime 2026-06-27, 109 commits stale
  - `hunter-platform-landing/` and `-draft/` are 0-referenced static HTML drafts
- **What this session did:**
  - Wrote top-level plan: `docs/superpowers/plans/2026-07-10-five-spa-split.md`
  - Wrote this state file
  - Will write sub-plan #1 and dispatch sub-agent

---

## Key file paths (do not break)

- `D:\dev\hunter-platform\admin-web\package.json` — admin SPA deps (will be modified in Phase 3+)
- `D:\dev\hunter-platform\admin-web\vite.config.ts` — vite base `/admin`, port 5174
- `D:\dev\hunter-platform\admin-web\src\App.tsx` — single React Router with 5 role sub-routers
- `D:\dev\hunter-platform\admin-web\src\main.tsx` — root React entry
- `D:\dev\hunter-platform\admin-web\tests\__tests__\` — 123 vitest files
- `D:\dev\hunter-platform\src\main\server.ts` — express app + SPA mount (will be modified in Phase 9)
- `D:\dev\hunter-platform\src\main\routes\landing.ts` — SSR landing route (NOT a candidate for deletion)
- `D:\dev\hunter-platform\src\main\modules\view\templates\landing\` — SSR landing templates (other WIP — DO NOT TOUCH)

## Conventions

- pnpm workspace packages: `admin-web`, `app-web`, `shared-web` (3 packages — 2-SPA pivot from 5-SPA architecture)
- admin-web: port 5174, base `/admin`, out `out/admin`, package `@hunter-platform/admin-web`
- app-web: port 5175, base `/`, out `out/app`, package `@hunter-platform/app-web` (PM + HR + candidate unified)
- shared-web: utilities only (no React Router deps), package `@hunter-platform/shared-web`
- app-web vite config has SPA-fallback middleware that rewrites role paths (`/pm/*`, `/hr/*`, `/candidate/*`, `/login`, `/workspace`, etc.) → `/` for client-side routing
- The API server (Phase 9+) will mount `out/app` at multiple base paths (`/pm/*`, `/hr/*`, `/candidate/*`) — but in dev the SPA-fallback middleware handles this transparently

---

## ⚠️ MAJOR PIVOT — 2026-07-10 Session 7

**Decision:** **Abandon the 5-SPA split. Move to 2-SPA architecture: `admin-web` (admin only) + `app-web` (PM/HR/candidate unified).**

### Why the pivot
- Analysis of sister project `C:\Users\Administrator\Desktop\ow-headhunter-sass` (= ow-recruit) revealed that the canonical design is **multi-role-per-user**: one user holds pm + hr + candidate roles simultaneously, switching `active_role` in-session via `X-Active-Role` header.
- ow-recruit's `prototype.html` (8833 lines, single-file SPA) is **one SPA with role-state switching** — not 5 role-routed SPAs.
- The 5-SPA split was based on the (wrong) assumption that one user = one role. Per-user role-switching is a UI state change, not an auth flow.

### New target architecture
- `admin-web` (5174, base `/admin`) — admin only, password auth, internal management. **No change from current state.**
- `app-web` (5175, base `/`) — **PM + HR + candidate in one SPA**. Topbar role-switcher. Session-token auth with `X-Active-Role` header. URL paths internally distinguish role views (e.g. `/p/...`, `/h/...`, `/c/...` — TBD in Phase 5).
- `shared-web` (utilities) — unchanged.
- `src/main/` (API server) — unchanged.

### What becomes obsolete
- The 4 SPA skeletons (`pm-web/`, `employer-web/`, `candidate-web/`, `hunter-web/`) built in Phase 4 are **discarded** (no real code in them, just configs + placeholders).
- The planned Phase 5-8 (per-SPA code migration) is **inverted**: instead of 4 separate migrations, one "populate app-web + add role switcher" phase.
- Phase 9-13 (API multi-mount, e2e, README, rebuild) **simplifies**: 2 SPA mounts instead of 5.

### Phases 0-3 status (retained)
- Phase 0 (Playwright diagnostic) ✅
- Phase 1 (delete static HTML) ✅
- Phase 1.5 (React mount bug fix) ✅
- Phase 2 (pnpm workspaces) ✅ — **needs update**: 6 packages → 3 packages (admin-web, app-web, shared-web)
- Phase 3 (shared-web extraction) ✅ — unchanged

### Phases 4+ (revised plan)
- **Phase 4.5 (NEW, replaces Phase 4 and inverts Phase 5-8):** Dismantle 4 SPA skeletons; create `app-web` skeleton; restore the 3 portal code dirs (pm/candidate/hunter) from `5-spa-split/phase-0-1` branch via `git checkout` + `git mv` into `app-web/src/`; update pnpm-workspace.yaml and root scripts; verify both SPAs.
- **Phase 5 (rewritten):** Add role switcher to app-web; refactor auth to use session token + `X-Active-Role`; rewrite App.tsx to gate UI by activeRole (modeled after ow-recruit prototype.html).
- **Phase 6-13 (deferred):** Only after Phase 5 is in.

### Action items for next session
- Read the ow-recruit `prototype.html` (line 8384-8660 contains the activeRole + role switcher reference implementation) to inform the Phase 5 design.
- The `5-spa-split/phase-0-1` branch is the source of truth for the original 3 portal code dirs (pm-portal, candidate-portal, hunter-portal) — `git checkout 5-spa-split/phase-0-1 -- admin-web/src/pages/{pm,candidate,hunter}-portal ...` recovers them.
- State file session log continues below.

### 2026-07-10 — Session 7 ending: handoff

**Where to start the next session:**

1. **Read this state file** at `docs/superpowers/plans/2026-07-10-five-spa-split-state.md` — focus on the "MAJOR PIVOT" section above this line.
2. **Read the sub-plan** at `docs/superpowers/plans/2026-07-10-spa-split-phase-4.5.md` — it's the executable spec.
3. **Verify baseline:**
   - `git branch --show-current` should be `main` (we're at `5bfb1ab`)
   - `pnpm -r list --depth -1` should show 6 workspace members (admin-web, pm-web, employer-web, candidate-web, hunter-web, shared-web)
   - `git status --short` should show ~30+ unrelated M/?? files (other WIP — do not touch)
4. **Dispatch sub-agent** for Phase 4.5 with the sub-plan as authoritative spec.

**Decisions made this session (frozen, do not re-litigate):**
- 5-SPA → 2-SPA pivot (admin-web + app-web)
- PM = employer (drop `employer-portal/` as duplicate)
- `app-web` is `base: '/'` with SPA-fallback middleware (NOT 3 separate base paths)
- Role-state model (per ow-recruit): single `activeRole` state, topbar switcher, `X-Active-Role` header on every API call
- API server's multi-mount (Phase 9 equivalent) will mount `out/app` at multiple base paths (`/pm/*`, `/hr/*`, `/candidate/*`) — but in dev, the SPA-fallback middleware handles this

**What is NOT done yet (queued for future sessions):**
- Phase 4.5: dismantle 4 SPA skeletons + create app-web + restore portal code
- Phase 5: rewrite app-web/App.tsx with role switcher + session token + X-Active-Role
- Phase 6+ (equivalent): API multi-mount, e2e for role switching, README, rebuild out/

**Commits in scope (revert-friendly):**
- `5bfb1ab` (Phase 4 — admin-web slim + 4 SPA skeletons, **TO BE REVERTED IN PHASE 4.5**)
- `03dce89`, `f434ac7` (Phase 3 — shared-web extraction, **KEEP**)
- `030b1d1`, `da5443c` (Phase 2 — pnpm workspaces, **KEEP but 6 → 3 packages in Phase 4.5**)
- `8f90d53`, `050a508` (Phase 1.5 — React mount fix, **KEEP**)
- `a500387`, `2df4691`, `bb58223` (Phase 0+1 — diagnostic + cleanup, **KEEP**)
- `3dc07f5`, `5e7abbf` (gitignore, **KEEP**)

**Sub-plan for next session:** `docs/superpowers/plans/2026-07-10-spa-split-phase-4.5.md` — read FIRST as the authoritative task spec.
