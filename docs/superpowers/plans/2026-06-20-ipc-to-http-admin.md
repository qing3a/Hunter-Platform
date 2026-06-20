# IPC → HTTP Admin Endpoints 迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `src/main/ipc/` 里 18 个 Electron IPC admin 操作迁移为 HTTP admin 端点，然后删除整个 IPC 模块及其依赖，让项目彻底 API-only。

**Architecture:** 在 `src/main/routes/admin.ts` 新建一个 Express router，挂载到 `/v1/admin`。所有 admin 端点统一通过 `adminAuthMiddleware`（基于 `ADMIN_PASSWORD_HASH` 的 bcrypt 校验 + Bearer token）保护。复用 `src/main/ipc/*` 里的 handler 逻辑（先重构到 `src/main/modules/admin/*.ts`），路由层只做参数解析 + 响应包装。

**Tech Stack:** Express 4.21, supertest, vitest, bcryptjs (admin auth), zod (input validation)。

---

## 背景

**当前状态**：
- `src/main/ipc/` 里有 10 个文件，全部使用 `ipcMain.handle(...)`
- **没有任何文件引用它们**（`grep -rn "registerAdminIpc" src/` 只有定义点）
- Electron 的 preload/renderer 目录不存在
- 项目 README 已明确 API-only 模式，但 IPC 代码是历史遗留
- `ADMIN_PASSWORD_HASH` 在 `src/main/env.ts:19` 已定义但**从未被使用**

**18 个 admin 操作（按 IPC channel 分类）**：

| Channel | HTTP 方法 + 路径 | 文件 |
|---------|-----------------|------|
| `admin:ping` | `GET /v1/admin/ping` | — |
| `admin:dashboard:getStats` | `GET /v1/admin/dashboard/stats` | `dashboard.ts` |
| `admin:users:list` | `GET /v1/admin/users` | `users.ts` |
| `admin:users:suspend` | `POST /v1/admin/users/:id/suspend` | `users.ts` |
| `admin:users:unsuspend` | `POST /v1/admin/users/:id/unsuspend` | `users.ts` |
| `admin:users:adjustQuota` | `POST /v1/admin/users/:id/adjust-quota` | `users.ts` |
| `admin:candidates:list` | `GET /v1/admin/candidates` | `candidates.ts` |
| `admin:candidates:removeFromPool` | `POST /v1/admin/candidates/:id/remove-from-pool` | `candidates.ts` |
| `admin:audit:list` | `GET /v1/admin/audit` | `audit.ts` |
| `admin:webhooks:listDeadLetter` | `GET /v1/admin/webhooks/dead-letter` | `webhooks.ts` |
| `admin:webhooks:retry` | `POST /v1/admin/webhooks/:id/retry` | `webhooks.ts` |
| `admin:rateLimit:listBuckets` | `GET /v1/admin/rate-limit/buckets` | `rate-limit.ts` |
| `admin:rateLimit:clearForUser` | `POST /v1/admin/rate-limit/users/:id/clear` | `rate-limit.ts` |
| `admin:config:get` | `GET /v1/admin/config` | `config.ts` |
| `admin:config:set` | `PUT /v1/admin/config/:key` | `config.ts` |
| `admin:placements:list` | `GET /v1/admin/placements` | `placements.ts` |
| `admin:placements:markPaid` | `POST /v1/admin/placements/:id/mark-paid` | `placements.ts` |
| `admin:placements:cancel` | `POST /v1/admin/placements/:id/cancel` | `placements.ts` |
| `admin:placements:summary` | `GET /v1/admin/placements/summary` | `placements.ts` |
| `admin:adminLog:list` | `GET /v1/admin/admin-log` | `admin-log.ts` |

---

## 文件结构变更

