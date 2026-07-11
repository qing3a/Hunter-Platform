# Sub-Plan #1: Phase 0 (Playwright Diagnostic) + Phase 1 (Delete Static HTML)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Parent plan:** `docs/superpowers/plans/2026-07-10-five-spa-split.md` (Phases 0 and 1)
**State file:** `docs/superpowers/plans/2026-07-10-five-spa-split-state.md` (re-read at session start)

**Branch:** Work on `5-spa-split/phase-0-1` (create from main).

**Scope:** ONLY Phase 0 and Phase 1 from the top-level plan. Do NOT touch any other phase. Do NOT touch any uncommitted files in the working tree that are unrelated (landing templates, etc.).

---

## Working tree rules (CRITICAL)

Before doing anything:

1. Run `git status --short` in `D:\dev\hunter-platform`.
2. Confirm there are uncommitted files. They are NOT yours. List them but do not add/commit them.
3. Create a feature branch: `git checkout -b 5-spa-split/phase-0-1`
4. The uncommitted files will follow the branch. Leave them alone.
5. When committing, use `git add <exact-path>` for the files YOU created/modified in THIS plan.
6. NEVER `git add -A`, `git add .`, or `git add -u`.

**Files you MAY create/modify in this sub-plan:**
- `D:\dev\hunter-platform\admin-web\package.json` (add Playwright dep)
- `D:\dev\hunter-platform\admin-web\pnpm-lock.yaml` (auto-updated by pnpm)
- `D:\dev\hunter-platform\admin-web\playwright.config.ts` (new)
- `D:\dev\hunter-platform\admin-web\tests\__tests__\` — DO NOT add new files here; they need jsdom setup
- `D:\dev\hunter-platform\admin-web\tests\e2e\admin-login.spec.ts` (new directory and file)
- `D:\dev\hunter-platform\README.md` (only if `grep -n "hunter-platform-landing" README.md` returns a hit; then delete those lines)

**Files you MUST delete:**
- `D:\dev\hunter-platform\hunter-platform-landing\` (whole directory)
- `D:\dev\hunter-platform\hunter-platform-landing-draft\` (whole directory)

**Files you MUST NOT touch** (other people's WIP):
- `src/main/modules/view/**` (landing template work in progress)
- `src/shared/constants.js`, `src/shared/types.js` (untracked, not yours)
- `.gitignore`, root `package.json`, root `pnpm-lock.yaml`
- All `tests/integration/landing*` and `tests/unit/gather-landing-data.test.ts`
- `docs/superpowers/plans/2026-07-09-pm-ui-visual-fidelity.md`
- `docs/superpowers/specs/2026-07-01-product-positioning-standard.md`
- `.superpowers/`, `.stylelintrc.json`

---

## Phase 0 Tasks

### Task 0.1: Install Playwright + chromium

**Files:** `admin-web/package.json`, `admin-web/pnpm-lock.yaml` (auto)

- [ ] **Step 1: Verify working tree state before starting**

```bash
cd D:/dev/hunter-platform
git status --short | head -50
git rev-parse --abbrev-ref HEAD  # confirm main or feature branch
```

Expected: List of uncommitted files shown (these are other people's WIP), branch is `main`.

- [ ] **Step 2: Create and switch to feature branch**

```bash
cd D:/dev/hunter-platform
git checkout -b 5-spa-split/phase-0-1
```

Expected: `Switched to a new branch '5-spa-split/phase-0-1'`. Working tree changes come along (uncommitted, dirty).

- [ ] **Step 3: Install Playwright as devDep**

```bash
cd D:/dev/hunter-platform/admin-web
pnpm add -D @playwright/test
```

Expected: exit 0, `pnpm` adds `@playwright/test` to devDependencies in `admin-web/package.json`. `pnpm-lock.yaml` is updated.

- [ ] **Step 4: Install chromium browser**

```bash
cd D:/dev/hunter-platform/admin-web
npx playwright install chromium
```

Expected: exit 0, downloads ~100MB chromium binary. **Note:** if `--with-deps` is needed on Linux, use it; on Windows this is typically not required.

If the install fails with a permission/architecture error, report BLOCKED with the exact error.

### Task 0.2: Write playwright.config.ts

**Files:** `admin-web/playwright.config.ts` (new)

- [ ] **Step 1: Create the file**

`admin-web/playwright.config.ts`:
```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    headless: true,
  },
  webServer: {
    command: 'pnpm dev',
    port: 5174,
    timeout: 60_000,
    reuseExistingServer: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd D:/dev/hunter-platform/admin-web
npx tsc --noEmit
```

Expected: exit 0. (Playwright types should be picked up automatically because it's now in devDependencies.)

### Task 0.3: Add `test:e2e` script to admin-web/package.json

**Files:** `admin-web/package.json`

- [ ] **Step 1: Read current scripts section**

```bash
cd D:/dev/hunter-platform/admin-web
cat package.json
```

- [ ] **Step 2: Add `test:e2e` script**

Edit the `scripts` block in `admin-web/package.json` to add:
```json
"test:e2e": "playwright test"
```

Keep all other scripts intact. **Do not change other fields.**

### Task 0.4: Write the diagnostic test

**Files:** `admin-web/tests/e2e/admin-login.spec.ts` (new)

- [ ] **Step 1: Create directory and file**

`admin-web/tests/e2e/admin-login.spec.ts`:
```typescript
// admin-web/tests/e2e/admin-login.spec.ts
//
// Phase 0: Reproduce "blank /admin/login" report from 2026-07-10.
// Curl showed the dev server returns 200 with correct HTML — this test
// runs a real headless browser to surface console errors and network
// failures, plus assert the React tree actually renders content.
import { test, expect } from '@playwright/test';

test.describe('/admin/login (Phase 0 diagnostic)', () => {
  test('returns 200 with no console errors and non-empty root', async ({ page }) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    const networkErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('requestfailed', (req) => {
      failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? 'unknown'}`);
    });
    page.on('response', (resp) => {
      if (resp.status() >= 400) {
        networkErrors.push(`${resp.status()} ${resp.url()}`);
      }
    });

    const response = await page.goto('/admin/login', { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);

    // The script tag must be present
    const scriptSrc = await page.locator('script[src*="main.tsx"]').getAttribute('src');
    expect(scriptSrc).toMatch(/\/admin\/src\/main\.tsx/);

    // Give React time to mount (StrictMode double-render takes a tick)
    await page.waitForSelector('#root *', { timeout: 5000 }).catch(() => {});
    const rootHtml = (await page.locator('#root').innerHTML()).trim();

    // Diagnostic output — do NOT fail on these yet, just record them
    console.log('=== Phase 0 diagnostic output ===');
    console.log('Console errors:', consoleErrors);
    console.log('Failed requests:', failedRequests);
    console.log('Network 4xx/5xx:', networkErrors);
    console.log('Root innerHTML length:', rootHtml.length);
    console.log('Root innerHTML preview:', rootHtml.slice(0, 200));
    console.log('=== end diagnostic ===');

    // Hard asserts (these are the regression we'll keep):
    expect(networkErrors.filter((e) => e.includes('/admin/src/'))).toEqual([]);
    expect(failedRequests).toEqual([]);
    expect(rootHtml.length).toBeGreaterThan(50);
  });
});
```

### Task 0.5: Run the diagnostic

- [ ] **Step 1: Make sure no dev server is running on 5174**

```bash
# On Windows, check if anything listens on 5174. If yes, kill it.
# The diagnostic test will start its own dev server via webServer config.
```

- [ ] **Step 2: Run Playwright**

```bash
cd D:/dev/hunter-platform/admin-web
pnpm test:e2e
```

Expected: Test runs (may take 30-60s for first run, including browser start and dev server warmup). Look for these lines in the output:

```
Console errors: [...]
Failed requests: [...]
Network 4xx/5xx: [...]
Root innerHTML length: <number>
Root innerHTML preview: <text>
```

**Record the `Root innerHTML length` value.** This is the **key diagnostic finding**.

Interpretation:
- `length > 50`: React rendered content. The user's "blank page" was likely browser cache. Report as **DONE_WITH_CONCERNS** with the finding.
- `length < 50`: React did not render. Real bug. Report as **DONE_WITH_CONCERNS** with the finding (will need Phase 2+ to address).

- [ ] **Step 3: Save the diagnostic output**

Create `D:\dev\hunter-platform\docs\superpowers\plans\2026-07-10-phase-0-diagnostic-result.md` with:
- Date and time
- Playwright version
- `Root innerHTML length` value
- `Root innerHTML preview` (first 200 chars)
- Full list of `Console errors` (if any)
- Full list of `Failed requests` (if any)
- Full list of `Network 4xx/5xx` (if any)
- Interpretation: blank-due-to-cache / blank-due-to-real-bug

### Task 0.6: Commit Phase 0

- [ ] **Step 1: Stage ONLY the files this task created**

```bash
cd D:/dev/hunter-platform
git add admin-web/package.json
git add admin-web/pnpm-lock.yaml
git add admin-web/playwright.config.ts
git add admin-web/tests/e2e/admin-login.spec.ts
git add docs/superpowers/plans/2026-07-10-phase-0-diagnostic-result.md
```

**Do NOT use `git add -A` or `git add .`.**

- [ ] **Step 2: Verify staged files**

```bash
cd D:/dev/hunter-platform
git status --short
git diff --cached --stat
```

Expected: ONLY the 5 files above are staged. The ~30 unrelated working tree changes should still be untracked (??) or modified (M) but NOT staged.

If anything else shows up in `git diff --cached --stat`, unstage it with `git restore --staged <path>` and re-check.

- [ ] **Step 3: Commit**

```bash
cd D:/dev/hunter-platform
git commit -m "test(e2e): add Phase 0 Playwright diagnostic for /admin/login

Installs @playwright/test, adds headless test that captures
console errors, network failures, and asserts React renders
content into #root. Diagnostic runs against existing dev
server on 5174.

Diagnostic result: <paste length value> chars rendered.
<one-line interpretation>"
```

---

## Phase 1 Tasks

### Task 1.1: Verify 0 references to landing dirs in source

- [ ] **Step 1: Run grep**

```bash
cd D:/dev/hunter-platform
grep -r "hunter-platform-landing" \
  --include="*.ts" --include="*.tsx" --include="*.json" \
  --include="*.mjs" --include="*.js" --include="*.html" \
  --include="*.css" --include="*.md" 2>/dev/null
```

Expected: matches ONLY in the two `hunter-platform-landing*/orchestration-summary.json` files (which will be deleted with their parent directories).

**STOP HERE if any other file is matched** and report NEEDS_CONTEXT. The user must decide whether that file's reference can be removed.

### Task 1.2: Delete the two static HTML directories

- [ ] **Step 1: Delete**

```bash
cd D:/dev/hunter-platform
rm -rf hunter-platform-landing/
rm -rf hunter-platform-landing-draft/
```

- [ ] **Step 2: Verify**

```bash
cd D:/dev/hunter-platform
ls -d hunter-platform-landing hunter-platform-landing-draft 2>&1
```

Expected:
```
ls: cannot access 'hunter-platform-landing': No such file or directory
ls: cannot access 'hunter-platform-landing-draft': No such file or directory
```

### Task 1.3: Update README (only if needed)

- [ ] **Step 1: Check for references**

```bash
cd D:/dev/hunter-platform
grep -n "hunter-platform-landing" README.md
```

If empty: skip to Task 1.4.

If non-empty: **carefully review each match**. The plan says to delete the lines. Show what you will delete in your report and use `Edit` to remove them.

**Do not rewrite the rest of README.md.** Only touch the specific lines that match.

### Task 1.4: Commit Phase 1

- [ ] **Step 1: Stage ONLY deletion + README change**

```bash
cd D:/dev/hunter-platform
# Add the deletions
git add -u hunter-platform-landing hunter-platform-landing-draft
# Or use:
git add hunter-platform-landing hunter-platform-landing-draft
# If README was edited:
git add README.md
```

Verify:
```bash
git status --short
git diff --cached --stat
```

Expected: ONLY deletions of the two directories + (optional) README.md changes. **No other files staged.**

- [ ] **Step 2: Commit**

```bash
cd D:/dev/hunter-platform
git commit -m "chore: remove offline static landing HTML drafts

