# Web Admin Sub-D4 Plan 1: Backend (Webhook Retry Audit + 4 GET :id)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **前置依赖：** Plan 1 是自包含的 — backend 改动可独立 merge、ship。Plan 2 (frontend) 必须在 Plan 1 merge 后再做（前端消费新 endpoint）。

**Goal:** 修 `webhooks.retry()` 写 audit log + 加 4 个 GET :id endpoint（user / candidate / job / recommendation）。

**Architecture:**
- **后端**：1 handler 修复 + 4 handler 加 get() 方法 + 1 route 改造（加 adminUserId） + 4 routes 新增 + 5 schema
- **测试**：~9 个集成测试
- **数据库**：0 改动

**Tech Stack (existing):** Express 4.21, node:sqlite, zod, vitest, supertest
**Spec:** [docs/superpowers/specs/2026-06-25-web-admin-sub-D4-design.md](../specs/2026-06-25-web-admin-sub-D4-design.md) — §3 backend design

---

## 0. Reviewer decisions

| 反馈点 | 决策 |
|--------|------|
| webhook retry audit | best-effort，audit 写失败不回滚 retry |
| 4 GET :id | 追加非 breaking，4 个 entity type |
| handler return shape | `T | null`（找不到时 null，route 抛 404） |
| 4 个新 schema | 复用现有 Row schema（如 UserRowSchema 已有） |

---

## 现有代码上下文（开始 Task 1 前必读）

- `src/main/modules/admin/handlers/webhooks.ts` — `retry(delivery_id)` 现状不写 audit
- `src/main/db/repositories/admin-action-log.ts` — `adminLog.insert({...})` API
- `src/main/modules/admin/handlers/users.ts` / `jobs.ts` / `candidates.ts` / `recommendations.ts` — 现有 list()，无 get()
- `src/main/routes/admin.ts` — existing retry route line 244 附近
- `src/main/schemas/admin.ts` — 已有 UserRow / JobRow / RecommendationRow 等 schema（如缺则需新加）

**不动文件：** `dashboard.ts`（Dashboard handler 不依赖这 4 个 get）

---

## File Structure

| File | Change |
|------|--------|
| `src/main/modules/admin/handlers/webhooks.ts` | **Modify** — retry() 加 adminUserId + 写 audit |
| `src/main/modules/admin/handlers/users.ts` | **Modify** — 加 get(id) |
| `src/main/modules/admin/handlers/jobs.ts` | **Modify** — 加 get(id) |
| `src/main/modules/admin/handlers/candidates.ts` | **Modify** — 加 get(id) |
| `src/main/modules/admin/handlers/recommendations.ts` | **Modify** — 加 get(id) |
| `src/main/routes/admin.ts` | **Modify** — retry 透传 adminUserId + 4 个新 GET :id routes |
| `src/main/schemas/admin.ts` | **Modify** — 4 个新 envelope schema（如果还没有） |
| `tests/integration/admin-webhooks.test.ts` | **Modify** — 加 audit 写入 case |
| `tests/integration/admin-get-by-id.test.ts` | **Create** — 4 endpoint × 2 case = 8 case |
| `CHANGELOG.md` | **Modify** — v2.4.0 条目 |

---

## Task 1: webhooks.retry() 加 adminUserId + 写 audit

**Files:**
- Modify: `src/main/modules/admin/handlers/webhooks.ts`

### Step 1.1: 改 retry() 签名

打开 `src/main/modules/admin/handlers/webhooks.ts`，替换整个文件：

