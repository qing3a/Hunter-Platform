# Sub-Plan #4: admin-web Slim + 4 New SPA Skeletons

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Parent plan:** `docs/superpowers/plans\2026-07-10-five-spa-split.md` (Phase 4)
**State file:** `docs\superpowers\plans\2026-07-10-five-spa-split-state.md` (re-read at session start)
**Branch:** `5-spa-split/phase-4-admin-slim` (create from `main@03dce89`)

**Goal:** Two changes:
1. **Slim admin-web** — remove PM/employer/candidate/hunter route groups from `App.tsx` and delete the corresponding files from `admin-web/src/{pages,components}/`. admin-web now serves only `/admin/*` for the admin role.
2. **Scaffold 4 new SPAs** — create `pm-web/`, `employer-web/`, `candidate-web/`, `hunter-web/` with full config (package.json, vite.config.ts, tsconfig.json, vitest.config.ts, index.html) and minimal entry points (main.tsx + App.tsx) that build cleanly but render placeholders.

**Scope:** ONLY Phase 4. Do NOT move real code from admin-web into the new SPAs (that's Phase 5-8). The 4 new SPAs get **skeletons only** — the deleted admin-web files are also deleted, not stashed. Phase 5-8 will re-create them in their target SPAs by `git revert` + new git mv.

---

## Working tree rules

- ~30 uncommitted files in working tree belong to **other in-progress work** (landing templates, etc.). DO NOT touch.
- When committing, use `git add <exact-path>` for files YOU create/modify in this sub-plan only. NEVER `git add -A` / `-u` / `.`.

**Files you MAY create/modify in this sub-plan:**

Delete from `admin-web/`:
- `admin-web/src/App.tsx` (modify — keep admin routes only)
- `admin-web/src/main.tsx` (modify — remove deleted imports)
- `admin-web/src/pages/candidate-portal/` (whole subdir)
- `admin-web/src/pages/hunter-portal/` (whole subdir)
- `admin-web/src/pages/pm-portal/` (whole subdir)
- `admin-web/src/pages/employer-portal/` (whole subdir)
- `admin-web/src/components/candidate-portal/` (whole subdir)
- `admin-web/src/components/hunter-portal/` (whole subdir)
- `admin-web/src/components/pm-portal/` (whole subdir)
- `admin-web/src/components/employer-portal/` (whole subdir)
- `admin-web/src/components/RequireAuth.tsx` (if it was candidate-portal-specific)
- `admin-web/src/components/RequireHunterAuth.tsx`
- `admin-web/src/components/RequirePMAuth.tsx`
- `admin-web/src/components/RequireEmployerAuth.tsx`
- `admin-web/src/lib/candidate-session.ts` (used only by candidate-portal)

Create in new SPA dirs (one each):
- `pm-web/{package.json, vite.config.ts, tsconfig.json, vitest.config.ts, index.html, src/main.tsx, src/App.tsx}`
- `employer-web/{package.json, vite.config.ts, tsconfig.json, vitest.config.ts, index.html, src/main.tsx, src/App.tsx}`
- `candidate-web/{package.json, vite.config.ts, tsconfig.json, vitest.config.ts, index.html, src/main.tsx, src/App.tsx}`
- `hunter-web/{package.json, vite.config.ts, tsconfig.json, vitest.config.ts, index.html, src/main.tsx, src/App.tsx}`

Update:
- `admin-web/package.json` (no script changes needed; typecheck is inherited)
- `pnpm-lock.yaml` (auto-updated by pnpm install)
- `docs/superpowers/plans/2026-07-10-five-spa-split-state.md`

**Files you MUST NOT touch:**
- `src/main/**` (API server)
- `shared-web/**` (Phase 3 output — don't re-touch)
- `tests/integration/landing*`, `tests/unit/gather-landing-data.test.ts`
- `src/main/modules/view/**` (other WIP)
- `src/shared/constants.js`, `src/shared/types.js`
- `.gitignore`, `.superpowers/`, `.stylelintrc.json`
- `pnpm-workspace.yaml` (already correct from Phase 2)

---

## Task 4.1: Inventory what's in admin-web that should be deleted

- [ ] **Step 1: List portal-specific dirs**

```bash
cd D:/dev/hunter-platform
ls admin-web/src/pages/
ls admin-web/src/components/
```

- [ ] **Step 2: Identify what to delete**

Mark for deletion:
- `admin-web/src/pages/{candidate,hunter,pm,employer}-portal/` — 4 subdirs
- `admin-web/src/components/{candidate,hunter,pm,employer}-portal/` — 4 subdirs
- `admin-web/src/components/Require{Auth,HunterAuth,PMAuth,EmployerAuth}.tsx` — 4 files (only if they are portal-specific; check the file headers)
- `admin-web/src/lib/candidate-session.ts` — only if it's candidate-portal-specific

KEEP:
- `admin-web/src/pages/*` (the non-portal pages: DashboardPage, UsersPage, etc.)
- `admin-web/src/components/PrivateRoute.tsx` (used by admin)
- `admin-web/src/components/Toast.tsx` (used by admin)
- `admin-web/src/lib/auth.ts` (admin-specific, used by admin)
- `admin-web/src/lib/format.ts`, `mask.ts`, `toast.tsx` — already moved to shared-web in Phase 3; should not exist here anymore

---

## Task 4.2: Set up branch

- [ ] **Step 1: Verify pre-state**

```bash
cd D:/dev/hunter-platform
git branch --show-current  # should be main
git log --oneline -3
```

- [ ] **Step 2: Create feature branch**

```bash
cd D:/dev/hunter-platform
git checkout -b 5-spa-split/phase-4-admin-slim
```

---

## Task 4.3: Slim admin-web's App.tsx

- [ ] **Step 1: Read current App.tsx**

```bash
cd D:/dev/hunter-platform
wc -l admin-web/src/App.tsx
head -5 admin-web/src/App.tsx
```

- [ ] **Step 2: Rewrite App.tsx**

`admin-web/src/App.tsx` after Phase 4 should:
- Import ONLY admin-related stuff: `LoginPage`, `DashboardPage`, `UsersPage`, `CandidatesPage`, `JobsPage`, `RecommendationsPage`, `AuditPage`, `UserTimelinePage`, `CandidateTimelinePage`, `JobTimelinePage`, `RecommendationTimelinePage`, `UserDetailPage`, `JobDetailPage`, `CandidateDetailPage`, `RecommendationDetailPage`, `WebhookDeadLetterPage`, `PlacementsPage`, `SettingsPage`, `ProfilePage`, `PrivateRoute`
- Keep the existing `AdminApp` (the relative-path version after Phase 1.5) — DO NOT change its internal routes
- Remove all PM, employer, candidate, hunter imports
- Remove all PM, employer, candidate, hunter route definitions
- The outer `<Routes>` should only have admin routes now (and the catch-all `<Route path="*" element={<Navigate to="/admin" replace />} />`)

The result will be much shorter than the current file (probably ~70 lines instead of ~210). Use `Read` first to see the current state, then `Write` to replace.

---

## Task 4.4: Delete portal-specific files from admin-web

Use `git rm` to remove files (preserves deletion in git history):

- [ ] **Step 1: Remove the 4 page subdirs**

```bash
cd D:/dev/hunter-platform
git rm -r admin-web/src/pages/candidate-portal/
git rm -r admin-web/src/pages/hunter-portal/
git rm -r admin-web/src/pages/pm-portal/
git rm -r admin-web/src/pages/employer-portal/
```

- [ ] **Step 2: Remove the 4 component subdirs**

```bash
cd D:/dev/hunter-platform
git rm -r admin-web/src/components/candidate-portal/
git rm -r admin-web/src/components/hunter-portal/
git rm -r admin-web/src/components/pm-portal/
git rm -r admin-web/src/components/employer-portal/
```

- [ ] **Step 3: Remove the 4 Require*Auth components (if they were portal-specific)**

Read each first to confirm scope:
```bash
head -10 admin-web/src/components/RequireAuth.tsx
head -10 admin-web/src/components/RequireHunterAuth.tsx
head -10 admin-web/src/components/RequirePMAuth.tsx
head -10 admin-web/src/components/RequireEmployerAuth.tsx
```

If each file's docstring or imports confirm it's portal-specific, delete:
```bash
cd D:/dev/hunter-platform
git rm admin-web/src/components/RequireAuth.tsx
git rm admin-web/src/components/RequireHunterAuth.tsx
git rm admin-web/src/components/RequirePMAuth.tsx
git rm admin-web/src/components/RequireEmployerAuth.tsx
```

- [ ] **Step 4: Remove candidate-session.ts (if portal-specific)**

```bash
cd D:/dev/hunter-platform
git rm admin-web/src/lib/candidate-session.ts
```

If it was also used by admin code (unlikely after Phase 4 slim), STOP and report BLOCKED.

- [ ] **Step 5: Verify what remains in admin-web/src**

```bash
cd D:/dev/hunter-platform
ls admin-web/src/pages/
ls admin-web/src/components/
ls admin-web/src/lib/
```

Expected:
- `pages/` has only admin pages: `DashboardPage`, `UsersPage`, `CandidatesPage`, `JobsPage`, `RecommendationsPage`, `AuditPage`, `UserTimelinePage`, `CandidateTimelinePage`, `JobTimelinePage`, `RecommendationTimelinePage`, `UserDetailPage`, `JobDetailPage`, `CandidateDetailPage`, `RecommendationDetailPage`, `WebhookDeadLetterPage`, `PlacementsPage`, `SettingsPage`, `ProfilePage`, `LoginPage`
- `components/` has: `PrivateRoute.tsx`, `Toast.tsx`, plus any others that are admin-specific (audit, timeline, etc.)
- `lib/` has: `auth.ts` only (format/mask/toast are now in shared-web)

---

## Task 4.5: Verify admin-web still typechecks and tests pass

After deletion, admin-web's tests may reference deleted files. There are two outcomes:

- [ ] **Step 1: Typecheck**

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/admin-web exec tsc --noEmit 2>&1 | head -30
```

If errors are ONLY about deleted imports: fix them by removing the imports from the test files (or the test files themselves if all tests in a file are dead).

If errors are about surviving code: STOP and report BLOCKED.

- [ ] **Step 2: Run unit tests**

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/admin-web run test 2>&1 | tail -10
```

Expected: count drops from 1070 to roughly 600 (because the deleted portal code had its own tests). ALL remaining tests should pass.

If many tests fail: STOP and report BLOCKED with the error.

- [ ] **Step 3: Run e2e regression**

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/admin-web run test:e2e
```

Expected: 1 passed (the `/admin/login` test still works).

---

## Task 4.6: Scaffold pm-web

- [ ] **Step 1: Create package.json**

`D:\dev\hunter-platform\pm-web\package.json`:
```json
{
  "name": "@hunter-platform/pm-web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@hunter-platform/shared-web": "workspace:*",
    "@tanstack/react-query": "^5.101.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.2",
    "vite": "^5.4.6",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create vite.config.ts**

`D:\dev\hunter-platform\pm-web\vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: '/admin/pm',
  build: {
    outDir: path.resolve(__dirname, '../out/pm'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5175,
    proxy: {
      '/v1': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 3: Create tsconfig.json + vitest.config.ts**

`D:\dev\hunter-platform\pm-web\tsconfig.json`:
```json
{
  "extends": "../admin-web/tsconfig.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

`D:\dev\hunter-platform\pm-web\vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
  },
});
```

- [ ] **Step 4: Create index.html**

`D:\dev\hunter-platform\pm-web\index.html`:
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PM Workbench</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create placeholder main.tsx + App.tsx**

`D:\dev\hunter-platform\pm-web\src\main.tsx`:
```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

const rootEl = document.getElementById('root')!;
createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
```

`D:\dev\hunter-platform\pm-web\src\App.tsx`:
```typescript
// PM Workbench — Phase 5 will populate this with real routes.
export default function App() {
  return <div>PM Workbench (skeleton — Phase 5)</div>;
}
```

### Task 4.7: Scaffold employer-web, candidate-web, hunter-web (same pattern)

Repeat Task 4.6 with appropriate substitutions:

| SPA | base | port | App placeholder |
|---|---|---|---|
| `employer-web` | `/admin/employer` | 5176 | `Employer Panel (skeleton — Phase 6)` |
| `candidate-web` | `/candidate` | 5177 | `Candidate Portal (skeleton — Phase 7)` |
| `hunter-web` | `/hunter` | 5178 | `Hunter Portal (skeleton — Phase 8)` |

Build output dirs:
- `out/employer` (for employer-web)
- `out/candidate` (for candidate-web)
- `out/hunter` (for hunter-web)

---

## Task 4.8: Reinstall + verify all 5 SPAs work

- [ ] **Step 1: pnpm install**

```bash
cd D:/dev/hunter-platform
pnpm install
```

Expected: exit 0. All 6 workspace members now have real deps.

- [ ] **Step 2: Typecheck each new SPA**

```bash
cd D:/dev/hunter-platform
for pkg in pm-web employer-web candidate-web hunter-web; do
  echo "=== $pkg ==="
  pnpm --filter "@hunter-platform/$pkg" run typecheck 2>&1 | tail -3
done
```

Expected: all 4 exit 0.

- [ ] **Step 3: Test each new SPA**

```bash
cd D:/dev/hunter-platform
for pkg in pm-web employer-web candidate-web hunter-web; do
  echo "=== $pkg ==="
  pnpm --filter "@hunter-platform/$pkg" run test 2>&1 | tail -3
done
```

Expected: all 4 exit 0 (no tests yet, but should pass with `--passWithNoTests` flag if added; otherwise vitest exits 1 and you need to add the flag — see concern #1 from Phase 3).

If vitest exits 1 on no-tests, edit each `package.json` to add `--passWithNoTests` to the test script, then re-run.

- [ ] **Step 4: Build each new SPA**

```bash
cd D:/dev/hunter-platform
for pkg in pm-web employer-web candidate-web hunter-web; do
  echo "=== building $pkg ==="
  pnpm --filter "@hunter-platform/$pkg" run build 2>&1 | tail -3
done
```

Expected: all 4 build successfully. Verify:
```bash
cd D:/dev/hunter-platform
ls -d out/{pm,employer,candidate,hunter} 2>&1
```

Expected: 4 dirs exist.

- [ ] **Step 5: Final admin-web regression**

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/admin-web run test:e2e
```

Expected: 1 passed, `Root innerHTML length: 323` (unchanged from Phase 1.5).

---

## Task 4.9: Update state file

- [ ] **Step 1: Edit** `docs\superpowers\plans\2026-07-10-five-spa-split-state.md`

- Update Phase 4 row: status = ✅ done, branch = `5-spa-split/phase-4-admin-slim`, last commit = `<hash>`, verified = yes
- Note the 4 new SPAs as "skeleton only — code lands in Phase 5-8"
- Add a Session log entry

---

## Task 4.10: Commit

Use ONE commit for the whole phase (admin-web slim + 4 SPA skeletons) so it's easy to review.

- [ ] **Step 1: Stage**

```bash
cd D:/dev/hunter-platform
# admin-web changes
git add admin-web/src/App.tsx
git add admin-web/src/main.tsx
# Deleted portal files (git rm already added them to the index, so git add is just to be safe)
git add -u admin-web/src/
# New SPA files
git add pm-web/
git add employer-web/
git add candidate-web/
git add hunter-web/
# Root changes
git add pnpm-lock.yaml
git add docs/superpowers/plans/2026-07-10-five-spa-split-state.md
```

`git add -u admin-web/src/` only stages DELETIONS and MODIFICATIONS (not new files). Combined with the new SPA `git add` calls, this should cover everything.

- [ ] **Step 2: Verify**

```bash
cd D:/dev/hunter-platform
git diff --cached --stat | tail -30
```

Expected:
- D entries for deleted portal files (~50+ files)
- A entries for new SPA config + entry files (~24 files: 6 per SPA × 4)
- M entry for admin-web/src/App.tsx + main.tsx
- M entry for pnpm-lock.yaml + state file
- NO landing template files

If anything unexpected is staged, `git restore --staged <path>` to unstage.

- [ ] **Step 3: Commit**

```bash
cd D:/dev/hunter-platform
git commit -m "refactor(admin-web): slim to admin-only; scaffold pm/employer/candidate/hunter SPA skeletons

admin-web changes:
- App.tsx: removed PM/employer/candidate/hunter route groups;
  keeps admin-only Routes
- src/main.tsx: removed portal-only imports
- git rm -r of pages/{pm,candidate,hunter,employer}-portal/
- git rm -r of components/{pm,candidate,hunter,employer}-portal/
- git rm of Require*Auth portal-specific components
- git rm of lib/candidate-session.ts (candidate-portal-only)

New SPA skeletons (4 packages, no real code yet):
- pm-web: base /admin/pm, port 5175
- employer-web: base /admin/employer, port 5176
- candidate-web: base /candidate, port 5177
- hunter-web: base /hunter, port 5178

Each scaffold: package.json, vite.config.ts, tsconfig.json,
vitest.config.ts, index.html, src/main.tsx, src/App.tsx
(placeholder div). All 4 typecheck, test, and build cleanly.

admin-web regression preserved: tsc exit 0, unit tests
<new count> passed (drops from 1070 due to deleted portal
test files), e2e 1 passed (Root innerHTML length: 323)."
```

---

## Escalation rules

Report `BLOCKED` if:
- admin-web App.tsx rewrite is ambiguous (you can't tell which imports are admin vs portal)
- pnpm install fails after the new SPA deps
- Any of the 4 new SPAs fails to typecheck / test / build
- A non-portal file in admin-web depends on a deleted portal file

Report `DONE_WITH_CONCERNS` if:
- You had to add `--passWithNoTests` to any of the 4 new SPAs' test scripts
- admin-web unit test count dropped more than expected (note the actual count)
- You had to modify a non-portal admin-web file beyond App.tsx/main.tsx

Otherwise report `DONE`.

---

## Report format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- **admin-web slim:** files deleted (count), files kept (count)
- **4 new SPAs:** each one's typecheck/test/build exit code
- **admin-web regression:** tsc exit, unit test count, e2e result
- **Commits created:** hash + first line
- **Files changed (only yours):** full list with line counts (the diff stat)
- **Anything unexpected**

The state file is the canonical record. Make it accurate.
