# Web Admin Sub-D3 Plan 1: Backend Webhooks + Placements

> **For agentic workers:** REQUIRED SUB-KILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **前置依赖：** Plan 1 是自包含的 — backend 改动可独立 merge、ship。Plan 2 (frontend) 必须在 Plan 1 merge 后再做。

**Goal:** 把 `GET /v1/admin/webhooks/dead-letter` 和 `GET /v1/admin/placements` 改成 paginated envelope，加 event_type/min_attempt_count/status/from/until filter，注册 2 个新 capability。

**Architecture:**
- **后端**：2 个 schema + 2 个 handler 改造 + 2 个 route 改造 + 2 个 capability + skill.md
- **测试**：~12 个集成测试
- **数据库**：0 改动

**Tech Stack (existing):** Express 4.21, node:sqlite, zod, vitest, supertest
**Spec:** [docs/superpowers/specs/2026-06-25-web-admin-sub-D3-design.md](../specs/2026-06-25-web-admin-sub-D3-design.md) — §3 backend design

---

## 0. Reviewer decisions

| 反馈点 | 决策 |
|--------|------|
| handler return shape | `Array<T>` → `{ rows, total }`（breaking change 但只内部用） |
| webhook filter | event_type + min_attempt_count + 日期 |
| placement filter | status + 日期 |
| URL 持久化 | 不做（避免 scope） |
| webhook retry audit log | 不做（留 Sub-D4） |

---

## 现有代码上下文（开始 Task 1 前必读）

- `src/main/schemas/admin.ts` — `PaginationSchema` 已有（line 195）
- `src/main/modules/admin/handlers/webhooks.ts` — `listDeadLetter(limit=50)` 返回 array
- `src/main/modules/admin/handlers/placements.ts` — `list({status})` 返回 max 100 array
- `src/main/routes/admin.ts` — 已有 webhook/placement 路由（line 238+）
- `src/main/capabilities/admin.ts` — capability registry 模式

**不动文件：** `src/main/modules/admin/handlers/dashboard.ts`（Dashboard stats 不依赖这 2 个 handler 的 return shape）

---

## File Structure

| File | Change |
|------|--------|
| `src/main/schemas/admin.ts` | **Modify** — 加 `DeadLetterRowSchema` + `ListDeadLetterResponseSchema` + `PlacementRowSchema` + `ListPlacementsResponseSchema` |
| `src/main/modules/admin/handlers/webhooks.ts` | **Modify** — `listDeadLetter` 接受 filter + 返回 `{ rows, total }` |
| `src/main/modules/admin/handlers/placements.ts` | **Modify** — `list` 接受 filter + 返回 `{ rows, total }` |
| `src/main/routes/admin.ts` | **Modify** — 2 个 GET endpoint 加 pagination + filter |
| `src/main/capabilities/admin.ts` | **Modify** — 加 2 个 capability |
| `docs/superpowers/skill.md` | **Modify** — capability 列表 +2 行 |
| `tests/integration/admin-webhooks.test.ts` | **Modify/Create** — ~6 cases |
| `tests/integration/admin-placements.test.ts` | **Modify/Create** — ~7 cases |
| `CHANGELOG.md` | **Modify** — v2.3.0 条目 |

---

## Task 1: 加 schemas（DeadLetterRowSchema + PlacementRowSchema + 2 个 envelope）

**Files:**
- Modify: `src/main/schemas/admin.ts`

### Step 1.1: 加 DeadLetterRowSchema + ListDeadLetterResponseSchema

打开 `src/main/schemas/admin.ts`，找到 export `AdminLogListResponseSchema` 附近（line 179），在它后面追加：

