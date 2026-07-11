# Sub-Plan: Cut Portal Redundancy (Phase 4.5 Undo)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Parent context:** MAJOR PIVOT from `docs/superpowers/plans/2026-07-10-five-spa-split-state.md` and the analysis that `C:\Users\Administrator\Desktop\ow-headhunter-sass\prototype.html` already provides a polished PM/HR/Candidate UI (9948 lines, single-file SPA). hunter-platform is API-first; the portal code moved into `app-web/` by Phase 4.5 is **redundant**.

**Goal:** Remove all portal code that duplicates `ow-recruit` functionality from both `app-web/` and `admin-web/`. After this sub-plan:
- `app-web/` contains only the entry skeleton (App.tsx, main.tsx, test-setup.ts, vite/ts/vitest config, package.json, index.html) — 0 business code
- `admin-web/` no longer imports the dead-weight portal CSS files (pm-portal.css, hunter-portal.css, employer-portal.css = 5522 lines)
- `admin-web/` and `src/main/` (backend) regression-preserved (tsc 0, tests pass)
- `shared-web/` unchanged

**Branch:** `cleanup/cut-portal-redundancy` (create from `main`)

**Estimated scope:** ~15500 lines of code deleted across ~70 files, 1 commit.

---

## Working tree rules

- The repo has ~44 uncommitted files belonging to **other in-progress work** (landing templates, etc.). **Do NOT touch.**
- When committing, use `git add <exact-path>...` for files YOU delete in this sub-plan only. NEVER `git add -A` / `-u` / `.`.

**Files you MAY delete in this sub-plan** (full enumeration — exhaustive):

### app-web deletions

Directory deletions:
- `D:\dev\hunter-platform\app-web\src\pages\pm-portal\` (10 pages + __tests__)
- `D:\dev\hunter-platform\app-web\src\pages\candidate-portal\` (full directory + __tests__)
- `D:\dev\hunter-platform\app-web\src\pages\hunter-portal\` (full directory + __tests__)
- `D:\dev\hunter-platform\app-web\src\components\pm-portal\` (full directory + __tests__)
- `D:\dev\hunter-platform\app-web\src\components\candidate-portal\` (full directory + __tests__)
- `D:\dev\hunter-platform\app-web\src\components\hunter-portal\` (full directory + __tests__)

File deletions:
- `D:\dev\hunter-platform\app-web\src\components\RequirePMAuth.tsx`
- `D:\dev\hunter-platform\app-web\src\components\RequireHunterAuth.tsx`
- `D:\dev\hunter-platform\app-web\src\components\RequireAuth.tsx`
- `D:\dev\hunter-platform\app-web\src\api\pm-portal.ts`
- `D:\dev\hunter-platform\app-web\src\api\candidate-portal.ts`
- `D:\dev\hunter-platform\app-web\src\api\hunter-portal.ts`
- `D:\dev\hunter-platform\app-web\src\lib\candidate-session.ts`
- `D:\dev\hunter-platform\app-web\src\lib\` (the directory itself may become empty — also delete)

### admin-web deletions

- `D:\dev\hunter-platform\admin-web\src\styles\pm-portal.css` (3600 lines, dead since Phase 4 portal removal)
- `D:\dev\hunter-platform\admin-web\src\styles\hunter-portal.css` (694 lines, dead since Phase 4 portal removal)
- `D:\dev\hunter-platform\admin-web\src\styles\employer-portal.css` (1228 lines, dead since Phase 4.5 PM=employer decision)

### admin-web modifications

- `D:\dev\hunter-platform\admin-web\src\styles.css` — remove 3 `@import` lines for the deleted portal CSS files

### Files you MUST NOT touch

- `D:\dev\hunter-platform\src\main\**` (backend)
- `D:\dev\hunter-platform\shared-web\**`
- `D:\dev\hunter-platform\admin-web\src\pages\**` (admin pages)
- `D:\dev\hunter-platform\admin-web\src\components\**` (admin components)
- `D:\dev\hunter-platform\admin-web\src\api\**`
- `D:\dev\hunter-platform\admin-web\src\lib\**`
- `D:\dev\hunter-platform\admin-web\src\hooks\**`
- `D:\dev\hunter-platform\app-web\src\App.tsx` (placeholder — leave as-is)
- `D:\dev\hunter-platform\app-web\src\main.tsx` (entry — leave as-is)
- `D:\dev\hunter-platform\app-web\src\test-setup.ts`
- `D:\dev\hunter-platform\app-web\vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `package.json`, `index.html`
- Any landing template files, plan files, or unrelated WIP