```
src/main/
├── ipc/                              # ← 全部删除
│   ├── index.ts
│   ├── users.ts
│   ├── candidates.ts
│   ├── audit.ts
│   ├── webhooks.ts
│   ├── rate-limit.ts
│   ├── config.ts
│   ├── placements.ts
│   ├── admin-log.ts
│   └── dashboard.ts
│
├── modules/
│   ├── admin/                        # ← 新建
│   │   ├── auth.ts                   # adminAuthMiddleware
│   │   ├── handlers/                 # 重构自 ipc/*
│   │   │   ├── users.ts
│   │   │   ├── candidates.ts
│   │   │   ├── audit.ts
│   │   │   ├── webhooks.ts
│   │   │   ├── rate-limit.ts
│   │   │   ├── config.ts
│   │   │   ├── placements.ts
│   │   │   ├── admin-log.ts
│   │   │   └── dashboard.ts
│   │   └── index.ts
│
└── routes/
    ├── admin.ts                      # ← 新建（Express router）
    └── server.ts                     # 修改：挂载 /v1/admin

tests/
├── integration/
│   └── admin-endpoints.test.ts       # ← 新建（覆盖所有 18 个端点）
└── unit/
    └── admin/
        └── auth.test.ts              # ← 新建（adminAuthMiddleware 单元测试）
```

---

## Task 1: 写 adminAuthMiddleware 单元测试（失败优先）

**Files:**
- Create: `tests/unit/admin/auth.test.ts`

- [ ] **Step 1: 写测试用例**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createAdminAuthMiddleware } from '../../../src/main/modules/admin/auth';

