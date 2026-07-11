# Sub-Plan #2: pnpm Workspaces Initialization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Parent plan:** `docs/superpowers/plans/2026-07-10-five-spa-split.md` (Phase 2)
**State file:** `docs/superpowers/plans/2026-07-10-five-spa-split-state.md` (re-read at session start)
**Branch:** `5-spa-split/phase-2-workspaces` (create from `main@8f90d53`)

**Goal:** Initialize pnpm workspaces so the monorepo can host 5 SPAs + 1 shared package. After Phase 2, `pnpm install` must succeed and the existing `admin-web/` must continue to work as a workspace member.

**Scope:** ONLY Phase 2. Do NOT start shared-web extraction (Phase 3) or any SPA migration (Phase 4-8). The 4 new SPAs and `shared-web` get **stub** package.json only — no real code yet.

---

## Working tree rules

- ~30 uncommitted files in working tree belong to **other in-progress work** (landing templates, etc.). DO NOT touch.
- When committing, use `git add <exact-path>` for files YOU create/modify in this sub-plan only. NEVER `git add -A` / `-u` / `.`.

**Files you MAY create/modify in this sub-plan:**
- `D:\dev\hunter-platform\pnpm-workspace.yaml` (new)
- `D:\dev\hunter-platform\package.json` (modify only the `workspaces` and `scripts` blocks; do NOT change other fields)
- `D:\dev\hunter-platform\pnpm-lock.yaml` (auto-updated by pnpm)
- `D:\dev\hunter-platform\shared-web\package.json` (new — stub)
- `D:\dev\hunter-platform\pm-web\package.json` (new — stub)
- `D:\dev\hunter-platform\employer-web\package.json` (new — stub)
- `D:\dev\hunter-platform\candidate-web\package.json` (new — stub)
- `D:\dev\hunter-platform\hunter-web\package.json` (new — stub)
- `D:\dev\hunter-platform\docs\superpowers\plans\2026-07-10-five-spa-split-state.md` (update)

**Files you MUST NOT touch:**
- `src/main/**` (API server)
- `admin-web/src/**` (existing SPA code)
- `tests/integration/landing*`, `tests/unit/gather-landing-data.test.ts`
- `src/main/modules/view/**` (other WIP)
- `src/shared/constants.js`, `src/shared/types.js`
- `.gitignore`, `.superpowers/`, `.stylelintrc.json`

---

## Task 2.1: Set up branch + verify pre-state

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
git checkout -b 5-spa-split/phase-2-workspaces
```

---

## Task 2.2: Create `pnpm-workspace.yaml`

- [ ] **Step 1: Create the workspace declaration file**

`D:\dev\hunter-platform\pnpm-workspace.yaml`:
```yaml
packages:
  - 'admin-web'
  - 'pm-web'
  - 'employer-web'
  - 'candidate-web'
  - 'hunter-web'
  - 'shared-web'
```

- [ ] **Step 2: Verify the file**

```bash
cd D:/dev/hunter-platform
cat pnpm-workspace.yaml
```

---

## Task 2.3: Update root `package.json`

Read the current root `package.json` carefully. Add a `workspaces` field and a few root-level orchestration scripts. **Do NOT touch the existing `dependencies`/`devDependencies`/`scripts` (other than adding new ones).**

- [ ] **Step 1: Add `workspaces` field**

If `package.json` does NOT have a top-level `workspaces` field, add it. If it already has one, **append to it** (do not replace). The result should look like:

```json
{
  "workspaces": [
    "admin-web",
    "pm-web",
    "employer-web",
    "candidate-web",
    "hunter-web",
    "shared-web"
  ]
}
```

Use the `Read` tool on `package.json` first to see the current state, then `Edit` to add the field.

- [ ] **Step 2: Add root-level orchestration scripts**

In the `scripts` block, add these new scripts (alongside existing ones — do NOT remove anything):

```json
{
  "build:web": "pnpm -r --filter \"./admin-web\" --filter \"./pm-web\" --filter \"./employer-web\" --filter \"./candidate-web\" --filter \"./hunter-web\" run build",
  "test:web": "pnpm -r --filter \"./admin-web\" --filter \"./pm-web\" --filter \"./employer-web\" --filter \"./candidate-web\" --filter \"./hunter-web\" --filter \"./shared-web\" run test"
}
```

For `dev:web`, we use `concurrently` (added in Task 2.4). Add this script too (it will work once concurrently is installed):

```json
{
  "dev:web": "concurrently -n admin,pm,employer,candidate,hunter -c blue,magenta,green,cyan,yellow \"pnpm --filter admin-web dev\" \"pnpm --filter pm-web dev\" \"pnpm --filter employer-web dev\" \"pnpm --filter candidate-web dev\" \"pnpm --filter hunter-web dev\""
}
```

---

## Task 2.4: Add `concurrently` to root devDeps

- [ ] **Step 1: Install concurrently at the workspace root**

```bash
cd D:/dev/hunter-platform
pnpm add -D -w concurrently
```

`-w` ensures it's added to the workspace root, not to any individual package. **Do not** add it to any sub-package.

- [ ] **Step 2: Verify**

```bash
cd D:/dev/hunter-platform
grep -A 2 "devDependencies" package.json | head -10
```

Expected: `concurrently` is listed in root devDependencies.

---

## Task 2.5: Create stub `package.json` for the 5 new packages

The 4 SPA packages (`pm-web`, `employer-web`, `candidate-web`, `hunter-web`) and `shared-web` don't have real code yet, but they MUST exist as workspace members so `pnpm install` doesn't fail.

For each of these 5 packages, create a `package.json` with this exact content (substitute the actual name):

```json
{
  "name": "<PACKAGE_NAME>",
  "version": "0.0.0",
  "private": true,
  "type": "module"
}
```

Where `<PACKAGE_NAME>` is one of:
- `@hunter-platform/shared-web`
- `@hunter-platform/pm-web`
- `@hunter-platform/employer-web`
- `@hunter-platform/candidate-web`
- `@hunter-platform/hunter-web`

- [ ] **Step 1: Create each stub**

```bash
cd D:/dev/hunter-platform
mkdir -p shared-web pm-web employer-web candidate-web hunter-web
```

For each of the 5 packages, create `<package>/package.json` with the content above.

- [ ] **Step 2: Verify all 5 exist**

```bash
cd D:/dev/hunter-platform
ls -d shared-web pm-web employer-web candidate-web hunter-web
for p in shared-web pm-web employer-web candidate-web hunter-web; do
  echo "=== $p ==="
  cat "$p/package.json"