```typescript
// Migrated from src/main/ipc/webhooks.ts on 2026-06-20
import type { DB } from '../../../db/connection.js';
import { createWebhookQueueRepo } from '../../../db/repositories/webhook-delivery-queue.js';
import { createAdminActionLogRepo } from '../../../db/repositories/admin-action-log.js';
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
  const adminLog = createAdminActionLogRepo(db);
  return {
    listDeadLetter(filter: ListDeadLetterFilter = {}): { rows: DeadLetterRow[]; total: number } {
      // ... same as before (unchanged) ...
      const where: string[] = ["status = 'dead_letter'"];
      const params: any[] = [];
      if (filter.event_type) { where.push('event_type = ?'); params.push(filter.event_type); }
      if (filter.min_attempt_count !== undefined && filter.min_attempt_count !== null) {
        where.push('attempt_count >= ?'); params.push(filter.min_attempt_count);
      }
      if (filter.from) { where.push('updated_at >= ?'); params.push(filter.from); }
      if (filter.until) { where.push('updated_at < ?'); params.push(filter.until); }
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
    retry(adminUserId: string, delivery_id: number): { id: number; status: string } {
      const rec = wh.findById(delivery_id);
      if (!rec) throw Errors.notFound('Delivery not found');
      if (rec.status !== 'dead_letter') throw Errors.invalidState(`Can only retry dead_letter, current: ${rec.status}`);
      db.prepare(
        "UPDATE webhook_delivery_queue SET status = 'pending', attempt_count = 0, last_error = NULL, next_retry_at = NULL, updated_at = ? WHERE id = ?"
      ).run(new Date().toISOString(), delivery_id);
      // Sub-D4: write audit log (best-effort, no rollback if this fails)
      try {
        adminLog.insert({
          admin_user_id: adminUserId,
          action: 'retry_webhook',
          target_type: 'webhook_delivery',
          target_id: String(delivery_id),
          details_json: JSON.stringify({
            event_type: rec.event_type,
            target_user_id: rec.target_user_id,
            previous_attempt_count: rec.attempt_count,
          }),
        });
      } catch (e) {
        console.error('[webhooks.retry] audit log insert failed:', e);
        // best-effort: do not rollback retry
      }
      return { id: delivery_id, status: 'pending' };
    },
  };
}
```

### Step 1.2: Typecheck

Run: `cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -5`
Expected: 无错误（应有调用方 errors，见 Task 2 修复）。

### Step 1.3: Commit（不等到 Task 2，因为 plan task 是独立的）

```bash
git -C D:/dev/hunter-platform add src/main/modules/admin/handlers/webhooks.ts
git -C D:/dev/hunter-platform commit -m "feat(admin): webhooks.retry — accept adminUserId + write audit log"
```

---

## Task 2: 改 retry route 透传 adminUserId

**Files:**
- Modify: `src/main/routes/admin.ts`

### Step 2.1: 改 route

找到 `router.post('/webhooks/:id/retry', ...)`，替换为：

```typescript
  router.post('/webhooks/:id/retry', (req, res, next) => {
    try {
      const adminUserId = (req as any).admin?.id;
      if (!adminUserId) throw Errors.unauthorized();
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) throw Errors.invalidParams('id must be a number');
      respond(res, /* schema */, { ok: true, data: webhooks.retry(adminUserId, id) });
    } catch (e) { next(e); }
  });
```

注：schema 用现有的（如果 DeadLetterListResponse 之类的不适用，可省略 strict 校验；这里仅传 data，无需严格 envelope schema——但要 match 现有 pattern 就用 dead-letter list schema 或简化的 object schema）。

### Step 2.2: Typecheck

Run: `cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -3`
Expected: 无错误。

### Step 2.3: 跑现有相关测试

Run: `cd /d/dev/hunter-platform && npx vitest run tests/integration/admin-webhooks.test.ts 2>&1 | tail -8`
Expected: 现有测试仍 pass（可能需要更新 retry call site 传 adminUserId — 见 Step 2.5）。

### Step 2.4: 如现有测试有 retry call 报缺 adminUserId 参数错误

打开 `tests/integration/admin-webhooks.test.ts`，找到 `webhooks.retry(...)` 或 `/webhooks/:id/retry` HTTP 测试，给所有 retry 调用加 `adminUserId`：
- handler 直接调用：`webhooks.retry('adm_test', id)`（用已有的 admin id）
- HTTP route 调用：保持不变（route 从 req.admin 取）

### Step 2.5: Commit

```bash
git -C D:/dev/hunter-platform add src/main/routes/admin.ts tests/integration/admin-webhooks.test.ts
git -C D:/dev/hunter-platform commit -m "feat(admin): retry route — pass adminUserId from req.admin to webhooks.retry"
```

---

## Task 3: 4 个 handler 加 get() 方法

**Files:**
- Modify: 4 handler files

### Step 3.1: users.ts 加 get(id)

