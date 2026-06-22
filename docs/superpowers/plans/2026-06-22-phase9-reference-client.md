# Phase 9 Reference Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the deprecated `examples/reference-agent/` CLI smoke test with a single ~200-line TypeScript class (`examples/hunter-client.ts`) that external AI Agent developers can copy-paste as their starting point. Plus a 1-page `examples/README.md` with usage examples.

**Architecture:** One self-contained TypeScript file with `HunterError` + `HunterClient` class. No build step, no new npm deps beyond `zod`. Replaces the 14-scenario CLI smoke test that was deprecated in Phase 5.

**Tech Stack:** TypeScript, zod (existing dep), native `fetch` (Node 18+). No new dependencies.

**Design spec:** `docs/superpowers/specs/2026-06-22-phase9-reference-client.md`

---

## File Structure

### New files (2)
| File | Content |
|---|---|
| `examples/hunter-client.ts` | The ~200-line TypeScript class |
| `examples/README.md` | 1-page usage doc |

### Deleted files (entire directory)
| Path | Reason |
|---|---|
| `examples/reference-agent/` | Deprecated in Phase 5, replaced by this |

### Untouched
- All production code (`src/main/**`)
- All test code (`tests/**`)
- `package.json`, `tsconfig.json` (the new file is example code, not part of the build)
- `docs/**`

---

## Task 1: Verify the actual API surface for the 8 convenience methods

**Files:** None (read-only investigation)

- [ ] **Step 1.1: Read the headhunter routes to confirm `uploadCandidate` and `recommend` body shapes**

Read `src/main/routes/headhunter.ts`. Find the handlers for:
- `POST /v1/headhunter/candidates` — confirm the body shape (likely `{candidate_user_id, name, phone, email}` per Phase 7 deviations)
- `POST /v1/headhunter/recommendations` — confirm the body shape (likely `{anonymized_candidate_id, job_id}`)

- [ ] **Step 1.2: Read the auth + capabilities routes**

Read `src/main/routes/auth.ts` and `src/main/routes/capabilities.ts`. Confirm:
- `POST /v1/auth/register` body is `{user_type, name, contact}` and returns `{id, api_key, user_type, ...}` in `data`
- `GET /v1/capabilities/me` returns `{user_id, user_type, capabilities: [...], quota_used, quota_per_day}` in `data`

- [ ] **Step 1.3: Read the employer routes**

Read `src/main/routes/employer.ts`. Find:
- `POST /v1/employer/recommendations/:id/express-interest` (likely empty body)
- `POST /v1/employer/recommendations/:id/unlock-contact` (likely empty body)

- [ ] **Step 1.4: Confirm the envelope shape and error shape**

Read `src/main/responses.ts` and `src/main/schemas/common.ts`. Confirm:
- Success envelope: `{ok: true, data: ...}`
- Error envelope: `{ok: false, error: {code, message, details?}}`
- Status code mapping (4xx/5xx) and standard error codes

This step is critical — the convenience methods' signatures and the `request()` envelope handling MUST match the actual API. Use the actual field names you find in the next task.

---

## Task 2: Write `examples/hunter-client.ts`

**Files:**
- Create: `examples/hunter-client.ts`

- [ ] **Step 2.1: Write the file**

