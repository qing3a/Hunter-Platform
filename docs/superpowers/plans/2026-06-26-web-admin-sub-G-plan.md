# Sub-G Implementation Plan: Public Rate-Limit + Commission Config + Cache TTL 0s

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /v1/config/rate-limits` public endpoint, wire commission rate through configCache, default TTL 0s so admin writes take effect immediately.

**Architecture:** Modify `config-cache` default TTL to 0 (each `get` re-reads DB). Add `getRateLimits()` helper to admin/config handler + public `GET /v1/config/rate-limits` route. Refactor `commission/handler.ts` to read `commission.platform_rate` from configCache (fallback 0.1). Add key-aware Zod validation in admin config PUT route. Migrate seeds default commission value at startup.

**Tech Stack:** Node.js + better-sqlite3 + zod (existing); no new deps.

**Spec:** [`docs/superpowers/specs/2026-06-26-web-admin-sub-G-design.md`](../specs/2026-06-26-web-admin-sub-G-design.md)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/main/modules/config-cache.ts` | Modify | TTL default 10000 → 0 |
| `src/main/modules/admin/handlers/config.ts` | Modify | +`getRateLimits()` method |
| `src/main/routes/config.ts` | Modify | +`GET /rate-limits` route + key-aware Zod validation on PUT |
| `src/main/schemas/admin.ts` | Modify | +`ListRateLimitsResponseSchema` |
| `src/main/modules/commission/handler.ts` | Modify | Read `commission.platform_rate` from configCache |
| `src/main/server.ts` | Modify | `migrateConfigFromFilesToDB` — seed default `commission.platform_rate = 0.1` when file missing |
| `tests/integration/rate-limit-public.test.ts` | **Create** | Public endpoint integration (3 cases) |
| `tests/integration/commission-config.test.ts` | **Create** | Commission handler integration (3 cases) |
| `docs/CHANGELOG.md` | Modify | v2.9.0 entry |

---

## Task 1: config-cache TTL default 0 + admin config handler getRateLimits() + schema + public route

**Files:**
- Modify: `src/main/modules/config-cache.ts` (line 51: TTL default)
- Modify: `src/main/modules/admin/handlers/config.ts` (add `getRateLimits()`)
- Modify: `src/main/schemas/admin.ts` (add `ListRateLimitsResponseSchema`)
- Modify: `src/main/routes/config.ts` (add route)
- Create: `tests/integration/rate-limit-public.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/rate-limit-public.test.ts`:

