# Sub-Plan #1.5: React-Mount Bug Investigation + Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Parent plan:** `docs/superpowers/plans/2026-07-10-five-spa-split.md` (Phase 1.5)
**State file:** `docs/superpowers/plans/2026-07-10-five-spa-split-state.md` (re-read at session start)
**Diagnostic evidence:** `docs/superpowers/plans/2026-07-10-phase-0-diagnostic-result.md`
**Branch:** `5-spa-split/phase-1.5` (create from `main@5e7abbf`)

**Goal:** Investigate and fix the real React-mount bug surfaced by Phase 0's Playwright diagnostic. The Phase 0 test currently FAILS on `expect(rootHtml.length).toBeGreaterThan(50)` — the fix must make it PASS.

---

## The bug (re-stated from Phase 0)

`GET /admin/login` against the dev server (vite on :5174):
- HTTP 200 ✓
- HTML body contains `<script type="module" src="/admin/src/main.tsx">` ✓
- Browser loads the script with **zero console errors**, **zero failed requests**, **zero 4xx/5xx** ✓
- Yet `#root` is **empty** (innerHTML length = 0) after `networkidle` + 5s wait ✗

This is reproducible in a clean headless chromium via `pnpm test:e2e` from `admin-web/`. It is **not** a cache issue. The bug is in the React mount/render path.

---

## Working tree rules

- ~30 uncommitted files in working tree belong to **other in-progress work** (landing templates, etc.). DO NOT touch.
- When committing, use `git add <exact-path>` for files YOU modify in this sub-plan only. NEVER `git add -A` / `-u` / `.`.
- Files you MAY create/modify in this sub-plan:
  - `D:\dev\hunter-platform\admin-web\src\**` (any file under admin-web/src) — this is your work area
  - `D:\dev\hunter-platform\admin-web\tests\e2e\admin-login.spec.ts` — the Phase 0 test (you will enhance it)
  - `D:\dev\hunter-platform\admin-web\playwright.config.ts` — only if you need to add a different reporter
  - `D:\dev\hunter-platform\docs\superpowers\plans\2026-07-10-five-spa-split-state.md` — update with Phase 1.5 result
  - `D:\dev\hunter-platform\docs\superpowers\plans\2026-07-10-phase-1.5-investigation.md` — new file: your investigation log
- Files you MUST NOT touch:
  - `src/main/**` (the API server, not yours)
  - Root `package.json`, root `pnpm-lock.yaml`
  - `src/main/modules/view/**` (other WIP)
  - Anything in `tests/integration/landing*` or `tests/unit/gather-landing-data.test.ts`
  - `src/shared/constants.js`, `src/shared/types.js`
  - `.gitignore`, `.superpowers/`, `.stylelintrc.json`

---

## Task 1.5.1: Set up branch + reproduce the bug fresh

- [ ] **Step 1: Verify you're on main and clean**

```bash
cd D:/dev/hunter-platform
git branch --show-current  # should be main
git status --short | wc -l  # ~30 expected
```

- [ ] **Step 2: Create feature branch**

```bash
cd D:/dev/hunter-platform
git checkout -b 5-spa-split/phase-1.5
```

- [ ] **Step 3: Re-run the Phase 0 test to confirm the bug is reproducible from this branch**

```bash
cd D:/dev/hunter-platform/admin-web
pnpm test:e2e
```

Expected: FAILED, with `Root innerHTML length: 0` in the diagnostic output. If the test PASSES here, something is different from Phase 0 — STOP and report.

---

## Task 1.5.2: Enhance the diagnostic to capture more signals

