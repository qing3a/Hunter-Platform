# Sub-Plan #4.5: 5-SPA → 2-SPA Pivot (Dismantle 4 Skeletons + Create app-web + Restore Portal Code)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Parent plan:** `docs/superpowers/plans\2026-07-10-five-spa-split.md` (Phase 4.5 — replaces the old Phase 4 + planned Phases 5-8 for SPA migration)
**State file:** `docs\superpowers\plans\2026-07-10-five-spa-split-state.md` (re-read at session start; "MAJOR PIVOT" section explains the why)
**Branch:** `5-spa-split/phase-4.5-pivot-to-2-spa` (create from `main@5bfb1ab`)

**Goal (PIVOT FROM 5-SPA):** Abandon the 4-role-separated SPA design. Replace `pm-web/`, `employer-web/`, `candidate-web/`, `hunter-web/` (all currently empty skeletons from Phase 4) with a single unified `app-web` package that hosts PM + HR + Candidate flows in one SPA. Restore the 3 portal code directories (pm-portal, candidate-portal, hunter-portal) from git history into `app-web/src/`. Per-user insight: **PM = employer** (same role), so `employer-portal/` is dropped as duplicate of `pm-portal/`.

**After this phase:**
- `app-web/` exists with: package.json, vite.config.ts (with SPA-fallback middleware), tsconfig.json, vitest.config.ts, index.html, src/main.tsx, src/App.tsx (placeholder), AND `src/{pages,components,lib}/` populated with restored PM/candidate/hunter code
- `pnpm-workspace.yaml` lists 3 packages: `admin-web`, `app-web`, `shared-web` (down from 6)
- Root `package.json` `dev:web` / `build:web` / `test:web` updated to use 2 SPAs
- `admin-web` regression preserved: tsc exit 0, unit tests pass, e2e 1 passed (Root innerHTML length 323)

**Scope:** ONLY Phase 4.5. Do NOT start Phase 5 (role switcher / session token refactor) — that's a separate sub-plan. The App.tsx here is a placeholder; Phase 5 rewrites it.

---

## Working tree rules

- ~30+ uncommitted files in working tree belong to **other in-progress work** (landing templates, etc.). DO NOT touch.
- When committing, use `git add <exact-path>` for files YOU create/modify in this sub-plan only. NEVER `git add -A` / `-u` / `.`.

**Files you MAY create/modify in this sub-plan:**

