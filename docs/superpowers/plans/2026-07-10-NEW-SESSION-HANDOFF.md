# New Session Handoff — Phase 4.5 of 5-SPA → 2-SPA Pivot

> **Purpose:** Self-contained handoff package for opening a new Claude/AI session to continue the Hunter Platform refactor. Copy the "Prompt" section below into a new chat. The "Plan" section is what the new session executes.

---

## Prompt (copy-paste this into the new session as the first message)

```
You are continuing work on the Hunter Platform monorepo refactor at D:\dev\hunter-platform.
This is a multi-day refactor split across multiple sessions. **Your job: execute Phase 4.5
of the 5-SPA → 2-SPA pivot** (dismantle 4 SPA skeletons, create app-web, restore portal code
from git).

## Required reading (in order)

1. **State file (entry point)**: `D:\dev\hunter-platform\docs\superpowers\plans\2026-07-10-five-spa-split-state.md`
   - Focus on the "MAJOR PIVOT" section (Session 7) and "Session 7 ending: handoff" block at the bottom
2. **Sub-plan (authoritative task spec)**: `D:\dev\hunter-platform\docs\superpowers\plans\2026-07-10-spa-split-phase-4.5.md`
   - Read EVERY step before doing anything
3. **Top-level plan (context only)**: `D:\dev\hunter-platform\docs\superpowers\plans\2026-07-10-five-spa-split.md`
   - Skim — has the original 5-SPA structure; the actual target is 2-SPA per the state file

## Context TL;DR

- Hunter Platform is a 3-role HR platform (PM/employer, headhunter, candidate) plus admin
- Originally designed for 5 SPAs (one per role + admin), but analysis of sister project
  `C:\Users\Administrator\Desktop\ow-headhunter-sass` (ow-recruit) revealed the canonical
  design has **one user holding all 3 operational roles simultaneously**, switching via
  `X-Active-Role` header in a single SPA
- We're pivoting to **2 SPAs**: `admin-web` (admin only, exists) + `app-web` (PM + HR +
  candidate unified, doesn't exist yet)
- Phase 0–4 are done and pushed to origin. Phase 4.5 is the pivot redo.

## Working tree rules (CRITICAL)

The repo has ~44 uncommitted files. **Most are unrelated in-progress work** (landing
templates, etc.) belonging to other developers. **Do NOT touch them.** Only touch files
explicitly named in sub-plan #4.5.

When committing, use `git add <exact-path>` for files YOU created/modified. NEVER
`git add -A` / `-u` / `.`.

## Process

1. Read the state file (entry point).
2. Read sub-plan #4.5 fully.
3. Verify pre-state (branch = main, working tree dirty but unrelated, no in-progress edits).
4. **Dispatch a sub-agent** with `subagent-driven-development` for the bulk of Phase 4.5
   (point it to the sub-plan). Your session context is fresh but you still shouldn't try
   to do all 13 tasks inline — let the sub-agent handle the heavy lifting.
5. After sub-agent reports back, independently spot-check the results.
6. Merge to main and push to origin.
7. Update the state file to mark Phase 4.5 done; add a Session 8 log entry.
8. Hand off to next session for Phase 5 (role switcher + session token + X-Active-Role).

## What success looks like

After this session:
- `pm-web/`, `employer-web/`, `candidate-web/`, `hunter-web/` are deleted
- `app-web/` exists with full config + restored PM/candidate/hunter portal code
- `pnpm-workspace.yaml` lists 3 packages: admin-web, app-web, shared-web
- Root `package.json` `dev:web` / `build:web` / `test:web` use 2 SPAs
- admin-web regression preserved: tsc 0, 217 unit + 1 skipped, e2e 1 passed (Root innerHTML length 323)
- app-web typecheck + test + build all exit 0
- One commit on `5-spa-split/phase-4.5-pivot-to-2-spa` branch
- Merged to main + pushed to origin
- State file updated to mark Phase 4.5 done
```

---

## Plan (checklist for the new session)

This is the ordered checklist. The new session's AI should follow this order, but defer
to the sub-plan #4.5 for actual commands and code blocks.

### Step 1: Pre-flight (5 min)

- [ ] Read `D:\dev\hunter-platform\docs\superpowers\plans\2026-07-10-five-spa-split-state.md`
- [ ] Read `D:\dev\hunter-platform\docs\superpowers\plans\2026-07-10-spa-split-phase-4.5.md` fully
- [ ] Run `cd D:/dev/hunter-platform && git branch --show-current` (expect `main`)
- [ ] Run `git log --oneline -3` (expect tip = `5bfb1ab refactor(admin-web): slim to admin-only...`)
- [ ] Run `git status --short | wc -l` (expect ~44, all unrelated)
- [ ] Run `pnpm -r list --depth -1 | grep hunter-platform` (expect 6 workspace members)

### Step 2: Create feature branch (1 min)

```bash
cd D:/dev/hunter-platform
git checkout -b 5-spa-split/phase-4.5-pivot-to-2-spa
```

### Step 3: Dispatch sub-agent for Phase 4.5 (45-90 min)

The sub-agent will execute sub-plan #4.5. Key reminders in the dispatch prompt:
- Working tree rules (only touch files in the sub-plan)
- Branch discipline (only the new branch, never `main`)
- Escalation rules from the sub-plan (BLOCKED after 2 failed import-path iterations, etc.)

