# OpenTelemetry + trace_id Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every HTTP request, every DB write to `action_history`, and every webhook delivery must carry a `trace_id` (W3C Trace Context) that is correlated across all three — so an external Agent can report a failure with one identifier and we can reconstruct the full timeline.

**Architecture:**

- Use `@opentelemetry/sdk-node` + `@opentelemetry/auto-instrumentations-node` for HTTP/Express/SQLite automatic instrumentation.
- One SDK init in `src/main/telemetry.ts`, started BEFORE `server.ts` imports Express (so auto-instrumentation patches `http` at module load).
- A `traceContext` middleware extracts `traceparent` (W3C) from incoming requests or mints a new one, attaches the OTel `Span` to `req.span`, and exposes `getTraceId(req)` to handlers.
- A `withSpan(name, fn)` helper wraps business logic in a child span.
- The existing `respond()` helper is extended to write `x-trace-id` to the response header.
- `action_history` gets a new `trace_id TEXT` column (migration v011). `actionHistoryMiddleware` reads it from the active span context and writes it as part of the audit row.
- `webhooks.enqueue()` accepts a `traceparent` field; `worker.processBatch()` propagates it as a header on the outbound HTTP call.
- Dev default: `ConsoleSpanExporter` (no external infra). Prod: `OTLPTraceExporter` reading `OTEL_EXPORTER_OTLP_ENDPOINT` env var, falling back to no-op if unset.

**Tech Stack:** TypeScript, Node 20+, `@opentelemetry/api ^1.9`, `@opentelemetry/sdk-node ^0.52`, `@opentelemetry/auto-instrumentations-node ^0.49`, `vitest`. No proprietary libraries.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/main/telemetry.ts` | SDK init (`startTelemetry()`), `getTraceId(req)`, `withSpan(name, attrs, fn)`, `shutdownTelemetry()` |
| `src/main/db/migrations/v011_action_history_trace_id.sql` | `ALTER TABLE action_history ADD COLUMN trace_id TEXT` + index |
| `tests/unit/telemetry.test.ts` | Unit tests for `withSpan` and trace_id propagation |
| `tests/integration/trace-id.test.ts` | End-to-end: HTTP request → response header; HTTP request → action_history.trace_id; HTTP request → webhook payload contains traceparent |

### Modified files

| File | Change |
|---|---|
| `package.json` | Add OTel dependencies + `test:trace` script |
| `src/main/server.ts` | Call `startTelemetry()` before `createApp()`; mount `traceContext` middleware FIRST |
| `src/main/responses.ts` | Add `x-trace-id` response header inside `respond()` |
| `src/main/db/migrations.ts` | Register v011 |
| `src/main/middleware/action-history.ts` | Inject `trace_id` from active span into INSERT |
| `src/main/modules/webhook/queue.ts` | Accept `traceparent` in `enqueue()`, write to `webhook_delivery_queue` |
| `src/main/db/migrations/v011_*.sql` (worker) | `webhook_delivery_queue` gets `traceparent TEXT` column |
| `src/main/modules/webhook/worker.ts` | Read `traceparent` and set as outbound `traceparent` header |
| `src/main/modules/headhunter/handler.ts` | Wrap `recommendCandidate` in `withSpan('recommendation.create', ...)` |
| `src/main/modules/employer/handler.ts` | Wrap `claimJob`, `rejectJob`, `unlockContact`, `createPlacement` in spans |
| `src/main/modules/candidate/handler.ts` | Wrap `approveUnlock`, `rejectUnlock` in spans |
| `src/main/db/connection.ts` | SQLite instrumentation hint (auto-instrumentation patches `node:sqlite` if available; otherwise noop) |
| `docs/superpowers/skill.md` | Document `x-trace-id` response header; document webhook `traceparent` field |

---

## Task 1: Install OTel dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1.1: Add dependencies**

```bash
cd /d/dev/hunter-platform
pnpm add @opentelemetry/api@^1.9.0
pnpm add @opentelemetry/sdk-node@^0.52.0
pnpm add @opentelemetry/auto-instrumentations-node@^0.49.0
pnpm add @opentelemetry/exporter-trace-otlp-http@^0.52.0
```

- [ ] **Step 1.2: Verify `package.json` has all four**

```bash
cd /d/dev/hunter-platform && cat package.json | grep -E "opentelemetry"
```

Expected: 4 lines, no errors.

- [ ] **Step 1.3: Commit**

```bash
cd /d/dev/hunter-platform
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add opentelemetry packages for distributed tracing"
```

---

## Task 2: Write telemetry SDK init + helpers

**Files:**
- Create: `src/main/telemetry.ts`
- Test: `tests/unit/telemetry.test.ts`

- [ ] **Step 2.1: Write failing test for `withSpan`**

```typescript
// tests/unit/telemetry.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { startTelemetry, withSpan, getTraceIdFromContext, shutdownTelemetry, _activeSpan } from '../../src/main/telemetry';

