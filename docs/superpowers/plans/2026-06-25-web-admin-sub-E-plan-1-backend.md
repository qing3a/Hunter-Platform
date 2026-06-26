# Web Admin Sub-E Plan 1: Backend (Webhook Subscriptions + Config)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **前置依赖：** Plan 1 是自包含的 — backend 改动可独立 merge、ship。Plan 2 (frontend) 必须在 Plan 1 merge 后再做（前端消费 4 个新 endpoint）。

**Goal:** 新增 1 个 migration（webhook_subscriptions 表）+ 4 个 webhook subscription endpoint（GET / POST / PATCH / DELETE）。Config / Rate-Limit 已有 endpoint，不改 backend。

**Architecture:**
- **后端**：1 migration + 1 new handler + 1 new route + 4 endpoint + 6 schema
- **测试**：~12 个集成测试
- **数据库**：+1 migration（v024）

**Tech Stack (existing):** Express 4.21, node:sqlite, zod, vitest, supertest
**Spec:** [docs/superpowers/specs/2026-06-25-web-admin-sub-E-design.md](../specs/2026-06-25-web-admin-sub-E-design.md) — §3 backend design

---

## 0. Reviewer decisions

| 反馈点 | 决策 |
|--------|------|
| Scope | 3 类：Config（不动）+ Rate-Limit（用 Config 表存）+ Webhook subscriptions（新增表 + endpoint）|
| Rate-Limit 写 | 用 Config 表的 `rate_limit.*` key 实现，0 schema 改动 |
| Webhook subscriptions | 新表 + 4 CRUD endpoints + audit log |
| Worker 端 | 0 改动（新表只是 metadata，不读） |

---

## 现有代码上下文（开始 Task 1 前必读）

- `src/main/db/migrations/v001.sql` → `v023.sql` — 已有 migration 序列，**新加 v024**
- `src/main/routes/admin.ts` line 313-318 — Config 已有 GET + PUT endpoint
- `src/main/modules/admin/handlers/config.ts` — 已有 handler
- `src/main/modules/admin/handlers/rate-limit.ts` — 已有 listBuckets + clearForUser
- `src/main/capabilities/admin.ts` — capability registry pattern
- `src/main/schemas/admin.ts` — 已有 zod schema 集合 + `IdString`, `ISODateTime`, `PaginationSchema`

**不动文件**：
- `src/main/modules/admin/handlers/dashboard.ts`（dashboard handler 不依赖新东西）
- `src/main/modules/admin/handlers/webhooks.ts`（dead-letter handler，独立）

---

## File Structure

| File | Change |
|------|--------|
| `src/main/db/migrations/v024_webhook_subscriptions.sql` | **Create** |
| `src/main/db/migrations/index.ts` | **Modify** — add v024 import (如文件存在) |
| `src/main/db/repositories/webhook-subscriptions.ts` | **Create** — CRUD functions |
| `src/main/modules/admin/handlers/webhook-subscriptions.ts` | **Create** — handler with admin audit |
| `src/main/routes/admin.ts` | **Modify** — add 4 routes |
| `src/main/schemas/admin.ts` | **Modify** — add 4 schemas |
| `src/main/capabilities/admin.ts` | **Modify** — add 4 capabilities |
| `docs/superpowers/skill.md` | **Modify** — capability 列表 +4 行 |
| `tests/integration/admin-webhook-subs.test.ts` | **Create** — ~10 case |
| `tests/integration/admin-config.test.ts` | **Modify/Create** — ~2 case for rate_limit.* key |
| `tests/unit/scripts/generate-skill-md-scenarios.test.ts` | **Modify** — bump expectedCount |
| `CHANGELOG.md` | **Modify** — v2.7.0 条目 |

---

## Task 1: migration v024_webhook_subscriptions

**Files:**
- Create: `src/main/db/migrations/v024_webhook_subscriptions.sql`