The current test catches `console` errors and `requestfailed`. It does NOT catch:
- `pageerror` (uncaught JS exceptions thrown asynchronously)
- `unhandledrejection` (Promise rejections that aren't caught)

Update `admin-web/tests/e2e/admin-login.spec.ts` to add these listeners and capture:
- Final URL after navigation
- Last 10 lines of `page.content()` (HTML)
- Last 10 lines of `page.evaluate(() => document.body.outerHTML)` if the listener fires

Specifically, the new test should:
1. Attach `page.on('pageerror', ...)` BEFORE `page.goto`
2. Attach `page.on('console', ...)` to ALSO catch warnings (not just errors)
3. After `networkidle`, log `page.url()` to see if there's been a redirect
4. If `pageerror` fires, log the error immediately

- [ ] **Step 1: Modify the test file** to add `pageerror` and `unhandledrejection` listeners, log final URL, and expand the diagnostic output section.

The test's hard assertion (`expect(rootHtml.length).toBeGreaterThan(50)`) stays unchanged. We just want more diagnostic data.

- [ ] **Step 2: Run the test again**

```bash
cd D:/dev/hunter-platform/admin-web
pnpm test:e2e
```

- [ ] **Step 3: Save the enhanced output to** `docs/superpowers/plans/2026-07-10-phase-1.5-investigation.md`

Include:
- The enhanced diagnostic output
- The final URL after navigation
- Any `pageerror` or `unhandledrejection` messages (likely none — but record this fact)
- Console warnings (likely none — record)
- Your first-pass hypothesis on the root cause

---

## Task 1.5.3: Investigate via code reading

The bug is in the React mount path. The most likely sources of silent failure are:
1. `LoginPage.tsx` (the page being mounted at `/admin/login`)
2. `App.tsx` (the outer router and providers)
3. `main.tsx` (where `createRoot().render()` happens)
4. `PrivateRoute.tsx` (if there's any way it executes for the `/admin/login` path)
5. `lib/toast.tsx` or `Toast.tsx` (a provider that throws inside render)
6. `queryClient` setup (if QueryClientProvider throws)

- [ ] **Step 1: Read the following files in order**

```bash
cat admin-web/src/main.tsx
cat admin-web/src/App.tsx | head -120
cat admin-web/src/pages/LoginPage.tsx
cat admin-web/src/components/PrivateRoute.tsx
ls admin-web/src/components/  # find any provider-like components
cat admin-web/src/components/Toast.tsx 2>/dev/null || echo "no Toast"
cat admin-web/src/lib/toast.tsx 2>/dev/null || echo "no lib/toast"
```

- [ ] **Step 2: For each file, look specifically for:**
   - A `useEffect` that triggers `navigate(...)` without proper guards
   - A `throw` in a render function
   - A `null` or `undefined` accessed without check
   - An `if (someLocalStorageCheck)` redirect on first mount
   - Any `useState` initializer that calls something async
   - A `Suspense` boundary that catches an error silently
   - The `ToastProvider` rendering something that throws

- [ ] **Step 3: Document your findings** in the investigation file (under "Code reading analysis" section). Be specific: which file, which line, what does it do, why might it cause the symptom?

---

## Task 1.5.4: Form and test a hypothesis

Based on the diagnostic + code reading, you should now have a top hypothesis. Likely candidates (in rough order of probability):

A. **LoginPage redirects on first render** — e.g., `useEffect(() => navigate('/admin'), [])` fires even when there's no token, but a different code path handles "no token" by also navigating somewhere. Redirect loop → root never populated.

B. **PrivateRoute / RequireAuth / similar is mounted at `/admin/login` path** — e.g., App.tsx's `<Route path="/admin/login" element={<PrivateRoute><LoginPage /></PrivateRoute>}>` — if PrivateRoute renders null while checking auth, and never resolves (e.g., localStorage throws), LoginPage never renders.

C. **ToastProvider / QueryClientProvider throws inside render** — some providers can throw at mount time. The throw is caught by React's error boundary, which renders null.

D. **Strict mode double-invocation + race condition** — StrictMode in dev double-invokes effects, and a useEffect that does async work might race.

E. **Vite HMR client side effect** — vite injects a runtime that monkey-patches fetch; if it fails for some reason, the script could fail to execute.

- [ ] **Step 1: Pick your top hypothesis** based on what you read.

- [ ] **Step 2: Confirm or refute it** with one minimal action. Examples:
   - If you suspect LoginPage redirects: read it carefully for `useEffect(navigate...)`. Look at the actual render function — does it return null before checking auth?
   - If you suspect PrivateRoute: read it. Does it `return null` while loading?
   - If you suspect a Provider: try commenting out the most suspicious one (e.g., ToastProvider) and re-run the test. If the bug disappears, that's the cause.

**Recommended first try:** if LoginPage.tsx contains any `navigate(...)` or `useNavigate()` call without a clear guard against infinite loop, that's your prime suspect.

---

## Task 1.5.5: Implement the minimal fix

- [ ] **Step 1: Make the smallest possible change** that addresses the root cause.

Examples (DO NOT do any of these blindly — only do the one matching your actual diagnosis):
- If LoginPage redirects unnecessarily: guard the redirect with `if (token)` and render the form otherwise.
- If PrivateRoute swallows the public login route: remove PrivateRoute from the `/admin/login` path.
- If a Provider throws: catch the throw or move the provider to a place where it can't crash the root.
- If StrictMode race condition: serialize the async work.

- [ ] **Step 2: Re-run the Playwright test**

```bash
cd D:/dev/hunter-platform/admin-web
pnpm test:e2e
```

Expected: PASSED (or at least, the hard assertion `expect(rootHtml.length).toBeGreaterThan(50)` passes).

- [ ] **Step 3: If the test still fails, do NOT add more fixes. Re-investigate.** Per systematic-debugging: 3+ fixes without success = architectural problem. Escalate.

- [ ] **Step 4: Run the full unit test suite to ensure no regression**

```bash
cd D:/dev/hunter-platform/admin-web
pnpm test 2>&1 | tail -20
```

Expected: 1070/1070 still pass (or similar count, depending on Phase 0/1 changes).

- [ ] **Step 5: Run typecheck**

```bash
cd D:/dev/hunter-platform/admin-web
npx tsc --noEmit
```

Expected: exit 0.

---

## Task 1.5.6: Update investigation doc + state file

- [ ] **Step 1: Finalize** `docs/superpowers/plans/2026-07-10-phase-1.5-investigation.md`

Include:
- **Root cause:** one-line description
- **The fix:** file path + line range, what changed
- **Verification:** Phase 0 test now passes (paste the assertion line)
- **Test counts:** unit test count, typecheck exit code

- [ ] **Step 2: Update state file** to mark Phase 1.5 done, add a Session 4 log entry.

---

## Task 1.5.7: Commit

- [ ] **Step 1: Stage ONLY the files this sub-plan created/modified**

```bash
cd D:/dev/hunter-platform
# The test enhancement:
git add admin-web/tests/e2e/admin-login.spec.ts
# The fix (specific file(s) you edited):
git add admin-web/src/<path>/<file>.tsx   # repeat per file
# Investigation doc:
git add docs/superpowers/plans/2026-07-10-phase-1.5-investigation.md
# State file:
git add docs/superpowers/plans/2026-07-10-five-spa-split-state.md
```

Verify with `git diff --cached --stat` — only your files should appear.

- [ ] **Step 2: Commit**

```bash
cd D:/dev/hunter-platform
git commit -m "fix(admin-web): <one-line summary of root cause + fix>

The /admin/login page was blank because <root cause>.
<brief description of the fix>.

Closes the Phase 0 regression: admin-web/tests/e2e/admin-login.spec.ts
now passes (rootHtml.length > 50 instead of 0).

Co-authored-by: human (Phase 0/1 dispatch)"
```

---

## Escalation rules (read carefully)

STOP and report `BLOCKED` if:
- The Phase 0 test passes WITHOUT any fix (suggests the bug is environment-specific — not reproducible here)
- Your fix requires modifying more than 3 files
- Your fix requires changes outside `admin-web/src/`
- The fix breaks the unit test suite (cannot be brought back to 1070/1070)
- You find that the bug is in `admin-web/playwright.config.ts` or `vite.config.ts` (configuration issue, not code)

Report `DONE_WITH_CONCERNS` if:
- The fix works for `/admin/login` but you noticed other pages might have the same issue (note them, don't fix now)
- The fix required touching code you weren't sure about
- The unit test count changed (e.g., dropped to 1065) — note which tests changed and why

Otherwise report `DONE`.

---

## Report format

When done, report:
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- **Root cause:** one-line description + file:line reference
- **Fix:** file path(s) modified + what changed
- **Verification:** Phase 0 test result (PASSED with assertion line); unit test count; typecheck exit code
- **Files changed (only yours):** full list with line counts
- **Commits created:** list
- **Anything unexpected**

The investigation doc at `docs/superpowers/plans/2026-07-10-phase-1.5-investigation.md` should be the **primary deliverable** of this sub-plan. It should be self-contained: a future engineer can read it and understand the bug without context.