```typescript
// examples/hunter-client.ts
//
// A minimal, copy-paste-able TypeScript client for the Hunter Platform API.
// ~200 lines. One file. No build step.
//
// Usage:
//   import { HunterClient, HunterError } from './hunter-client';
//   const client = new HunterClient('http://localhost:3000', process.env.HP_KEY!);
//   const me = await client.getCapabilities();
//
// See examples/README.md for full examples and docs/superpowers/skill.md for
// the complete API reference.

import { z, type ZodTypeAny } from 'zod';

// =============================================================================
// Error type
// =============================================================================

export class HunterError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly traceId: string | null,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HunterError';
  }
}

// =============================================================================
// Client class
// =============================================================================

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RequestOptions {
  body?: unknown;
  /** Optional zod schema. If provided, response.data is parsed and validated. */
  schema?: ZodTypeAny;
}

export class HunterClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  /**
   * Low-level request. Use the typed wrappers below for the common flows;
   * use this for any other endpoint documented in skill.md.
   *
   * @throws {HunterError} on any 4xx or 5xx response.
   */
  async request<T = unknown>(
    method: HttpMethod,
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    // x-trace-id is on every response (Phase 2). Capture for log correlation.
    const traceId = res.headers.get('x-trace-id');
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      data?: T;
      error?: { code: string; message: string; details?: unknown };
    } | null;

    if (!res.ok || data?.ok === false) {
      throw new HunterError(
        res.status,
        data?.error?.code ?? 'UNKNOWN',
        data?.error?.message ?? `HTTP ${res.status}`,
        traceId,
        data?.error?.details,
      );
    }

    const payload = (data?.data ?? null) as T;
    if (opts.schema) return opts.schema.parse(payload) as T;
    return payload;
  }

  // ---------------------------------------------------------------------------
  // Typed convenience methods — the most common flows an external agent needs
  // in the first 5 minutes of integration. Use client.request() for anything
  // not listed here.
  // ---------------------------------------------------------------------------

  /** Discover your own available capabilities + remaining quota. Always call this first. */
  getCapabilities() {
    return this.request('GET', '/v1/capabilities/me');
  }

  /** Register a new user. The api_key in the response is shown only once. */
  register(userType: 'candidate' | 'headhunter' | 'employer', name: string, contact: string) {
    return this.request('POST', '/v1/auth/register', {
      body: { user_type: userType, name, contact },
    });
  }

  /** Get your own user status (quota, reputation, account state). */
  getMyStatus() {
    return this.request('GET', '/v1/users/me/status');
  }

  /** Headhunter: upload a candidate. candidate_user_id is the ID of the candidate user. */
  uploadCandidate(
    candidateUserId: string,
    data: { name: string; phone: string; email: string },
  ) {
    return this.request('POST', '/v1/headhunter/candidates', {
      body: { candidate_user_id: candidateUserId, ...data },
    });
  }

  /** Headhunter: recommend an anonymized candidate to a job. */
  recommend(anonymizedCandidateId: string, jobId: string) {
    return this.request('POST', '/v1/headhunter/recommendations', {
      body: { anonymized_candidate_id: anonymizedCandidateId, job_id: jobId },
    });
  }

  /** Headhunter: list your submitted recommendations. */
  listMyRecommendations() {
    return this.request('GET', '/v1/headhunter/recommendations');
  }

  /** Employer: express interest in a recommendation (advances state machine). */
  expressInterest(recommendationId: string) {
    return this.request(
      'POST',
      `/v1/employer/recommendations/${encodeURIComponent(recommendationId)}/express-interest`,
    );
  }

  /** Employer: unlock contact info after candidate approval. */
  unlockContact(recommendationId: string) {
    return this.request(
      'POST',
      `/v1/employer/recommendations/${encodeURIComponent(recommendationId)}/unlock-contact`,
    );
  }
}
```

**NOTE:** The exact body shape for `uploadCandidate` (`candidate_user_id` required or not) was discovered in Task 1. If the actual API requires `candidate_user_id`, the convenience method takes it as a parameter. If the API uses a different field, adjust.

- [ ] **Step 2.2: Verify the file compiles**