```typescript
const DeadLetterRowSchema = z.object({
  id: z.number().int(),
  target_user_id: z.string(),
  event_type: z.string(),
  attempt_count: z.number().int(),
  last_error: z.string().nullable(),
  next_retry_at: z.string().nullable(),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});

const ListDeadLetterResponseSchema = z.object({
  ok: z.literal(true),
  data: z.array(DeadLetterRowSchema),
  pagination: PaginationSchema,
});

const PlacementRowSchema = z.object({
  id: z.string(),
  job_id: z.string(),
  employer_id: z.string(),
  anonymized_candidate_id: z.string(),
  primary_headhunter_id: z.string().nullable(),
  referrer_headhunter_id: z.string().nullable(),
  annual_salary: z.number(),
  platform_fee: z.number(),
  primary_share: z.number(),
  referrer_share: z.number(),
  status: z.enum(['pending_payment', 'paid', 'cancelled']),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});

const ListPlacementsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.array(PlacementRowSchema),
  pagination: PaginationSchema,
});
```

### Step 1.2: 加 exports

找到 export 块（line 209 附近），加：

```typescript
export { ListDeadLetterResponseSchema, ListPlacementsResponseSchema };
```

### Step 1.3: Typecheck

Run: `cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -5`
Expected: 无错误。如失败：检查 `PaginationSchema` 已在 schema 中定义（line 195）。

### Step 1.4: Commit

```bash
git -C D:/dev/hunter-platform add src/main/schemas/admin.ts
git -C D:/dev/hunter-platform commit -m "feat(admin-schemas): DeadLetterRowSchema + PlacementRowSchema + paginated envelopes"
```

---

## Task 2: handler 改造 — webhooks.listDeadLetter

**Files:**
- Modify: `src/main/modules/admin/handlers/webhooks.ts`

### Step 2.1: 改 listDeadLetter signature + body

打开 `src/main/modules/admin/handlers/webhooks.ts`，替换整个文件：

```typescript
// Migrated from src/main/ipc/webhooks.ts on 2026-06-20
import type { DB } from '../../../db/connection.js';
import { createWebhookQueueRepo } from '../../../db/repositories/webhook-delivery-queue.js';
import { Errors } from '../../../errors.js';

export type DeadLetterRow = {
  id: number;
  target_user_id: string;
  event_type: string;
  attempt_count: number;
  last_error: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ListDeadLetterFilter = {
  event_type?: string;
  min_attempt_count?: number;
  from?: string;
  until?: string;
  limit?: number;
  offset?: number;
};

export function createAdminWebhooksHandler(db: DB) {
  const wh = createWebhookQueueRepo(db);
  return {
    listDeadLetter(filter: ListDeadLetterFilter = {}): { rows: DeadLetterRow[]; total: number } {
      const where: string[] = ["status = 'dead_letter'"];
      const params: any[] = [];
      if (filter.event_type) {
        where.push('event_type = ?');
        params.push(filter.event_type);
      }
      if (filter.min_attempt_count !== undefined && filter.min_attempt_count !== null) {
        where.push('attempt_count >= ?');
        params.push(filter.min_attempt_count);
      }
      if (filter.from) {
        where.push('updated_at >= ?');
        params.push(filter.from);
      }
      if (filter.until) {
        where.push('updated_at < ?');
        params.push(filter.until);
      }
      const whereSql = where.join(' AND ');
      const total = (db.prepare(
        `SELECT COUNT(*) AS cnt FROM webhook_delivery_queue WHERE ${whereSql}`
      ).get(...params) as { cnt: number }).cnt;
      const rows = db.prepare(`
        SELECT id, target_user_id, event_type, attempt_count, last_error, next_retry_at, created_at, updated_at
        FROM webhook_delivery_queue WHERE ${whereSql}
        ORDER BY updated_at DESC LIMIT ? OFFSET ?
      `).all(...params, filter.limit ?? 20, filter.offset ?? 0) as DeadLetterRow[];
      return { rows, total };
    },
    retry(delivery_id: number): { id: number; status: string } {
      const rec = wh.findById(delivery_id);
      if (!rec) throw Errors.notFound('Delivery not found');
      if (rec.status !== 'dead_letter') throw Errors.invalidState(`Can only retry dead_letter, current: ${rec.status}`);
      db.prepare(
        "UPDATE webhook_delivery_queue SET status = 'pending', attempt_count = 0, last_error = NULL, next_retry_at = NULL, updated_at = ? WHERE id = ?"
      ).run(new Date().toISOString(), delivery_id);
      return { id: delivery_id, status: 'pending' };
    },
  };
}
```