---

## Task 1: Pre-flight verification (10 min)

### Step 1.1: Verify pre-state

```bash
cd D:/dev/hunter-platform
git branch --show-current  # should be main
git log --oneline -3
git status --short | wc -l  # expect ~44
```

Expected tip: `32cdf77` (Phase 4.5 merge commit).

### Step 1.2: Cross-reference check

Verify no code OUTSIDE the cut scope imports the files we're deleting. The grep targets are intentionally limited to `admin-web/src` (minus the styles dir), `shared-web/src`, and `src/main` — `app-web/src` is excluded because it's being gutted anyway.

```bash
# 1) Auth guards: must NOT be referenced by admin-web, shared-web, or backend
grep -rln "RequirePMAuth\|RequireHunterAuth\|RequireAuth" \
  D:/dev/hunter-platform/admin-web/src \
  D:/dev/hunter-platform/shared-web/src \
  D:/dev/hunter-platform/src/main
# Expected: NO output

# 2) candidate-session: must NOT be referenced by admin-web, shared-web, or backend
grep -rln "candidate-session" \
  D:/dev/hunter-platform/admin-web/src \
  D:/dev/hunter-platform/shared-web/src \
  D:/dev/hunter-platform/src/main
# Expected: NO output

# 3) Portal CSS: admin-web's pages/components must NOT depend on the deleted portal CSS
# (We exclude admin-web/src/styles/ because that's where the deleted files live and
# they reference each other in comments — those matches are expected and OK.)
grep -rln "pm-portal\.css\|hunter-portal\.css\|employer-portal\.css" \
  D:/dev/hunter-platform/admin-web/src/pages \
  D:/dev/hunter-platform/admin-web/src/components \
  D:/dev/hunter-platform/admin-web/src/api \
  D:/dev/hunter-platform/admin-web/src/lib \
  D:/dev/hunter-platform/admin-web/src/main.tsx \
  D:/dev/hunter-platform/admin-web/src/App.tsx
# Expected: NO output
```

If ANY of these commands produces output, STOP and investigate before cutting.

### Step 1.3: Snapshot baseline metrics

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/admin-web exec tsc --noEmit  # expect exit 0
pnpm --filter @hunter-platform/admin-web run test 2>&1 | tail -3  # expect: 217 passed, 1 skipped
pnpm --filter @hunter-platform/app-web exec tsc --noEmit  # expect exit 0
pnpm --filter @hunter-platform/app-web run test 2>&1 | tail -3  # expect: 658 passed (62 files)
```

Record these numbers. They are the regression baselines.

---

## Task 2: Create branch (1 min)

```bash
cd D:/dev/hunter-platform
git checkout -b cleanup/cut-portal-redundancy
```

---

## Task 3: Cut app-web portal code (15 min)

### Step 3.1: Delete portal pages directories

```bash
cd D:/dev/hunter-platform
git rm -r app-web/src/pages/pm-portal/
git rm -r app-web/src/pages/candidate-portal/
git rm -r app-web/src/pages/hunter-portal/
```

Each `git rm -r` schedules the entire directory (including `__tests__/` subdirs) for deletion. The three directories contain ~1500 lines of test code + ~4300 lines of page code ≈ 5800 lines.

### Step 3.2: Delete portal components directories

```bash
cd D:/dev/hunter-platform
git rm -r app-web/src/components/pm-portal/
git rm -r app-web/src/components/candidate-portal/
git rm -r app-web/src/components/hunter-portal/
```

~2000 lines of component code + ~1500 lines of test code ≈ 3500 lines.

### Step 3.3: Delete auth guards + API clients + lib

```bash
cd D:/dev/hunter-platform
git rm app-web/src/components/RequirePMAuth.tsx
git rm app-web/src/components/RequireHunterAuth.tsx
git rm app-web/src/components/RequireAuth.tsx
git rm app-web/src/api/pm-portal.ts
git rm app-web/src/api/candidate-portal.ts
git rm app-web/src/api/hunter-portal.ts
git rm app-web/src/lib/candidate-session.ts