Run: `cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -10`
Expected: 0 errors. (The new file is a `.ts` file but not part of the build; typecheck runs against `tsconfig.node.json` which excludes `examples/`. If typecheck doesn't pick it up, run a one-off: `pnpm tsc --noEmit --target es2022 --module nodenext --moduleResolution nodenext --esModuleInterop examples/hunter-client.ts` and confirm 0 errors.)

- [ ] **Step 2.3: Verify line count is in the 150-250 range**

Run: `cd /d/dev/hunter-platform && wc -l examples/hunter-client.ts`
Expected: 150-250 lines.

- [ ] **Step 2.4: Commit**

```bash
cd /d/dev/hunter-platform
git add examples/hunter-client.ts
git commit -m "feat(examples): add hunter-client.ts reference implementation (~200 lines)"
```

---

## Task 3: Write `examples/README.md`

**Files:**
- Create: `examples/README.md`

- [ ] **Step 3.1: Write the README**

```markdown
# Hunter Client — Reference Implementation

A ~200-line TypeScript class for external AI agents integrating with the Hunter Platform API.

Copy `hunter-client.ts` into your project. The only dependency is `zod` (a standard TypeScript schema library; you can remove it and use `as T` casts if you don't want it).

## Quick start

```typescript
import { HunterClient, HunterError } from './hunter-client';

const client = new HunterClient(
  'http://localhost:3000',   // or your production baseUrl
  process.env.HUNTER_API_KEY!,
);

// 1. Discover your capabilities and quota
const me = await client.getCapabilities();
console.log(`You can do ${me.capabilities.length} things; quota ${me.quota_used}/${me.quota_per_day}`);

// 2. Upload a candidate (headhunter)
const cand = await client.uploadCandidate('user_abc', {
  name: '张三', phone: '13800000001', email: 'z@x.com',
});

// 3. Recommend to a job
const rec = await client.recommend(cand.anonymized_id, 'job_xyz');
```

## Error handling

Every 4xx and 5xx response throws a `HunterError` with typed fields:

```typescript
try {
  await client.recommend(anonId, jobId);
} catch (e) {
  if (e instanceof HunterError) {
    if (e.code === 'INSUFFICIENT_QUOTA') {
      console.log(`Quota exhausted; reset at ${e.details?.reset_at}`);
    } else if (e.code === 'INVALID_STATE') {
      console.log(`Cannot transition: ${e.message}`);
    } else {
      console.error(`API ${e.status} (${e.code}): ${e.message} [trace: ${e.traceId}]`);
    }
  } else {
    throw e; // network error, etc.
  }
}
```

The `traceId` is the `x-trace-id` response header — log it for support correlation.

## Calling endpoints not in the wrapper

The 8 convenience methods cover the most common flows. For any other endpoint, use `client.request()`:

```typescript
// Public endpoint, no auth
const health = await client.request('GET', '/v1/health');

// Authenticated, with zod validation of the response
import { z } from 'zod';
const MySchema = z.object({ id: z.string(), name: z.string() });
const result = await client.request('GET', '/v1/users/me/status', {
  schema: MySchema,
});
```

## Admin endpoints

Admin endpoints use a different auth (the admin password, not an API key). Create a second `HunterClient` instance:

```typescript
const admin = new HunterClient('http://localhost:3000', process.env.ADMIN_PASSWORD!);
const stats = await admin.request('GET', '/v1/admin/dashboard/stats');
```

## What this file does NOT do (intentionally)

- **No retries** — let your agent decide when to retry (especially on 429)
- **No caching** — call the API fresh each time
- **No batching / async helpers** — keep it simple
- **No typed wrappers for all 64 endpoints** — only the 8 most common

## Full API reference

- `docs/superpowers/skill.md` — human-readable, with examples
- `GET /v1/openapi.json` — machine-readable, OpenAPI 3.0 spec
- `docs/superpowers/capabilities.md` — list of all 46 capabilities

## Comparison with the deprecated reference-agent

The old `examples/reference-agent/` (removed in v1.8) was a CLI smoke test that exercised 27 endpoints. This file is a different kind of reference: a single, copy-paste-able class that an external developer can drop into their project. If you want the smoke test behavior, run `pnpm test skill-md-conformance` — it covers 46 capabilities with full schema validation.
```

- [ ] **Step 3.2: Commit**

```bash
cd /d/dev/hunter-platform
git add examples/README.md
git commit -m "docs(examples): add README for hunter-client reference"
```

---

## Task 4: Delete the deprecated `examples/reference-agent/` directory

**Files:**
- Delete: `examples/reference-agent/` (entire directory)

- [ ] **Step 4.1: Delete the directory**

Run: `cd /d/dev/hunter-platform && git rm -r examples/reference-agent/`
Expected: Removes all files in the directory. `git status` shows them as deleted.

- [ ] **Step 4.2: Verify no other code references the deleted directory**

Run: `cd /d/dev/hunter-platform && grep -rn "reference-agent" --include="*.ts" --include="*.json" --include="*.md" . 2>&1 | grep -v node_modules | head -10`
Expected: 0 references in code or docs. (The Phase 5 deprecation commit message and v1.7 release notes mention "reference-agent" in past tense — those are fine, they're historical.) If any active reference is found (e.g., a package.json script or a test that imports from the directory), update it.

- [ ] **Step 4.3: Run typecheck and full test suite**

Run:
```bash
cd /d/dev/hunter-platform
pnpm typecheck && pnpm test 2>&1 | tail -10
```
Expected: 0 typecheck errors; test count unchanged (deletion of a `@deprecated` directory should not affect any tests).

- [ ] **Step 4.4: Commit**

```bash
cd /d/dev/hunter-platform
git add -A
git commit -m "chore(examples): remove deprecated reference-agent/ directory (replaced by hunter-client.ts)"
```

---

## Task 5: Final verification

**Files:** None modified.

- [ ] **Step 5.1: Verify only the expected files changed**

Run: `cd /d/dev/hunter-platform && git diff 184fe2c HEAD --stat`
Expected: 3 files only (1 new + 1 new + 1 deleted directory). No `src/main/**` or other files.

- [ ] **Step 5.2: Inspect git log**

Run: `cd /d/dev/hunter-platform && git log --oneline 184fe2c..HEAD`
Expected: 3 commits (Tasks 2, 3, 4).

- [ ] **Step 5.3: Manual smoke test — copy the file and run it**

Run:
```bash
cd /d/dev/hunter-platform
# Verify the file is syntactically valid TypeScript
node --import tsx -e "
import { HunterClient } from './examples/hunter-client.ts';
const c = new HunterClient('http://localhost:3000', 'fake-key');
console.log('Type check passed; methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(c)).filter(n => n !== 'constructor').sort());
" 2>&1 | tail -10
```
Expected: prints the list of 8 convenience methods + `request` (9 names total).

- [ ] **Step 5.4: Verify the README example actually works against a running server**

Optional (requires `pnpm api:dev` to be running). If you have a server, run:
```bash
cd /d/dev/hunter-platform
pnpm api:dev &  # in another terminal
sleep 2
node --import tsx -e "
import { HunterClient } from './examples/hunter-client.ts';
const c = new HunterClient('http://localhost:3000', '');
const health = await c.request('GET', '/v1/health');
console.log('Health:', health);
" 2>&1 | tail -5
```
Expected: `Health: { status: 'healthy', ... }`. (The public `/v1/health` endpoint doesn't require auth.)

- [ ] **Step 5.5: Confirm the file is self-contained**

Run: `cd /d/dev/hunter-platform && grep -E "^import|^export" examples/hunter-client.ts`
Expected: only `import { z, type ZodTypeAny } from 'zod';` and the local `export class` / `export interface` lines. No imports from `../../src/main/**` or any other project files.

---

## Self-Review Checklist

- [ ] Task 1 reads the actual API surface — the convenience method signatures must match real routes
- [ ] Task 2 produces a ~200-line file (150-250 range) that compiles
- [ ] Task 3 README has 3-4 working code examples
- [ ] Task 4 deletes the entire `examples/reference-agent/` directory
- [ ] Task 5 verifies no breakage to existing tests
- [ ] No production code touched
- [ ] No new npm dependencies

## Definition of Done

1. `examples/hunter-client.ts` exists with 8 convenience methods + `request()`
2. `examples/README.md` exists with quick start + error handling + admin examples
3. `examples/reference-agent/` directory is completely deleted
4. `pnpm typecheck` passes
5. `pnpm test` count is unchanged
6. 3 atomic commits on top of `184fe2c`
7. No production code modified
8. File is genuinely self-contained (only zod import + local exports)

## Out of Scope (deferred)

- Phase 8 work (3 admin bug fixes + refactor) — separate phase
- v1.8 release — separate phase
- Auto-generating types from openapi.json
- Building / publishing the client as an npm package
- Tests for the client itself
- More convenience methods (developer adds as needed)

## Effort Estimate

~0.5 working day. 3 atomic commits. Aligns with spec §9.