### Step 2.2: Typecheck

Run: `cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -5`
Expected: 无错误。

### Step 2.3: Commit

```bash
git -C D:/dev/hunter-platform add src/main/modules/admin/handlers/webhooks.ts
git -C D:/dev/hunter-platform commit -m "feat(admin): webhooks.listDeadLetter — accept filter, return { rows, total }"
```

---

## Task 3: handler 改造 — placements.list

**Files:**
- Modify: `src/main/modules/admin/handlers/placements.ts`

### Step 3.1: 替换整个文件

打开 `src/main/modules/admin/handlers/placements.ts`，替换为：

```typescript
// Migrated from src/main/ipc/placements.ts on 2026-06-20
import type { DB } from '../../../db/connection.js';
import { createPlacementsRepo } from '../../../db/repositories/placements.js';
import { createAdminActionLogRepo } from '../../../db/repositories/admin-action-log.js';
import { createCommissionHandler } from '../../commission/handler.js';
import { createNotificationTrigger } from '../../notification/trigger.js';
import { Errors } from '../../../errors.js';

export type PlacementRow = {
  id: string;
  job_id: string;
  employer_id: string;
  anonymized_candidate_id: string;
  primary_headhunter_id: string | null;
  referrer_headhunter_id: string | null;
  annual_salary: number;
  platform_fee: number;
  primary_share: number;
  referrer_share: number;
  status: 'pending_payment' | 'paid' | 'cancelled';
  created_at: string;
  updated_at: string;
};

export type ListPlacementsFilter = {
  status?: 'pending_payment' | 'paid' | 'cancelled';
  from?: string;
  until?: string;
  limit?: number;
  offset?: number;
};

export function createAdminPlacementsHandler(db: DB, encryptionKey: Buffer) {
  const places = createPlacementsRepo(db);
  const adminLog = createAdminActionLogRepo(db);
  const notifTrigger = createNotificationTrigger(db);
  const commission = createCommissionHandler(db, encryptionKey, notifTrigger);

  return {
    list(filter: ListPlacementsFilter = {}): { rows: PlacementRow[]; total: number } {
      const where: string[] = ['1=1'];
      const params: any[] = [];
      if (filter.status) {
        where.push('p.status = ?');
        params.push(filter.status);
      }
      if (filter.from) {
        where.push('p.created_at >= ?');
        params.push(filter.from);
      }
      if (filter.until) {
        where.push('p.created_at < ?');
        params.push(filter.until);
      }
      const whereSql = where.join(' AND ');
      const total = (db.prepare(
        `SELECT COUNT(*) AS cnt FROM placements p WHERE ${whereSql}`
      ).get(...params) as { cnt: number }).cnt;
      const rows = db.prepare(`
        SELECT p.id, p.job_id, j.employer_id AS employer_id,
               p.anonymized_candidate_id,
               p.primary_headhunter_id, p.referrer_headhunter_id,
               p.annual_salary, p.platform_fee, p.primary_share, p.referrer_share,
               p.status, p.created_at, p.updated_at
        FROM placements p
        JOIN jobs j ON j.id = p.job_id
        WHERE ${whereSql}
        ORDER BY p.created_at DESC LIMIT ? OFFSET ?
      `).all(...params, filter.limit ?? 20, filter.offset ?? 0) as any[];
      const projected: PlacementRow[] = rows.map(r => ({
        id: r.id,
        job_id: r.job_id,
        employer_id: r.employer_id,
        anonymized_candidate_id: r.anonymized_candidate_id,
        primary_headhunter_id: r.primary_headhunter_id,
        referrer_headhunter_id: r.referrer_headhunter_id,
        annual_salary: r.annual_salary,
        platform_fee: r.platform_fee,
        primary_share: r.primary_share,
        referrer_share: r.referrer_share,
        status: r.status,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));
      return { rows: projected, total };
    },
    markPaid(adminUserId: string, placementId: string): { id: string; status: 'paid' } {
      const result = commission.markPaid(adminUserId, placementId);
      return { id: result.id, status: 'paid' };
    },
    cancel(adminUserId: string, placementId: string): { id: string; status: 'cancelled' } {
      const p = places.findById(placementId);
      if (!p) throw Errors.notFound('Placement not found');
      if (p.status === 'paid') throw Errors.invalidState('Cannot cancel paid placement');
      places.updateStatus(placementId, 'cancelled');
      adminLog.insert({
        admin_user_id: adminUserId, action: 'cancel_placement',
        target_type: 'placement', target_id: placementId,
        details_json: JSON.stringify({ previous_status: p.status }),
      });
      return { id: placementId, status: 'cancelled' };
    },
    summary(): {
      total_count: number; pending_payment_count: number; paid_count: number;
      cancelled_count: number; total_revenue: number;
    } {
      const rows = db.prepare(
        "SELECT status, COUNT(*) as cnt, COALESCE(SUM(platform_fee), 0) as total_fee FROM placements GROUP BY status"
      ).all() as { status: string; cnt: number; total_fee: number }[];
      let total_count = 0, pending_payment_count = 0, paid_count = 0, cancelled_count = 0, total_revenue = 0;
      for (const r of rows) {
        total_count += r.cnt;
        total_revenue += r.total_fee;
        if (r.status === 'pending_payment') pending_payment_count = r.cnt;
        if (r.status === 'paid') paid_count = r.cnt;
        if (r.status === 'cancelled') cancelled_count = r.cnt;
      }
      return { total_count, pending_payment_count, paid_count, cancelled_count, total_revenue };
    },
  };
}
```