describe('adminAuthMiddleware', () => {
  const ADMIN_PWD = 'super-secret-admin-pwd-1234';
  let app: express.Express;

  beforeEach(() => {
    process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(ADMIN_PWD, 4);
    app = express();
    app.get('/protected',
      createAdminAuthMiddleware(),
      (_req, res) => res.json({ ok: true }),
    );
  });

  it('rejects request without Authorization header', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects wrong password', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer wrong-password`);
    expect(res.status).toBe(401);
  });

  it('rejects non-Bearer scheme', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Basic ${Buffer.from(ADMIN_PWD).toString('base64')}`);
    expect(res.status).toBe(401);
  });

  it('accepts correct password', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${ADMIN_PWD}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejects malformed bearer (no space)', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', ADMIN_PWD);  // missing "Bearer "
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: 运行测试，验证失败**

Run: `cd D:\dev\hunter-platform && pnpm vitest run tests/unit/admin/auth.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/modules/admin/auth'`

- [ ] **Step 3: Commit 测试**

```bash
git add tests/unit/admin/auth.test.ts
git commit -m "test: add adminAuthMiddleware unit tests (failing)"
```

---

## Task 2: 实现 adminAuthMiddleware

**Files:**
- Create: `src/main/modules/admin/auth.ts`

- [ ] **Step 1: 实现中间件**

```typescript
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import bcrypt from 'bcryptjs';
import { Errors } from '../../errors.js';

/**
 * Admin auth middleware — verifies Bearer token against ADMIN_PASSWORD_HASH.
 *
 * Distinct from regular authMiddleware: admins authenticate with a single
 * shared password (set via ADMIN_PASSWORD_HASH in env), NOT a per-user API key.
 *
 * Usage:
 *   app.use('/v1/admin', createAdminAuthMiddleware(), createAdminRouter(db))
 *
 * Failure modes (all → 401 UNAUTHORIZED):
 *   - Missing Authorization header
 *   - Non-Bearer scheme (e.g. Basic, raw token)
 *   - Empty bearer value
 *   - bcrypt compare returns false
 */
export function createAdminAuthMiddleware(): RequestHandler {
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash || hash.length < 20) {
    throw new Error('ADMIN_PASSWORD_HASH must be set (≥20 chars) before mounting admin routes');
  }
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ') || auth.length <= 7) {
      return next(Errors.unauthorized('Admin auth requires "Authorization: Bearer <ADMIN_PASSWORD>"'));
    }
    const pwd = auth.slice(7);
    // bcrypt is async; we use the callback form to keep this middleware sync-shaped.
    bcrypt.compare(pwd, hash, (err, ok) => {
      if (err) {
        console.error('adminAuth: bcrypt error', err);
        return next(Errors.internal('Admin auth backend error'));
      }
      if (!ok) return next(Errors.unauthorized('Invalid admin password'));
      next();
    });
  };
}
```

- [ ] **Step 2: 运行单元测试，验证通过**

Run: `cd D:\dev\hunter-platform && pnpm vitest run tests/unit/admin/auth.test.ts`
Expected: 5 passed

- [ ] **Step 3: Commit**

```bash
git add src/main/modules/admin/auth.ts
git commit -m "feat(admin): add adminAuthMiddleware with bcrypt verification"
```

---

## Task 3: 重构 handler 逻辑从 IPC 到 modules/admin

**Files:**
- Create: `src/main/modules/admin/handlers/dashboard.ts`
- Create: `src/main/modules/admin/handlers/users.ts`
- Create: `src/main/modules/admin/handlers/candidates.ts`
- Create: `src/main/modules/admin/handlers/audit.ts`
- Create: `src/main/modules/admin/handlers/webhooks.ts`
- Create: `src/main/modules/admin/handlers/rate-limit.ts`
- Create: `src/main/modules/admin/handlers/config.ts`
- Create: `src/main/modules/admin/handlers/placements.ts`
- Create: `src/main/modules/admin/handlers/admin-log.ts`

- [ ] **Step 1: 复制每个 IPC handler 到对应新文件**

从 `src/main/ipc/<name>.ts` 复制到 `src/main/modules/admin/handlers/<name>.ts`。改动：
- 函数签名不变（输入输出类型保持兼容）
- 内部 SQL / 错误抛出逻辑完全保留
- 添加一行注释：`// Migrated from src/main/ipc/<name>.ts on 2026-06-20`

例如 `src/main/modules/admin/handlers/users.ts`：

```typescript
// Migrated from src/main/ipc/users.ts on 2026-06-20
import type { DB } from '../../db/connection.js';
import { createUsersRepo } from '../../db/repositories/users.js';
import { Errors } from '../../errors.js';

export function createAdminUsersHandler(db: DB) {
  const users = createUsersRepo(db);

  return {
    list(filter: { user_type?: string; status?: string; limit?: number }): unknown[] {
      let sql = 'SELECT * FROM users WHERE 1=1';
      const params: any[] = [];
      if (filter.user_type) { sql += ' AND user_type = ?'; params.push(filter.user_type); }
      if (filter.status) { sql += ' AND status = ?'; params.push(filter.status); }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(filter.limit ?? 100);
      return db.prepare(sql).all(...params);
    },
    suspend(user_id: string, reason: string): { user_id: string; status: string; reason: string } {
      const u = users.findById(user_id);
      if (!u) throw Errors.notFound('User not found');
      db.prepare("UPDATE users SET status = 'suspended', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), user_id);
      return { user_id, status: 'suspended', reason };
    },
    unsuspend(user_id: string): { user_id: string; status: string } {
      const u = users.findById(user_id);
      if (!u) throw Errors.notFound('User not found');
      db.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), user_id);
      return { user_id, status: 'active' };
    },
    adjustQuota(user_id: string, new_quota: number): { user_id: string; new_quota: number } {
      if (new_quota < 0 || new_quota > 100000) throw Errors.invalidParams('quota must be 0-100000');
      const u = users.findById(user_id);
      if (!u) throw Errors.notFound('User not found');
      db.prepare('UPDATE users SET quota_per_day = ?, updated_at = ? WHERE id = ?')
        .run(new_quota, new Date().toISOString(), user_id);
      return { user_id, new_quota };
    },
  };
}
```

其他 8 个文件按相同模式迁移：`audit.ts`、`candidates.ts`、`webhooks.ts`、`rate-limit.ts`、`config.ts`、`placements.ts`、`admin-log.ts`、`dashboard.ts`。

- [ ] **Step 2: 运行 typecheck，验证类型正确**

Run: `cd D:\dev\hunter-platform && pnpm typecheck`
Expected: 无错误（handler 内的类型应保持一致）

- [ ] **Step 3: Commit**

```bash
git add src/main/modules/admin/handlers/
git commit -m "refactor(admin): migrate IPC handlers to modules/admin/handlers (no behavior change)"
```

---

## Task 4: 创建 admin router

**Files:**
- Create: `src/main/routes/admin.ts`

- [ ] **Step 1: 实现 router**

```typescript
import { Router } from 'express';
import type { DB } from '../db/connection.js';
import { Errors } from '../errors.js';
import { createAdminUsersHandler } from '../modules/admin/handlers/users.js';
import { createAdminCandidatesHandler } from '../modules/admin/handlers/candidates.js';
import { createAdminAuditHandler } from '../modules/admin/handlers/audit.js';
import { createAdminWebhooksHandler } from '../modules/admin/handlers/webhooks.js';
import { createAdminRateLimitHandler } from '../modules/admin/handlers/rate-limit.js';
import { createAdminConfigHandler } from '../modules/admin/handlers/config.js';
import { createAdminPlacementsHandler } from '../modules/admin/handlers/placements.js';
import { createAdminAdminLogHandler } from '../modules/admin/handlers/admin-log.js';
import { makeAdminDashboardHandler } from '../modules/admin/handlers/dashboard.js';

export function createAdminRouter(db: DB): Router {
  const router = Router();
  const users = createAdminUsersHandler(db);
  const candidates = createAdminCandidatesHandler(db);
  const audit = createAdminAuditHandler(db);
  const webhooks = createAdminWebhooksHandler(db);
  const rateLimit = createAdminRateLimitHandler(db);
  const config = createAdminConfigHandler();
  const placements = createAdminPlacementsHandler(db);
  const adminLog = createAdminAdminLogHandler(db);
  const dashboard = makeAdminDashboardHandler(db);

  // Health check (no auth required — useful for ops monitoring)
  router.get('/ping', (_req, res) => {
    res.json({ ok: true, data: { message: 'admin pong' } });
  });

  // Dashboard
  router.get('/dashboard/stats', (_req, res, next) => {
    try { res.json({ ok: true, data: dashboard.getStats() }); } catch (e) { next(e); }
  });

  // Users
  router.get('/users', (req, res, next) => {
    try {
      const filter = {
        user_type: typeof req.query.user_type === 'string' ? req.query.user_type : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      };
      res.json({ ok: true, data: users.list(filter) });
    } catch (e) { next(e); }
  });
  router.post('/users/:id/suspend', (req, res, next) => {
    try {
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
      if (!reason) throw Errors.invalidParams('reason is required');
      res.json({ ok: true, data: users.suspend(req.params.id, reason) });
    } catch (e) { next(e); }
  });
  router.post('/users/:id/unsuspend', (req, res, next) => {
    try { res.json({ ok: true, data: users.unsuspend(req.params.id) }); } catch (e) { next(e); }
  });
  router.post('/users/:id/adjust-quota', (req, res, next) => {
    try {
      const new_quota = Number(req.body?.new_quota);
      if (!Number.isFinite(new_quota)) throw Errors.invalidParams('new_quota must be a number');
      res.json({ ok: true, data: users.adjustQuota(req.params.id, new_quota) });
    } catch (e) { next(e); }
  });

  // Candidates
  router.get('/candidates', (req, res, next) => {
    try {
      const filter = {
        industry: typeof req.query.industry === 'string' ? req.query.industry : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      };
      res.json({ ok: true, data: candidates.list(filter) });
    } catch (e) { next(e); }
  });
  router.post('/candidates/:id/remove-from-pool', (req, res, next) => {
    try { res.json({ ok: true, data: candidates.removeFromPool(req.params.id) }); } catch (e) { next(e); }
  });

  // Audit
  router.get('/audit', (req, res, next) => {
    try {
      const filter = {
        user_id: typeof req.query.user_id === 'string' ? req.query.user_id : undefined,
        action_type: typeof req.query.action_type === 'string' ? req.query.action_type : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      };
      res.json({ ok: true, data: audit.list(filter) });
    } catch (e) { next(e); }
  });

  // Webhooks
  router.get('/webhooks/dead-letter', (req, res, next) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      res.json({ ok: true, data: webhooks.listDeadLetter(limit) });
    } catch (e) { next(e); }
  });
  router.post('/webhooks/:id/retry', (req, res, next) => {
    try { res.json({ ok: true, data: webhooks.retry(req.params.id) }); } catch (e) { next(e); }
  });

  // Rate limit
  router.get('/rate-limit/buckets', (req, res, next) => {
    try {
      const user_id = typeof req.query.user_id === 'string' ? req.query.user_id : undefined;
      res.json({ ok: true, data: rateLimit.listBuckets(user_id) });
    } catch (e) { next(e); }
  });
  router.post('/rate-limit/users/:id/clear', (req, res, next) => {
    try { res.json({ ok: true, data: rateLimit.clearForUser(req.params.id) }); } catch (e) { next(e); }
  });

  // Config
  router.get('/config', (_req, res, next) => {
    try { res.json({ ok: true, data: config.get() }); } catch (e) { next(e); }
  });
  router.put('/config/:key', (req, res, next) => {
    try { res.json({ ok: true, data: config.set(req.params.key, req.body) }); } catch (e) { next(e); }
  });

  // Placements
  router.get('/placements', (req, res, next) => {
    try {
      const filter = {
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      };
      res.json({ ok: true, data: placements.list(filter) });
    } catch (e) { next(e); }
  });
  router.post('/placements/:id/mark-paid', (req, res, next) => {
    try { res.json({ ok: true, data: placements.markPaid('admin', req.params.id) }); } catch (e) { next(e); }
  });
  router.post('/placements/:id/cancel', (req, res, next) => {
    try { res.json({ ok: true, data: placements.cancel('admin', req.params.id) }); } catch (e) { next(e); }
  });
  router.get('/placements/summary', (_req, res, next) => {
    try { res.json({ ok: true, data: placements.summary() }); } catch (e) { next(e); }
  });

  // Admin log
  router.get('/admin-log', (req, res, next) => {
    try {
      const filter = {
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      };
      res.json({ ok: true, data: adminLog.list(filter) });
    } catch (e) { next(e); }
  });

  return router;
}
```

- [ ] **Step 2: 挂载到 server.ts**

修改 `src/main/server.ts`，在 line 173 附近（`app.use('/v1/users', ...)` 之前）加入：

```typescript
import { createAdminAuthMiddleware } from './modules/admin/auth.js';
import { createAdminRouter } from './routes/admin.js';
```

然后在 `app.use('/v1/users', ...)` 之前插入：

```typescript
app.use('/v1/admin', createAdminAuthMiddleware(), createAdminRouter(db));
```

- [ ] **Step 3: 验证 typecheck**

Run: `cd D:\dev\hunter-platform && pnpm typecheck`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/main/routes/admin.ts src/main/server.ts
git commit -m "feat(admin): add /v1/admin router with 18 admin HTTP endpoints"
```

---

## Task 5: 写集成测试

**Files:**
- Create: `tests/integration/admin-endpoints.test.ts`

- [ ] **Step 1: 写测试**

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('admin endpoints integration', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-test.db');
  let app: any;
  let db: any;
  const ADMIN_PWD = 'admin-test-pwd-12345';
  const adminAuth = `Bearer ${ADMIN_PWD}`;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    try { fs.unlinkSync(testDb + '-wal'); } catch {}
    try { fs.unlinkSync(testDb + '-shm'); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(ADMIN_PWD, 4);
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createAppFromDb } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { loadEnv } = await import('../../src/main/env');
    db = openDb(testDb);
    runMigrations(db);
    app = createAppFromDb(db, loadEnv());
  });

  afterAll(() => { if (db) db.close(); });

  describe('GET /v1/admin/ping', () => {
    it('returns pong (auth required for everything except /ping)', async () => {
      // Note: per design, /ping has NO auth — it's for ops monitoring
      const res = await request(app).get('/v1/admin/ping');
      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('admin pong');
    });
  });

  describe('auth enforcement', () => {
    it('401 without bearer on protected endpoint', async () => {
      const res = await request(app).get('/v1/admin/users');
      expect(res.status).toBe(401);
    });

    it('401 with wrong password', async () => {
      const res = await request(app).get('/v1/admin/users').set('Authorization', 'Bearer wrong');
      expect(res.status).toBe(401);
    });
  });

  describe('users admin', () => {
    let testUserId: string;
    beforeEach(() => {
      const id = 'user_test_admin';
      db.prepare(`
        INSERT OR REPLACE INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
          quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
        VALUES (?, 'candidate', 'Test', 'test@test.com', 'hash', 'prefix', 100, 0,
          datetime('now', '+1 day'), 50, 'active', datetime('now'), datetime('now'))
      `).run(id);
      testUserId = id;
    });

    it('GET /v1/admin/users lists users', async () => {
      const res = await request(app).get('/v1/admin/users').set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('POST /v1/admin/users/:id/suspend requires reason', async () => {
      const res = await request(app)
        .post(`/v1/admin/users/${testUserId}/suspend`)
        .set('Authorization', adminAuth)
        .send({});
      expect(res.status).toBe(400);
    });

    it('POST /v1/admin/users/:id/suspend succeeds with reason', async () => {
      const res = await request(app)
        .post(`/v1/admin/users/${testUserId}/suspend`)
        .set('Authorization', adminAuth)
        .send({ reason: 'spam' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('suspended');
    });

    it('POST /v1/admin/users/:id/unsuspend restores to active', async () => {
      await request(app).post(`/v1/admin/users/${testUserId}/suspend`)
        .set('Authorization', adminAuth).send({ reason: 'test' });
      const res = await request(app)
        .post(`/v1/admin/users/${testUserId}/unsuspend`)
        .set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('active');
    });

    it('POST /v1/admin/users/:id/adjust-quota validates range', async () => {
      const res = await request(app)
        .post(`/v1/admin/users/${testUserId}/adjust-quota`)
        .set('Authorization', adminAuth)
        .send({ new_quota: 999999 });
      expect(res.status).toBe(400);
    });

    it('POST /v1/admin/users/:id/adjust-quota accepts valid value', async () => {
      const res = await request(app)
        .post(`/v1/admin/users/${testUserId}/adjust-quota`)
        .set('Authorization', adminAuth)
        .send({ new_quota: 50 });
      expect(res.status).toBe(200);
      expect(res.body.data.new_quota).toBe(50);
    });
  });

  describe('config admin', () => {
    it('GET /v1/admin/config returns config object', async () => {
      const res = await request(app).get('/v1/admin/config').set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('desensitization');
    });

    it('PUT /v1/admin/config/:key rejects unknown key', async () => {
      const res = await request(app)
        .put('/v1/admin/config/unknown_key')
        .set('Authorization', adminAuth)
        .send({});
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('rate-limit admin', () => {
    it('GET /v1/admin/rate-limit/buckets returns array', async () => {
      const res = await request(app)
        .get('/v1/admin/rate-limit/buckets')
        .set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('webhooks admin', () => {
    it('GET /v1/admin/webhooks/dead-letter returns array', async () => {
      const res = await request(app)
        .get('/v1/admin/webhooks/dead-letter')
        .set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `cd D:\dev\hunter-platform && pnpm vitest run tests/integration/admin-endpoints.test.ts`
Expected: 所有用例通过

- [ ] **Step 3: Commit**

```bash
git add tests/integration/admin-endpoints.test.ts
git commit -m "test(admin): add integration tests for /v1/admin endpoints"
```

---

## Task 6: 更新 skill.md 文档

**Files:**
- Modify: `docs/superpowers/skill.md`

- [ ] **Step 1: 添加 §X Admin API 章节**

在 skill.md 中找到 "## 🖼 7. view_url" 之前或合适位置插入新章节：

```markdown
## 🛠 X. Admin API（运维 / 服务器 AI 管理接口）

> **鉴权**：所有端点（除 `/v1/admin/ping` 外）需要 `Authorization: Bearer <ADMIN_PASSWORD>`。
> 密码哈希通过环境变量 `ADMIN_PASSWORD_HASH`（bcrypt 格式）配置。

| Method | Path | 说明 |
|--------|------|------|
| GET    | `/v1/admin/ping` | 健康检查（无需鉴权） |
| GET    | `/v1/admin/dashboard/stats` | 平台统计 |
| GET    | `/v1/admin/users` | 用户列表（?user_type&status&limit） |
| POST   | `/v1/admin/users/:id/suspend` | 暂停用户 |
| POST   | `/v1/admin/users/:id/unsuspend` | 恢复用户 |
| POST   | `/v1/admin/users/:id/adjust-quota` | 调整 quota |
| GET    | `/v1/admin/candidates` | 候选人列表 |
| POST   | `/v1/admin/candidates/:id/remove-from-pool` | 从人才池移除 |
| GET    | `/v1/admin/audit` | 审计日志 |
| GET    | `/v1/admin/webhooks/dead-letter` | 死信 webhook |
| POST   | `/v1/admin/webhooks/:id/retry` | 重试 webhook |
| GET    | `/v1/admin/rate-limit/buckets` | 限流桶列表 |
| POST   | `/v1/admin/rate-limit/users/:id/clear` | 清除用户限流 |
| GET    | `/v1/admin/config` | 读取配置 |
| PUT    | `/v1/admin/config/:key` | 更新配置 |
| GET    | `/v1/admin/placements` | placement 列表 |
| POST   | `/v1/admin/placements/:id/mark-paid` | 标记已付款 |
| POST   | `/v1/admin/placements/:id/cancel` | 取消 |
| GET    | `/v1/admin/placements/summary` | 汇总 |
| GET    | `/v1/admin/admin-log` | 管理员操作日志 |
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/skill.md
git commit -m "docs: add §X Admin API to skill.md"
```

---

## Task 7: 更新 openapi.json

**Files:**
- Modify: `docs/superpowers/openapi.json`

- [ ] **Step 1: 运行自动生成脚本**

Run: `cd D:\dev\hunter-platform && pnpm openapi:generate`
Expected: openapi.json 被更新，包含 /v1/admin/* 路径

- [ ] **Step 2: 验证**

Run: `cd D:\dev\hunter-platform && pnpm openapi:check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/openapi.json
git commit -m "docs: regenerate openapi.json with admin endpoints"
```

---

## Task 8: 删除 IPC 模块和 electron 依赖

**Files:**
- Delete: `src/main/ipc/` (整个目录)
- Delete: `tests/unit/ipc/` (如果有)
- Modify: `package.json` (移除 electron 相关 devDeps)

- [ ] **Step 1: 删除目录**

```bash
git rm -r src/main/ipc/
ls src/main/ipc/ 2>&1   # 确认不存在
```

- [ ] **Step 2: 验证没破坏**

Run: `cd D:\dev\hunter-platform && pnpm typecheck && pnpm test`
Expected: 全部通过（如果有 IPC 测试失败，确认它们已被迁移或删除）

- [ ] **Step 3: 清理 package.json electron devDeps**

打开 `package.json` 并删除以下 devDependencies（如果存在）：
- `electron`
- `electron-builder`
- `electron-vite`
- `@types/electron` (如果有)
- 任何 `vite*` 与 electron 相关的 plugin

```bash
git add package.json package.json.sum  # pnpm-lock.yaml 等
git commit -m "chore: remove dead IPC module and electron devDeps (API-only mode)"
```

- [ ] **Step 4: 更新 README**

修改 `D:\dev\hunter-platform\README.md`，删除或更新 §"可选 Admin UI（实验性 / 不推荐生产）" 整节，因为 electron admin UI 已不再存在。改为：

```markdown
## 运维 / 管理

通过 `POST /v1/admin/*` HTTP 端点管理平台。需要 `ADMIN_PASSWORD_HASH` 环境变量配置管理员密码（bcrypt 哈希）。详见 [docs/superpowers/skill.md §X](docs/superpowers/skill.md)。
```

```bash
git add README.md
git commit -m "docs: replace electron admin UI section with HTTP admin API reference"
```

---

## Task 9: 全量回归

- [ ] **Step 1: 跑全套测试**

Run: `cd D:\dev\hunter-platform && pnpm test`
Expected: 全部通过

- [ ] **Step 2: 启动服务并冒烟测试**

```bash
cd D:\dev\hunter-platform && pnpm dev
# 等 3 秒后：
curl -s http://localhost:3000/v1/admin/ping | jq .
# 期望：{"ok":true,"data":{"message":"admin pong"}}

curl -s http://localhost:3000/v1/admin/users | jq .
# 期望：401

curl -s -H "Authorization: Bearer ${ADMIN_PASSWORD}" http://localhost:3000/v1/admin/users | jq .
# 期望：{"ok":true,"data":[]}
```

- [ ] **Step 3: 完整 reference-agent 测试**

```bash
npx tsx examples/reference-agent/src/index.ts
```
Expected: 27/27 通过（admin 端点不计入 reference-agent 范围，但确保业务端点无回归）

- [ ] **Step 4: 标记完成**

```bash
git tag v1.5.0-admin-http-migration
git push origin v1.5.0-admin-http-migration
```

---

## 验证清单（完成时确认）

- [ ] `src/main/ipc/` 目录不存在
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm test` 通过
- [ ] `pnpm vitest run tests/integration/admin-endpoints.test.ts` 全绿
- [ ] `pnpm dev` 启动成功，`/v1/admin/ping` 返回 200
- [ ] 错误的 admin 密码返回 401
- [ ] 正确的 admin 密码可访问 `/v1/admin/users`
- [ ] `package.json` 没有 electron devDeps
- [ ] `docs/superpowers/skill.md` 包含 §X Admin API 章节
- [ ] `docs/superpowers/openapi.json` 包含 /v1/admin/* 路径
- [ ] README.md §"可选 Admin UI" 已替换

---

## 风险与回滚

**风险**：
- 修改 ADMIN 鉴权模式（从无 → bcrypt）会破坏已有部署（如果有的话）
- admin 操作目前无人使用，破坏面 = 0

**回滚**：每个 task 都单独 commit，按需 `git revert`。