# Phase 9 — Reference Client Design Spec

**Date:** 2026-06-22
**Status:** Approved
**Project:** hunter-platform
**Branch:** main
**Author:** ZCode (brainstorming session)
**Depends on:** Phase 5 commit `7539c44` (which deprecated `examples/reference-agent/`)

## 1. Background & Goal

In Phase 5, `examples/reference-agent/` (a 27-endpoint CLI smoke test) was marked `@deprecated` because the new vitest-native conformance test (`tests/integration/skill-md-conformance/`) supersedes it. The deprecation was correct for the **test** purpose, but no replacement was provided for the **reference implementation** purpose — i.e., the "competent client reading skill.md" pattern that external AI Agent developers need as a copy-paste starting point.

**Goal:** Provide a single, ~200-line TypeScript file (`examples/hunter-client.ts`) that external developers can read in 5 minutes and copy verbatim into their own projects. Replaces the deprecated CLI smoke test with something genuinely useful for the primary consumer (external AI agents integrating via HTTP).

## 2. Non-Goals (YAGNI)

Explicitly **not** in scope:
- An npm package (AI agents don't `pnpm add`)
- A full SDK with auto-generated types (overkill for the use case)
- Multi-step flow helpers like `registerAndUploadAndRecommend()` (developers can compose)
- Built-in rate-limit retry (let agents see the 429 and decide)
- Built-in caching, batching, or async helpers
- Test suite for the client itself (the API's conformance test is the real test)
- A CLI binary (the deprecation specifically removed the CLI)
- TypeScript types auto-generated from `openapi.json` (deliberate: this file is hand-written and self-contained for easy copy-paste)

## 3. Architecture

### 3.1 Single-file design

**File:** `examples/hunter-client.ts` (~200 lines)

**Why single file:**
- Maximum portability — drop one `.ts` into any project, no `package.json` deps to align
- Maximum readability — one file, top-to-bottom, no jumping between modules
- Maximum copy-paste value — no import path questions, no workspace setup
- Matches the "200-line reference" pattern (e.g., `unified` processor example, `xstate` minimal example)

### 3.2 Class structure

```typescript
// ~200 lines total
import { z, type ZodTypeAny } from 'zod';

// === Error type (~15 lines) ===
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

// === Client class (~150 lines) ===
export class HunterClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  // Low-level: ~40 lines
  async request<T>(method, path, opts): Promise<T> { ... }

  // Convenience methods: ~100 lines (8-10 methods, ~10 lines each)
  async getCapabilities() { ... }
  async register(userType, name, contact) { ... }
  async getMyStatus() { ... }
  async uploadCandidate(candidateUserId, data) { ... }
  async recommend(anonymizedCandidateId, jobId) { ... }
  async listMyRecommendations() { ... }
  async expressInterest(recommendationId) { ... }
  async unlockContact(recommendationId) { ... }

  // Optional admin helper: ~20 lines
  adminClient(password: string) { ... }  // returns a client with admin auth
}

// === Type exports (inline) (~10 lines) ===
export type UserType = 'candidate' | 'headhunter' | 'employer';
// etc.
```

### 3.3 `request()` method — the core

The single private-ish method that does all the work:

```typescript
async request<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  opts: {
    body?: unknown;
    schema?: ZodTypeAny;       // optional zod validation of response.data
    adminAuth?: string;        // override apiKey for admin endpoints
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const auth = opts.adminAuth ?? this.apiKey;
  if (auth) headers['Authorization'] = `Bearer ${auth}`;

  const res = await fetch(`${this.baseUrl}${path}`, {
    method, headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  // x-trace-id is on every response (Phase 2). Capture for logging.
  const traceId = res.headers.get('x-trace-id');
  const data = await res.json().catch(() => null);

  if (!res.ok || data?.ok === false) {
    throw new HunterError(
      res.status,
      data?.error?.code ?? 'UNKNOWN',
      data?.error?.message ?? `HTTP ${res.status}`,
      traceId,
      data?.error?.details,
    );
  }

  const payload = data?.data as T;
  return opts.schema ? (opts.schema.parse(payload) as T) : payload;
}
```

**Behaviors that match the API's actual contract:**
- Status `>= 400` OR `data.ok === false` → throw `HunterError`
- 4xx codes map to specific `code` values: `UNAUTHORIZED` (401), `FORBIDDEN` (403), `INVALID_STATE` (409), `INSUFFICIENT_QUOTA` (429), `INTERNAL_ERROR` (500)
- 429 includes rate-limit info via standard `RateLimit-*` headers (Phase 4) — exposed on the error object
- `x-trace-id` always present (Phase 2) — for log correlation

### 3.4 The 8-10 convenience methods

Picked to cover the **most common external-Agent flows** without bloat:

| Method | Endpoint | Why picked |
|---|---|---|
| `getCapabilities()` | `GET /v1/capabilities/me` | First call an agent should make (discovery + quota) |
| `register(userType, name, contact)` | `POST /v1/auth/register` | Onboarding flow |
| `getMyStatus()` | `GET /v1/users/:id/status` | Self-check |
| `uploadCandidate(candidateUserId, data)` | `POST /v1/headhunter/candidates` | Core headhunter action |
| `recommend(anonymizedCandidateId, jobId)` | `POST /v1/headhunter/recommendations` | Core headhunter action |
| `listMyRecommendations()` | `GET /v1/headhunter/recommendations` | Read flow |
| `expressInterest(recommendationId)` | `POST /v1/employer/recommendations/:id/express-interest` | Core employer action |
| `unlockContact(recommendationId)` | `POST /v1/employer/recommendations/:id/unlock-contact` | Core employer action |

**Deliberately NOT included** (developer can use `client.request('POST', ...)` directly):
- 30+ other endpoints
- Multi-step flows like `registerAndUpload()`
- Admin endpoints (separate `adminClient(password)` helper if needed)

### 3.5 `adminClient()` helper

```typescript
adminClient(password: string): HunterClient {
  return new HunterClient(this.baseUrl, password);
  // Note: admin uses the SAME apiKey slot, but admin endpoints
  // expect the admin password in Authorization header. The
  // adminClient() is just a separate instance for clarity.
}
```

Actually, the cleaner pattern: admin endpoints use `req.adminAuth` parameter. The user creates a separate `HunterClient` instance with the admin password as the apiKey. No special method needed.

**Decision:** Remove `adminClient()`. Document in README that admin calls use a second client instance.

### 3.6 README

**File:** `examples/README.md` (replaces existing `examples/reference-agent/README.md`)

Structure (3-4 sections, max 1 page):

```markdown
# Hunter Client — Reference Implementation

A ~200-line TypeScript class for external AI agents integrating with Hunter Platform.
Copy `hunter-client.ts` into your project; no dependencies beyond `zod`.

## Quick start

\`\`\`typescript
import { HunterClient, HunterError } from './hunter-client';

const client = new HunterClient(
  'http://localhost:3000',
  process.env.HUNTER_API_KEY!,
);

// 1. Discover your capabilities
const me = await client.getCapabilities();
console.log(\`You can do \${me.capabilities.length} things, quota remaining: \${me.quota_per_day - me.quota_used}\`);

// 2. Upload a candidate (headhunter)
const cand = await client.uploadCandidate(myCandidateUserId, {
  name: '张三', phone: '13800000001', email: 'z@x.com',
});

// 3. Recommend to a job
await client.recommend(cand.anonymized_id, jobId);
\`\`\`

## Error handling

\`\`\`typescript
try {
  await client.recommend(anonId, jobId);
} catch (e) {
  if (e instanceof HunterError) {
    if (e.code === 'INSUFFICIENT_QUOTA') {
      console.log(\`Quota exceeded; reset at \${e.details?.reset_at}\`);
    } else if (e.code === 'INVALID_STATE') {
      console.log(\`Cannot transition: \${e.message}\`);
    } else {
      console.error(\`API error \${e.status} (\${e.code}): \${e.message} [trace: \${e.traceId}]\`);
    }
  }
}
\`\`\`

## What this file does NOT do

- No retries, no caching, no batching — keep it simple.
- No typed methods for all 64 endpoints — use \`client.request('POST', '/v1/...', { body })\` for the rest.
- No admin endpoints — create a second client with the admin password as the apiKey.

## Full API reference

See \`docs/superpowers/skill.md\` and \`GET /v1/openapi.json\`.
```

### 3.7 Handling the deprecated `examples/reference-agent/`

The `examples/reference-agent/` directory was marked @deprecated in Phase 5 with the message "It will be removed in v1.8." This phase deletes the directory entirely.

**Deletion is part of Phase 9.** Commit:
- Delete `examples/reference-agent/` entirely (src/, README.md, package.json if any)
- Create `examples/hunter-client.ts`
- Create `examples/README.md`

## 4. File Manifest

### New files (2)
| File | Content |
|---|---|
| `examples/hunter-client.ts` | The ~200-line TypeScript class (the only new code) |
| `examples/README.md` | 1-page usage doc with 3-4 examples |

### Deleted files (entire directory)
| Path | Reason |
|---|---|
| `examples/reference-agent/` | Deprecated by Phase 5, replaced by this |

### Untouched
- All production code
- All test code
- `package.json` (hunter-client.ts is a self-contained reference; no build step)
- `tsconfig.json` (the file is just example code, not part of the build)
- Phase 5 deprecation commit remains in history (audit trail)

## 5. Test strategy

**No tests for `examples/hunter-client.ts`.** Rationale:
- The API's conformance test (`tests/integration/skill-md-conformance/`) is the real test
- The reference client is example code, not production code
- If the example is wrong, external developers will report it (and we'll fix the example)
- Adding a test suite for the example would defeat the "200 lines, copy-paste, no deps" goal

**Verification** (manual, not automated):
- After commit, run `pnpm typecheck` to confirm the example compiles
- Manually read through `examples/hunter-client.ts` and confirm:
  - All 8 convenience methods use correct method + path
  - `request()` correctly handles the `{ok: true, data: ...}` envelope
  - Error handling throws `HunterError` with all 5 fields
- Read through `examples/README.md` to confirm examples are accurate

## 6. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 200 lines is too long for "easy to read" | Medium | Medium | The class is split into 3 clear sections (Error / request / convenience methods). Reading top-to-bottom takes 5 minutes. |
| 200 lines is too short — missing common flows | Low | Low | The `request()` method covers everything; the 8 convenience methods are starter examples. Developers extend the class for their own flows. |
| zod is a real dependency, not stdlib | Low | Low | zod is the de-facto TypeScript schema library. If a developer doesn't have it, they can remove the `schema` param and use `as T` casts. Documented in README. |
| The `adminClient()` helper confusion | Low | Low | Removed in spec §3.5. Documented in README. |
| The example doesn't match the current API (e.g., upload_candidate body changed) | Medium | High | The executor MUST read the actual handler signatures in `src/main/routes/*.ts` for the 8 convenience methods before writing them. The plan's Task 2.1 explicitly addresses this. |
| The @deprecated reference-agent is still in git history, but directory deletion loses the README history | Low | Low | The deletion is fine; the README is in the audit trail. |

## 7. Success Criteria

- [ ] `examples/hunter-client.ts` exists and is ~150-250 lines
- [ ] `examples/README.md` exists with 3-4 usage examples
- [ ] `examples/reference-agent/` directory is deleted (no leftover files)
- [ ] `pnpm typecheck` passes (the example compiles)
- [ ] All 8 convenience methods use correct method + path (manually verified against `src/main/routes/*.ts`)
- [ ] `HunterError` has all 5 fields: status, code, message, traceId, details
- [ ] `x-trace-id` is captured on every response
- [ ] 1 atomic commit on main branch
- [ ] No other files modified

## 8. Out of Scope (deferred to Phase 10+)

- Any build / publish / distribution of the client
- Auto-generating types from `openapi.json`
- A separate `npm` package
- Tests for the client itself
- The Phase 8 work (3 admin bug fixes + refactor) — separate phase, separate spec
- The v1.8 release — separate phase, separate work

## 9. Effort Estimate

~0.5 working day. 1 atomic commit. This is a small, focused replacement.

## 10. Open Questions for Executor

1. **The exact body shape for `uploadCandidate` in the current API**: read `src/main/routes/headhunter.ts` and `src/main/schemas/headhunter.ts` to confirm. The Phase 7 deviations suggest the body now requires `candidate_user_id` (separate from the candidate's name/phone/email). If so, the convenience method's signature must match.
2. **Whether the `recommend` endpoint body now includes additional fields** (e.g., `cover_letter`). Read the current schema.
3. **The list of 8 convenience methods** — if the executor finds a more important endpoint to include (e.g., `getMyJobs` for employers is more important than `listMyRecommendations` for headhunters), adjust. The principle is: pick endpoints that an external agent would call in the first 5 minutes of integration.