### Step 3.2: Typecheck + 跑现有相关测试

Run: `cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -5`
Expected: 无错误。

Run: `cd /d/dev/hunter-platform && npx vitest run tests/integration/admin-endpoints.test.ts tests/integration/admin-list-pagination.test.ts 2>&1 | tail -8`
Expected: 现有测试不退。如失败：检查 commission.markPaid / cancel 调用方是否仍兼容。

### Step 3.3: Commit

```bash
git -C D:/dev/hunter-platform add src/main/modules/admin/handlers/placements.ts
git -C D:/dev/hunter-platform commit -m "feat(admin): placements.list — accept filter, return { rows, total }"
```

---

## Task 4: route 改造 — 2 个 GET endpoint

**Files:**
- Modify: `src/main/routes/admin.ts`

### Step 4.1: 加 imports

在 routes/admin.ts 顶部 import 块加：

```typescript
import {
  // ...已有...
  ListDeadLetterResponseSchema,
  ListPlacementsResponseSchema,
} from '../schemas/admin.js';
```

### Step 4.2: 替换 GET /v1/admin/webhooks/dead-letter route

找到现有 route（line 238 附近）：

```typescript
  router.get('/webhooks/dead-letter', (req, res, next) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      respond(res, DeadLetterListResponseSchema, { ok: true, data: webhooks.listDeadLetter(limit) }, { strict: true });
    } catch (e) { next(e); }
  });
```

替换为：

```typescript
  router.get('/webhooks/dead-letter', (req, res, next) => {
    try {
      const page = req.query.page !== undefined ? Number(req.query.page) : 1;
      const pageSize = req.query.pageSize !== undefined ? Number(req.query.pageSize) : 20;
      if (!Number.isFinite(page) || page < 1) throw Errors.invalidParams('page must be a positive integer');
      if (!Number.isFinite(pageSize) || pageSize < 1 || pageSize > 100) {
        throw Errors.invalidParams('pageSize must be 1-100');
      }
      const min_attempt_count = req.query.min_attempt_count
        ? Number(req.query.min_attempt_count)
        : undefined;
      if (min_attempt_count !== undefined && (!Number.isFinite(min_attempt_count) || min_attempt_count < 0)) {
        throw Errors.invalidParams('min_attempt_count must be a non-negative integer');
      }
      const { rows, total } = webhooks.listDeadLetter({
        event_type: typeof req.query.event_type === 'string' ? req.query.event_type : undefined,
        min_attempt_count,
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        until: typeof req.query.until === 'string' ? req.query.until : undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      respond(res, ListDeadLetterResponseSchema, {
        ok: true, data: rows,
        pagination: { total, page, pageSize, has_more: page * pageSize < total },
      }, { strict: true });
    } catch (e) { next(e); }
  });
```