打开 `src/main/modules/admin/handlers/users.ts`，在 handler 内部加：

```typescript
    get(id: string): UserPublic | null {
      return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserPublic | null;
    },
```

找到合适位置（紧接 `list()` 之后）。

### Step 3.2: jobs.ts 加 get(id)

类似：

```typescript
    get(id: string): JobRow | null {
      return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | null;
    },
```

### Step 3.3: candidates.ts 加 get(id)

```typescript
    get(id: string): CandidateRow | null {
      return db.prepare('SELECT * FROM candidates_anonymized WHERE anonymized_id = ?').get(id) as CandidateRow | null;
    },
```

注：candidates 的 id 是 `anonymized_id`（不是 candidates_private 的 id）。

### Step 3.4: recommendations.ts 加 get(id)

```typescript
    get(id: string): RecommendationRow | null {
      return db.prepare(`
        SELECT r.id, r.job_id, r.anonymized_candidate_id, r.headhunter_user_id,
               j.title AS job_title, c.industry AS candidate_industry,
               u.name AS headhunter_name, r.status, r.created_at, r.updated_at
        FROM recommendations r
        LEFT JOIN jobs j ON j.id = r.job_id
        LEFT JOIN candidates_anonymized c ON c.anonymized_id = r.anonymized_candidate_id
        LEFT JOIN users u ON u.id = r.headhunter_user_id
        WHERE r.id = ?
      `).get(id) as RecommendationRow | null;
    },
```

注：根据 recommendations 表实际列名调整（可能是 `headhunter_id` 或 `headhunter_user_id`）。需要先查 DB schema。

### Step 3.5: Typecheck

Run: `cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -5`
Expected: 无错误。如 TypeScript 报 get 缺失，可能是 handler 没 export 类型；检查每个 handler 的 return type 注解。

### Step 3.6: Commit

```bash
git -C D:/dev/hunter-platform add src/main/modules/admin/handlers/users.ts src/main/modules/admin/handlers/jobs.ts src/main/modules/admin/handlers/candidates.ts src/main/modules/admin/handlers/recommendations.ts
git -C D:/dev/hunter-platform commit -m "feat(admin): add get(id) to users/jobs/candidates/recommendations handlers"
```

---

## Task 4: 4 个 GET :id routes

**Files:**
- Modify: `src/main/routes/admin.ts`
- Modify: `src/main/schemas/admin.ts` (如缺)

### Step 4.1: 加 4 个 schema envelope（如缺）

打开 `src/main/schemas/admin.ts`，找到现有 envelope schema 区域，加：

```typescript
// Get-by-id envelope (no pagination, single row)
const GetUserResponseSchema = z.object({
  ok: z.literal(true),
  data: UserPublicSchema,  // 如已有就用现有的；缺则加
});
const GetJobResponseSchema = z.object({
  ok: z.literal(true),
  data: JobRowSchema,
});
const GetCandidateResponseSchema = z.object({
  ok: z.literal(true),
  data: CandidateRowSchema,  // 如已有
});
const GetRecommendationResponseSchema = z.object({
  ok: z.literal(true),
  data: RecommendationRowSchema,
});
```

如有 schema 已存在（如 Sub-C 加过），直接用，跳过 schema 定义。

### Step 4.2: 在 routes/admin.ts 加 4 个 routes

找到 `router.get('/users/:id', ...)` 应不存在（确认），在合适位置（如 `/users` route 之后）加：

```typescript
  // Sub-D4: get-by-id
  const getById = (handler: (id: string) => any, schema: any) => (req: any, res: any, next: any) => {
    try {
      const id = req.params.id;
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw Errors.invalidParams('id has invalid format');
      const row = handler(id);
      if (!row) throw Errors.notFound('Not found');
      respond(res, schema, { ok: true, data: row }, { strict: true });
    } catch (e) { next(e); }
  };

  router.get('/users/:id', getById(users.get, GetUserResponseSchema));
  router.get('/jobs/:id', getById(jobs.get, GetJobResponseSchema));
  router.get('/candidates/:id', getById(candidates.get, GetCandidateResponseSchema));
  router.get('/recommendations/:id', getById(recommendations.get, GetRecommendationResponseSchema));
```