### Step 1.1: 检查现有 migration 编号

Run: `ls /d/dev/hunter-platform/src/main/db/migrations/ | tail -5`
确认下一个是 v024（如已有 v024+，改为下一个可用编号）。

### Step 1.2: 创建 migration SQL

Create `src/main/db/migrations/v024_webhook_subscriptions.sql`:

```sql
-- v024: Webhook subscriptions (Sub-E)
-- Stores admin-configured webhook endpoints that should receive event notifications.
-- Worker (not in this migration) currently does NOT read this table — see Sub-F
-- (Sub-E+) for worker integration. This Sub-E only adds the management UI/API.

CREATE TABLE webhook_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_url TEXT NOT NULL,
  event_types TEXT NOT NULL,        -- JSON array, e.g. '["placement.paid","candidate.unlocked"]'
  hmac_secret TEXT,                -- nullable; if NULL, uses global WEBHOOK_HMAC_SECRET
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_admin_user_id TEXT
);

CREATE INDEX idx_webhook_subs_enabled ON webhook_subscriptions(enabled);
```

### Step 1.3: 确认 migration 加载

打开 `src/main/db/migrations/index.ts`（或同等文件），如现有 migration 列表是手动 import 数组，加 v024 import。如用 `glob` 自动发现，则无需改。

### Step 1.4: 跑测试确认 migration 不破坏

Run: `cd /d/dev/hunter-platform && npx vitest run tests/integration 2>&1 | tail -8`
Expected: 现有测试不退。

### Step 1.5: Commit

```bash
git -C D:/dev/hunter-platform add src/main/db/migrations/v024_webhook_subscriptions.sql src/main/db/migrations/index.ts
git -C D:/dev/hunter-platform commit -m "feat(admin): migration v024 — webhook_subscriptions table"
```

---

## Task 2: Schema + Repository

**Files:**
- Modify: `src/main/schemas/admin.ts`
- Create: `src/main/db/repositories/webhook-subscriptions.ts`

### Step 2.1: 加 4 个 schema

打开 `src/main/schemas/admin.ts`，在合适位置加：

```typescript
const WebhookSubscriptionSchema = z.object({
  id: z.number().int(),
  target_url: z.string().url(),
  event_types: z.array(z.string()),
  hmac_secret: z.string().nullable(),
  enabled: z.boolean(),
  created_at: ISODateTime,
  updated_at: ISODateTime,
  created_by_admin_user_id: z.string().nullable(),
});

const ListWebhookSubscriptionsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.array(WebhookSubscriptionSchema),
});
const GetWebhookSubscriptionResponseSchema = z.object({
  ok: z.literal(true),
  data: WebhookSubscriptionSchema,
});
```

加 export：
```typescript
export { WebhookSubscriptionSchema, ListWebhookSubscriptionsResponseSchema, GetWebhookSubscriptionResponseSchema };
```

### Step 2.2: 创建 repository

Create `src/main/db/repositories/webhook-subscriptions.ts`:

```typescript
import type { DB } from '../connection.js';

export type WebhookSubscriptionRow = {
  id: number;
  target_url: string;
  event_types: string;
  hmac_secret: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
  created_by_admin_user_id: string | null;
};

export type WebhookSubscription = {
  id: number;
  target_url: string;
  event_types: string[];
  hmac_secret: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  created_by_admin_user_id: string | null;
};

const rowToSubscription = (r: WebhookSubscriptionRow): WebhookSubscription => ({
  id: r.id,
  target_url: r.target_url,
  event_types: JSON.parse(r.event_types),
  hmac_secret: r.hmac_secret,
  enabled: r.enabled === 1,
  created_at: r.created_at,
  updated_at: r.updated_at,
  created_by_admin_user_id: r.created_by_admin_user_id,
});

export function createWebhookSubscriptionsRepo(db: DB) {
  return {
    list(): WebhookSubscription[] {
      const rows = db.prepare('SELECT * FROM webhook_subscriptions ORDER BY id ASC').all() as WebhookSubscriptionRow[];
      return rows.map(rowToSubscription);
    },
    findById(id: number): WebhookSubscription | null {
      const row = db.prepare('SELECT * FROM webhook_subscriptions WHERE id = ?').get(id) as WebhookSubscriptionRow | undefined;
      return row ? rowToSubscription(row) : null;
    },
    create(data: { target_url: string; event_types: string[]; hmac_secret: string | null; created_by_admin_user_id: string | null }): WebhookSubscription {
      const now = new Date().toISOString();
      const result = db.prepare(`
        INSERT INTO webhook_subscriptions (target_url, event_types, hmac_secret, enabled, created_at, updated_at, created_by_admin_user_id)
        VALUES (?, ?, ?, 1, ?, ?, ?)
      `).run(data.target_url, JSON.stringify(data.event_types), data.hmac_secret, now, now, data.created_by_admin_user_id);
      const id = Number(result.lastInsertRowid);
      return this.findById(id)!;
    },
    update(id: number, data: Partial<{ target_url: string; event_types: string[]; hmac_secret: string | null; enabled: boolean }>): WebhookSubscription {
      const fields: string[] = [];
      const values: any[] = [];
      if (data.target_url !== undefined) { fields.push('target_url = ?'); values.push(data.target_url); }
      if (data.event_types !== undefined) { fields.push('event_types = ?'); values.push(JSON.stringify(data.event_types)); }
      if (data.hmac_secret !== undefined) { fields.push('hmac_secret = ?'); values.push(data.hmac_secret); }
      if (data.enabled !== undefined) { fields.push('enabled = ?'); values.push(data.enabled ? 1 : 0); }
      fields.push('updated_at = ?');
      values.push(new Date().toISOString());
      values.push(id);
      db.prepare(`UPDATE webhook_subscriptions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      return this.findById(id)!;
    },
    delete(id: number): void {
      db.prepare('DELETE FROM webhook_subscriptions WHERE id = ?').run(id);
    },
  };
}
```

### Step 2.3: Typecheck

Run: `cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -5`
Expected: 无错误。

### Step 2.4: Commit

```bash
git -C D:/dev/hunter-platform add src/main/schemas/admin.ts src/main/db/repositories/webhook-subscriptions.ts
git -C D:/dev/hunter-platform commit -m "feat(admin): webhook-subscriptions repo + schemas"
```

---

## Task 3: Handler + 4 Routes

**Files:**
- Create: `src/main/modules/admin/handlers/webhook-subscriptions.ts`
- Modify: `src/main/routes/admin.ts`

### Step 3.1: 创建 handler

Create `src/main/modules/admin/handlers/webhook-subscriptions.ts`:

```typescript
import type { DB } from '../../../db/connection.js';
import { createAdminActionLogRepo } from '../../../db/repositories/admin-action-log.js';
import { createWebhookSubscriptionsRepo } from '../../../db/repositories/webhook-subscriptions.js';
import { Errors } from '../../../errors.js';

export type CreateSubscriptionInput = {
  target_url: string;
  event_types: string[];
  hmac_secret: string | null;
};

export type UpdateSubscriptionInput = Partial<CreateSubscriptionInput & { enabled: boolean }>;

const validateUrl = (url: string) => {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw Errors.invalidParams('target_url must be http or https');
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('invalid_params')) throw e;
    throw Errors.invalidParams('target_url is not a valid URL');
  }
};

const validateEventTypes = (types: string[]) => {
  if (!Array.isArray(types) || types.length === 0) {
    throw Errors.invalidParams('event_types must be a non-empty array');
  }
};

