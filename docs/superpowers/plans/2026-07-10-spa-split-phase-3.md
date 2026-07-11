# Sub-Plan #3: shared-web Package — Config Scaffold + Code Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Parent plan:** `docs/superpowers/plans/2026-07-10-five-spa-split.md` (Phase 3)
**State file:** `docs/superpowers\plans\2026-07-10-five-spa-split-state.md` (re-read at session start)
**Branch:** `5-spa-split/phase-3-shared-web` (create from `main@030b1d1`)

**Goal:** Add tsconfig + vitest config to the `shared-web/` stub from Phase 2, then migrate shared code (API client, ToastProvider, query client factory, utilities) from `admin-web/src/` to `shared-web/src/`. After Phase 3, `admin-web` imports shared code via `@hunter-platform/shared-web` and still passes its 1070 unit tests + 1 e2e regression.

**Scope:** ONLY Phase 3. Do NOT start admin-web route slimming (Phase 4) or any SPA migration (Phase 5-8).

**Two-part structure** (per user decision 2026-07-10):
- **Part A: Config scaffold** (Tasks 3.1-3.4) — add tsconfig, vitest config, barrel index, deps
- **Part B: Code migration** (Tasks 3.5-3.10) — move files + update imports

---

## Working tree rules

- ~30 uncommitted files in working tree belong to **other in-progress work** (landing templates, etc.). DO NOT touch.
- When committing, use `git add <exact-path>` for files YOU create/modify in this sub-plan only. NEVER `git add -A` / `-u` / `.`.

**Files you MAY create/modify in this sub-plan:**
- `D:\dev\hunter-platform\shared-web\**` (whole subdirectory — your work area)
- `D:\dev\hunter-platform\admin-web\package.json` (add `@hunter-platform/shared-web: workspace:*` to dependencies)
- `D:\dev\hunter-platform\admin-web\pnpm-lock.yaml` (auto-updated by pnpm)
- `D:\dev\hunter-platform\admin-web\src\**` (modify import paths; delete files you migrated)
- `D:\dev\hunter-platform\admin-web\vite.config.ts` (only if needed for shared CSS import)
- `D:\dev\hunter-platform\admin-web\tests\__tests__\**` (only if you must adjust tests for moved code)
- `D:\dev\hunter-platform\docs\superpowers\plans\2026-07-10-five-spa-split-state.md` (update)

**Files you MUST NOT touch:**
- `src/main/**` (API server)
- `pm-web/**`, `employer-web/**`, `candidate-web/**`, `hunter-web/**` (stubs only — no real code yet)
- `tests/integration/landing*`, `tests/unit/gather-landing-data.test.ts`
- `src/main/modules/view/**` (other WIP)
- `src/shared/constants.js`, `src/shared/types.js`
- `.gitignore`, `.superpowers/`, `.stylelintrc.json`
- `pnpm-workspace.yaml` (already correct from Phase 2)

---

## PART A: Config scaffold

### Task 3.1: Create tsconfig.json

`D:\dev\hunter-platform\shared-web\tsconfig.json`:
```json
{
  "extends": "../admin-web/tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src/**/*"]
}
```

The `noEmit: true` is because Vite handles transpilation; tsc is only used for typechecking. `jsx: "react-jsx"` is needed because some shared code (ToastProvider) is React JSX.

If the extended `admin-web/tsconfig.json` has settings that break the shared package (e.g., `noEmit` conflicts, missing DOM lib), read it first and adjust. Common needed addition:
```json
"lib": ["DOM", "DOM.Iterable", "ES2022"]
```

### Task 3.2: Create vitest.config.ts

`D:\dev\hunter-platform\shared-web\vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: [],
    globals: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

If the shared code has NO React components (e.g., if ToastProvider stays in admin-web for now), drop `@vitejs/plugin-react` and just use the base config.

### Task 3.3: Update shared-web/package.json

- [ ] **Step 1: Read current state**

```bash
cd D:/dev/hunter-platform
cat shared-web/package.json
```

- [ ] **Step 2: Add deps, scripts, exports**

Edit `shared-web/package.json` to:
- Keep `name: "@hunter-platform/shared-web"`, `version: "0.0.0"`, `private: true`, `type: "module"`
- Add `main: "./src/index.ts"` and `exports` map
- Add scripts: `test`, `test:watch`, `typecheck`
- Add deps: React 18, TanStack Query 5 (whatever admin-web uses — copy versions from `admin-web/package.json`)
- Add devDeps: typescript, vitest, jsdom, @vitejs/plugin-react, @types/react

Use this template (substitute actual versions from admin-web's package.json):

```json
{
  "name": "@hunter-platform/shared-web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./api": "./src/api/index.ts",
    "./lib": "./src/lib/index.ts",
    "./styles": "./src/styles/shared.css"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.101.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.2",
    "vitest": "^2.1.0"
  }
}
```

### Task 3.4: Create empty barrel index

`D:\dev\hunter-platform\shared-web\src\index.ts`:
```typescript
// Placeholder; populated as code is migrated in Part B.
export {};
```

Create the directory:
```bash
cd D:/dev/hunter-platform
mkdir -p shared-web/src/{api,lib,styles}
```

### Task 3.5: Install + verify Part A

- [ ] **Step 1: Run pnpm install**

```bash
cd D:/dev/hunter-platform
pnpm install
```

Expected: exit 0. `shared-web` is now a proper workspace member with deps installed.

- [ ] **Step 2: Verify typecheck**

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/shared-web run typecheck
```