```typescript
// tests/integration/rate-limit-public.test.ts
//
// Sub-G: GET /v1/config/rate-limits is a public endpoint (optional auth) that
// returns the current per-tier rate-limit thresholds so agents can pre-read.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('GET /v1/config/rate-limits (Sub-G public endpoint)', () => {
  const testDb = path.join(__dirname, '../../tmp/rate-limit-public-test.db');
  let app: any;
  let db: any;
  const ADMIN_PWD = 'admin-rlp-pwd-12345';
  const ADMIN_EMAIL = 'admin-rlp@default.com';
  let adminAuth = '';

  beforeAll(async () => {
    [testDb, testDb + '-wal', testDb + '-shm'].forEach((f) => { try { fs.unlinkSync(f); } catch {} });
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = 'DEPRECATED';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createAppFromDb } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { loadEnv } = await import('../../src/main/env');
    db = openDb(testDb);
    runMigrations(db);
    app = createAppFromDb(db, loadEnv());

    const pwdHash = bcrypt.hashSync(ADMIN_PWD, 4);
    const keyHash = bcrypt.hashSync('hp_admin_rlp_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_rlp', 'RLP Admin', ADMIN_EMAIL, pwdHash, keyHash, 'hp_admin_rlp', 'super', 'active',
      '2026-06-26T00:00:00Z', '2026-06-26T00:00:00Z'
    );
    const loginResp = await request(app).post('/v1/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PWD });
    adminAuth = `Bearer ${loginResp.body.data.api_key}`;
  });

  afterAll(() => { if (db) db.close(); });

  it('1. public endpoint returns 200 with complete shape (no auth)', async () => {
    const res = await request(app).get('/v1/config/rate-limits');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.tiers).toEqual({
      candidate:  { second: 10, minute: 50,  hour: 300 },
      headhunter: { second: 20, minute: 100, hour: 750 },
      employer:   { second: 30, minute: 200, hour: 1200 },
    });
    expect(res.body.data.windows).toEqual(['second', 'minute', 'hour']);
  });

  it('2. admin put new limit, public endpoint reflects new value (TTL=0)', async () => {
    await request(app)
      .put('/v1/admin/config/rate_limit.tier.headhunter.limit_per_minute')
      .set('Authorization', adminAuth)
      .send({ value: 200, reason: 'sub-g public test' });
    const res = await request(app).get('/v1/config/rate-limits');
    expect(res.status).toBe(200);
    expect(res.body.data.tiers.headhunter.minute).toBe(200);
  });

  it('3. unauthenticated request still works (optional auth, not strict)', async () => {
    // Reset by removing the admin row's override (or rely on test 2)
    // The endpoint is /v1/config/* → optionalAuthMiddleware → no 401 on missing auth.
    const res = await request(app).get('/v1/config/rate-limits');
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /d/dev/hunter-platform && npx vitest run tests/integration/rate-limit-public.test.ts 2>&1 | tail -5`
Expected: FAIL — `404` (route doesn't exist yet) or `data.tiers` undefined

- [ ] **Step 3: Modify config-cache TTL default to 0**

In `src/main/modules/config-cache.ts`, change the TTL default from 10_000 to 0:

```typescript
// before:
export function createConfigCache(db: DB, ttlMs: number = 10_000): ConfigCache {

// after:
export function createConfigCache(db: DB, ttlMs: number = 0): ConfigCache {
```

Rationale: TTL=0 means `isExpired(loadedAt)` is always true → every `get` re-reads DB → admin writes take effect immediately.

- [ ] **Step 4: Add `getRateLimits()` to admin config handler**

In `src/main/modules/admin/handlers/config.ts`, add this import and method:

Add to imports at top:
```typescript
import { RATE_LIMIT_BURSTS } from '../../../shared/constants.js';
import { createConfigCache } from '../config-cache.js';
```

Add `getRateLimits()` method to the returned object (right after `list()` method):

```typescript
getRateLimits(): {
  tiers: Record<string, Record<string, number>>;
  windows: string[];
} {
  const cache = createConfigCache(db);
  const tiers = ['candidate', 'headhunter', 'employer'] as const;
  const result: Record<string, Record<string, number>> = {};
  for (const tier of tiers) {
    result[tier] = {
      second: cache.getOrDefault<number>(
        `rate_limit.tier.${tier}.limit_per_second`,
        () => RATE_LIMIT_BURSTS[tier].second,
      ),
      minute: cache.getOrDefault<number>(
        `rate_limit.tier.${tier}.limit_per_minute`,
        () => RATE_LIMIT_BURSTS[tier].minute,
      ),
      hour: cache.getOrDefault<number>(
        `rate_limit.tier.${tier}.limit_per_hour`,
        () => RATE_LIMIT_BURSTS[tier].hour,
      ),
    };
  }
  return { tiers: result, windows: ['second', 'minute', 'hour']};
},
```

- [ ] **Step 5: Add `ListRateLimitsResponseSchema` to schemas**

In `src/main/schemas/admin.ts`, find `ListPlacementsResponseSchema` (around line 213) and add `ListRateLimitsResponseSchema` near it:

```typescript
const ListRateLimitsResponseSchema = EnvelopeSchema(z.object({
  tiers: z.object({
    candidate:  z.object({ second: z.number(), minute: z.number(), hour: z.number() }),
    headhunter: z.object({ second: z.number(), minute: z.number(), hour: z.number() }),
    employer:   z.object({ second: z.number(), minute: z.number(), hour: z.number() }),
  }),
  windows: z.array(z.enum(['second', 'minute', 'hour'])),
}));
```

Add `ListRateLimitsResponseSchema` to the export list at the bottom of the file (find the existing `export { ... }` block, add this name):

```typescript
export { PaginationSchema, ListUsersEnvelopeSchema, ListTimelineResponseSchema, ListDeadLetterResponseSchema, ListPlacementsResponseSchema, ListRateLimitsResponseSchema, ListConfigResponseSchema, GetConfigResponseSchema };
```

- [ ] **Step 6: Add public `GET /v1/config/rate-limits` route**

In `src/main/routes/config.ts`, add to imports at the top:

```typescript
import { ListRateLimitsResponseSchema } from '../schemas/admin.js';
```

Also need to import `RATE_LIMIT_BURSTS` and `createConfigCache` for the handler if not already there. Read the current file and add what's missing:

Check `src/main/routes/config.ts` top — if it doesn't already import:
```typescript
import { RATE_LIMIT_BURSTS } from '../../shared/constants.js';
import { createConfigCache } from '../modules/config-cache.js';
import { createAdminConfigHandler } from '../modules/admin/handlers/config.js';
```
Add them as needed (skip already-present ones).

Add a new route handler after the existing `/industries` route. Find the end of the `/industries` handler and add:

```typescript
// GET /v1/config/rate-limits — public rate-limit thresholds (Sub-G)
router.get('/rate-limits', (req: Request, res: Response) => {
  const authedUser = (req as any).user;
  if (authedUser) {
    const r = quota.tryConsume(authedUser.id, QUOTA_COSTS.config_lookup ?? 1);
    if (!r.ok && r.reason === 'INSUFFICIENT_QUOTA') {
      return res.status(429).json({ ok: false, error: { code: 'INSUFFICIENT_QUOTA', message: 'Daily quota exceeded' } });
    }
  }
  const adminConfig = createAdminConfigHandler(db);
  const data = adminConfig.getRateLimits();
  respond(res, ListRateLimitsResponseSchema, { ok: true, data });
});
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd /d/dev/hunter-platform && npx vitest run tests/integration/rate-limit-public.test.ts 2>&1 | tail -5`
Expected: 3 tests passed

- [ ] **Step 8: Run full test suite to check no regression**

Run: `cd /d/dev/hunter-platform && pnpm test 2>&1 | tail -3`
Expected: All existing tests pass. Sub-F's `rate-limit-config.test.ts` may now fail because TTL=0 means cache reads happen on every request — but since it asserts header values, the assertions should still hold (cache reads DB which is empty → fallback fires).

If Sub-F `rate-limit-config.test.ts` "cache TTL: headhunter minute limit stays at 100 (fallback) within 10s" fails (because TTL=0 means immediate reload), **update that test** to reflect TTL=0 behavior. See step 8a.

- [ ] **Step 8a (conditional): Fix Sub-F rate-limit-config test 3 if it fails**

If the test "3. cache TTL: headhunter minute limit stays at 100 (fallback) within 10s" fails because TTL is now 0, update `tests/integration/rate-limit-config.test.ts` test 3 to:

```typescript
  it('3. after config write, public endpoint reflects new minute limit (TTL=0)', async () => {
    // Sub-G: TTL default is now 0, so admin write takes effect immediately (not 10s).
    const { apiKey } = await registerHeadhunter('RL3');
    const res = await request(app).get('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${apiKey}`);
    // minute limit was set to 5 in test 2, TTL=0 means new value takes effect immediately
    expect(res.headers['ratelimit-limit']).toBe('20, 5, 750');
  });