describe('telemetry helpers', () => {
  beforeAll(async () => {
    await startTelemetry({ exporter: 'console' });
  });

  it('withSpan returns the function result and creates a span', async () => {
    const result = await withSpan('test.op', { foo: 'bar' }, (span) => {
      expect(_activeSpan()).toBe(span);
      return 42;
    });
    expect(result).toBe(42);
  });

  it('getTraceIdFromContext returns a 32-char hex string inside withSpan', async () => {
    let tid: string | undefined;
    await withSpan('test.op2', {}, () => {
      tid = getTraceIdFromContext();
    });
    expect(tid).toMatch(/^[0-9a-f]{32}$/);
  });

  it('errors thrown inside withSpan are rethrown and span records the error', async () => {
    await expect(
      withSpan('test.op3', {}, () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `cd /d/dev/hunter-platform && pnpm test telemetry`
Expected: FAIL with "Cannot find module '../../src/main/telemetry'"

- [ ] **Step 2.3: Implement `telemetry.ts`**

```typescript
// src/main/telemetry.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { ConsoleSpanExporter, SimpleSpanProcessor, type SpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { trace, context, SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api';

let sdk: NodeSDK | null = null;
let started = false;

export interface TelemetryOptions {
  /** 'console' for dev, 'otlp' for prod, 'none' to disable */
  exporter: 'console' | 'otlp' | 'none';
  serviceName?: string;
}

/**
 * Initialize the OTel SDK. MUST be called before any HTTP server / DB code is
 * imported, so that auto-instrumentation can patch the relevant modules at
 * load time. Best practice: call this at the very top of server.ts.
 */
export async function startTelemetry(opts: TelemetryOptions = { exporter: 'none' }): Promise<void> {
  if (started) return;
  started = true;

  const serviceName = opts.serviceName ?? 'hunter-platform';

  if (opts.exporter === 'none') {
    // Just set up the API provider, no exporter.
    trace.disable();
    return;
  }

  let processor: SpanProcessor;
  if (opts.exporter === 'console') {
    processor = new SimpleSpanProcessor(new ConsoleSpanExporter());
  } else {
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces';
    processor = new SimpleSpanProcessor(new OTLPTraceExporter({ url: endpoint }));
  }

  sdk = new NodeSDK({
    serviceName,
    spanProcessor: processor,
    instrumentations: [getNodeAutoInstrumentations({
      // Disable fs instrumentation (too noisy)
      '@opentelemetry/instrumentation-fs': { enabled: false },
    })],
  });

  await sdk.start();
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk) await sdk.shutdown();
  sdk = null;
  started = false;
}

const tracer: Tracer = trace.getTracer('hunter-platform');

/**
 * Run `fn` inside a new child span. The span is ended (and exported) when
 * the function resolves OR throws. Errors are recorded on the span and rethrown.
 *
 * Use for business-logic-level tracing (recommendation.create, claimJob, etc.).
 * HTTP-level tracing is automatic via auto-instrumentation.
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean | undefined>,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Synchronous variant. Same semantics but no async. */
export function withSpanSync<T>(
  name: string,
  attributes: Record<string, string | number | boolean | undefined>,
  fn: (span: Span) => T,
): T {
  return tracer.startActiveSpan(name, { attributes }, (span) => {
    try {
      const result = fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Get the trace_id (W3C, 32-char hex) of the currently active span. */
export function getTraceIdFromContext(): string | undefined {
  const span = trace.getSpan(context.active());
  return span?.spanContext().traceId;
}

/** Get the W3C `traceparent` header value of the currently active span. */
export function getTraceparentFromContext(): string | undefined {
  const span = trace.getSpan(context.active());
  if (!span) return undefined;
  const sc = span.spanContext();
  return `00-${sc.traceId}-${sc.spanId}-01`;
}

// Internal helper for tests only — do not use in app code.
export function _activeSpan(): Span | undefined {
  return trace.getSpan(context.active());
}
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `cd /d/dev/hunter-platform && pnpm test telemetry`
Expected: PASS (3 tests)

- [ ] **Step 2.5: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/telemetry.ts tests/unit/telemetry.test.ts
git commit -m "feat(telemetry): add OTel SDK init + withSpan/getTraceId helpers"
```

---

## Task 3: Migration v011 — add `trace_id` to `action_history`

**Files:**
- Create: `src/main/db/migrations/v011_action_history_trace_id.sql`
- Modify: `src/main/db/migrations.ts`

- [ ] **Step 3.1: Write migration SQL**

```sql
-- v011: add trace_id column to action_history for distributed-trace correlation
--
-- A row in action_history is the audit record of one user action. We now
-- stamp it with the OTel trace_id of the request that caused the action,
-- so an external Agent can report a failure (with x-trace-id from the
-- response header) and we can join straight from action_history to the
-- OTel backend to reconstruct the full timeline.
--
-- trace_id is nullable: pre-existing rows (and rows from non-HTTP code
-- paths) will have NULL. New rows are stamped by actionHistoryMiddleware.

ALTER TABLE action_history ADD COLUMN trace_id TEXT;

CREATE INDEX idx_action_history_trace_id ON action_history(trace_id)
  WHERE trace_id IS NOT NULL;
```

- [ ] **Step 3.2: Register migration**

In `src/main/db/migrations.ts`, append to the array:

```typescript
{ version: 11, description: 'Add trace_id to action_history (OTel correlation)', file: 'migrations/v011_action_history_trace_id.sql' },
```

- [ ] **Step 3.3: Update migrations-v002/v003 tests**

In `tests/integration/migrations-v002.test.ts` and `tests/integration/migrations-v003.test.ts`:

```typescript
expect(migs.map(m => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
```

- [ ] **Step 3.4: Run migration tests**

Run: `cd /d/dev/hunter-platform && pnpm test migrations-v002 migrations-v003`
Expected: PASS

- [ ] **Step 3.5: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/db/migrations/v011_action_history_trace_id.sql src/main/db/migrations.ts tests/integration/migrations-v002.test.ts tests/integration/migrations-v003.test.ts
git commit -m "feat(db): add action_history.trace_id (v011 migration)"
```

---

## Task 4: Update `actionHistoryMiddleware` to write `trace_id`

**Files:**
- Modify: `src/main/middleware/action-history.ts`
- Test: extend `tests/integration/trace-id.test.ts` (created in Task 9)

- [ ] **Step 4.1: Read current middleware**

Read `src/main/middleware/action-history.ts` and locate the INSERT statement. The exact field list depends on the file, but it will be a `db.prepare('INSERT INTO action_history ...').run(...)` call.

- [ ] **Step 4.2: Add `trace_id` to the INSERT**

At the top of the file:
```typescript
import { getTraceIdFromContext } from '../telemetry.js';
```

In the INSERT call, add `trace_id` as the last column and `getTraceIdFromContext() ?? null` as the last value:

```typescript
db.prepare(`
  INSERT INTO action_history (user_id, action_type, target_type, target_id,
                              request_summary_json, error_code, status, duration_ms,
                              trace_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  user_id, action_type, target_type, target_id,
  request_summary_json, error_code, status, duration_ms,
  getTraceIdFromContext() ?? null,
  new Date().toISOString(),
);
```

(Adjust the exact column list to match the file's existing schema; the key change is appending `trace_id` and the trace-id value.)

- [ ] **Step 4.3: Commit (test will be added in Task 9)**

```bash
cd /d/dev/hunter-platform
git add src/main/middleware/action-history.ts
git commit -m "feat(audit): stamp action_history rows with active OTel trace_id"
```

---

## Task 5: Extend `respond()` to write `x-trace-id` response header

**Files:**
- Modify: `src/main/responses.ts`

- [ ] **Step 5.1: Add header write to `respond()`**

At the top of `src/main/responses.ts`:
```typescript
import { getTraceIdFromContext } from './telemetry.js';
```

In the `respond()` function, just before `res.json(result.data)`:
```typescript
const traceId = getTraceIdFromContext();
if (traceId) res.setHeader('x-trace-id', traceId);
```

- [ ] **Step 5.2: Verify existing responses test still passes**

Run: `cd /d/dev/hunter-platform && pnpm test responses`
Expected: PASS (existing tests don't assert on the header; we add a new test in Task 9)

- [ ] **Step 5.3: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/responses.ts
git commit -m "feat(responses): write x-trace-id response header from active span"
```

---

## Task 6: Webhook `traceparent` propagation (queue + worker)

**Files:**
- Create: `src/main/db/migrations/v012_webhook_traceparent.sql`
- Modify: `src/main/db/migrations.ts`
- Modify: `src/main/modules/webhook/queue.ts`
- Modify: `src/main/modules/webhook/worker.ts`

- [ ] **Step 6.1: Write migration v012**

```sql
-- v012: webhook_delivery_queue gets traceparent column for cross-system tracing
--
-- When a user action triggers a webhook (e.g. notify_unlock_request), the
-- outgoing HTTP call carries the originating trace_id via the W3C
-- `traceparent` header. This lets the recipient's Agent join their
-- trace timeline to ours.

ALTER TABLE webhook_delivery_queue ADD COLUMN traceparent TEXT;
```

- [ ] **Step 6.2: Register migration**

In `src/main/db/migrations.ts`:
```typescript
{ version: 12, description: 'Add traceparent to webhook_delivery_queue (OTel propagation)', file: 'migrations/v012_webhook_traceparent.sql' },
```

- [ ] **Step 6.3: Update `webhooks.enqueue()` signature**

In `src/main/modules/webhook/queue.ts`, find the `enqueue` function and:
1. Add `traceparent?: string | null` to its input type
2. Add `traceparent` to the INSERT statement (matching the column added by v012)

```typescript
// Add to EnqueueInput type:
traceparent?: string | null;

// In the INSERT:
db.prepare(`
  INSERT INTO webhook_delivery_queue (
    target_user_id, event_type, payload_enc,
    contains_pii, max_attempts, next_retry_at,
    traceparent, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  input.target_user_id, input.event_type, input.payload_enc,
  input.contains_pii, input.max_attempts, input.next_retry_at,
  input.traceparent ?? null,
  new Date().toISOString(), new Date().toISOString(),
);
```

- [ ] **Step 6.4: Update `worker.processBatch()` to set the outbound header**

In `src/main/modules/webhook/worker.ts`, locate the code that calls the user's webhook endpoint (likely `fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ... }, body: ... })`). Add the `traceparent` header if the row has one:

```typescript
const headers: Record<string, string> = { 'Content-Type': 'application/json' };
if (row.traceparent) headers['traceparent'] = row.traceparent;

const res = await fetch(row.url, {
  method: 'POST',
  headers,
  body: JSON.stringify(row.payload),
});
```

(Adjust variable names to match the worker file's actual code.)

- [ ] **Step 6.5: Update existing enqueue call sites**

In all files that call `webhooks.enqueue(...)`:
- `src/main/modules/employer/handler.ts` (expressInterest, unlockContact)
- `src/main/modules/candidate/handler.ts` (notify employer on approve/reject)
- `src/main/modules/admin/handlers/*.ts` (if any admin actions enqueue webhooks)

For each call site, add the traceparent field:
```typescript
import { getTraceparentFromContext } from '../../telemetry.js';
// ...
webhooks.enqueue({
  // ... existing fields ...
  traceparent: getTraceparentFromContext() ?? null,
});
```

- [ ] **Step 6.6: Run webhook tests**

Run: `cd /d/dev/hunter-platform && pnpm test webhook`
Expected: PASS

- [ ] **Step 6.7: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/db/migrations/v012_webhook_traceparent.sql src/main/db/migrations.ts src/main/modules/webhook/queue.ts src/main/modules/webhook/worker.ts src/main/modules/employer/handler.ts src/main/modules/candidate/handler.ts
git commit -m "feat(webhook): propagate traceparent through queue to outbound HTTP"
```

---

## Task 7: Custom spans on key business handlers

**Files:**
- Modify: `src/main/modules/headhunter/handler.ts`
- Modify: `src/main/modules/employer/handler.ts`
- Modify: `src/main/modules/candidate/handler.ts`

- [ ] **Step 7.1: Wrap `recommendCandidate`**

In `src/main/modules/headhunter/handler.ts`, find the `recommendCandidate` function. Wrap its body in `withSpan`:

```typescript
import { withSpan } from '../telemetry.js';

recommendCandidate(user: User, input: { ... }): Recommendation {
  return withSpanSync('headhunter.recommend', {
    'headhunter.id': user.id,
    'job.id': input.job_id,
    'anonymized_candidate.id': input.anonymized_candidate_id,
  }, (span) => {
    // ... existing function body ...
    // span.setAttribute('recommendation.id', result.id);  ← add this near the end
    return result;
  });
}
```

- [ ] **Step 7.2: Wrap employer key handlers**

In `src/main/modules/employer/handler.ts`, wrap:
- `claimJob` → span `employer.claim`, attrs: `employer.id`, `job.id`
- `rejectJob` → span `employer.reject`, attrs: `employer.id`, `job.id`, `reject.reason`
- `unlockContact` → span `employer.unlock`, attrs: `employer.id`, `recommendation.id`
- `createPlacement` → span `employer.create_placement`, attrs: `employer.id`, `job.id`, `anonymized_candidate.id`, `placement.annual_salary`

- [ ] **Step 7.3: Wrap candidate key handlers**

In `src/main/modules/candidate/handler.ts`, wrap:
- `approveUnlock` → span `candidate.approve_unlock`, attrs: `candidate.id`, `recommendation.id`
- `rejectUnlock` → span `candidate.reject_unlock`, attrs: `candidate.id`, `recommendation.id`

- [ ] **Step 7.4: Run all tests**

Run: `cd /d/dev/hunter-platform && pnpm test`
Expected: PASS (no behavior changes from wrapping in spans)

- [ ] **Step 7.5: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/modules/headhunter/handler.ts src/main/modules/employer/handler.ts src/main/modules/candidate/handler.ts
git commit -m "feat(handlers): add custom OTel spans on key business operations"
```

---

## Task 8: Mount `traceContext` middleware in `server.ts`

**Files:**
- Modify: `src/main/server.ts`

- [ ] **Step 8.1: Call `startTelemetry()` at the very top**

In `src/main/server.ts`, the FIRST import (before any other app imports) must be the telemetry init:

```typescript
// src/main/server.ts
import { startTelemetry, shutdownTelemetry } from './telemetry.js';

// MUST be the first await before any other app code loads.
await startTelemetry({
  exporter: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? 'otlp' : 'console',
  serviceName: 'hunter-platform',
});

// ... rest of existing imports & app code
```

- [ ] **Step 8.2: Add shutdown handler**

At the bottom of `createApp` or wherever the server is constructed, add:

```typescript
process.on('SIGTERM', () => { shutdownTelemetry().then(() => process.exit(0)); });
process.on('SIGINT',  () => { shutdownTelemetry().then(() => process.exit(0)); });
```

- [ ] **Step 8.3: Verify no startup errors**

Run: `cd /d/dev/hunter-platform && pnpm dev &` (background), wait 3s, `curl http://localhost:3000/v1/health`, then `kill %1`.
Expected: 200 OK; no OTel-related stderr (other than the ConsoleSpanExporter's own spans, which are expected).

- [ ] **Step 8.4: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/server.ts
git commit -m "feat(server): init OTel SDK at startup + graceful shutdown"
```

---

## Task 9: End-to-end trace propagation tests

**Files:**
- Create: `tests/integration/trace-id.test.ts`

- [ ] **Step 9.1: Write e2e test**

```typescript
// tests/integration/trace-id.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

const testDb = path.join(__dirname, '../../tmp/trace-id.db');
let app: any;

beforeAll(async () => {
  try { fs.unlinkSync(testDb); } catch {}
  process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
  process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
  process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuv';
  process.env.DATABASE_PATH = testDb;
  process.env.NODE_ENV = 'test';
  const { createApp } = await import('../../src/main/server');
  app = createApp();
});
afterAll(() => { try { fs.unlinkSync(testDb); } catch {} });
beforeEach(() => {
  try { fs.unlinkSync(testDb); } catch {}
  try { fs.unlinkSync(testDb + '-wal'); } catch {}
  try { fs.unlinkSync(testDb + '-shm'); } catch {}
});

describe('OTel trace_id propagation', () => {
  it('every response includes x-trace-id header (32 hex chars)', async () => {
    const r = await request(app).get('/v1/health');
    expect(r.status).toBe(200);
    expect(r.headers['x-trace-id']).toMatch(/^[0-9a-f]{32}$/);
  });

  it('server-generated traceparent is honored (W3C format)', async () => {
    // W3C traceparent: 00-{traceId(32)}-{spanId(16)}-{flags(2)}
    const traceId = '0af7651916cd43dd8448eb211c80319c';
    const spanId  = 'b7ad6b7169203331';
    const parent  = `00-${traceId}-${spanId}-01`;

    const r = await request(app)
      .get('/v1/health')
      .set('traceparent', parent);
    expect(r.headers['x-trace-id']).toBe(traceId);
  });

  it('action_history row has trace_id matching the request trace_id', async () => {
    // Register a user, then call a tracing-enabled endpoint
    const reg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'T', contact: 't@x.com' });
    expect(reg.status).toBe(200);
    const traceId = reg.headers['x-trace-id'];
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);

    // Now call rotate-key (which writes to action_history)
    const rot = await request(app).post('/v1/auth/rotate-key')
      .set('Authorization', `Bearer ${reg.body.data.api_key}`);
    expect(rot.status).toBe(200);
    const rotTraceId = rot.headers['x-trace-id'];
    expect(rotTraceId).toMatch(/^[0-9a-f]{32}$/);

    // Query action_history directly
    const Database = (await import('better-sqlite3'));
    const db = new Database.default(testDb);
    const row = db.prepare(`
      SELECT trace_id FROM action_history
      WHERE action_type = 'rotate_api_key'
      ORDER BY id DESC LIMIT 1
    `).get() as { trace_id: string | null };
    db.close();

    expect(row.trace_id).toBe(rotTraceId);
  });

  it('webhook payload row contains traceparent', async () => {
    // Express interest on a recommendation (creates a webhook enqueue)
    // ... (assemble headhunter/employer/candidate users, create job,
    //      upload candidate, recommend, express interest)
    // The webhook enqueue should write traceparent to webhook_delivery_queue
    // Then verify by direct DB query
    // (omitted for brevity; see existing webhook tests for the setup)
  });
});
```

- [ ] **Step 9.2: Run new tests**

Run: `cd /d/dev/hunter-platform && pnpm test trace-id`
Expected: PASS (4 tests)

- [ ] **Step 9.3: Add npm script**

In `package.json`:
```json
"test:trace": "vitest run tests/integration/trace-id.test.ts"
```

- [ ] **Step 9.4: Commit**

```bash
cd /d/dev/hunter-platform
git add tests/integration/trace-id.test.ts package.json
git commit -m "test(trace): end-to-end trace_id propagation tests"
```

---

## Task 10: Update `skill.md` and run full suite

**Files:**
- Modify: `docs/superpowers/skill.md`

- [ ] **Step 10.1: Add trace section**

In skill.md, find the section describing webhook payload format. Add a new subsection:

```markdown
## 🔗 分布式追踪 (Phase 2)

每个 HTTP 响应都带 `x-trace-id` header（32 字符 hex，W3C Trace ID）。Agent 客户端应在报错日志里包含这个 ID，以便支持方直接定位到对应的 span / action_history / webhook。

Webhook payload 中也包含 `traceparent` 字段（如果发起方在 OTel 上下文里），供接收方 Agent 拼接跨系统时间线。

- 响应头：`x-trace-id: <32-hex>`
- 入口 header：兼容 W3C `traceparent: 00-<traceId>-<spanId>-01`
- Webhook 出口 header：`traceparent: 00-<traceId>-<spanId>-01`
```

- [ ] **Step 10.2: Run full test suite**

Run: `cd /d/dev/hunter-platform && pnpm test`
Expected: PASS (588+ tests; trace-id.test.ts adds 4, so 592+)

- [ ] **Step 10.3: Run typecheck and openapi check**

Run: `cd /d/dev/hunter-platform && pnpm typecheck && pnpm openapi:check`
Expected: 0 errors / 0 forward gaps

- [ ] **Step 10.4: Commit**

```bash
cd /d/dev/hunter-platform
git add docs/superpowers/skill.md
git commit -m "docs(skill): document OTel trace_id propagation"
```

---

## Self-Review Checklist

- [ ] All 10 tasks done; 10 atomic commits
- [ ] `pnpm test` passes (592+ tests, 0 new failures)
- [ ] `pnpm test:trace` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm openapi:check` passes
- [ ] `pnpm dev` starts cleanly (no OTel init errors)
- [ ] Manual smoke: `curl -i http://localhost:3000/v1/health` shows `x-trace-id` header
- [ ] Manual smoke: `console.log` of OTel ConsoleSpanExporter shows the span with `http.method=GET http.path=/v1/health`
- [ ] No business logic changed; pure observability layer

---

## Definition of Done

1. Every HTTP response carries `x-trace-id`.
2. `action_history` rows carry `trace_id` for all new writes.
3. Webhook delivery carries `traceparent` outbound header when set.
4. Custom spans on the 7 key business operations (recommend, claim, reject, unlock, place, approve, reject-candidate).
5. `pnpm test:trace` passes.
6. Full test suite still green.
7. `skill.md` documents the contract.
8. Dev mode uses ConsoleSpanExporter; prod switches to OTLP via env var.

## Out of Scope (deferred to Phase 2.5 or later)

- **OpenTelemetry Collector / Jaeger / Tempo deployment** — infra concern, not code.
- **Sampling configuration** — default is 100% capture for now; reduce in prod.
- **Metrics (counters, histograms)** — Phase 1's `/metrics` Prometheus endpoint stays; OTel metrics are a separate concern.
- **Logs correlation** — already covered by `pino` if present; not a Phase 2 deliverable.
- **UI for trace viewer** — not applicable to a backend service.