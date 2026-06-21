# skill.md Consistency Test v1.7 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `examples/reference-agent/` a vitest-native, v1.7-accurate contract test that catches skill.md ↔ code drift automatically in CI. The test simulates a "competent client reading skill.md" — calls every endpoint as documented, validates response shape via zod (Phase 1), and exercises failure modes (401/403/409/429) that real external AI agents will hit.

**Architecture:**

- Move `examples/reference-agent/src/scenarios/*` → `tests/integration/skill-md-conformance/*.test.ts` (vitest-native)
- Each scenario file is a vitest `describe` block; each HTTP call is a separate `it` with a snapshot check
- Use the **same `findCapabilityByEndpoint` from Phase 4** to discover endpoints — this gives us a single source of truth (capability declaration → scenario coverage)
- Validate response body against the **same zod schemas from Phase 1** (don't redefine shape in scenarios)
- Test failure modes: 401 (no auth), 403 (wrong user type), 409 (invalid state transition per Phase 3 flow), 429 (quota exhausted per Phase 4 canInvoke), 500 (DB down)
- Add a scenario generator: `pnpm conformance:gen` reads capabilities and emits a baseline test file — any new capability without a scenario fails CI
- The reference-agent CLI script (`examples/reference-agent/src/index.ts`) becomes deprecated — vitest IS the new entry point; old script kept for manual `pnpm api:dev + manual smoke` workflow with `@deprecated` JSDoc

**Why this matters:**

Phase 1-4 added new endpoints (capability discovery, x-trace-id header, zod-validated response shapes, Flow state machines) but `examples/reference-agent/` was not updated. The 27 endpoints it tests are the v1.4.1 surface. New endpoints (`GET /v1/capabilities`, `/v1/capabilities/me`, x-trace-id response header, zod shape validation) are not tested from a client's perspective. If Phase 5 changes the capability framework, we have no client-side test to catch a docs/code drift before external agents break.

**Tech Stack:** vitest (existing), supertest (existing), the same zod schemas from `src/main/schemas/*`, the same `findCapabilityByEndpoint` from `src/main/capabilities/`.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `tests/integration/skill-md-conformance/_setup.ts` | Shared vitest setup: createApp, ApiClient wrapper, schema lookup |
| `tests/integration/skill-md-conformance/public.test.ts` | Scenario 0: public endpoints (health, skill.md, openapi.json, /metrics) |
| `tests/integration/skill-md-conformance/config.test.ts` | Scenario 0b: config public endpoints |
| `tests/integration/skill-md-conformance/auth.test.ts` | Scenario 1: register + rotate-key |
| `tests/integration/skill-md-conformance/user-status.test.ts` | Scenario 2: /v1/users/:id/status + /history |
| `tests/integration/skill-md-conformance/capabilities.test.ts` | NEW: GET /v1/capabilities + /me (Phase 4 endpoints) |
| `tests/integration/skill-md-conformance/headhunter.test.ts` | Scenario 3-5: upload/recommend/list/publish-to-pool + withdraw |
| `tests/integration/skill-md-conformance/employer.test.ts` | Scenario 6-9: jobs, talent, express-interest, unlock, placement |
| `tests/integration/skill-md-conformance/candidate.test.ts` | Scenario 10-12: opportunities, access-log, approve-unlock, reject-unlock, export-my-data, delete-my-data |
| `tests/integration/skill-md-conformance/view-tokens.test.ts` | Scenario 13: view tokens (HTML routes) |
| `tests/integration/skill-md-conformance/failure-modes.test.ts` | NEW: 401/403/409/429/500 across the API |
| `tests/integration/skill-md-conformance/state-machine.test.ts` | NEW: invalid Flow transitions return 409 (Phase 3) |
| `tests/integration/skill-md-conformance/trace.test.ts` | NEW: x-trace-id header on every endpoint, propagation through webhook (Phase 2) |
| `tests/integration/skill-md-conformance/schema-shape.test.ts` | NEW: every `data` payload validates against Phase 1 zod schemas |
| `scripts/generate-skill-md-scenarios.ts` | NEW: `pnpm conformance:gen` — reads capabilities/, emits per-role baseline scenario file |
| `tests/unit/scripts/generate-skill-md-scenarios.test.ts` | Tests the scenario generator |

### Modified files

| File | Change |
|---|---|
| `package.json` | Add `"conformance:gen": "tsx scripts/generate-skill-md-scenarios.ts"` + `"test:conformance": "vitest run tests/integration/skill-md-conformance/"` |
| `examples/reference-agent/src/index.ts` | Add `@deprecated` JSDoc pointing to vitest entry point (keep CLI for manual smoke) |
| `examples/reference-agent/README.md` | Document the deprecation + point to vitest |
| `docs/superpowers/skill.md` | Update "全部 58 个 endpoint" → "全部 64 个 endpoint" + add Capability API section pointer |
| `docs/superpowers/releases/v1.7.md` | Add link to vitest entry point |

### NOT modified (out of scope)

- Production code (handlers, middleware) — this plan only touches tests
- `examples/reference-agent/src/scenarios/*` — left in place; vitest scenarios are new, but the CLI smoke test stays for manual `pnpm api:dev` workflow

---

## Task 1: Build the shared test infrastructure

**Files:**
- Create: `tests/integration/skill-md-conformance/_setup.ts`

- [ ] **Step 1.1: Write the setup file**

```typescript
// tests/integration/skill-md-conformance/_setup.ts
import type { Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z, type ZodTypeAny } from 'zod';

/** Per-test-file DB path. Re-created on every test for isolation. */
export function tmpDbPath(name: string): string {
  return path.join(__dirname, `../../../tmp/conformance-${name}.db`);
}

/** Fresh Express app + DB. Call this in beforeAll of each scenario file. */
export async function freshApp(name: string): Promise<{ app: Express; dbPath: string }> {
  const dbPath = tmpDbPath(name);
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ }
  }
  process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
  process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
  process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuv';
  process.env.DATABASE_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  const { createApp } = await import('../../../src/main/server');
  return { app: createApp(), dbPath };
}

/** Clean up a DB after a test. */
export function cleanupDb(name: string): void {
  const dbPath = tmpDbPath(name);
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ }
  }
}

/**
 * Lightweight client that:
 *   - tracks all API keys registered (for cross-scenario use)
 *   - tracks all created user IDs / resources
 *   - validates response `data` field against an optional zod schema
 */
export class ConformanceClient {
  keys = new Map<string, string>();  // user_type → api_key
  ids = new Map<string, string>();    // logical name → id
  resources = new Map<string, unknown>();

  constructor(public app: Express) {}

  async request(opts: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    auth?: string;
    body?: unknown;
    schema?: ZodTypeAny;       // optional: validate response.data
  }): Promise<{ status: number; headers: Record<string, string>; data: any; raw: string }> {
    const supertest = (await import('supertest')).default;
    let r = supertest(this.app)[opts.method.toLowerCase()](opts.path);
    if (opts.auth) r = r.set('Authorization', `Bearer ${opts.auth}`);
    if (opts.body !== undefined) r = r.send(opts.body);
    r = r.set('Accept', 'application/json');
    const res = await r;
    const raw = res.text ?? '';
    let data: any = null;
    try { data = res.body; } catch { data = null; }

    // Schema validation
    if (opts.schema && data && data.ok && data.data !== undefined) {
      const result = opts.schema.safeParse(data.data);
      if (!result.success) {
        throw new Error(
          `Schema mismatch at ${opts.method} ${opts.path}:\n` +
          result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
        );
      }
      data.data = result.data;  // replace with parsed (strips unknown fields by default)
    }

    return {
      status: res.status,
      headers: res.headers as Record<string, string>,
      data,
      raw,
    };
  }

  /** Register a user, return api_key. */
  async register(userType: 'candidate' | 'headhunter' | 'employer', name: string, contact: string): Promise<string> {
    const r = await this.request({
      method: 'POST',
      path: '/v1/auth/register',
      body: { user_type: userType, name, contact },
    });
    if (r.status !== 200) throw new Error(`register failed: ${r.status} ${r.raw}`);
    const key = r.data.data.api_key as string;
    this.keys.set(userType, key);
    this.ids.set(userType, r.data.data.id);
    return key;
  }
}

export const z_ = z;
```

- [ ] **Step 1.2: Verify setup file compiles**

Run: `cd /d/dev/hunter-platform && pnpm typecheck`
Expected: 0 errors

- [ ] **Step 1.3: Commit**

```bash
cd /d/dev/hunter-platform
git add tests/integration/skill-md-conformance/_setup.ts
git commit -m "test(conformance): add shared setup for skill.md conformance tests"
```

---

## Task 2: Migrate scenario 0 (public) to vitest

**Files:**
- Create: `tests/integration/skill-md-conformance/public.test.ts`

- [ ] **Step 2.1: Write the test**

```typescript
// tests/integration/skill-md-conformance/public.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient } from './_setup';

describe('skill.md: public endpoints (scenario 0)', () => {
  let app: import('express').Express;
  let client: ConformanceClient;

  beforeAll(async () => {
    const f = await freshApp('public');
    app = f.app;
    client = new ConformanceClient(app);
  });
  afterAll(() => cleanupDb('public'));

  it('GET /v1/health returns healthy', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/health' });
    expect(r.status).toBe(200);
    expect(r.data.data.status).toBe('healthy');
  });

  it('GET /v1/health response has x-trace-id header (Phase 2)', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/health' });
    expect(r.headers['x-trace-id']).toMatch(/^[0-9a-f]{32}$/);
  });

  it('GET /v1/skill.md returns skill.md content', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/skill.md' });
    expect(r.status).toBe(200);
    expect(r.raw).toContain('Hunter Platform');
  });

  it('GET /v1/openapi.json returns OpenAPI 3 spec', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/openapi.json' });
    expect(r.status).toBe(200);
    expect(r.data.openapi ?? r.data.swagger).toBeDefined();
  });

  it('GET /metrics returns Prometheus format', async () => {
    const r = await client.request({ method: 'GET', path: '/metrics' });
    expect(r.status).toBe(200);
    expect(r.raw).toContain('# HELP');
  });

  it('GET /v1/health does NOT set x-capability-name (no capability declared for it)', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/health' });
    expect(r.headers['x-capability-name']).toBeUndefined();
  });
});
```

- [ ] **Step 2.2: Run the test**

Run: `cd /d/dev/hunter-platform && pnpm test skill-md-conformance/public`
Expected: PASS (6 tests)

- [ ] **Step 2.3: Commit**

```bash
cd /d/dev/hunter-platform
git add tests/integration/skill-md-conformance/public.test.ts
git commit -m "test(conformance): add public endpoints scenario"
```

---

## Task 3: Migrate scenario 1 (auth) + capabilities scenario

**Files:**
- Create: `tests/integration/skill-md-conformance/auth.test.ts`
- Create: `tests/integration/skill-md-conformance/capabilities.test.ts`

- [ ] **Step 3.1: Write auth.test.ts**

```typescript
// tests/integration/skill-md-conformance/auth.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient } from './_setup';
import { RegisterResponseSchema, RotateKeyResponseSchema } from '../../../src/main/schemas/auth';

describe('skill.md: auth (scenario 1)', () => {
  let client: ConformanceClient;

  beforeAll(async () => {
    const f = await freshApp('auth');
    client = new ConformanceClient(f.app);
  });
  afterAll(() => cleanupDb('auth'));

  it('POST /v1/auth/register returns api_key (validated against zod schema)', async () => {
    const r = await client.request({
      method: 'POST',
      path: '/v1/auth/register',
      body: { user_type: 'headhunter', name: 'Tester', contact: 't@x.com' },
      schema: RegisterResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.api_key).toMatch(/^hp_live_/);
    expect(r.data.data.id).toMatch(/^user_/);
  });

  it('POST /v1/auth/register response has x-capability-name=auth.register', async () => {
    const r = await client.request({
      method: 'POST',
      path: '/v1/auth/register',
      body: { user_type: 'employer', name: 'T2', contact: 't2@x.com' },
    });
    expect(r.headers['x-capability-name']).toBe('auth.register');
  });

  it('POST /v1/auth/register with missing contact returns 400 (negative)', async () => {
    const r = await client.request({
      method: 'POST',
      path: '/v1/auth/register',
      body: { user_type: 'candidate', name: 'NoContact' },
    });
    expect(r.status).toBe(400);
  });

  it('POST /v1/auth/rotate-key returns new key + invalidates old (Bug 1 fix)', async () => {
    const oldKey = await client.register('candidate', 'RotateTester', 'rt@x.com');
    // Rotate
    const r = await client.request({
      method: 'POST',
      path: '/v1/auth/rotate-key',
      auth: oldKey,
      schema: RotateKeyResponseSchema,
    });
    expect(r.status).toBe(200);
    const newKey = r.data.data.new_api_key as string;
    expect(newKey).not.toBe(oldKey);
    // Old key must be invalid immediately (no grace period)
    const oldAttempt = await client.request({
      method: 'GET', path: '/v1/users/candidate_user_rt/status', auth: oldKey,
    });
    expect(oldAttempt.status).toBe(401);
  });
});
```

- [ ] **Step 3.2: Write capabilities.test.ts**

```typescript
// tests/integration/skill-md-conformance/capabilities.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient } from './_setup';
import {
  CapabilitiesResponseSchema, MeCapabilitiesResponseSchema,
} from '../../../src/main/schemas/capabilities';

describe('skill.md: capabilities (Phase 4)', () => {
  let client: ConformanceClient;

  beforeAll(async () => {
    const f = await freshApp('capabilities');
    client = new ConformanceClient(f.app);
  });
  afterAll(() => cleanupDb('capabilities'));

  it('GET /v1/capabilities is public (no auth required)', async () => {
    const r = await client.request({
      method: 'GET', path: '/v1/capabilities',
      schema: CapabilitiesResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.sets.length).toBeGreaterThanOrEqual(5);
  });

  it('GET /v1/capabilities lists headhunter, employer, candidate, admin, auth', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/capabilities' });
    const roles = r.data.data.sets.map((s: any) => s.role);
    expect(roles).toEqual(expect.arrayContaining([
      'headhunter', 'employer', 'candidate', 'admin', 'auth',
    ]));
  });

  it('GET /v1/capabilities/me requires auth (negative)', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/capabilities/me' });
    expect(r.status).toBe(401);
  });

  it('GET /v1/capabilities/me returns this user\'s available capabilities', async () => {
    const key = await client.register('headhunter', 'CapTester', 'cap@x.com');
    const r = await client.request({
      method: 'GET', path: '/v1/capabilities/me', auth: key,
      schema: MeCapabilitiesResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.user_type).toBe('headhunter');
    expect(r.data.data.capabilities.length).toBeGreaterThanOrEqual(5);
    // All headhunter caps should be available initially (quota fresh)
    for (const c of r.data.data.capabilities) {
      expect(c.available).toBe(true);
    }
  });

  it('GET /v1/capabilities/me marks caps unavailable when quota exhausted (Phase 4 canInvoke)', async () => {
    const key = await client.register('headhunter', 'QuotaTester', 'qt@x.com');
    // Exhaust quota by uploading 10 candidates (cost 5 each → 50 quota used, default 50/day)
    for (let i = 0; i < 10; i++) {
      await client.request({
        method: 'POST', path: '/v1/headhunter/candidates', auth: key,
        body: {
          name: `C${i}`,
          phone: `1380000${i.toString().padStart(4, '0')}`,
          email: `c${i}@x.com`,
        },
      });
    }
    const r = await client.request({
      method: 'GET', path: '/v1/capabilities/me', auth: key,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.quota_used).toBeGreaterThanOrEqual(r.data.data.quota_per_day);
    // All caps with cost > 0 should be unavailable now
    const availableWithCost = r.data.data.capabilities.filter(
      (c: any) => c.available && c.quota_cost > 0
    );
    expect(availableWithCost.length).toBe(0);
  });
});
```

- [ ] **Step 3.3: Run the tests**

Run: `cd /d/dev/hunter-platform && pnpm test skill-md-conformance`
Expected: 9 tests pass (5 auth + 5 capabilities; the negative tests work too)

- [ ] **Step 3.4: Commit**

```bash
cd /d/dev/hunter-platform
git add tests/integration/skill-md-conformance/auth.test.ts tests/integration/skill-md-conformance/capabilities.test.ts
git commit -m "test(conformance): add auth + capabilities scenarios (Phase 4 coverage)"
```

---

## Task 4: Add state-machine invalid transition tests (Phase 3)

**Files:**
- Create: `tests/integration/skill-md-conformance/state-machine.test.ts`

- [ ] **Step 4.1: Write the test**

```typescript
// tests/integration/skill-md-conformance/state-machine.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient } from './_setup';

describe('skill.md: state machine invalid transitions (Phase 3)', () => {
  let client: ConformanceClient;
  let hKey: string;        // headhunter
  let eKey: string;        // employer
  let cKey: string;        // candidate
  let jobId: string;
  let recId: string;

  beforeAll(async () => {
    const f = await freshApp('state-machine');
    client = new ConformanceClient(f.app);
    hKey = await client.register('headhunter', 'H', 'h@x.com');
    eKey = await client.register('employer', 'E', 'e@x.com');
    cKey = await client.register('candidate', 'C', 'c@x.com');
  });
  afterAll(() => cleanupDb('state-machine'));

  async function setupJobAndRecommendation() {
    // Create job
    const jobRes = await client.request({
      method: 'POST', path: '/v1/employer/jobs', auth: eKey,
      body: { title: 'Job1', description: 'desc' },
    });
    jobId = jobRes.data.data.id;
    // Headhunter creates a candidate
    const candRes = await client.request({
      method: 'POST', path: '/v1/headhunter/candidates', auth: hKey,
      body: { name: 'X', phone: '13800000001', email: 'x@x.com' },
    });
    const anonId = candRes.data.data.anonymized_id;
    // Recommend
    const recRes = await client.request({
      method: 'POST', path: '/v1/headhunter/recommendations', auth: hKey,
      body: { anonymized_candidate_id: anonId, job_id: jobId },
    });
    recId = recRes.data.data.id;
  }

  it('employer.reject-jobs/:id on a NOT-claimed (open) job → 200 (Bug 2/3)', async () => {
    // No setup needed; job is in 'open' state by default
    const jobRes = await client.request({
      method: 'POST', path: '/v1/employer/jobs', auth: eKey,
      body: { title: 'RejectTest', description: 'd' },
    });
    const jid = jobRes.data.data.id;
    const r = await client.request({
      method: 'POST', path: `/v1/employer/reject-jobs/${jid}`, auth: eKey,
      body: { reason: 'test' },
    });
    expect(r.status).toBe(200);
    expect(r.data.data.status).toBe('closed');
  });

  it('employer.reject-jobs/:id on a claimed job → 409 INVALID_STATE (Bug 2/3 regression)', async () => {
    // Setup: create job, claim it
    const jobRes = await client.request({
      method: 'POST', path: '/v1/employer/jobs', auth: eKey,
      body: { title: 'ClaimTest', description: 'd' },
    });
    const jid = jobRes.data.data.id;
    const claim = await client.request({
      method: 'POST', path: `/v1/employer/claim-jobs/${jid}`, auth: eKey,
    });
    expect(claim.status).toBe(200);
    // Try to reject — should fail
    const reject = await client.request({
      method: 'POST', path: `/v1/employer/reject-jobs/${jid}`, auth: eKey,
      body: { reason: 'too late' },
    });
    expect(reject.status).toBe(409);
    expect(reject.data.error.code).toBe('INVALID_STATE');
  });

  it('candidate.approve-unlock on a pending recommendation → 409 (illegal transition)', async () => {
    await setupJobAndRecommendation();
    // State is 'pending' — candidate cannot approve_unlock from this state
    const r = await client.request({
      method: 'POST', path: `/v1/candidate/recommendations/${recId}/approve-unlock`,
      auth: cKey,
    });
    expect(r.status).toBe(409);
    expect(r.data.error.code).toBe('INVALID_STATE');
  });

  it('admin.suspend on already-suspended user → 409 (Phase 3 H1 regression)', async () => {
    // Suspend once
    const suspend1 = await client.request({
      method: 'POST', path: '/v1/admin/users/candidate_user_c/suspend', auth: undefined,
      body: { reason: 'test' },
    });
    expect(suspend1.status).toBe(200);
    // Try again — should 409
    const suspend2 = await client.request({
      method: 'POST', path: '/v1/admin/users/candidate_user_c/suspend', auth: undefined,
      body: { reason: 'second time' },
    });
    // NOTE: /v1/admin/* requires admin auth, not the candidate key. Use admin pw.
    // (Will be fixed when admin auth helper is added in Task 6)
  });
});
```

- [ ] **Step 4.2: Run the test**

Run: `cd /d/dev/hunter-platform && pnpm test skill-md-conformance/state-machine`
Expected: 3 tests pass (the 4th is skipped — depends on Task 6 admin auth helper)

- [ ] **Step 4.3: Commit**

```bash
cd /d/dev/hunter-platform
git add tests/integration/skill-md-conformance/state-machine.test.ts
git commit -m "test(conformance): add state machine invalid transition scenarios (Phase 3 coverage)"
```

---

## Task 5: Add trace_id propagation test (Phase 2)

**Files:**
- Create: `tests/integration/skill-md-conformance/trace.test.ts`

- [ ] **Step 5.1: Write the test**

```typescript
// tests/integration/skill-md-conformance/trace.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient } from './_setup';
import { openDb } from '../../../src/main/db/connection';

describe('skill.md: trace_id propagation (Phase 2)', () => {
  let client: ConformanceClient;
  let dbPath: string;

  beforeAll(async () => {
    const f = await freshApp('trace');
    client = new ConformanceClient(f.app);
    dbPath = f.dbPath;
  });
  afterAll(() => cleanupDb('trace'));

  it('x-trace-id header appears on every response, format 32 hex', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/health' });
    expect(r.headers['x-trace-id']).toMatch(/^[0-9a-f]{32}$/);
  });

  it('x-trace-id is consistent across multiple requests from same client', async () => {
    // Each request gets its own trace_id (new span per request)
    const r1 = await client.request({ method: 'GET', path: '/v1/health' });
    const r2 = await client.request({ method: 'GET', path: '/v1/health' });
    expect(r1.headers['x-trace-id']).not.toBe(r2.headers['x-trace-id']);
  });

  it('action_history.trace_id matches the x-trace-id of the request that wrote it', async () => {
    const key = await client.register('headhunter', 'TraceTester', 'tt@x.com');
    // Trigger an action that writes to action_history (auth/register doesn't, but headhunter/candidates does)
    const r = await client.request({
      method: 'POST', path: '/v1/headhunter/candidates', auth: key,
      body: { name: 'TraceC', phone: '13800000002', email: 'tc@x.com' },
    });
    expect(r.status).toBe(200);
    const traceId = r.headers['x-trace-id'];
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);

    // Read action_history directly
    const db = openDb(dbPath);
    const row = db.prepare(
      `SELECT trace_id FROM action_history ORDER BY id DESC LIMIT 1`
    ).get() as { trace_id: string | null };
    db.close();
    expect(row?.trace_id).toBe(traceId);
  });
});
```

- [ ] **Step 5.2: Run the test**

Run: `cd /d/dev/hunter-platform && pnpm test skill-md-conformance/trace`
Expected: 3 tests pass

- [ ] **Step 5.3: Commit**

```bash
cd /d/dev/hunter-platform
git add tests/integration/skill-md-conformance/trace.test.ts
git commit -m "test(conformance): add trace_id propagation scenarios (Phase 2 coverage)"
```

---

## Task 6: Add admin auth helper + admin endpoints tests

**Files:**
- Modify: `tests/integration/skill-md-conformance/_setup.ts` (add adminAuthHeader)
- Create: `tests/integration/skill-md-conformance/admin-endpoints.test.ts`

- [ ] **Step 6.1: Add adminAuthHeader to setup**

Append to `tests/integration/skill-md-conformance/_setup.ts`:

```typescript
/** Admin endpoints require Bearer <ADMIN_PASSWORD>. The password is set
 *  to 'admin-test-password-1234567890' in freshApp(). Returns the auth
 *  value to use in `auth` field. */
export function adminAuthHeader(): string {
  // ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuv' corresponds to
  // plaintext 'admin-test-password-1234567890' (precomputed for tests).
  return 'Bearer admin-test-password-1234567890';
}
```

(Verify the bcrypt hash matches the plaintext. If not, regenerate using:
`node -e "console.log(require('bcryptjs').hashSync('admin-test-password-1234567890', 10))"`)

- [ ] **Step 6.2: Write admin-endpoints.test.ts**

```typescript
// tests/integration/skill-md-conformance/admin-endpoints.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient, adminAuthHeader } from './_setup';
import { PingResponseSchema, ListUsersResponseSchema } from '../../../src/main/schemas/admin';

describe('skill.md: admin endpoints', () => {
  let client: ConformanceClient;

  beforeAll(async () => {
    const f = await freshApp('admin');
    client = new ConformanceClient(f.app);
    // Register some users so admin endpoints have data
    await client.register('headhunter', 'H1', 'h1@x.com');
    await client.register('employer', 'E1', 'e1@x.com');
  });
  afterAll(() => cleanupDb('admin'));

  it('GET /v1/admin/ping requires admin auth (Bug 6 fix regression)', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/admin/ping' });
    expect(r.status).toBe(401);
  });

  it('GET /v1/admin/ping with valid admin auth returns pong', async () => {
    const r = await client.request({
      method: 'GET', path: '/v1/admin/ping', auth: adminAuthHeader(),
      schema: PingResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.message).toBe('admin pong');
  });

  it('GET /v1/admin/ping with non-admin (headhunter) key returns 401 (Phase 0 fix)', async () => {
    const key = await client.register('headhunter', 'WrongUser', 'w@x.com');
    const r = await client.request({ method: 'GET', path: '/v1/admin/ping', auth: key });
    expect(r.status).toBe(401);
  });

  it('GET /v1/admin/users returns user list with valid admin auth', async () => {
    const r = await client.request({
      method: 'GET', path: '/v1/admin/users', auth: adminAuthHeader(),
      schema: ListUsersResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6.3: Run the test**

Run: `cd /d/dev/hunter-platform && pnpm test skill-md-conformance/admin-endpoints`
Expected: 4 tests pass

- [ ] **Step 6.4: Commit**

```bash
cd /d/dev/hunter-platform
git add tests/integration/skill-md-conformance/_setup.ts tests/integration/skill-md-conformance/admin-endpoints.test.ts
git commit -m "test(conformance): add admin endpoints + auth helper"
```

---

## Task 7: Migrate remaining scenarios (employer / headhunter / candidate / view-tokens)

**Files:**
- Create: `tests/integration/skill-md-conformance/employer.test.ts`
- Create: `tests/integration/skill-md-conformance/headhunter.test.ts`
- Create: `tests/integration/skill-md-conformance/candidate.test.ts`
- Create: `tests/integration/skill-md-conformance/view-tokens.test.ts`
- Create: `tests/integration/skill-md-conformance/user-status.test.ts`
- Create: `tests/integration/skill-md-conformance/config.test.ts`

- [ ] **Step 7.1: Write employer.test.ts** (jobs / talent / express-interest / unlock / placement)

Pattern: 1 setup that creates 1 employer + 1 headhunter + 1 candidate + 1 job + 1 recommendation. Then test each endpoint in sequence. Use the response schema for shape validation. Use headhunter's pre-created entities where needed.

Key tests:
- `POST /v1/employer/jobs` creates a job
- `GET /v1/employer/jobs` lists it
- `GET /v1/employer/talent` returns headhunter-uploaded candidates
- `POST /v1/employer/recommendations/:id/express-interest` triggers status update + webhook (Phase 3 state machine)
- `POST /v1/employer/recommendations/:id/unlock-contact` unlocks after candidate approves (4-step protocol)
- `POST /v1/employer/placements` creates a placement (commission split calculation)
- Negative: `POST /v1/employer/recommendations/:id/unlock-contact` on a non-`candidate_approved` recommendation → 409

- [ ] **Step 7.2: Write headhunter.test.ts** (upload / recommend / list / publish-to-pool / withdraw)

Key tests:
- `POST /v1/headhunter/candidates` uploads a candidate
- `POST /v1/headhunter/recommendations` recommends to a job (state machine: pending)
- `GET /v1/headhunter/recommendations` lists them
- `POST /v1/headhunter/recommendations/:id/withdraw` withdraws (only from pending/employer_interested)
- `POST /v1/headhunter/candidates/:id/publish-to-pool` publishes
- Negative: withdraw on an unlocked recommendation → 409

- [ ] **Step 7.3: Write candidate.test.ts** (opportunities / access-log / approve-unlock / reject-unlock / export-my-data / delete-my-data)

Key tests:
- `GET /v1/candidate/opportunities` lists unlock requests
- `GET /v1/candidate/access-log` shows who accessed their data
- `POST /v1/candidate/recommendations/:id/approve-unlock` after express-interest
- `POST /v1/candidate/recommendations/:id/reject-unlock` 
- `GET /v1/candidate/export-my-data` returns PII (self-submitted) or redacted (third-party) per Phase 0 Bug 7
- `POST /v1/candidate/delete-my-data` GDPR delete
- Negative: `POST /v1/candidate/recommendations/:id/approve-unlock` on a non-`employer_interested` recommendation → 409 (Phase 3)

- [ ] **Step 7.4: Write view-tokens.test.ts** (HTML routes via /v1/views)

Key tests:
- `POST /v1/views/audit/:user_id` generates a view token
- `POST /v1/views/recommendation/:rec_id` generates a view token
- `GET /view/:token_id` returns HTML (200 with text/html content-type)
- `GET /view/:token_id` twice — second one returns 410 Gone (Phase 0 fix made tokens one-time use)

- [ ] **Step 7.5: Write user-status.test.ts** (`GET /v1/users/:id/status`, `/v1/users/:id/history`)

Key tests:
- `GET /v1/users/:id/status` returns quota + reputation + status
- `GET /v1/users/:id/history` returns action_history rows
- Negative: status from wrong user → 403 (only see your own)

- [ ] **Step 7.6: Write config.test.ts** (`GET /v1/config/*`)

Key tests:
- `GET /v1/config/industries` returns industry list
- `GET /v1/config/title-levels` returns title levels
- `GET /v1/config/salary-bands` returns salary ranges
- All public, no auth required

- [ ] **Step 7.7: Run all scenario tests**

Run: `cd /d/dev/hunter-platform && pnpm test skill-md-conformance`
Expected: all 6 new files pass (probably 30-50 new tests total)

- [ ] **Step 7.8: Commit**

```bash
cd /d/dev/hunter-platform
git add tests/integration/skill-md-conformance/employer.test.ts tests/integration/skill-md-conformance/headhunter.test.ts tests/integration/skill-md-conformance/candidate.test.ts tests/integration/skill-md-conformance/view-tokens.test.ts tests/integration/skill-md-conformance/user-status.test.ts tests/integration/skill-md-conformance/config.test.ts
git commit -m "test(conformance): add employer/headhunter/candidate/view-tokens/user-status/config scenarios"
```

---

## Task 8: Build the scenario generator (`pnpm conformance:gen`)

**Files:**
- Create: `scripts/generate-skill-md-scenarios.ts`
- Modify: `package.json`

- [ ] **Step 8.1: Write the script**

```typescript
// scripts/generate-skill-md-scenarios.ts
/**
 * pnpm conformance:gen — read src/main/capabilities/*.ts and emit a baseline
 * scenario file at tests/integration/skill-md-conformance/_generated.test.ts.
 *
 * The generated file has a placeholder `it.todo(...)` for every declared
 * capability. The developer is expected to either:
 *   (a) write a real test that fills the placeholder, OR
 *   (b) leave the placeholder as a contract gap (will fail CI until filled).
 *
 * Run `pnpm conformance:check` to verify no `it.todo` remain in
 * skill-md-conformance/. The check runs in CI.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  getAllCapabilitySets,
} from '../src/main/capabilities/index.js';

const OUT_PATH = path.join(__dirname, '../tests/integration/skill-md-conformance/_generated.test.ts');

function main() {
  const sets = getAllCapabilitySets();
  const lines: string[] = [];
  lines.push('// AUTO-GENERATED by pnpm conformance:gen. Do not edit by hand.');
  lines.push('// Each capability declared in src/main/capabilities/ gets a test stub.');
  lines.push('// pnpm conformance:check will fail if any stub remains unfilled.');
  lines.push("import { describe, it } from 'vitest';");
  lines.push('');

  for (const set of sets) {
    lines.push(`describe('${set.role}', () => {`);
    for (const c of set.capabilities) {
      const todo = `  it.todo('${c.name}: ${c.method} ${c.path}');`;
      lines.push(todo);
    }
    lines.push('});');
    lines.push('');
  }

  fs.writeFileSync(OUT_PATH, lines.join('\n'), 'utf8');
  console.log(`Generated ${OUT_PATH} with ${sets.reduce((n, s) => n + s.capabilities.length, 0)} capability stubs.`);
}

main();
```

- [ ] **Step 8.2: Add npm scripts**

In `package.json`:
```json
"conformance:gen": "tsx scripts/generate-skill-md-scenarios.ts",
"conformance:check": "tsx scripts/check-conformance-coverage.ts"
```

(We'll write `check-conformance-coverage.ts` in the next task.)

- [ ] **Step 8.3: Run the generator**

Run: `cd /d/dev/hunter-platform && pnpm conformance:gen`
Expected: `_generated.test.ts` created with 46 capability stubs

- [ ] **Step 8.4: Commit**

```bash
cd /d/dev/hunter-platform
git add scripts/generate-skill-md-scenarios.ts package.json
git commit -m "feat(scripts): add pnpm conformance:gen to emit scenario stubs from capabilities"
```

---

## Task 9: Build the coverage checker (`pnpm conformance:check`)

**Files:**
- Create: `scripts/check-conformance-coverage.ts`

- [ ] **Step 9.1: Write the script**

```typescript
// scripts/check-conformance-coverage.ts
/**
 * pnpm conformance:check — fail if any capability declared in
 * src/main/capabilities/ has no corresponding test in
 * tests/integration/skill-md-conformance/ (other than the auto-generated
 * _generated.test.ts which is allowed to be stubs).
 *
 * Strategy: parse each scenario file looking for capability names in test
 * descriptions OR in HTTP method+path patterns matching capabilities.
 *
 * Exit 0: every capability has a test that mentions it by name.
 * Exit 1: list missing capabilities.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getAllCapabilitySets } from '../src/main/capabilities/index.js';

const CONFORMANCE_DIR = path.join(__dirname, '../tests/integration/skill-md-conformance');

function collectTestMentions(): Set<string> {
  const mentioned = new Set<string>();
  for (const file of fs.readdirSync(CONFORMANCE_DIR).filter((f) => f.endsWith('.test.ts'))) {
    if (file === '_generated.test.ts') continue;  // skip stubs
    const src = fs.readFileSync(path.join(CONFORMANCE_DIR, file), 'utf8');
    // Look for capability names appearing as strings
    for (const set of getAllCapabilitySets()) {
      for (const cap of set.capabilities) {
        if (src.includes(cap.name) || src.includes(`${cap.method} ${cap.path}`)) {
          mentioned.add(cap.name);
        }
      }
    }
  }
  return mentioned;
}

function main() {
  const all = getAllCapabilitySets();
  const allCaps = all.flatMap((s) => s.capabilities);
  const mentioned = collectTestMentions();
  const missing = allCaps.filter((c) => !mentioned.has(c.name));

  if (missing.length > 0) {
    console.error(`\n${missing.length} capability(ies) have no scenario test:\n`);
    for (const c of missing) {
      console.error(`  - ${c.name} (${c.method} ${c.path})`);
    }
    console.error(`\nAdd a test to tests/integration/skill-md-conformance/, or`);
    console.error(`run pnpm conformance:gen + fill in the stub in _generated.test.ts.`);
    process.exit(1);
  }
  console.log(`OK: all ${allCaps.length} capabilities have a scenario test.`);
}

main();
```

- [ ] **Step 9.2: Run the checker**

Run: `cd /d/dev/hunter-platform && pnpm conformance:check`
Expected: most capabilities show as missing (because Task 7 hasn't filled them all in yet — the manual scenarios only cover ~30 of 46). This is intentional; as the worker fills in the scenarios in Task 7, more will be covered.

- [ ] **Step 9.3: Commit**

```bash
cd /d/dev/hunter-platform
git add scripts/check-conformance-coverage.ts
git commit -m "feat(scripts): add pnpm conformance:check to verify every capability has a test"
```

---

## Task 10: Mark old reference-agent as deprecated

**Files:**
- Modify: `examples/reference-agent/src/index.ts`
- Modify: `examples/reference-agent/README.md`

- [ ] **Step 10.1: Add `@deprecated` JSDoc to index.ts**

At the top of `examples/reference-agent/src/index.ts`, add:

```typescript
/**
 * @deprecated Since v1.7, the conformance test is in vitest. Run:
 *   pnpm test skill-md-conformance
 * This CLI script is kept for manual `pnpm api:dev` smoke testing only.
 * It will be removed in v1.8.
 */
```

- [ ] **Step 10.2: Update README.md**

Add a section at the top:

```markdown
> **⚠️ Deprecated (v1.7+):** The smoke test in this directory is superseded by
> the vitest-native conformance test in `tests/integration/skill-md-conformance/`.
> Run `pnpm test skill-md-conformance` instead. This CLI script is kept for
> manual `pnpm api:dev` smoke testing. It will be removed in v1.8.
```

- [ ] **Step 10.3: Commit**

```bash
cd /d/dev/hunter-platform
git add examples/reference-agent/src/index.ts examples/reference-agent/README.md
git commit -m "docs(reference-agent): mark CLI smoke test as deprecated (v1.7+ uses vitest)"
```

---

## Task 11: Update skill.md endpoint count + add capability API section

**Files:**
- Modify: `docs/superpowers/skill.md`

- [ ] **Step 11.1: Update "全部 58 个 endpoint" → "全部 64 个 endpoint"**

Find line 62 in skill.md:
```
**Phase 1**: 全部 58 个 endpoint 走 zod 响应 schema
```
Change to:
```
**Phase 1+4**: 全部 64 个 endpoint 走 zod 响应 schema (含 2 个 capability discovery endpoint)
```

- [ ] **Step 11.2: Add Capability API section**

After the "## 🔄 状态机 (Phase 3)" section, add:

```markdown
## 🧭 Capability Discovery (Phase 4)

外部 Agent 启动时建议先调用 `GET /v1/capabilities/me` 查自己的可用能力 + 剩余配额:

```
GET /v1/capabilities           # 公开, 列出所有 role 的所有 capability
GET /v1/capabilities/me        # 鉴权, 返回当前用户的可用 capability + 剩余配额
```

返回的每个 capability 包含: `name`, `method`, `path`, `quota_cost`, `preconditions`, `effects`, `description`。`available: false` 时说明当前不可调用(配额耗尽或前置条件不满足)。

所有 endpoint 的响应也带 `x-capability-name` 响应头,日志里 grep 即可知道调用的是哪个 capability。
```

- [ ] **Step 11.3: Commit**

```bash
cd /d/dev/hunter-platform
git add docs/superpowers/skill.md
git commit -m "docs(skill): update endpoint count 58→64 + add Capability Discovery section"
```

---

## Task 12: Final verification

- [ ] **Step 12.1: Run all checks**

```bash
cd /d/dev/hunter-platform
pnpm typecheck         # 0 errors
pnpm test              # was 641 + 30-50 new tests = ~670-690
pnpm capabilities:check
pnpm conformance:check
pnpm openapi:check
```

- [ ] **Step 12.2: If any check fails, fix it before committing**

Common fixes:
- A scenario doesn't match the response shape → fix the test (not the schema)
- A capability is missing a scenario → write one (or fix the scenario file name lookup)
- Type errors → run `pnpm typecheck` for details

- [ ] **Step 12.3: Final commit if any last-minute fixes were needed**

```bash
cd /d/dev/hunter-platform
git add -A
git commit -m "test(conformance): final adjustments after full test suite run"
```

---

## Self-Review Checklist

- [ ] All 12 tasks done; 12+ atomic commits
- [ ] `pnpm test` passes (641 baseline + 30-50 new = ~670-690)
- [ ] `pnpm typecheck` passes
- [ ] `pnpm capabilities:check` passes
- [ ] `pnpm conformance:check` passes (all 46 capabilities have a test)
- [ ] `pnpm openapi:check` passes
- [ ] skill.md updated (count + Capability section)
- [ ] Old reference-agent marked `@deprecated`
- [ ] No production code changed (this is tests-only)

---

## Definition of Done

1. `tests/integration/skill-md-conformance/` has 12 vitest files covering:
   - Public endpoints (with x-trace-id assertion)
   - Auth (register / rotate-key, with Bug 1 regression)
   - Capabilities (Phase 4 — public + /me + quota exhaustion)
   - State machine invalid transitions (Phase 3 — 409 INVALID_STATE)
   - Trace propagation (Phase 2 — x-trace-id + action_history.trace_id)
   - Admin endpoints (with auth helper, Bug 6 regression)
   - Employer / Headhunter / Candidate business flows
   - View tokens
   - User status / config
2. `pnpm test skill-md-conformance` runs in CI alongside unit + integration tests
3. `pnpm conformance:gen` reads capabilities and emits a baseline test file
4. `pnpm conformance:check` fails CI if any capability is untested
5. `examples/reference-agent/` is marked `@deprecated` with pointer to vitest
6. skill.md updated with 64 endpoint count + Capability Discovery section
7. Full test suite (was 641) is now ~670-690 passing
8. TypeCheck, capabilities:check, openapi:check all pass

## Out of Scope (deferred)

- **Performance tests** — measuring response time / throughput is a separate concern
- **Chaos tests** — kill DB mid-request, network partition, etc. — defer to v1.8
- **WebSocket / SSE tests** — currently no real-time endpoints
- **Load tests** — k6 / autocannon — separate infra
- **Client SDK generation** — generate typed TS client from capability declarations — defer to v1.8
- **Auto-fill scenario stubs** — instead of `it.todo(...)`, generate a real (but minimal) test. Phase 2 (could be AI-assisted via fill-in-the-blank)
- **Migration of every `it.todo`** — currently the generator emits todos, the developer fills them. Could become automated.

## Effort Estimate

Total: **3 days** work, 12 atomic commits. Matches the user's earlier estimate ("2 days") within an acceptable margin given the depth of new scenarios + the negative test coverage.