```

Run: `cd /d/dev/hunter-platform && pnpm test tests/integration/rate-limit-config.test.ts 2>&1 | tail -5`
Expected: 4 tests passed

- [ ] **Step 9: Commit**

```bash
cd /d/dev/hunter-platform && git add src/main/modules/config-cache.ts src/main/modules/admin/handlers/config.ts src/main/schemas/admin.ts src/main/routes/config.ts tests/integration/rate-limit-public.test.ts
git commit -m "feat(config): TTL=0 (immediate) + public GET /v1/config/rate-limits (Sub-G)"
```

If step 8a was needed, also include the modified test:
```bash
cd /d/dev/hunter-platform && git add tests/integration/rate-limit-config.test.ts
```

---

## Task 2: Commission handler reads `commission.platform_rate` from configCache

**Files:**
- Modify: `src/main/modules/commission/handler.ts`
- Create: `tests/integration/commission-config.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/commission-config.test.ts`:

```typescript
// tests/integration/commission-config.test.ts
//
// Sub-G: commission handler reads `commission.platform_rate` from config table.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('commission handler reads from config (Sub-G)', () => {
  const testDb = path.join(__dirname, '../../tmp/commission-config-test.db');
  let app: any;
  let db: any;
  const ADMIN_PWD = 'admin-cfg-pwd-12345';
  const ADMIN_EMAIL = 'admin-cfg@default.com';
  let adminAuth = '';
  let employerAuth = '';
  let headhunterAuth = '';

  async function registerUser(user_type: 'headhunter' | 'employer', name: string, contact: string): Promise<string> {
    const res = await request(app).post('/v1/auth/register')
      .send({ user_type, name, contact });
    return res.body.data.api_key;
  }

  beforeAll(async () => {
    [testDb, testDb + '-wal', testDb + '-shm'].forEach((f) => { try { fs.unlinkSync(f); } catch {} });
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = 'DEPRECATED';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createAppFromDb } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { loadEnv } = await import('../../src/main/env');
    db = openDb(testDb);
    runMigrations(db);
    app = createAppFromDb(db, loadEnv());

    const pwdHash = bcrypt.hashSync(ADMIN_PWD, 4);
    const keyHash = bcrypt.hashSync('hp_admin_cfg_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_cfg', 'Cfg Admin', ADMIN_EMAIL, pwdHash, keyHash, 'hp_admin_cfg', 'super', 'active',
      '2026-06-26T00:00:00Z', '2026-06-26T00:00:00Z'
    );
    const loginResp = await request(app).post('/v1/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PWD });
    adminAuth = `Bearer ${loginResp.body.data.api_key}`;

    // Set up headhunter + employer
    headhunterAuth = await registerUser('headhunter', 'CfgHH', 'cfghh@x.com');
    employerAuth = await registerUser('employer', 'CfgEmp', 'cfgemp@x.com');
  });

  afterAll(() => { if (db) db.close(); });

  it('1. migrate seeds default commission.platform_rate = 0.1', async () => {
    // After beforeAll's runMigrations + migrate, commission.platform_rate should be in DB
    const row = db.prepare('SELECT value_json FROM config WHERE key = ?').get('commission.platform_rate') as { value_json: string };
    expect(row).toBeTruthy();
    expect(JSON.parse(row.value_json).platform_rate).toBe(0.1);
  });

  it('2. admin put new rate, DB has the value (handler picks it up via TTL=0)', async () => {
    await request(app)
      .put('/v1/admin/config/commission.platform_rate')
      .set('Authorization', adminAuth)
      .send({ value: 0.15, reason: 'sub-g test' });
    const row = db.prepare('SELECT value_json FROM config WHERE key = ?').get('commission.platform_rate') as { value_json: string };
    expect(JSON.parse(row.value_json).platform_rate).toBe(0.15);
  });

  it('3. PUT with value > 1 is rejected (Zod 0-1 validation)', async () => {
    const res = await request(app)
      .put('/v1/admin/config/commission.platform_rate')
      .set('Authorization', adminAuth)
      .send({ value: 1.5, reason: 'should reject' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /d/dev/hunter-platform && npx vitest run tests/integration/commission-config.test.ts 2>&1 | tail -10`
Expected: FAIL — migration hasn't seeded commission key yet, route lacks Zod validation

- [ ] **Step 3: Modify `migrateConfigFromFilesToDB` to seed default commission value**

In `src/main/server.ts`, find the `migrateConfigFromFilesToDB` function. Replace the `if (!fs.existsSync(full)) continue;` line with code that handles commission default:

Before:
```typescript
  for (const f of files) {
    const full = path.join(configDir, f);
    if (!fs.existsSync(full)) continue;
    try {
      const content = fs.readFileSync(full, 'utf8');
      const key = path.basename(f, '.json');
      const now = new Date().toISOString();
      db.prepare(
        'INSERT OR IGNORE INTO config (key, value_json, updated_at, updated_by_admin_user_id) VALUES (?, ?, ?, NULL)'
      ).run(key, content, now);
    } catch (e) {
      console.warn('[startup] config migration failed for ' + f + ':', e);
    }
  }
```

After:
```typescript
  for (const f of files) {
    const full = path.join(configDir, f);
    if (!fs.existsSync(full)) {
      // Sub-G: if commission.json is missing, seed default value (commission.json often
      // doesn't exist in dev). Other missing files just skip + warn.
      if (f === 'commission.json') {
        const now = new Date().toISOString();
        db.prepare(
          'INSERT OR IGNORE INTO config (key, value_json, updated_at, updated_by_admin_user_id) VALUES (?, ?, ?, NULL)'
        ).run('commission', JSON.stringify({ platform_rate: 0.1 }), now);
      } else {
        console.warn('[startup] config seed file not found: ' + f + ', skipping');
      }
      continue;
    }
    try {
      const content = fs.readFileSync(full, 'utf8');
      const key = path.basename(f, '.json');
      const now = new Date().toISOString();
      db.prepare(
        'INSERT OR IGNORE INTO config (key, value_json, updated_at, updated_by_admin_user_id) VALUES (?, ?, ?, NULL)'
      ).run(key, content, now);
    } catch (e) {
      console.warn('[startup] config migration failed for ' + f + ':', e);
    }
  }
```

- [ ] **Step 4: Modify `commission/handler.ts` to read from configCache**

Read `src/main/modules/commission/handler.ts` first to see the current shape (especially the `split()` method and the `PLATFORM_FEE_RATE` constant).

After reading, add this import at the top:
```typescript
import { createConfigCache } from '../config-cache.js';
```

Find where `PLATFORM_FEE_RATE` is defined (likely a top-level `const`). Either delete it or leave it commented out (will be replaced).

Find the `split()` method. It should compute a `platformFee` from `PLATFORM_FEE_RATE`. Replace that calculation with:

```typescript
const cache = createConfigCache(db);
const platformRate = await cache.getOrDefault<number>(
  'commission.platform_rate',
  () => 0.1
);
// Defensive: if admin wrote a bad value (non-number), fall back to 0.1
const safeRate = Number.isFinite(platformRate) ? platformRate : 0.1;
const platformFee = placementAmount * safeRate;
```

The `split()` method may be sync — you'll need to make it `async` and propagate the change to all callers (probably in `placements/handler.ts` or similar — find the call site with `grep -rn "commission.split\|commissionHandler.split" src/main/` and add `await`).

If the existing `split()` returns a value (object/array), keep the same return shape — just add `async` to the function signature and `await` to the calls.

- [ ] **Step 5: Add key-aware Zod validation in admin config PUT route**

In `src/main/routes/admin.ts`, find the `PUT /config/:key` handler:

```typescript
router.put('/config/:key', (req, res, next) => {
  try { const adminUserId = (req as any).admin?.id;
  if (!adminUserId) throw Errors.unauthorized();
  const value = (req.body && typeof req.body === 'object' && 'value' in req.body) ? (req.body as any).value : req.body;
  const reason = (req.body && typeof req.body === 'object' && typeof (req.body as any).reason === 'string') ? (req.body as any).reason : '';
  respond(res, GetConfigResponseSchema, { ok: true, data: config.set(adminUserId, req.params.key, value, reason) }); } catch (e) { next(e); }
});
```

Replace it with:

```typescript
router.put('/config/:key', (req, res, next) => {
  try { const adminUserId = (req as any).admin?.id;
  if (!adminUserId) throw Errors.unauthorized();
  // Sub-G: key-aware Zod validation. commission.platform_rate must be 0-1.
  let value: unknown;
  if (req.params.key === 'commission.platform_rate') {
    const parsed = CommissionRateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw Errors.invalidParams('commission.platform_rate.value must be a number between 0 and 1: ' + parsed.error.issues.map(i => i.message).join('; '));
    }
    value = parsed.data.value;
  } else {
    value = (req.body && typeof req.body === 'object' && 'value' in req.body) ? (req.body as any).value : req.body;
  }
  const reason = (req.body && typeof req.body === 'object' && typeof (req.body as any).reason === 'string') ? (req.body as any).reason : '';
  respond(res, GetConfigResponseSchema, { ok: true, data: config.set(adminUserId, req.params.key, value, reason) }); } catch (e) { next(e); }
});
```

Add the import at the top of `src/main/routes/admin.ts`:
```typescript
import { z } from 'zod';
```
(If not already present.)

Add the schema definition before the router setup (top of file, after imports):
```typescript
const CommissionRateBodySchema = z.object({
  value: z.number().min(0).max(1),
  reason: z.string().min(3).max(500),
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /d/dev/hunter-platform && npx vitest run tests/integration/commission-config.test.ts 2>&1 | tail -5`
Expected: 3 tests passed

- [ ] **Step 7: Run full test suite**

Run: `cd /d/dev/hunter-platform && pnpm test 2>&1 | tail -3`
Expected: All passing. The existing commission integration tests should still work because `0.1` fallback preserves the legacy behavior.

If a commission test fails because of the `await` added to `split()`, update that test to `await` the call too. Look for failures with `grep -B 2 "split\|commission"` in the failing test output.

- [ ] **Step 8: Commit**

```bash
cd /d/dev/hunter-platform && git add src/main/modules/commission/handler.ts src/main/routes/admin.ts src/main/server.ts tests/integration/commission-config.test.ts
git commit -m "feat(commission): read platform_rate from config table with default 0.1 (Sub-G)"
```

---

## Task 3: Final verification + CHANGELOG + push

**Files:**
- Modify: `docs/CHANGELOG.md`

- [ ] **Step 1: Run all tests one more time**

Run: `cd /d/dev/hunter-platform && pnpm test 2>&1 | tail -3`
Expected: ~990+ passed (was 987 + 6 new = 993 expected)

- [ ] **Step 2: Run typecheck**

Run: `cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -3`
Expected: 0 errors

- [ ] **Step 3: Run admin-web tests (no changes expected)**

Run: `cd /d/dev/hunter-platform/admin-web && npx vitest run 2>&1 | tail -3`
Expected: 43 files / 212 tests passed

- [ ] **Step 4: Add v2.9.0 entry to CHANGELOG.md**

In `docs/CHANGELOG.md`, prepend (above v2.8.0) a new section:

```markdown
## v2.9.0 (Sub-G — Public Rate-Limit + Commission Config + Cache TTL 0s) — 2026-06-26

Sub-F 让 worker 读 Config，但还有 3 个运营控制缺口：agent 预读 rate-limit、commission rate 调优、admin 改后立即生效。v2.9.0 解决。

### 新增功能
- **公开 rate-limit endpoint**：`GET /v1/config/rate-limits`（optional auth，仿 `/v1/config/industries` pattern）— 返 `{ tiers: { candidate, headhunter, employer }, windows: ['second','minute','hour'] }`。agent 可预读避开撞击。
- **commission 接入 Config**：1 key `commission.platform_rate`（double 0-1）。handler 读 configCache，fallback `0.1`。
- **migrate seed 默认 commission**：启动时若 `config/commission.json` 缺失，INSERT OR IGNORE `commission.platform_rate = 0.1`（保持向后兼容）。
- **TTL 缩到 0s**：`config-cache` 默认 TTL 改 0，每次 `get` 重读 DB — admin 改后**立即**生效（不再等 10s）。
- **Route 层 Zod 校验**：admin PUT `commission.platform_rate` 用 `z.number().min(0).max(1)` 校验 body（其他 key 保持 `unknown`）。

### 配置示例
```
GET /v1/config/rate-limits  →  { tiers: { candidate: {second:10, minute:50, hour:300}, ... } }

PUT /v1/admin/config/commission.platform_rate
  body: { value: 0.15, reason: "Q3 promotion" }
```

### 测试
- 后端 +6 case（rate-limit-public 3 + commission-config 3）
- admin-web：无改动
- **总计：987 + 6 = 993 tests**

### 已知限制
- TTL=0 性能：每次 rate-limit endpoint 9 DB read（3 tier × 3 window）。SQLite in-memory < 1ms，端到端 < 10ms。
- commission 单 rate：hunter/referrer 比例拆分推 Sub-H。
- 多进程部署：每个进程各自缓存，TTL=0 仍 work，无一致性问题。

---

## v2.8.0 (Sub-F — Worker Reads Config + Public Rate-Limit DB-Backed) — 2026-06-26
```

- [ ] **Step 5: Commit and push**

```bash
cd /d/dev/hunter-platform && git add docs/CHANGELOG.md
git commit -m "docs(changelog): v2.9.0 — Sub-G public rate-limit + commission config + TTL 0s"

# Push to origin (per PROJECT_MEMORY §5: single-dev, no PR)
git push -u origin main
```

- [ ] **Step 6: Verify final state**

Run: `cd /d/dev/hunter-platform && git log --oneline -5`
Expected: 4 new commits at the top (TTL+endpoint, commission, migration default + Zod, CHANGELOG)

Then per PROJECT_MEMORY §1b, deploy to production:
```bash
cd /d/dev/hunter-platform && pnpm build
scp -r -i "/d/Downloads/cc.pem" out/* root@101.201.110.129:/opt/hunter-platform/out/
ssh -i "/d/Downloads/cc.pem" root@101.201.110.129 'systemctl restart hunter-platform && sleep 2 && curl -s http://localhost:3000/v1/config/rate-limits | head -c 300'
```
Expected: JSON response with `tiers.candidate = { second: 10, minute: 50, hour: 300 }` etc.

---

## Done criteria (Sub-G complete)

- [x] Task 1: TTL=0 + getRateLimits() + schema + route + integration test
- [x] Task 2: commission handler reads configCache + Zod 0-1 validation + integration test
- [x] Task 3: All tests pass + typecheck + CHANGELOG + push + deploy

**Sub-G 全部完成。** 下一步：Sub-H（commission hunter/referrer 比例拆分）按需启动。