export function createAdminWebhookSubscriptionsHandler(db: DB) {
  const repo = createWebhookSubscriptionsRepo(db);
  const adminLog = createAdminActionLogRepo(db);

  return {
    list() {
      return repo.list();
    },
    create(adminUserId: string, input: CreateSubscriptionInput) {
      validateUrl(input.target_url);
      validateEventTypes(input.event_types);
      const sub = repo.create({ ...input, created_by_admin_user_id: adminUserId });
      adminLog.insert({
        admin_user_id: adminUserId,
        action: 'create_webhook_subscription',
        target_type: 'webhook_subscription',
        target_id: String(sub.id),
        details_json: JSON.stringify({
          target_url: sub.target_url,
          event_types: sub.event_types,
          enabled: sub.enabled,
        }),
      });
      return sub;
    },
    update(adminUserId: string, id: number, input: UpdateSubscriptionInput) {
      if (input.target_url !== undefined) validateUrl(input.target_url);
      if (input.event_types !== undefined) validateEventTypes(input.event_types);
      const existing = repo.findById(id);
      if (!existing) throw Errors.notFound('Subscription not found');
      const sub = repo.update(id, input);
      adminLog.insert({
        admin_user_id: adminUserId,
        action: 'update_webhook_subscription',
        target_type: 'webhook_subscription',
        target_id: String(id),
        details_json: JSON.stringify({
          changes: input,
          previous: existing,
        }),
      });
      return sub;
    },
    delete(adminUserId: string, id: number) {
      const existing = repo.findById(id);
      if (!existing) throw Errors.notFound('Subscription not found');
      repo.delete(id);
      adminLog.insert({
        admin_user_id: adminUserId,
        action: 'delete_webhook_subscription',
        target_type: 'webhook_subscription',
        target_id: String(id),
        details_json: JSON.stringify({ target_url: existing.target_url }),
      });
    },
  };
}
```

### Step 3.2: 加 4 routes

打开 `src/main/routes/admin.ts`：

加 import：
```typescript
import { createAdminWebhookSubscriptionsHandler } from '../modules/admin/handlers/webhook-subscriptions.js';
import {
  // ... 已有
  ListWebhookSubscriptionsResponseSchema,
  GetWebhookSubscriptionResponseSchema,
} from '../schemas/admin.js';
```

在 `const placements = createAdminPlacementsHandler(...)` 附近加：
```typescript
  const webhookSubs = createAdminWebhookSubscriptionsHandler(db);
```

在 Config route 之后加 4 个 routes：
```typescript
  // Webhook subscriptions (Sub-E)
  router.get('/webhook-subscriptions', (_req, res, next) => {
    try { respond(res, ListWebhookSubscriptionsResponseSchema, { ok: true, data: webhookSubs.list() }, { strict: true }); }
    catch (e) { next(e); }
  });
  router.post('/webhook-subscriptions', (req, res, next) => {
    try {
      const adminUserId = (req as any).admin?.id;
      if (!adminUserId) throw Errors.unauthorized();
      const { target_url, event_types, hmac_secret } = req.body ?? {};
      respond(res, GetWebhookSubscriptionResponseSchema, {
        ok: true, data: webhookSubs.create(adminUserId, { target_url, event_types, hmac_secret: hmac_secret ?? null }),
      }, { strict: true });
    } catch (e) { next(e); }
  });
  router.patch('/webhook-subscriptions/:id', (req, res, next) => {
    try {
      const adminUserId = (req as any).admin?.id;
      if (!adminUserId) throw Errors.unauthorized();
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) throw Errors.invalidParams('id must be a number');
      respond(res, GetWebhookSubscriptionResponseSchema, {
        ok: true, data: webhookSubs.update(adminUserId, id, req.body ?? {}),
      }, { strict: true });
    } catch (e) { next(e); }
  });
  router.delete('/webhook-subscriptions/:id', (req, res, next) => {
    try {
      const adminUserId = (req as any).admin?.id;
      if (!adminUserId) throw Errors.unauthorized();
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) throw Errors.invalidParams('id must be a number');
      webhookSubs.delete(adminUserId, id);
      respond(res, /* empty schema */, { ok: true, data: null });
    } catch (e) { next(e); }
  });