Delete:
- `D:\dev\hunter-platform\pm-web\` (whole directory — currently stub)
- `D:\dev\hunter-platform\employer-web\` (whole directory — currently stub; code dropped per "PM = employer" insight)
- `D:\dev\hunter-platform\candidate-web\` (whole directory — currently stub)
- `D:\dev\hunter-platform\hunter-web\` (whole directory — currently stub)

Modify:
- `D:\dev\hunter-platform\pnpm-workspace.yaml` — replace 4 entries with 1 (`'app-web'`)
- `D:\dev\hunter-platform\package.json` — update `dev:web`, `build:web`, `test:web` to use 2 SPAs
- `D:\dev\hunter-platform\pnpm-lock.yaml` (auto-updated by pnpm)
- `D:\dev\hunter-platform\docs\superpowers/plans/2026-07-10-five-spa-split-state.md` (update)

Create:
- `D:\dev\hunter-platform\app-web\package.json`
- `D:\dev\hunter-platform\app-web\vite.config.ts` (with SPA-fallback middleware)
- `D:\dev\hunter-platform\app-web\tsconfig.json`
- `D:\dev\hunter-platform\app-web\vitest.config.ts`
- `D:\dev\hunter-platform\app-web\index.html`
- `D:\dev\hunter-platform\app-web\src\main.tsx`
- `D:\dev\hunter-platform\app-web\src\App.tsx` (placeholder — Phase 5 replaces)
- `D:\dev\hunter-platform\app-web\src\pages\pm-portal\` (restored from git)
- `D:\dev\hunter-platform\app-web\src\pages\candidate-portal\` (restored)
- `D:\dev\hunter-platform\app-web\src\pages\hunter-portal\` (restored)
- `D:\dev\hunter-platform\app-web\src\components\pm-portal\` (restored)
- `D:\dev\hunter-platform\app-web\src\components\candidate-portal\` (restored)
- `D:\dev\hunter-platform\app-web\src\components\hunter-portal\` (restored)
- `D:\dev\hunter-platform\app-web\src\components\RequirePMAuth.tsx` (restored)
- `D:\dev\hunter-platform\app-web\src\components\RequireHunterAuth.tsx` (restored)
- `D:\dev\hunter-platform\app-web\src\components\RequireAuth.tsx` (restored)
- `D:\dev\hunter-platform\app-web\src\lib\candidate-session.ts` (restored)

**Files you MUST NOT touch:**
- `src/main/**` (API server)
- `admin-web/src/**` (DO NOT add portal code back to admin-web — git checkout step 7 lands in admin-web/src/ TEMPORARILY then immediately moves to app-web/src/)
- `shared-web/**` (Phase 3 output — don't re-touch)
- `tests/integration/landing*`, `tests/unit/gather-landing-data.test.ts`
- `src/main/modules/view/**` (other WIP)
- `src/shared/constants.js`, `src/shared/types.js`
- `.gitignore`, `.superpowers/`, `.stylelintrc.json`

---

## Task 4.5.1: Set up branch

- [ ] **Step 1: Verify pre-state**

```bash
cd D:/dev/hunter-platform
git branch --show-current  # should be main
git log --oneline -3
git status --short | wc -l  # expect ~30
```

- [ ] **Step 2: Create feature branch**

```bash
cd D:/dev/hunter-platform
git checkout -b 5-spa-split/phase-4.5-pivot-to-2-spa
```

---

## Task 4.5.2: Delete the 4 stub SPA directories

The 4 directories from Phase 4 contain only config + placeholder code. They were created in commit `5bfb1ab`. Since this is a pivot (reversing Phase 4's split), the cleanest way is to `git rm` the directories (which removes them in git history at the new commit).

- [ ] **Step 1: Verify they're stubs**

```bash
cd D:/dev/hunter-platform
for p in pm-web employer-web candidate-web hunter-web; do
  echo "=== $p/src ==="
  ls $p/src/ 2>/dev/null
done
```

Expected: each `src/` contains only `App.tsx` + `main.tsx` placeholders.

- [ ] **Step 2: git rm the 4 directories**

```bash
cd D:/dev/hunter-platform
git rm -r pm-web/
git rm -r employer-web/
git rm -r candidate-web/
git rm -r hunter-web/
```

Note: each `pm-web/`, `employer-web/`, `candidate-web/`, `hunter-web/` is currently tracked (committed in `5bfb1ab`). `git rm` schedules them for deletion in the new commit.

---

## Task 4.5.3: Update `pnpm-workspace.yaml`

- [ ] **Step 1: Read current**

```bash
cd D:/dev/hunter-platform
cat pnpm-workspace.yaml
```

- [ ] **Step 2: Rewrite to list 3 packages**

`D:\dev\hunter-platform\pnpm-workspace.yaml`:
```yaml
packages:
  - 'admin-web'
  - 'app-web'
  - 'shared-web'
```

---

## Task 4.5.4: Update root `package.json` orchestration scripts

- [ ] **Step 1: Read current `dev:web`, `build:web`, `test:web`**

```bash
cd D:/dev/hunter-platform
grep -E '"(dev:web|build:web|test:web)"' package.json
```

- [ ] **Step 2: Replace with 2-SPA versions**

The new scripts use 2 filters (`@hunter-platform/admin-web` and `@hunter-platform/app-web`) instead of 5. Use `Edit` to replace the 3 lines:

**Old (one of these patterns, depending on prior state):**
```json
"build:web": "pnpm -r --filter \"./admin-web\" --filter \"./pm-web\" --filter \"./employer-web\" --filter \"./candidate-web\" --filter \"./hunter-web\" run build",
"dev:web": "concurrently -n admin,pm,employer,candidate,hunter -c blue,magenta,green,cyan,yellow \"pnpm --filter @hunter-platform/admin-web dev\" \"pnpm --filter @hunter-platform/pm-web dev\" \"pnpm --filter @hunter-platform/employer-web dev\" \"pnpm --filter @hunter-platform/candidate-web dev\" \"pnpm --filter @hunter-platform/hunter-web dev\"",
"test:web": "pnpm -r --filter \"./admin-web\" --filter \"./pm-web\" --filter \"./employer-web\" --filter \"./candidate-web\" --filter \"./hunter-web\" --filter \"./shared-web\" run test"
```

**New:**
```json
"build:web": "pnpm --filter @hunter-platform/admin-web run build && pnpm --filter @hunter-platform/app-web run build",
"dev:web": "concurrently -n admin,app -c blue,green \"pnpm --filter @hunter-platform/admin-web dev\" \"pnpm --filter @hunter-platform/app-web dev\"",
"test:web": "pnpm --filter @hunter-platform/admin-web run test && pnpm --filter @hunter-platform/app-web run test && pnpm --filter @hunter-platform/shared-web run test"
```

The `&&` is intentional — fail-fast if one SPA breaks.

---

## Task 4.5.5: Create `app-web/` skeleton

- [ ] **Step 1: Create `app-web/package.json`**

`D:\dev\hunter-platform\app-web\package.json`:
```json
{
  "name": "@hunter-platform/app-web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run --passWithNoTests",
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

Note: `--passWithNoTests` because vitest 2.x exits 1 on empty test sets. The actual tests come with the restored code in Tasks 4.5.7-4.5.8 (most of which already have test files in `__tests__/` subdirs).

- [ ] **Step 2: Create `app-web/vite.config.ts`**

`D:\dev\hunter-platform\app-web\vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    {
      // SPA fallback: rewrite role paths to / for client-side routing.
      // Without this, dev-server visiting /pm/login 404s.
      name: 'app-spa-fallback',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (
            req.url &&
            req.headers.accept?.includes('text/html') &&
            /^\/(p|h|c|pm|hr|candidate|hunter|app|login|workspace|home|browse|profile|settings)(\/|$|\?)/.test(req.url)
          ) {
            req.url = '/';
          }
          next();
        });
      },
    },
  ],
  base: '/',
  build: {
    outDir: path.resolve(__dirname, '../out/app'),
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

- [ ] **Step 3: Create `app-web/tsconfig.json`**

`D:\dev\hunter-platform\app-web\tsconfig.json`:
```json
{
  "extends": "../admin-web/tsconfig.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Create `app-web/vitest.config.ts`**

`D:\dev\hunter-platform\app-web\vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 5: Create `app-web/index.html`**

`D:\dev\hunter-platform\app-web\index.html`:
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Ow Recruit</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `app-web/src/main.tsx`**

`D:\dev\hunter-platform\app-web\src\main.tsx`:
```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import '@hunter-platform/shared-web/styles';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

const rootEl = document.getElementById('root')!;
createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
```

- [ ] **Step 7: Create `app-web/src/App.tsx` (placeholder — Phase 5 will rewrite)**

`D:\dev\hunter-platform\app-web\src\App.tsx`:
```typescript
// app-web — PM + HR + candidate unified SPA
//
// Phase 4.5 delivers the skeleton + restored portal code (pages/, components/, lib/).
// Phase 5 will rewrite this file to add the role switcher and gate UI by activeRole
// (per ow-recruit's `window.OW_RELAY.activeRole` model in prototype.html line 8384-8660).
//
// For now, this placeholder just renders a div so the SPA mounts and the Playwright
// regression test can verify the bundle.
export default function App() {
  return <div>app-web skeleton — Phase 5 adds role switcher + session token auth</div>;
}
```

- [ ] **Step 8: Create the `src/` subdirs**

```bash
cd D:/dev/hunter-platform
mkdir -p app-web/src/{pages,components,lib,hooks,api}
```

---

## Task 4.5.6: Run `pnpm install` to wire up the new workspace

- [ ] **Step 1: Install**

```bash
cd D:/dev/hunter-platform
pnpm install
```

Expected: exit 0. The 4 deleted SPAs (`pm-web`, etc.) are removed from the workspace; `app-web` is now a member.

- [ ] **Step 2: Verify workspace**

```bash
cd D:/dev/hunter-platform
pnpm -r list --depth -1 2>&1 | grep -E "hunter-platform" | head -10
```

Expected: 3 workspace members: `@hunter-platform/admin-web`, `@hunter-platform/app-web`, `@hunter-platform/shared-web`.

- [ ] **Step 3: Verify app-web typechecks (with placeholder src)**

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/app-web run typecheck
```

Expected: exit 0.

---

## Task 4.5.7: Restore the 3 portal code directories from git

The Phase 4 commit (`5bfb1ab`) deleted `pm-portal/`, `candidate-portal/`, `hunter-portal/`, and their components + `Require*Auth.tsx` + `lib/candidate-session.ts`. The 5-SPA-plan-phase-0-1 branch (pre-Phase-4) still has them.

- [ ] **Step 1: Verify the source branch has the code**

```bash
cd D:/dev/hunter-platform
git ls-tree --name-only 5-spa-split/phase-0-1 admin-web/src/pages/ 2>&1 | head -10
```

Expected: shows `pm-portal/`, `candidate-portal/`, `hunter-portal/`, `employer-portal/` (4 dirs).

- [ ] **Step 2: Restore the 3 portal code dirs into admin-web/src/ (TEMPORARY — we'll move to app-web/src/ in Step 3)**

```bash
cd D:/dev/hunter-platform
git checkout 5-spa-split/phase-0-1 -- \
  admin-web/src/pages/pm-portal \
  admin-web/src/pages/candidate-portal \
  admin-web/src/pages/hunter-portal \
  admin-web/src/components/pm-portal \
  admin-web/src/components/candidate-portal \
  admin-web/src/components/hunter-portal \
  admin-web/src/components/RequirePMAuth.tsx \
  admin-web/src/components/RequireHunterAuth.tsx \
  admin-web/src/components/RequireAuth.tsx \
  admin-web/src/lib/candidate-session.ts
```

This **temporarily** puts the files back in `admin-web/src/`. **Step 3 moves them to `app-web/src/`.**

- [ ] **Step 3: git mv from admin-web/src/ to app-web/src/**

```bash
cd D:/dev\hunter-platform
mkdir -p app-web/src/pages app-web/src/components app-web/src/lib
git mv admin-web/src/pages/pm-portal              app-web/src/pages/pm-portal
git mv admin-web/src/pages/candidate-portal       app-web/src/pages/candidate-portal
git mv admin-web/src/pages/hunter-portal          app-web/src/pages/hunter-portal
git mv admin-web/src/components/pm-portal         app-web/src/components/pm-portal
git mv admin-web/src/components/candidate-portal  app-web/src/components/candidate-portal
git mv admin-web/src/components/hunter-portal     app-web/src/components/hunter-portal
git mv admin-web/src/components/RequirePMAuth.tsx     app-web/src/components/RequirePMAuth.tsx
git mv admin-web/src/components/RequireHunterAuth.tsx app-web/src/components/RequireHunterAuth.tsx
git mv admin-web/src/components/RequireAuth.tsx        app-web/src/components/RequireAuth.tsx
git mv admin-web/src/lib/candidate-session.ts         app-web/src/lib/candidate-session.ts
```

- [ ] **Step 4: Verify admin-web is back to its slimmed state**

```bash
cd D:/dev/hunter-platform
ls admin-web/src/pages/
ls admin-web/src/components/
ls admin-web/src/lib/
```

Expected:
- `admin-web/src/pages/` — only admin pages (LoginPage, DashboardPage, etc.), NO `*-portal/` subdirs
- `admin-web/src/components/` — `PrivateRoute.tsx`, `Toast.tsx`, admin-only components; NO `Require*Auth.tsx`, NO `*-portal/` subdirs
- `admin-web/src/lib/` — `auth.ts` only

---

## Task 4.5.8: Update import paths in moved files

The moved files were originally in `admin-web/src/{pages,components,lib}/<portal>/...`. They may have relative imports like:
- `import { X } from '../lib/auth'` (admin-web specific — now needs `@hunter-platform/shared-web` or `../../lib/...`)
- `import { Y } from '../../components/Toast'` (cross-cutting — should now use shared-web)
- `import { Z } from './SomeLocal'` (intra-file — unchanged)

- [ ] **Step 1: Run typecheck to see what breaks**

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/app-web run typecheck 2>&1 | head -40
```

Expected: many errors about unresolved imports. **These are the ones to fix.** Don't fix any that aren't from the moved files.

- [ ] **Step 2: For each error, fix the import path**

Common fixes:
- `'../lib/auth'` → check if `auth.ts` is now in `app-web/src/lib/`. If so: `'../lib/auth'`. If not: remove the import.
- `'../../lib/format'`, `'../../lib/mask'`, `'../../lib/toast'` → these moved to `shared-web` in Phase 3 → `'@hunter-platform/shared-web/lib'`
- `'../../components/Toast'` → check where `Toast` lives. If it's in `app-web/src/components/`, use relative path; if removed, replace with shared-web equivalent.
- `'../lib/candidate-session'` → already moved to `app-web/src/lib/` in Task 4.5.7 Step 3. Relative path is unchanged.

Use `Edit` to fix each file. Be methodical — fix one file at a time, typecheck after.

- [ ] **Step 3: Re-run typecheck**

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/app-web run typecheck
```

Expected: exit 0. If errors persist, iterate.

- [ ] **Step 4: If you can't fix in 2 iterations, STOP and report BLOCKED**

The most common error will be a reference to a file that doesn't exist anymore (e.g., a removed admin-web helper). If you can't find a sensible replacement, list the errors in the report.

---

## Task 4.5.9: Run the app-web test suite

The moved code likely has its own `__tests__/` subdirs (from the pre-Phase-4 state).

- [ ] **Step 1: Run tests**

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/app-web run test 2>&1 | tail -15
```

Expected: a mix of pass + fail. Some tests may fail because of the import changes from Task 4.5.8. If a test fails for an obvious reason (bad path, etc.), fix it. If it fails for a structural reason (e.g., a test mocks a now-removed module), report it.

- [ ] **Step 2: If test count is wildly off (>20% delta from expected), STOP and report**

The expected count is roughly: pre-Phase-4 had ~1070 admin-web tests; 853 were portal tests. So expect ~600-800 app-web tests.

---

## Task 4.5.10: Verify admin-web regression is preserved

- [ ] **Step 1: Typecheck**

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/admin-web exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 2: Unit tests**

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/admin-web run test 2>&1 | tail -5
```

Expected: 217 passed + 1 skipped (matches Phase 4 baseline).

- [ ] **Step 3: e2e**

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/admin-web run test:e2e
```

Expected: 1 passed, `Root innerHTML length: 323`.

---

## Task 4.5.11: Build app-web + verify it actually serves

- [ ] **Step 1: Build**

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/app-web run build 2>&1 | tail -5
```

Expected: exit 0. `out/app/` should be created with `index.html` + assets.

- [ ] **Step 2: Verify `out/app/index.html` exists**

```bash
cd D:/dev/hunter-platform
ls out/app/index.html
head -10 out/app/index.html
```

Expected: file exists, has the title and the root div.

---

## Task 4.5.12: Update state file

- [ ] **Step 1: Edit** `docs\superpowers\plans\2026-07-10-five-spa-split-state.md`

- Add Phase 4.5 row: status = ✅ done, branch = `5-spa-split/phase-4.5-pivot-to-2-spa`, last commit = `<hash>`, verified = yes
- Update the "Conventions" section to reflect 2-SPA: `app-web` (port 5175, base `/`) replaces the 4 SPAs
- Add a Session 7 log entry (this is the pivot session)

---

## Task 4.5.13: Commit

- [ ] **Step 1: Stage ONLY the files this sub-plan created/modified**

```bash
cd D:/dev/hunter-platform
# Deleted 4 SPAs (git rm already staged these)
# Workspace config
git add pnpm-workspace.yaml
git add package.json
# Lockfile
git add pnpm-lock.yaml
# New app-web
git add app-web/package.json
git add app-web/vite.config.ts
git add app-web/tsconfig.json
git add app-web/vitest.config.ts
git add app-web/index.html
git add app-web/src/main.tsx
git add app-web/src/App.tsx
# Restored code (in their NEW locations under app-web/src/)
git add app-web/src/pages/pm-portal/
git add app-web/src/pages/candidate-portal/
git add app-web/src/pages/hunter-portal/
git add app-web/src/components/pm-portal/
git add app-web/src/components/candidate-portal/
git add app-web/src/components/hunter-portal/
git add app-web/src/components/RequirePMAuth.tsx
git add app-web/src/components/RequireHunterAuth.tsx
git add app-web/src/components/RequireAuth.tsx
git add app-web/src/lib/candidate-session.ts
# Modified files (import paths within moved code)
# These are auto-detected by git status if you use git add on directories above
# But if a moved file had ONLY an import path change, you need to add it explicitly:
# git add app-web/src/pages/pm-portal/SpecificFile.tsx
# (or just git add the whole subdirs — git will pick up all changes)
# State file
git add docs/superpowers/plans/2026-07-10-five-spa-split-state.md
```

- [ ] **Step 2: Verify with diff**

```bash
cd D:/dev/hunter-platform
git diff --cached --stat | tail -30
```

Expected: lots of D entries (4 SPA dirs), A entries (app-web files), R entries (renames from admin-web/src/... to app-web/src/...), M entries (package.json, pnpm-workspace.yaml, state file). NO landing-template files.

If anything unexpected is staged, `git restore --staged <path>` to unstage.

- [ ] **Step 3: Commit**

```bash
cd D:/dev/hunter-platform
git commit -m "refactor(workspaces): 5-SPA → 2-SPA pivot; create app-web (PM+HR+candidate unified)

Major architectural pivot per Session 7: a single user holds
pm + hr + candidate roles simultaneously (per ow-recruit
multi-role model). Splitting into 5 SPAs was based on the
wrong one-user-one-role assumption.

This commit:
- Deletes pm-web/, employer-web/, candidate-web/, hunter-web/
  (all empty skeletons from Phase 4)
- Creates app-web/ with full config + restored portal code
  from 5-spa-split/phase-0-1 branch (pm-portal, candidate-portal,
  hunter-portal; employer-portal dropped as duplicate per
  'PM = employer' insight)
- pnpm-workspace.yaml: 6 packages → 3 (admin-web, app-web, shared-web)
- Root package.json: dev:web / build:web / test:web use 2 SPAs
  instead of 5
- app-web vite config has SPA-fallback middleware so dev visits
  to /pm/*, /hr/*, /candidate/* etc. rewrite to / and serve
  index.html (for client-side routing)

Phase 5 will rewrite app-web/src/App.tsx to add the role
switcher and gate UI by activeRole (per ow-recruit's
window.OW_RELAY.activeRole model).

admin-web regression preserved: tsc exit 0, 217 unit + 1 skipped,
e2e 1 passed (Root innerHTML length: 323)."
```

- [ ] **Step 4: Push branch**

```bash
cd D:/dev/hunter-platform
git push -u origin 5-spa-split/phase-4.5-pivot-to-2-spa
```

If push fails (no remote), skip.

---

## Escalation rules

Report `BLOCKED` if:
- `pnpm install` fails after the workspace change
- typecheck on app-web can't be fixed in 2 iterations (some imports unresolvable)
- A moved file references a now-removed module that has no replacement
- The test count is wildly off (>20% delta from expected ~600-800)
- The git mv / git checkout dance leaves admin-web in a broken state

Report `DONE_WITH_CONCERNS` if:
- The app-web test count is significantly different from the expected ~600-800 (note actual)
- The import path fixes required more than just rewriting to shared-web (note what)
- The SPA-fallback middleware had to be expanded (note which paths)

Otherwise report `DONE`.

---

## Report format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- **Deletions:** 4 SPA dirs removed (list them)
- **app-web skeleton:** files created (list)
- **Restored code:** files moved from admin-web/src/ to app-web/src/ (count)
- **Import path fixes:** what categories of paths needed changing
- **Verification:** app-web typecheck/test/build exit; admin-web tsc/unit/e2e results
- **Commits created:** hash + first line
- **Files changed (only yours):** full list with line counts
- **Anything unexpected**

The state file update is the canonical record of Phase 4.5 completion. Make it accurate.