注：route 顺序——`/users/:id` 必须在 `/users` 之后避免冲突；同样 `/users/:id/timeline`（Sub-D2 已存在）也要在 `/users/:id` 之后。

### Step 4.3: Typecheck

Run: `cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -5`
Expected: 无错误。

### Step 4.4: 跑现有相关测试

Run: `cd /d/dev/hunter-platform && npx vitest run tests/integration/admin-endpoints.test.ts tests/integration/admin-list-pagination.test.ts 2>&1 | tail -8`
Expected: 现有不退。

### Step 4.5: Commit

```bash
git -C D:/dev/hunter-platform add src/main/routes/admin.ts src/main/schemas/admin.ts
git -C D:/dev/hunter-platform commit -m "feat(admin): 4 GET :id routes (users/jobs/candidates/recommendations) with paginated envelope"
```

---

## Task 5: 集成测试 — webhook retry 写 audit

**Files:**
- Modify: `tests/integration/admin-webhooks.test.ts`

### Step 5.1: 加测试

打开 `tests/integration/admin-webhooks.test.ts`，找到 test 5（retry），加新 case：

```typescript
  it('7. retry writes admin_action_log row', async () => {
    // Pick a dead_letter id
    const id = (db.prepare("SELECT id FROM webhook_delivery_queue WHERE status = 'dead_letter' LIMIT 1").get() as any).id;
    const beforeCount = (db.prepare("SELECT COUNT(*) AS c FROM admin_action_log WHERE action = 'retry_webhook'").get() as { c: number }).c;

    const r = await request(app).post(`/v1/admin/webhooks/${id}/retry`).set('Authorization', adminAuth);
    expect(r.status).toBe(200);

    const afterCount = (db.prepare("SELECT COUNT(*) AS c FROM admin_action_log WHERE action = 'retry_webhook'").get() as { c: number }).c;
    expect(afterCount).toBe(beforeCount + 1);

    const log = db.prepare(`SELECT * FROM admin_action_log WHERE target_id = ? AND action = 'retry_webhook' ORDER BY id DESC LIMIT 1`).get(String(id)) as any;
    expect(log).toBeTruthy();
    expect(log.admin_user_id).toBeTruthy();
    const details = JSON.parse(log.details_json);
    expect(details).toHaveProperty('event_type');
    expect(details).toHaveProperty('target_user_id');
    expect(details).toHaveProperty('previous_attempt_count');
  });
```

### Step 5.2: 跑测试

Run: `cd /d/dev/hunter-platform && npx vitest run tests/integration/admin-webhooks.test.ts 2>&1 | tail -8`
Expected: 7 通过（含新加的 case 7）。

### Step 5.3: Commit

```bash
git -C D:/dev/hunter-platform add tests/integration/admin-webhooks.test.ts
git -C D:/dev/hunter-platform commit -m "test(admin): webhook retry writes admin_action_log row"
```

---

## Task 6: 集成测试 — 4 个 GET :id

**Files:**
- Create: `tests/integration/admin-get-by-id.test.ts`

### Step 6.1: 创建测试文件