The sub-agent does:
- Delete 4 stub SPA directories
- Update pnpm-workspace.yaml (6 → 3 packages)
- Update root package.json (dev:web, build:web, test:web use 2 SPAs)
- Create app-web/ skeleton
- `pnpm install` + verify
- `git checkout 5-spa-split/phase-0-1` to restore portal code into admin-web/src/ (TEMPORARY)
- `git mv` from admin-web/src/ to app-web/src/
- Update import paths in moved files
- Verify typecheck + test + build for app-web
- Verify admin-web regression preserved
- Commit on the feature branch

### Step 4: Spot-check the sub-agent's work (10 min)

After sub-agent reports:
- [ ] `ls pm-web/ employer-web/ candidate-web/ hunter-web/` should all fail (deleted)
- [ ] `ls app-web/` should show config files + src/
- [ ] `pnpm -r list --depth -1 | grep hunter-platform` should show 3 (admin-web, app-web, shared-web)
- [ ] `pnpm --filter @hunter-platform/admin-web run test:e2e` should pass (Root innerHTML length 323)
- [ ] `pnpm --filter @hunter-platform/app-web run typecheck` should exit 0
- [ ] `pnpm --filter @hunter-platform/app-web run build` should exit 0, `out/app/index.html` exists

If anything fails, dispatch a fix sub-agent (or do small fixes directly).

### Step 5: Merge to main + push (2 min)

```bash
cd D:/dev/hunter-platform
git checkout main
git merge --ff-only 5-spa-split/phase-4.5-pivot-to-2-spa
git push origin main
git push origin 5-spa-split/phase-4.5-pivot-to-2-spa
```

### Step 6: Update state file (5 min)

- [ ] Edit `D:\dev\hunter-platform\docs\superpowers\plans\2026-07-10-five-spa-split-state.md`
- [ ] Add Phase 4.5 row to the table (status ✅, branch, commit hash, verified)
- [ ] Update "Conventions" section to reflect 2-SPA: `app-web` (port 5175, base `/`) replaces the 4 SPAs
- [ ] Add Session 8 log entry

```bash
git add docs/superpowers/plans/2026-07-10-five-spa-split-state.md
git commit -m "docs(plan): mark Phase 4.5 complete; pivot to 2-SPA architecture"
git push origin main
```

### Step 7: Hand off to next session (for Phase 5)

Tell the user (or write a similar handoff file):
- Phase 4.5 is done, main is updated, origin is synced
- Phase 5 is the next step: rewrite app-web/src/App.tsx to add the role switcher + session
  token + `X-Active-Role` header (per ow-recruit `prototype.html:8384-8660` pattern)
- Phase 5 sub-plan doesn't exist yet; the next session will need to write it
- The 3 role flows (pm, hunter, candidate) are now physically present in app-web but the
  activeRole state machine + role switcher UI is still TBD

---

## Pitfalls / notes for the new session

1. **The 4 SPA skeletons are about to be deleted.** Don't be alarmed by the lack of `pm-web` etc.
2. **The git checkout in Step 3f of sub-plan #4.5 puts files in admin-web/src/ temporarily.**
   This is intentional — they get `git mv`'d to app-web/src/ in the next step.
3. **Import path fixes are the highest-risk step.** The moved files reference each other
   via relative paths like `../lib/format` (now in shared-web) and `../../components/Toast`
   (also in shared-web or removed). Sub-agent has 2 iterations to fix before BLOCKED.
4. **The SPA-fallback middleware in app-web's vite.config.ts is critical.** Without it,
   dev visits to `/pm/login` 404. Verify by `curl http://localhost:5175/pm/login` after
   starting the dev server.
5. **PM = employer is the user's call, not the AI's.** Don't try to restore employer-portal
   code "to be safe" — the user said it's a duplicate of pm-portal.
6. **The 44 working tree files are noise.** Filter them out at `git add` time. If anything
   in the working tree changes during your session that's not from your edits, investigate
   before committing.

---

## Files referenced

- State file: `D:\dev\hunter-platform\docs\superpowers\plans\2026-07-10-five-spa-split-state.md`
- Sub-plan: `D:\dev\hunter-platform\docs\superpowers\plans\2026-07-10-spa-split-phase-4.5.md`
- Top-level plan: `D:\dev\hunter-platform\docs\superpowers\plans\2026-07-10-five-spa-split.md`
- Phase 1.5 investigation: `D:\dev\hunter-platform\docs\superpowers\plans\2026-07-10-phase-1.5-investigation.md`
- Reference implementation (ow-recruit): `C:\Users\Administrator\Desktop\ow-headhunter-sass\prototype.html` (lines 8384–8660)
- Reference implementation (ow-recruit README): `C:\Users\Administrator\Desktop\ow-headhunter-sass\README.md`
- Phase 0–4 branches (already pushed to origin):
  - `origin/5-spa-split/phase-0-1`
  - `origin/5-spa-split/phase-1.5`
  - `origin/5-spa-split/phase-2-workspaces`
  - `origin/5-spa-split/phase-3-shared-web`
  - `origin/5-spa-split/phase-4-admin-slim`
- Source branch for portal code restoration: `5-spa-split/phase-0-1`
