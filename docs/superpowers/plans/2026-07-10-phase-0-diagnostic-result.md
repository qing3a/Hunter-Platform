# Phase 0 Diagnostic Result — `/admin/login` blank-page reproduction

**Date:** 2026-07-10
**Branch:** `5-spa-split/phase-0-1`
**Sub-plan:** `docs/superpowers/plans/2026-07-10-spa-split-phase-0-1.md`
**Top-level plan:** `docs/superpowers/plans/2026-07-10-five-spa-split.md`

---

## Environment

| Item | Value |
|---|---|
| Playwright version | `1.61.1` |
| Chromium build | `chromium-1228` (headless shell pre-installed) |
| Node / pnpm | Node 22, pnpm 9 (existing) |
| Dev server | already running on `http://localhost:5174` (reused via `reuseExistingServer: true`) |
| Test runner | `pnpm test:e2e` (added to `admin-web/package.json`) |
| Test file | `admin-web/tests/e2e/admin-login.spec.ts` |
| Config | `admin-web/playwright.config.ts` (testDir `./tests/e2e`, headless chromium, baseURL `http://localhost:5174`) |

---

## Key diagnostic finding

**`Root innerHTML length: 0`**

This is the **single most important value** captured. It is **< 50**, which per the sub-plan's interpretation table means:

> `length < 50`: React did not render. **Real bug.** Report as **DONE_WITH_CONCERNS**.

The user's "blank `/admin/login`" report of 2026-07-10 is **reproduced** in a real headless browser. It is **not** a stale-cache-only problem.

---

## Full diagnostic output

```
=== Phase 0 diagnostic output ===
Console errors: []
Failed requests: []
Network 4xx/5xx: []
Root innerHTML length: 0
Root innerHTML preview:
=== end diagnostic ===
```

### Per-signal notes

| Signal | Value | Note |
|---|---|---|
| HTTP status of `/admin/login` | `200` | curl + Playwright both confirm |
| `<script src=...>` attribute | matches `/admin/src/main.tsx` | script tag present in DOM |
| Console errors | `[]` | no JS exceptions thrown during page load + networkidle |
| Failed requests | `[]` | every request succeeded (no aborts, no timeouts) |
| Network 4xx/5xx | `[]` | every response < 400 |
| `#root` children | `0` chars of innerHTML | React **did not mount any DOM** into `#root` |

### Curl sanity check (run before Playwright)

```
GET http://localhost:5174/admin/login
→ HTTP 200
→ <!doctype html> ... <div id="root"></div>
   <script type="module" src="/admin/src/main.tsx"></script> ...
```

The server is serving correct HTML. The browser executes the script. The script loads with no errors. But **nothing is rendered into `#root`**.

---

## Interpretation

The blank-page symptom is **a real bug, not just browser cache**:

- The dev server returns the expected HTML
- The browser successfully loads `/admin/src/main.tsx`
- No console errors, no failed requests, no 4xx/5xx
- Yet `#root` is empty after `networkidle` + a 5s wait for `#root *`

**Why this matters:** This rules out the "hard refresh fixes it" hypothesis. The bug is in the React mount/render path itself. The blank page will recur for any user hitting `/admin/login` against this dev server, regardless of cache state.

**Hypotheses to investigate in Phase 2+ (out of scope here):**
- React `createRoot(...).render(...)` may be throwing inside an async boundary that the `console` listener did not catch (e.g. before `page.on('console')` was attached, or via unhandled promise rejection)
- `main.tsx` may be hitting an import that fails silently (e.g. conditional `if (import.meta.env.DEV)` block)
- The router base path may be resolving to a route that returns `null` (e.g. `*` → `<Navigate>` inside a router that hasn't fully mounted)
- TanStack Query / context providers may be rejecting early without throwing

**The Phase 0 deliverable is this evidence**, not a fix. The fix lives in Phase 2+.

---

## Test status

- **Test result:** FAILED (expected — the hard assertion `expect(rootHtml.length).toBeGreaterThan(50)` triggered)
- **Why this is still a successful Phase 0:** The diagnostic test correctly captured the bug, surfaced the `length: 0` value, and failed loudly enough to be caught in CI. The test is now a **regression baseline**: any future fix must make it pass.

---

## Artifacts left by the test run

- `admin-web/test-results/admin-login--admin-login-P-93a8e-e-errors-and-non-empty-root-chromium/error-context.md`
- `admin-web/test-results/admin-login--admin-login-P-93a8e-e-errors-and-non-empty-root-chromium/trace.zip`

The trace is a Playwright trace of the full browser session (DOM, network, console timeline). It can be opened with:

```bash
pnpm exec playwright show-trace admin-web/test-results/admin-login--admin-login-P-93a8e-e-errors-and-non-empty-root-chromium/trace.zip
```

---

## Next steps (out of scope for Phase 0)

Per the top-level plan:
- **Phase 2+** will fix the root cause (likely vite config / import path / React mount issue)
- The same Playwright test will be the regression gate: when it passes, the bug is fixed