```

注：DELETE response 用 `null` data 即可，需要 `EmptyResponseSchema` 或 `z.unknown()` 验证。

### Step 3.3: Typecheck + 跑现有测试

```bash
cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -3
npx vitest run tests/integration/admin-endpoints.test.ts tests/integration/admin-list-pagination.test.ts 2>&1 | tail -5
```

Expected: 无错误；现有测试不退。

### Step 3.4: Commit

```bash
git -C D:/dev/hunter-platform add src/main/modules/admin/handlers/webhook-subscriptions.ts src/main/routes/admin.ts
git -C D:/dev/hunter-platform commit -m "feat(admin): webhook subscriptions handler + 4 routes (list/create/update/delete with audit)"
```

---

## Task 4: Capabilities + skill.md

**Files:**
- Modify: `src/main/capabilities/admin.ts`
- Modify: `docs/superpowers/skill.md`
- Modify: `tests/unit/scripts/generate-skill-md-scenarios.test.ts`

### Step 4.1: 加 4 capability

打开 `src/main/capabilities/admin.ts`，找到 `admin.list_dead_letter` 之后，加 4 个：

```typescript
    {
      name: 'admin.list_webhook_subscriptions',
      description: '列出 webhook 订阅',
      method: 'GET', path: '/v1/admin/webhook-subscriptions',
      response_schema: ListWebhookSubscriptionsResponseSchema,
      quota_cost: 0, preconditions: [],
    },
    {
      name: 'admin.create_webhook_subscription',
      description: '创建 webhook 订阅（admin audit 写入）',
      method: 'POST', path: '/v1/admin/webhook-subscriptions',
      response_schema: GetWebhookSubscriptionResponseSchema,
      quota_cost: 0, preconditions: [],
    },
    {
      name: 'admin.update_webhook_subscription',
      description: '更新 webhook 订阅',
      method: 'PATCH', path: '/v1/admin/webhook-subscriptions/:id',
      response_schema: GetWebhookSubscriptionResponseSchema,
      quota_cost: 0, preconditions: [],
    },
    {
      name: 'admin.delete_webhook_subscription',
      description: '删除 webhook 订阅',
      method: 'DELETE', path: '/v1/admin/webhook-subscriptions/:id',
      response_schema: null,
      quota_cost: 0, preconditions: [],
    },