Create `tests/integration/admin-get-by-id.test.ts`：

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('GET /v1/admin/{entity}/:id (Sub-D4 Plan 1)', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-subd4-test.db');
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
    const keyHash = bcrypt.hashSync('hp_admin_subd4_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_subd4', 'SubD4 Admin', 'subd4@test.com', pwdHash, keyHash, 'hp_admin_subd4_a', 'super', 'active',
      '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z'
    );
    const lr = await request(app).post('/v1/admin/auth/login').send({ email: 'subd4@test.com', password: 'admin-pwd' });
    adminAuth = `Bearer ${lr.body.data.api_key}`;

    // Seed minimal data
    db.prepare(`INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
      quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
      VALUES ('u_test_1', 'candidate', 'Test User', 'u@x', 'h', 'hp_test_1', 100, 0,
      datetime('now', '+1 day'), 50, 'active', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run();
  });

  afterAll(() => { if (db) db.close(); });

  it('1. GET /users/u_test_1 returns user', async () => {
    const r = await request(app).get('/v1/admin/users/u_test_1').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.data.id).toBe('u_test_1');
    expect(r.body.data.name).toBe('Test User');
  });

  it('2. GET /users/nonexistent → 404', async () => {
    const r = await request(app).get('/v1/admin/users/nonexistent').set('Authorization', adminAuth);
    expect(r.status).toBe(404);
  });

  it('3. GET /jobs/nonexistent → 404', async () => {
    const r = await request(app).get('/v1/admin/jobs/nonexistent').set('Authorization', adminAuth);
    expect(r.status).toBe(404);
  });

  it('4. GET /candidates/nonexistent → 404', async () => {
    const r = await request(app).get('/v1/admin/candidates/nonexistent').set('Authorization', adminAuth);
    expect(r.status).toBe(404);
  });

  it('5. GET /recommendations/nonexistent → 404', async () => {
    const r = await request(app).get('/v1/admin/recommendations/nonexistent').set('Authorization', adminAuth);
    expect(r.status).toBe(404);
  });

  it('6. invalid id format (special chars) → 400', async () => {
    const r = await request(app).get("/v1/admin/users/u'test").set('Authorization', adminAuth);
    expect(r.status).toBe(400);
  });

  it('7. no auth → 401', async () => {
    const r = await request(app).get('/v1/admin/users/u_test_1');
    expect(r.status).toBe(401);
  });

  it('8. happy path for jobs after seed', async () => {
    db.prepare(`INSERT INTO jobs (id, employer_id, title, status, created_at, updated_at)
      VALUES ('job_test_1', 'u_test_1', 'Test Job', 'open', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run();
    const r = await request(app).get('/v1/admin/jobs/job_test_1').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data.title).toBe('Test Job');
  });
});
```

### Step 6.2: 跑测试

Run: `cd /d/dev/hunter-platform && npx vitest run tests/integration/admin-get-by-id.test.ts 2>&1 | tail -8`
Expected: 8 通过。

### Step 6.3: Commit

```bash
git -C D:/dev/hunter-platform add tests/integration/admin-get-by-id.test.ts
git -C D:/dev/hunter-platform commit -m "test(admin): integration tests for 4 GET :id endpoints (happy + 404 + 400 + 401)"
```

---

## Task 7: 全量验证 + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

### Step 7.1: 跑全部后端测试

Run: `cd /d/dev/hunter-platform && npx vitest run 2>&1 | tail -6`
Expected: 全绿（947 + 9 = ~956 tests）。

### Step 7.2: Typecheck

Run: `cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -3`
Expected: 无错误。

### Step 7.3: 加 CHANGELOG

打开 `CHANGELOG.md`，在 `v2.3.0 (Sub-D3 ...)` 之后加：

```markdown
## v2.4.0 (Sub-D4 Plan 1 — Backend Detail + Retry Audit) — 2026-06-25

### 新增功能
- **4 个 GET :id endpoint**：`/v1/admin/users/:id` + `/jobs/:id` + `/candidates/:id` + `/recommendations/:id`（返回单条 entity，404 if not found）
- **Webhook retry 写 audit log**（Sub-D3 known limitation fix）：`webhooks.retry()` 现在写 `admin_action_log`（action='retry_webhook'，含 event_type/target_user_id/previous_attempt_count）

### Breaking changes
- `webhooks.retry()` handler signature 加 `adminUserId` 参数

### 测试
- 后端 +9 个集成测试
```

### Step 7.4: Commit

```bash
git -C D:/dev/hunter-platform add CHANGELOG.md
git -C D:/dev/hunter-platform commit -m "docs(changelog): v2.4.0 — Sub-D4 Plan 1 (Backend)"
```

### Step 7.5: 最终 sanity check

```bash
git -C D:/dev/hunter-platform log --oneline -15
```

确认 Plan 1 7 个新 commit 都在。

---

## Done criteria（Plan 1 完成）

- [ ] webhooks.retry 写 audit log
- [ ] 4 个 GET :id endpoint 工作
- [ ] ~9 集成测试通过
- [ ] 全量测试不退（956+）
- [ ] CHANGELOG v2.4.0 加好
- [ ] 7 个 task 都 commit

**Plan 1 merge 后，Plan 2 (Frontend) 才可以开始：4 个详情 page + 4 列表页按钮 + 4 API wrapper + 路由注册。**