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
await client.recommend(cand.anonymized_id, 'job_xyz');
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
const result = await client.request('GET', `/v1/users/${me.user_id}/status`, {
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
- **No typed wrappers for all 46 endpoints** — only the 8 most common

## Full API reference

- `docs/superpowers/skill.md` — human-readable, with examples
- `GET /v1/openapi.json` — machine-readable, OpenAPI 3.0 spec
- `docs/superpowers/capabilities.md` — list of all 46 capabilities

## Comparison with the deprecated reference-agent

The old `examples/reference-agent/` (removed in v1.8) was a CLI smoke test that exercised 27 endpoints. This file is a different kind of reference: a single, copy-paste-able class that an external developer can drop into their project. If you want the smoke test behavior, run `pnpm test skill-md-conformance` — it covers 46 capabilities with full schema validation.