Expected: exit 0 (empty src, no errors).

- [ ] **Step 3: Verify vitest runs (no tests yet, but should not error)**

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/shared-web run test
```

Expected: exit 0, "No test files found" or similar (NOT an error).

If any of these fail, STOP and report BLOCKED with the error.

### Task 3.6: Commit Part A

- [ ] **Step 1: Stage**

```bash
cd D:/dev/hunter-platform
git add shared-web/tsconfig.json
git add shared-web/vitest.config.ts
git add shared-web/package.json
git add shared-web/src/index.ts
git add pnpm-lock.yaml
```

- [ ] **Step 2: Commit**

```bash
cd D:/dev/hunter-platform
git commit -m "build(shared-web): scaffold config (tsconfig + vitest + exports)

Add the foundational config files for @hunter-platform/shared-web:
- tsconfig.json extends admin-web's, noEmit for typecheck-only
- vitest.config.ts with jsdom for any future React component tests
- package.json with main/exports, scripts (test/typecheck), and
  React + TanStack Query deps matching admin-web's versions
- empty src/index.ts as a placeholder barrel

pnpm install resolves the new package; typecheck and test both
succeed with no errors (no source yet)."
```

---

## PART B: Code migration

### Task 3.7: Inventory admin-web's sharable code

Before moving anything, list what's actually in `admin-web/src/` that's safe to share.

- [ ] **Step 1: Inventory**

```bash
cd D:/dev/hunter-platform
ls admin-web/src/api/ 2>/dev/null || echo "no api dir"
ls admin-web/src/lib/ 2>/dev/null || echo "no lib dir"
ls admin-web/src/hooks/ 2>/dev/null || echo "no hooks dir"
```

- [ ] **Step 2: Classify each file as SHARABLE or NOT SHARABLE**

For each .ts/.tsx file in `api/`, `lib/`, `hooks/`:

**SHARABLE** (move to shared-web):
- Pure API client functions (no React component, no useEffect)
- QueryClient factory (`createQueryClient` or similar)
- ToastProvider / useToast if it's a pure utility (or if it doesn't depend on React Router)
- Type-only files (interfaces, type aliases)
- Pure utility functions (mask PII, format dates, etc.)

**NOT SHARABLE** (keep in admin-web for now):
- Files importing from `react-router-dom`
- Files importing from `../pages/*` or `../components/*` (admin-specific)
- Files with hardcoded paths to `/v1/admin/*` (admin-specific endpoints)
- Files with admin-specific auth (localStorage admin token)

Document your classification in the commit message and the state file.

### Task 3.8: Move SHARABLE files to shared-web

For each SHARABLE file:
- Use `git mv` (preserves history)
- Update internal relative imports to match new location
- If the file had `import x from './y'` and both x and y move, the relative import is unchanged
- If only x moves, the import becomes `'../admin-web/src/y'` — fix it

Examples:
```bash
cd D:/dev/hunter-platform
# If admin-web/src/api/users.ts is sharable:
mkdir -p shared-web/src/api
git mv admin-web/src/api/users.ts shared-web/src/api/users.ts

# If admin-web/src/lib/toast.tsx is sharable:
mkdir -p shared-web/src/lib
git mv admin-web/src/lib/toast.tsx shared-web/src/lib/toast.tsx
```

After moves, create barrel `index.ts` files:
- `shared-web/src/api/index.ts` exporting everything from `api/*.ts`
- `shared-web/src/lib/index.ts` exporting everything from `lib/*.{ts,tsx}`

### Task 3.9: Update admin-web imports

- [ ] **Step 1: Find all import sites in admin-web that reference moved files**

```bash
cd D:/dev/hunter-platform
grep -rln "from '\.\./api\b\|from '\./api\b\|from '\.\./lib/toast\|from '\./lib/toast" admin-web/src/ 2>/dev/null
```

- [ ] **Step 2: Rewrite each import to point at shared-web**

Example rewrites:
- `import { api } from '../api'` → `import { api } from '@hunter-platform/shared-web/api'`
- `import { ToastProvider } from './lib/toast'` → `import { ToastProvider } from '@hunter-platform/shared-web/lib'`
- `import { queryClient } from '../lib/query-client'` → `import { queryClient } from '@hunter-platform/shared-web/lib'`

Use `Edit` on each file. Be careful to preserve exact symbols.

- [ ] **Step 3: Add shared-web as admin-web dependency**

Edit `admin-web/package.json` `dependencies` block to add:
```json
"@hunter-platform/shared-web": "workspace:*"
```

- [ ] **Step 4: Run pnpm install to wire up the workspace dep**

```bash
cd D:/dev/hunter-platform
pnpm install
```

Expected: exit 0. The shared-web dep is now in admin-web's node_modules symlink.

### Task 3.10: Verify nothing broke

- [ ] **Step 1: Typecheck admin-web**

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/admin-web run typecheck
```

Expected: exit 0.

- [ ] **Step 2: Run admin-web unit tests**

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/admin-web run test 2>&1 | tail -10
```

Expected: 1070 passed + 1 skipped (same as Phase 1.5 baseline; minor variance OK).

- [ ] **Step 3: Run admin-web e2e**

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/admin-web run test:e2e
```

Expected: 1 passed, `Root innerHTML length: 323`.

- [ ] **Step 4: Run shared-web tests (if any migrated tests)**

```bash
cd D:/dev/hunter-platform
pnpm --filter @hunter-platform/shared-web run test
```

Expected: exit 0. If you migrated test files, they should pass.

If any of these fail:
1. Re-read the error
2. Check if the import path was wrong
3. Check if a relative path inside the moved file was not updated
4. If stuck after 2 attempts, STOP and report BLOCKED with the error

### Task 3.11: Commit Part B

- [ ] **Step 1: Stage ONLY the files this sub-plan created/modified**

```bash
cd D:/dev/hunter-platform
# Moved files (use git add for both old and new paths if git mv wasn't used)
# (git mv should have handled this, but double-check)
git status --short

# Add moved files (in their new locations):
git add shared-web/src/
# Add the empty barrel if created:
git add shared-web/src/api/index.ts shared-web/src/lib/index.ts
# Add modified admin-web imports:
git add admin-web/src/
# Add admin-web's package.json (new shared-web dep):
git add admin-web/package.json
# Add lockfile:
git add pnpm-lock.yaml
# Add state file:
git add docs/superpowers/plans/2026-07-10-five-spa-split-state.md
```

- [ ] **Step 2: Verify with diff**

```bash
cd D:/dev/hunter-platform
git diff --cached --stat | tail -30
```

Expected: only files under `shared-web/`, `admin-web/src/`, `admin-web/package.json`, `pnpm-lock.yaml`, state file. NO landing templates, NO other unrelated files.

- [ ] **Step 3: Commit**

```bash
cd D:/dev/hunter-platform
git commit -m "refactor(shared-web): migrate API client + lib utilities from admin-web

Moves <list of moved files> from admin-web/src/{api,lib,hooks} to
shared-web/src/{api,lib,hooks}. admin-web now imports these via
@hunter-platform/shared-web (added as workspace:* dep).

Shared components:
- <list>

admin-web regression: typecheck exit 0, unit 1070 passed + 1
skipped, e2e 1 passed (Root innerHTML length = 323)."
```

---

## Task 3.12: Update state file

- [ ] **Step 1: Edit** `docs/superpowers/plans/2026-07-10-five-spa-split-state.md`

- Update Phase 3 row: status = ✅ done, branch = `5-spa-split/phase-3-shared-web`, last commit = `<hash>`, verified = yes
- Add a Session log entry covering both Part A and Part B

---

## Escalation rules

Report `BLOCKED` if:
- `pnpm install` fails after Part A
- `tsc --noEmit` in shared-web fails on the empty src (config issue, not code)
- A sharable file is impossible to extract due to circular dependencies with admin-web-specific code
- admin-web's tests break (1070→<1070) and the cause can't be found in 2 attempts

Report `DONE_WITH_CONCERNS` if:
- You kept an "ambiguous" file in admin-web instead of moving it (note which and why)
- You modified admin-web source files beyond import path changes (note why)
- A test had to be moved too (note which test and why)

Otherwise report `DONE`.

---

## Report format

When done, report:
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- **Part A:** pnpm install exit, typecheck exit, test exit
- **Part B:** list of files moved, files kept in admin-web (and why), files modified
- **Verification:** admin-web tsc exit, unit test count, e2e result
- **Commits created:** hashes + first lines
- **Files changed (only yours):** full list
- **Anything unexpected**

The state file is the canonical record of Phase 3 completion. Make it accurate.