```

### Step 4.2: 更新 skill.md

加 4 行到 admin capability 表。

### Step 4.3: 更新 capability count test

打开 `tests/unit/scripts/generate-skill-md-scenarios.test.ts`，更新 `expectedCount`：

```typescript
expect(stubCount).toBe(expectedCount);
// Sub-C +2 (51→53) | Sub-D2 +1 (→54) | Sub-D3 +1 (→55) | Sub-D4 +4 (→59) | Sub-E +4 (→63)
expect(expectedCount).toBe(63);
```

### Step 4.4: 跑 conformance test

```bash
cd /d/dev/hunter-platform && npx vitest run tests/integration/skill-md-conformance 2>&1 | tail -10
```

Expected: 全绿。

### Step 4.5: Commit

```bash
git -C D:/dev/hunter-platform add src/main/capabilities/admin.ts docs/superpowers/skill.md tests/unit/scripts/generate-skill-md-scenarios.test.ts
git -C D:/dev/hunter-platform commit -m "feat(admin): register 4 webhook-subscription capabilities + skill.md"
```

---

## Task 5: 集成测试 — webhook subscriptions

**Files:**
- Create: `tests/integration/admin-webhook-subs.test.ts`

### Step 5.1: 创建测试

Create `tests/integration/admin-webhook-subs.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('GET/POST/PATCH/DELETE /v1/admin/webhook-subscriptions (Sub-E Plan 1)', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-sube-webhook-subs-test.db');
  let app: any, db: any;
  let adminAuth = '';

  beforeAll(async () => {
    for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(testDb + s); } catch { /* */ }
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createAppFromDb } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { loadEnv } = await import('../../src/main/env');
    db = openDb(testDb);
    runMigrations(db);
    app = createAppFromDb(db, loadEnv());

    const pwdHash = bcrypt.hashSync('admin-pwd', 4);
    const keyHash = bcrypt.hashSync('hp_admin_sube_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_sube', 'SubE Admin', 'sube@test.com', pwdHash, keyHash, 'hp_admin_sube_aa', 'super', 'active',
      '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z'
    );
    const lr = await request(app).post('/v1/admin/auth/login').send({ email: 'sube@test.com', password: 'admin-pwd' });
    adminAuth = `Bearer ${lr.body.data.api_key}`;
  });

  afterAll(() => { if (db) db.close(); });

  it('1. GET returns empty list initially', async () => {
    const r = await request(app).get('/v1/admin/webhook-subscriptions').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });

  it('2. POST creates subscription with audit log', async () => {
    const r = await request(app).post('/v1/admin/webhook-subscriptions')
      .set('Authorization', adminAuth)
      .send({ target_url: 'https://example.com/webhook', event_types: ['placement.paid', 'candidate.unlocked'] });
    expect(r.status).toBe(200);
    expect(r.body.data.id).toBeGreaterThan(0);
    expect(r.body.data.target_url).toBe('https://example.com/webhook');
    expect(r.body.data.event_types).toEqual(['placement.paid', 'candidate.unlocked']);
    expect(r.body.data.enabled).toBe(true);

    // Verify audit log written
    const log = db.prepare(`SELECT * FROM admin_action_log WHERE action = 'create_webhook_subscription' ORDER BY id DESC LIMIT 1`).get() as any;
    expect(log).toBeTruthy();
    expect(log.target_id).toBe(String(r.body.data.id));
  });

  it('3. POST rejects invalid target_url', async () => {
    const r = await request(app).post('/v1/admin/webhook-subscriptions')
      .set('Authorization', adminAuth)
      .send({ target_url: 'ftp://invalid', event_types: ['x'] });
    expect(r.status).toBe(400);
  });

  it('4. POST rejects empty event_types', async () => {
    const r = await request(app).post('/v1/admin/webhook-subscriptions')
      .set('Authorization', adminAuth)
      .send({ target_url: 'https://example.com', event_types: [] });
    expect(r.status).toBe(400);
  });

  it('5. PATCH updates target_url', async () => {
    // First create
    const create = await request(app).post('/v1/admin/webhook-subscriptions')
      .set('Authorization', adminAuth)
      .send({ target_url: 'https://old.com', event_types: ['x'] });
    const id = create.body.data.id;
    // Then update
    const r = await request(app).patch(`/v1/admin/webhook-subscriptions/${id}`)
      .set('Authorization', adminAuth)
      .send({ target_url: 'https://new.com' });
    expect(r.status).toBe(200);
    expect(r.body.data.target_url).toBe('https://new.com');
  });

  it('6. PATCH non-existent → 404', async () => {
    const r = await request(app).patch('/v1/admin/webhook-subscriptions/99999')
      .set('Authorization', adminAuth)
      .send({ target_url: 'https://x.com' });
    expect(r.status).toBe(404);
  });

  it('7. DELETE removes subscription with audit log', async () => {
    const create = await request(app).post('/v1/admin/webhook-subscriptions')
      .set('Authorization', adminAuth)
      .send({ target_url: 'https://todelete.com', event_types: ['x'] });
    const id = create.body.data.id;
    const r = await request(app).delete(`/v1/admin/webhook-subscriptions/${id}`).set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    // Verify gone
    const get = await request(app).get('/v1/admin/webhook-subscriptions').set('Authorization', adminAuth);
    expect(get.body.data.find((s: any) => s.id === id)).toBeUndefined();
    // Verify audit
    const log = db.prepare(`SELECT * FROM admin_action_log WHERE action = 'delete_webhook_subscription' AND target_id = ?`).get(String(id)) as any;
    expect(log).toBeTruthy();
  });

  it('8. DELETE non-existent → 404', async () => {
    const r = await request(app).delete('/v1/admin/webhook-subscriptions/99999').set('Authorization', adminAuth);
    expect(r.status).toBe(404);
  });

  it('9. GET list returns created subscriptions', async () => {
    const r = await request(app).get('/v1/admin/webhook-subscriptions').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThan(0);
    expect(r.body.data[0]).toHaveProperty('event_types');
    expect(r.body.data[0].event_types).toBeInstanceOf(Array);
  });

  it('10. no auth → 401', async () => {
    const r = await request(app).get('/v1/admin/webhook-subscriptions');
    expect(r.status).toBe(401);
  });
});
```

### Step 5.2: 跑测试

```bash
cd /d/dev/hunter-platform && npx vitest run tests/integration/admin-webhook-subs.test.ts 2>&1 | tail -10
```

Expected: 10 通过。

### Step 5.3: Commit

```bash
git -C D:/dev/hunter-platform add tests/integration/admin-webhook-subs.test.ts
git -C D:/dev/hunter-platform commit -m "test(admin): integration tests for webhook-subscriptions CRUD (10 cases)"
```

---

## Task 6: 全验证 + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

### Step 6.1: 跑全部后端测试

```bash
cd /d/dev/hunter-platform && npx vitest run 2>&1 | tail -6
```

Expected: 956 + 10 = 966 通过。

### Step 6.2: Typecheck

```bash
cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -3
```

Expected: 无错误。

### Step 6.3: 加 CHANGELOG

打开 `CHANGELOG.md`，在 `v2.6.0 (Sub-D6 ...)` 之后加：

```markdown
## v2.7.0 (Sub-E Plan 1 — Backend Webhook Subscriptions) — 2026-06-25