# If app-web/src/lib/ is now empty, remove the directory too
[ -z "$(ls -A app-web/src/lib/)" ] && git rm -r app-web/src/lib/
```

~500 lines.

### Step 3.4: Verify app-web src structure

```bash
cd D:/dev/hunter-platform
find app-web/src -type f | sort
```

Expected remaining files:
- `app-web/src/App.tsx` (placeholder, 11 lines)
- `app-web/src/main.tsx` (entry, 23 lines)
- `app-web/src/test-setup.ts`
- (possibly `app-web/src/lib/` removed entirely)

If anything else remains, STOP and investigate.

### Step 3.5: Verify app-web typecheck still passes

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/app-web exec tsc --noEmit  # expect exit 0
```

Since `App.tsx` is a placeholder that doesn't reference any portal code, and `main.tsx` only renders `App`, this should pass without further changes.

### Step 3.6: Verify app-web build still passes

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/app-web run build  # expect exit 0
ls app-web/../out/app/  # expect index.html + assets/
```

### Step 3.7: Verify app-web tests still pass

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/app-web run test 2>&1 | tail -5
```

Expected: number of tests dropped (from 658) to whatever's left. With portal pages/components gone, expect a much smaller number. Tests should still all pass (with `--passWithNoTests` flag if 0 tests remain — Phase 4.5 already added that flag).

---

## Task 4: Cut admin-web dead-weight portal CSS (5 min)

### Step 4.1: Delete portal CSS files

```bash
cd D:/dev/hunter-platform
git rm admin-web/src/styles/pm-portal.css       # 3600 lines
git rm admin-web/src/styles/hunter-portal.css   # 694 lines
git rm admin-web/src/styles/employer-portal.css # 1228 lines
```

5522 lines deleted.

### Step 4.2: Remove the three @import lines from admin-web/src/styles.css

Read the file first, then use `Edit`:

```bash
# Old (lines 1-4):
# @import './styles/tokens.css';
# @import './styles/hunter-portal.css';
# @import './styles/pm-portal.css';
# @import './styles/employer-portal.css';

# New:
# @import './styles/tokens.css';
```

Use the `Edit` tool with exact strings:
- `old_string`:
  ```
  @import './styles/tokens.css';
  @import './styles/hunter-portal.css';
  @import './styles/pm-portal.css';
  @import './styles/employer-portal.css';
  ```
- `new_string`:
  ```
  @import './styles/tokens.css';
  ```

### Step 4.3: Verify admin-web still compiles

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/admin-web exec tsc --noEmit  # expect exit 0
```

Removing 3 `@import` lines from a CSS file should not affect TypeScript compilation.

### Step 4.4: Verify admin-web tests still pass

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/admin-web run test 2>&1 | tail -3
# Expect: 217 passed, 1 skipped (matches Phase 4.5 baseline)
```

### Step 4.5: Verify admin-web e2e still passes

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/admin-web run test:e2e 2>&1 | tail -5
# Expect: 1 passed, Root innerHTML length: 323 (matches Phase 1.5 / 4.5 baseline)
```

---

## Task 5: Final verification (5 min)

### Step 5.1: Repo-wide build + test sweep

```bash
cd D:/dev/hunter-platform

# Backend compiles
pnpm exec tsc --noEmit  # expect exit 0 (this is the root tsconfig)

# admin-web
pnpm --filter @hunter-platform/admin-web exec tsc --noEmit  # expect exit 0
pnpm --filter @hunter-platform/admin-web run test  # 217 + 1 skipped
pnpm --filter @hunter-platform/admin-web run test:e2e  # 1 passed

# app-web
pnpm --filter @hunter-platform/app-web exec tsc --noEmit  # exit 0
pnpm --filter @hunter-platform/app-web run test  # whatever's left, all passing
pnpm --filter @hunter-platform/app-web run build  # exit 0, out/app/ created