done
```

---

## Task 2.6: Run `pnpm install` and verify workspace recognition

- [ ] **Step 1: Install**

```bash
cd D:/dev/hunter-platform
pnpm install
```

Expected: exit 0. The output should list 6 workspace members.

- [ ] **Step 2: Verify workspace members are recognized**

```bash
cd D:/dev/hunter-platform
pnpm -r list --depth -1 2>&1 | head -20
```

Expected: All 6 packages appear as workspace members. If any error says "package not found", stop and report BLOCKED.

- [ ] **Step 3: Verify filter syntax works**

```bash
cd D:/dev/hunter-platform
pnpm --filter admin-web run test:e2e 2>&1 | tail -5
```

Expected: `admin-web`'s Playwright e2e test runs (or fails the same way as before, but the filter resolved).

If this fails, the workspace is not correctly set up. STOP and report BLOCKED with the error.

---

## Task 2.7: Verify existing admin-web still works

- [ ] **Step 1: Typecheck**

```bash
cd D:/dev/hunter-platform
pnpm --filter admin-web exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 2: Run the Phase 1.5 Playwright test (regression check)**

```bash
cd D:/dev/hunter-platform
pnpm --filter admin-web run test:e2e
```

Expected: 1 passed, `Root innerHTML length: 323`.

- [ ] **Step 3: Run unit tests**

```bash
cd D:/dev/hunter-platform
pnpm --filter admin-web run test 2>&1 | tail -5
```

Expected: 1070 passed + 1 skipped.

If any of these fail, STOP and report BLOCKED. The workspace setup broke something.

---

## Task 2.8: Update state file

- [ ] **Step 1: Edit** `docs/superpowers/plans/2026-07-10-five-spa-split-state.md`

- Update the "Phase progress" table:
  - Phase 1.5 row: status = ✅ done, branch = main (merged)
  - Phase 2 row: status = ✅ done, branch = `5-spa-split/phase-2-workspaces`, last commit = `<paste commit hash>`, verified = yes (pnpm install 0 + admin-web regression 0)
- Add a Session log entry for this session.

---

## Task 2.9: Commit

- [ ] **Step 1: Stage ONLY the files this sub-plan created/modified**

```bash
cd D:/dev/hunter-platform
git add pnpm-workspace.yaml
git add package.json
git add pnpm-lock.yaml
git add shared-web/package.json
git add pm-web/package.json
git add employer-web/package.json
git add candidate-web/package.json
git add hunter-web/package.json
git add docs/superpowers/plans/2026-07-10-five-spa-split-state.md
```

- [ ] **Step 2: Verify staged files**

```bash
cd D:/dev/hunter-platform
git diff --cached --stat
```

Expected: ONLY the files listed above are staged. ~30 unrelated M/?? files should NOT appear in the staged set.

If anything else is staged, `git restore --staged <path>` to unstage and re-check.

- [ ] **Step 3: Commit**

```bash
cd D:/dev/hunter-platform
git commit -m "build: initialize pnpm workspaces for 5-SPA split

- pnpm-workspace.yaml declares 6 packages: admin-web, pm-web,
  employer-web, candidate-web, hunter-web, shared-web
- Root package.json adds workspaces field and orchestration
  scripts (build:web, dev:web, test:web)
- Add concurrently to root devDeps for dev:web
- Create stub package.json for 5 packages that don't yet
  exist as code, so pnpm install succeeds

The existing admin-web is the first workspace member and
continues to pass its Phase 1.5 Playwright regression test
(rootHtml.length = 323) and 1070 unit tests."
```

---

## Task 2.10: (Optional) Push branch

```bash
cd D:/dev/hunter-platform
git push -u origin 5-spa-split/phase-2-workspaces
```

If push fails because no remote, skip.

---

## Escalation rules

Report `BLOCKED` if:
- `pnpm install` fails
- `pnpm --filter admin-web` doesn't resolve admin-web
- The Phase 1.5 Playwright test or unit tests break after workspace setup
- The 4 new stub package.json files fail to be created for any reason

Report `DONE_WITH_CONCERNS` if:
- The 5 stub packages can be created but pnpm install produces warnings (note them)
- Anything unexpected about the existing `package.json` structure (e.g., conflicting `workspaces` field)

Otherwise report `DONE`.

---

## Report format

When done, report:
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- **`pnpm install` result:** exit code, any warnings
- **`pnpm -r list` output:** the 6 workspace members shown
- **admin-web regression check:** tsc exit, e2e test result, unit test count
- **Commits created:** hash + first line
- **Files changed (only yours):** full list
- **Anything unexpected**

The state file update is the canonical record of Phase 2 completion. Make it accurate.