### Step 4.3: 替换 GET /v1/admin/placements route

找到现有 route，替换为：

```typescript
  router.get('/placements', (req, res, next) => {
    try {
      const validStatuses = ['pending_payment', 'paid', 'cancelled'] as const;
      const statusParam = typeof req.query.status === 'string' ? req.query.status : '';
      if (statusParam && !(validStatuses as readonly string[]).includes(statusParam)) {
        throw Errors.invalidParams('status must be pending_payment|paid|cancelled');
      }
      const page = req.query.page !== undefined ? Number(req.query.page) : 1;
      const pageSize = req.query.pageSize !== undefined ? Number(req.query.pageSize) : 20;
      if (!Number.isFinite(page) || page < 1) throw Errors.invalidParams('page must be a positive integer');
      if (!Number.isFinite(pageSize) || pageSize < 1 || pageSize > 100) {
        throw Errors.invalidParams('pageSize must be 1-100');
      }
      const { rows, total } = placements.list({
        status: statusParam ? (statusParam as any) : undefined,
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        until: typeof req.query.until === 'string' ? req.query.until : undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      respond(res, ListPlacementsResponseSchema, {
        ok: true, data: rows,
        pagination: { total, page, pageSize, has_more: page * pageSize < total },
      }, { strict: true });
    } catch (e) { next(e); }
  });
```

### Step 4.4: Typecheck

Run: `cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -5`
Expected: 无错误。

### Step 4.5: Commit

```bash
git -C D:/dev/hunter-platform add src/main/routes/admin.ts
git -C D:/dev/hunter-platform commit -m "feat(admin): GET /v1/admin/webhooks/dead-letter + /placements — paginated envelope with filters"
```

---

## Task 5: capability + skill.md 同步

**Files:**
- Modify: `src/main/capabilities/admin.ts`
- Modify: `docs/superpowers/skill.md`

### Step 5.1: 加 2 个 capability

打开 `src/main/capabilities/admin.ts`，找到 `admin.get_timeline` 之后，加：

```typescript
    {
      name: 'admin.list_dead_letter',
      description: '列出 webhook 死信队列（含 event_type/min_attempt_count/日期 filter）',
      method: 'GET', path: '/v1/admin/webhooks/dead-letter',
      response_schema: ListDeadLetterResponseSchema,
      quota_cost: 0, preconditions: [],
    },
    {
      name: 'admin.list_placements',
      description: '列出 placements（含 status/日期 filter）',
      method: 'GET', path: '/v1/admin/placements',
      response_schema: ListPlacementsResponseSchema,
      quota_cost: 0, preconditions: [],
    },
```

### Step 5.2: 加 import（如文件已 zod import，加 ListDeadLetterResponseSchema + ListPlacementsResponseSchema）

### Step 5.3: 更新 skill.md

打开 `docs/superpowers/skill.md`，找到 admin capability 表，在 `admin.get_timeline` 行之后，加 2 行：

```
| admin.list_dead_letter | GET /v1/admin/webhooks/dead-letter | 列出 webhook 死信队列（filter: event_type/min_attempt_count/日期） |
| admin.list_placements | GET /v1/admin/placements | 列出 placements（filter: status/日期） |
```

格式按文件中已有 admin capability 行。

### Step 5.4: 跑 conformance test

Run: `cd /d/dev/hunter-platform && npx vitest run tests/integration/skill-md-conformance/ 2>&1 | tail -10`
Expected: 全绿。**注意：conformance test 的 capability count 期望值也要更新（Sub-C + Sub-D2 + 本次 = 54 + 2 = 56）**。如失败，编辑 `tests/unit/scripts/generate-skill-md-scenarios.test.ts` 把 `expectedCount` 改 56。

