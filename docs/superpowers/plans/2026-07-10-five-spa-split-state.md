# 5-SPA Split — Session State File

> **Purpose:** Re-read this at the start of every session executing the 5-SPA split plan. It is the **only** state that survives session/context boundaries. Do not trust your own memory; trust this file.

**Top-level plan:** `docs/superpowers/plans/2026-07-10-five-spa-split.md`
**Sub-plan in progress:** `docs/superpowers/plans/2026-07-10-spa-split-phase-0-1.md`

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
| 0 (Playwright diagnostic) | ✅ done | `5-spa-split/phase-0-1` | `a500387` | yes — Root innerHTML length = **0** (real bug, not just cache) |
| 1 (Delete static HTML) | ✅ done | `5-spa-split/phase-0-1` | `2df4691` | yes — both dirs removed, grep returned 0 source-code refs |
| 2 (pnpm workspaces) | ⏸ not started | — | — | — |
| 3 (shared-web extract) | ⏸ not started | — | — | — |
| 4 (admin-web slim) | ⏸ not started | — | — | — |
| 5-8 (4 new SPAs) | ⏸ not started | — | — | — |
| 9 (API multi-mount) | ⏸ not started | — | — | — |
| 10 (e2e 5-SPA) | ⏸ not started | — | — | — |
| 11 (README) | ⏸ not started | — | — | — |
| 12 (rebuild out/) | ⏸ not started | — | — | — |
| 13 (final verify) | ⏸ not started | — | — | — |

## Open questions / blockers

- None at this point.

## Session log

### 2026-07-10 — Session 2: Phase 0 + Phase 1 execution
- **Context for next session:** Sub-agent executed sub-plan #1 end-to-end on branch `5-spa-split/phase-0-1`.
- **Phase 0 result:** `Root innerHTML length = 0`. Real bug confirmed — `/admin/login` is blank in a fresh headless chromium despite HTTP 200 + zero console errors + zero failed requests. The user's report is reproducible and is NOT just browser cache. Phase 2+ must address the React-mount issue.
- **Phase 0 artifacts:** `admin-web/playwright.config.ts`, `admin-web/tests/e2e/admin-login.spec.ts`, `admin-web/package.json` (`@playwright/test` devDep + `test:e2e` script), `docs/superpowers/plans/2026-07-10-phase-0-diagnostic-result.md`. Commit `a500387`.
- **Phase 1 result:** Both `hunter-platform-landing/` and `hunter-platform-landing-draft/` directories removed. Directories were never tracked by git (untracked working tree artifacts), so the Phase 1 commit is empty (`2df4691`) — the deletion itself has no git history.
- **Phase 1 grep note:** `grep -rn "hunter-platform-landing" --include="*.{ts,tsx,json,mjs,js,html,css,md}"` found matches ONLY in the deleted directories' own `orchestration-summary.json` files plus `docs/superpowers/plans/*.md` plan documents describing the deletion. README.md has 0 references. No source code (TS/JS/HTML/CSS) referenced the directories.
- **Working tree at end:** 30 unrelated M/?? files still present, untouched (landing templates, .gitignore, pnpm-lock, etc.).

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

- All SPA ports: admin=5174, pm=5175, employer=5176, candidate=5177, hunter=5178
- All SPA bases (when split): admin=`/admin`, pm=`/admin/pm`, employer=`/admin/employer`, candidate=`/candidate`, hunter=`/hunter`
- Out dirs: `out/{main,admin,pm,employer,candidate,hunter}`
- pnpm workspace name: `@hunter-platform/<spa>` or `@hunter-platform/shared-web`