hunter-platform-landing/ and hunter-platform-landing-draft/
were untracked static HTML artifacts with 0 source-code
references and no server mount. Server-side landing template
(src/main/modules/view/templates/landing/) is the single
source of truth for the public landing page."
```

---

## Final tasks

### Task F.1: Update state file

- [ ] **Step 1: Edit `docs/superpowers/plans/2026-07-10-five-spa-split-state.md`**

Update the "Phase progress" table:
- Phase 0 row: status = ✅ done, branch = `5-spa-split/phase-0-1`, last commit = `<paste commit hash>`, verified = `<paste diagnostic length>`
- Phase 1 row: status = ✅ done, branch = `5-spa-split/phase-0-1`, last commit = `<paste commit hash>`, verified = yes (deletion + grep returned 0)

Add a Session log entry for THIS session.

- [ ] **Step 2: Commit the state file update**

```bash
cd D:/dev/hunter-platform
git add docs/superpowers/plans/2026-07-10-five-spa-split-state.md
git commit -m "docs(plan): mark Phase 0 + Phase 1 complete in session state"
```

### Task F.2: Push branch (optional, do NOT auto-merge)

```bash
cd D:/dev/hunter-platform
git log --oneline -5
git push -u origin 5-spa-split/phase-0-1  # Only if remote exists
```

If push fails because no remote: skip. The user will handle remote push.

---

## Report format

When done, report:

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- **Phase 0 diagnostic result:** the `Root innerHTML length` value and one-line interpretation
- **Phase 1 deletion result:** directories removed, 0 references confirmed
- **Commits created:** list of commit hashes + messages
- **Files changed (only those you touched):** full list
- **Working tree state at end:** `git status --short` output (expect ~30 unrelated M/?? files still present, untouched)
- **Anything unexpected:** yes/no, details

Use DONE_WITH_CONCERNS if the diagnostic shows a real bug (length < 50). Use BLOCKED if the Playwright install or test setup fails. Use NEEDS_CONTEXT if README references require judgment. Otherwise DONE.