如仍报同样的 capability count failure（其他 capability 没新增），只改这个数。如还失败，看 stacktrace 修其他问题。

### Step 5.5: Commit

```bash
git -C D:/dev/hunter-platform add src/main/capabilities/admin.ts docs/superpowers/skill.md tests/unit/scripts/generate-skill-md-scenarios.test.ts
git -C D:/dev/hunter-platform commit -m "feat(admin): register admin.list_dead_letter + admin.list_placements capabilities"
```

---

## Task 6: 集成测试 — webhook 死信

**Files:**
- Modify/Create: `tests/integration/admin-webhooks.test.ts`

### Step 6.1: 创建测试文件

Create `tests/integration/admin-webhooks.test.ts`：

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('GET /v1/admin/webhooks/dead-letter (Sub-D3 Plan 1)', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-subd3-webhooks-test.db');
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
    const keyHash = bcrypt.hashSync('hp_admin_subd3_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_subd3', 'SubD3 Admin', 'subd3@test.com', pwdHash, keyHash, 'hp_admin_subd3_a', 'super', 'active',
      '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z'
    );
    const lr = await request(app).post('/v1/admin/auth/login').send({ email: 'subd3@test.com', password: 'admin-pwd' });
    adminAuth = `Bearer ${lr.body.data.api_key}`;

    // Seed 5 dead-letter rows + 2 pending rows (to verify filter)
    for (let i = 0; i < 5; i++) {
      db.prepare(`INSERT INTO webhook_delivery_queue
        (target_user_id, event_type, payload, status, attempt_count, last_error, created_at, updated_at)
        VALUES (?, ?, ?, 'dead_letter', ?, ?, ?, ?)`).run(
        `u_dl_${i}`, 'payment.succeeded', '{}', i + 1, `error ${i}`,
        '2026-06-25T00:00:00Z', new Date(Date.now() - i * 1000).toISOString()
      );
    }
    for (let i = 0; i < 2; i++) {
      db.prepare(`INSERT INTO webhook_delivery_queue
        (target_user_id, event_type, payload, status, attempt_count, created_at, updated_at)
        VALUES (?, 'placement.created', '{}', 'pending', 0, ?, ?)`).run(
        `u_p_${i}`, '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z'
      );
    }
  });

  afterAll(() => { if (db) db.close(); });

  it('1. default returns paginated envelope of dead_letter only', async () => {
    const r = await request(app).get('/v1/admin/webhooks/dead-letter').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.pagination.total).toBe(5);
    expect(r.body.data).toHaveLength(5);
    expect(r.body.data.every((row: any) => row.event_type === 'payment.succeeded')).toBe(true);
  });

  it('2. event_type filter', async () => {
    // Add one dead-letter of different type
    db.prepare(`INSERT INTO webhook_delivery_queue
      (target_user_id, event_type, payload, status, attempt_count, created_at, updated_at)
      VALUES ('u_other', 'placement.created', '{}', 'dead_letter', 1, ?, ?)`).run(
      '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z'
    );
    const r = await request(app).get('/v1/admin/webhooks/dead-letter?event_type=placement.created').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.pagination.total).toBe(1);
    expect(r.body.data[0].event_type).toBe('placement.created');
  });

  it('3. min_attempt_count filter', async () => {
    const r = await request(app).get('/v1/admin/webhooks/dead-letter?min_attempt_count=3').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data.every((row: any) => row.attempt_count >= 3)).toBe(true);
  });

  it('4. time range filter (updated_at)', async () => {
    // Get all current rows' updated_at, filter by a range
    const fromTs = new Date(Date.now() - 3 * 1000).toISOString();
    const r = await request(app).get(`/v1/admin/webhooks/dead-letter?from=${encodeURIComponent(fromTs)}`).set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('5. POST /webhooks/:id/retry → status=pending', async () => {
    const id = (db.prepare("SELECT id FROM webhook_delivery_queue WHERE status = 'dead_letter' LIMIT 1").get() as any).id;
    const r = await request(app).post(`/v1/admin/webhooks/${id}/retry`).set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ id, status: 'pending' });
    // Verify DB updated
    const updated = db.prepare('SELECT status FROM webhook_delivery_queue WHERE id = ?').get(id) as any;
    expect(updated.status).toBe('pending');
  });

  it('6. retry non-existent → 404', async () => {
    const r = await request(app).post('/v1/admin/webhooks/99999/retry').set('Authorization', adminAuth);
    expect(r.status).toBe(404);
  });
});
```

### Step 6.2: 跑测试

Run: `cd /d/dev/hunter-platform && npx vitest run tests/integration/admin-webhooks.test.ts 2>&1 | tail -10`
Expected: 6 通过。

如失败：检查 `webhook_delivery_queue` 表的实际列名（可能不是 `target_user_id` / `payload` / `status`）。按实际列调整 INSERT SQL。

### Step 6.3: Commit

```bash
git -C D:/dev/hunter-platform add tests/integration/admin-webhooks.test.ts
git -C D:/dev/hunter-platform commit -m "test(admin): integration tests for webhooks/dead-letter + retry (paginated + filter)"
```

---

## Task 7: 集成测试 — placements

**Files:**
- Create: `tests/integration/admin-placements.test.ts`

### Step 7.1: 创建测试文件

Create `tests/integration/admin-placements.test.ts`：

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('GET /v1/admin/placements (Sub-D3 Plan 1)', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-subd3-placements-test.db');
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
    const keyHash = bcrypt.hashSync('hp_admin_subd3_p_aa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_subd3_p', 'SubD3 Admin', 'subd3p@test.com', pwdHash, keyHash, 'hp_admin_subd3_p', 'super', 'active',
      '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z'
    );
    const lr = await request(app).post('/v1/admin/auth/login').send({ email: 'subd3p@test.com', password: 'admin-pwd' });
    adminAuth = `Bearer ${lr.body.data.api_key}`;

    // Seed jobs + placements
    db.prepare(`INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
      quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
      VALUES ('emp_1', 'employer', 'E1', 'e@x', 'h', 'hp_emp_1', 100, 0, datetime('now','+1 day'), 50, 'active', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run();
    db.prepare(`INSERT INTO jobs (id, employer_id, title, status, created_at, updated_at)
      VALUES ('job_1', 'emp_1', 'Senior Eng', 'open', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run();
    db.prepare(`INSERT INTO jobs (id, employer_id, title, status, created_at, updated_at)
      VALUES ('job_2', 'emp_1', 'PM', 'open', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run();

    // 4 placements: 2 pending, 1 paid, 1 cancelled
    for (const [id, status] of [['p_1', 'pending_payment'], ['p_2', 'pending_payment'], ['p_3', 'paid'], ['p_4', 'cancelled']] as const) {
      db.prepare(`INSERT INTO placements (id, job_id, anonymized_candidate_id, candidate_user_id,
        primary_headhunter_id, referrer_headhunter_id, annual_salary, platform_fee, primary_share, referrer_share,
        candidate_bonus, status, created_at, updated_at)
        VALUES (?, 'job_1', 'c_1', 'u_1', NULL, NULL, 500000, 50000, 40000, 10000, 0, ?, '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run(
        id, status
      );
    }
  });

  afterAll(() => { if (db) db.close(); });

  it('1. default returns all 4 placements', async () => {
    const r = await request(app).get('/v1/admin/placements').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.pagination.total).toBe(4);
    expect(r.body.data).toHaveLength(4);
  });

  it('2. status=paid filter returns only paid', async () => {
    const r = await request(app).get('/v1/admin/placements?status=paid').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.pagination.total).toBe(1);
    expect(r.body.data.every((row: any) => row.status === 'paid')).toBe(true);
  });

  it('3. status=invalid → 400', async () => {
    const r = await request(app).get('/v1/admin/placements?status=garbage').set('Authorization', adminAuth);
    expect(r.status).toBe(400);
  });

  it('4. from/until time range', async () => {
    const fromTs = '2026-06-24T00:00:00Z';
    const r = await request(app).get(`/v1/admin/placements?from=${encodeURIComponent(fromTs)}`).set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBe(4);
  });

  it('5. POST /placements/:id/mark-paid → status=paid', async () => {
    const r = await request(app).post('/v1/admin/placements/p_1/mark-paid').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ id: 'p_1', status: 'paid' });
  });

  it('6. POST /placements/:id/cancel → status=cancelled (with audit log)', async () => {
    const r = await request(app).post('/v1/admin/placements/p_2/cancel').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ id: 'p_2', status: 'cancelled' });
    // Verify audit log written
    const log = db.prepare(`SELECT * FROM admin_action_log WHERE target_id = 'p_2' AND action = 'cancel_placement'`).get() as any;
    expect(log).toBeTruthy();
  });

  it('7. cancel paid → 400 invalid_state', async () => {
    const r = await request(app).post('/v1/admin/placements/p_3/cancel').set('Authorization', adminAuth);
    expect(r.status).toBe(400);
  });
});
```

### Step 7.2: 跑测试

Run: `cd /d/dev/hunter-platform && npx vitest run tests/integration/admin-placements.test.ts 2>&1 | tail -10`
Expected: 7 通过。

如失败：检查 `placements` 表实际列名（如 `candidate_user_id` 是否存在、commission 表是否需要 seed data）。按实际 schema 调整。

### Step 7.3: Commit

```bash
git -C D:/dev/hunter-platform add tests/integration/admin-placements.test.ts
git -C D:/dev/hunter-platform commit -m "test(admin): integration tests for placements list + mark-paid + cancel"
```

---

## Task 8: 全量验证 + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

### Step 8.1: 跑全部后端测试

Run: `cd /d/dev/hunter-platform && npx vitest run 2>&1 | tail -6`
Expected: 全绿（933 + 13 = ~946 tests）。

### Step 8.2: Typecheck

Run: `cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -3`
Expected: 无错误。

### Step 8.3: 加 CHANGELOG

打开 `CHANGELOG.md`，在 `v2.2.0 (Sub-D2 — Per-Entity Timeline)` 之后加：

```markdown
## v2.3.0 (Sub-D3 Plan 1 — Backend Webhooks + Placements) — 2026-06-25

### 新增功能
- **GET /v1/admin/webhooks/dead-letter**：paginated envelope + 4 个 filter（event_type/min_attempt_count/from/until）
- **GET /v1/admin/placements**：paginated envelope + 3 个 filter（status/from/until）
- **新 capability**：`admin.list_dead_letter` + `admin.list_placements`

### Breaking changes（admin-web 同步修复）
- 2 个 GET endpoint 之前返回 flat array，现在返回 `{ ok, data, pagination }` envelope
- 仅 admin-web 调用，影响本项目 frontend（Plan 2 同步上 UI）

### 测试
- 后端 +13 个集成测试
```

### Step 8.4: Commit

```bash
git -C D:/dev/hunter-platform add CHANGELOG.md
git -C D:/dev/hunter-platform commit -m "docs(changelog): v2.3.0 — Sub-D3 Plan 1 (Backend Webhooks + Placements)"
```

### Step 8.5: 最终 sanity check

```bash
git -C D:/dev/hunter-platform log --oneline -15
```

确认 Plan 1 所有 task 已 commit（应有 8 个新 commit）。

---

## Done criteria（Plan 1 完成）

- [ ] 2 个 GET endpoint 返回 paginated envelope
- [ ] ~13 集成测试通过
- [ ] Capability + skill.md 注册
- [ ] 全量测试不退（946+）
- [ ] CHANGELOG v2.3.0 条目加好
- [ ] 8 个 task 都 commit

**Plan 1 merge 后，Plan 2 (Frontend) 才可以开始：2 个 page + ConfirmModal + api wrappers + 路由注册。**