### 新增功能
- **1 个 migration** (`v024_webhook_subscriptions`)：webhook_subscriptions 表
- **4 个 webhook subscription endpoint**：
  - `GET /v1/admin/webhook-subscriptions` (list)
  - `POST /v1/admin/webhook-subscriptions` (create, writes admin audit)
  - `PATCH /v1/admin/webhook-subscriptions/:id` (update, writes admin audit)
  - `DELETE /v1/admin/webhook-subscriptions/:id` (delete, writes admin audit)
- **4 个新 capability**：`admin.list/create/update/delete_webhook_subscription`
- **Config / Rate-Limit UI 后端**：0 改动（Rate-Limit 用现有 Config 表的 `rate_limit.*` key 存）

### Breaking changes
- 无

### 测试
- 后端 +10 个集成测试
```

### Step 6.4: Commit

```bash
git -C D:/dev/hunter-platform add CHANGELOG.md
git -C D:/dev/hunter-platform commit -m "docs(changelog): v2.7.0 — Sub-E Plan 1 (Backend Webhook Subscriptions)"
```

### Step 6.5: 最终 sanity check

```bash
git -C D:/dev/hunter-platform log --oneline -10
```

确认 Plan 1 6 个新 commit 都在。

---

## Done criteria（Plan 1 完成）

- [ ] webhook_subscriptions 表创建（migration v024）
- [ ] 4 endpoint 工作 + audit 写入
- [ ] 10 集成测试通过
- [ ] 全量测试不退（966+）
- [ ] CHANGELOG v2.7.0 加好
- [ ] 6 个 task 都 commit

**Plan 1 merge 后，Plan 2 (Frontend) 才可以开始：SettingsPage + 3 tabs + 4 API wrappers + 路由注册。**