# shared-web
pnpm --filter @hunter-platform/shared-web exec tsc --noEmit  # exit 0
```

### Step 5.2: Verify delete totals

```bash
cd D:/dev/hunter-platform
git diff --stat main 2>&1 | tail -5
```

Expected: ~15500 lines deleted across ~70 files, 1 file modified (admin-web/src/styles.css with 3 lines removed).

### Step 5.3: Confirm working tree clean (apart from staged + unrelated WIP)

```bash
cd D:/dev/hunter-platform
git status --short | wc -l  # expect ~44 + the deleted files showing as staged
git status --short | head -20  # visually confirm only deletions + 1 styles.css change
```

---

## Task 6: Commit (2 min)

```bash
cd D:/dev/hunter-platform
git add app-web/src/pages/pm-portal \
        app-web/src/pages/candidate-portal \
        app-web/src/pages/hunter-portal \
        app-web/src/components/pm-portal \
        app-web/src/components/candidate-portal \
        app-web/src/components/hunter-portal \
        app-web/src/components/RequirePMAuth.tsx \
        app-web/src/components/RequireHunterAuth.tsx \
        app-web/src/components/RequireAuth.tsx \
        app-web/src/api/pm-portal.ts \
        app-web/src/api/candidate-portal.ts \
        app-web/src/api/hunter-portal.ts \
        app-web/src/lib \
        admin-web/src/styles/pm-portal.css \
        admin-web/src/styles/hunter-portal.css \
        admin-web/src/styles/employer-portal.css \
        admin-web/src/styles.css

git commit -m "cleanup: cut portal redundancy (~15500 lines)

Phase 4.5 moved PM/candidate/hunter portal code from admin-web into
app-web/ on the assumption we would build the PM/HR/Candidate UI
there. Analysis of C:\\Users\\Administrator\\Desktop\\ow-headhunter-sass
reveals ow-recruit already provides a polished 9948-line prototype.html
covering all 9 PM screens (S1-S9) plus hunter/candidate portals.

hunter-platform is API-first; we do not compete with client UIs.

Deletions:
- app-web/src/pages/{pm,candidate,hunter}-portal/ (~5800 lines incl tests)
- app-web/src/components/{pm,candidate,hunter}-portal/ (~3500 lines)
- app-web/src/components/Require{PMAuth,HunterAuth,Auth}.tsx
- app-web/src/api/{pm,candidate,hunter}-portal.ts
- app-web/src/lib/candidate-session.ts (and empty lib/ dir)
- admin-web/src/styles/{pm,hunter,employer}-portal.css (5522 lines, dead
  since Phase 4 portal removal left these as orphan @imports)

app-web retains only the entry skeleton: App.tsx (placeholder), main.tsx,
test-setup.ts. ~70 files deleted, 1 modified (styles.css @import removal).

Backend (src/main/) and shared-web/ untouched. admin-web e2e preserved
(Root innerHTML length: 323)."
```

---

## Task 7: Independent re-verification (5 min)

After commit, re-run Task 5.1 commands in a fresh shell to confirm no caching surprises.

If all checks pass, the work is done. The branch is ready to merge to main and push.

---

## Task 8: Hand off

This sub-plan does NOT include merge-to-main. The user will trigger merge in a separate step (or in this session after explicit approval).

After this sub-plan, the next natural step is **Phase 5 (session token + X-Active-Role + role switcher)**, but that work is for app-web's rebirth as a "minimal reference client" or for direct backend work. NOT in scope here.

---

## Pitfalls / notes

1. **DO NOT add `-A` / `-u` / `.` to `git add`.** The repo has ~44 unrelated WIP files. Use explicit paths only.
2. **DO NOT touch `admin-web/src/pages/**` or `admin-web/src/components/**`.** Only the 3 CSS files and `styles.css` are in scope for admin-web.
3. **DO NOT touch backend.** `src/main/` is the API; we're not removing backend routes.
4. **DO NOT touch `shared-web/`.** It's clean.
5. **`app-web/src/App.tsx` is already a placeholder.** It renders a single `<div>`. Don't replace it.
6. **CSS `@import` order matters in some bundlers.** We only removed 3 lines, kept `tokens.css` as the first import. No order issue.
7. **Tests may go to 0 in app-web.** `--passWithNoTests` is already set (per Phase 4.5); vitest 2.x requires it.
8. **If `grep` in Task 1.2 finds ANY cross-reference**, STOP. That means some code outside the cut list imports the cut files. Investigate before deleting.

---

## Files referenced

- This sub-plan: `D:\dev\hunter-platform\docs\superpowers\plans\2026-07-11-cut-portal-redundancy.md`
- Phase 4.5 plan (the source of these portal files): `D:\dev\hunter-platform\docs\superpowers\plans\2026-07-10-spa-split-phase-4.5.md`
- Phase 4.5 state file: `D:\dev\hunter-platform\docs\superpowers\plans\2026-07-10-five-spa-split-state.md`
- Reference client (the actual PM/HR/Candidate UI implementation): `C:\Users\Administrator\Desktop\ow-headhunter-sass\prototype.html` (9948 lines)