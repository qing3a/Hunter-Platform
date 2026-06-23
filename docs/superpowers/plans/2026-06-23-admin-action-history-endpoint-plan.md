# Admin Action History Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `GET /v1/admin/action-history` HTTP 端点，让 admin 能查询 `action_history` 表全量业务审计数据。

**Architecture:** 在现有 `action-history` repo 上加 `list(filter)` + `count(filter)` 动态 WHERE 方法；新建 `modules/admin/handlers/action-history.ts`；在 `routes/admin.ts` 加一条 GET 路由；schema 走 zod strict 验证。复用现有 admin 鉴权（`createAdminAuthMiddleware`，bcrypt bearer）。

**Tech Stack:** Express 4.21, better-sqlite3（已用）, zod（已用）, supertest + vitest（已用）

**Spec:** [docs/superpowers/specs/2026-06-23-admin-action-history-endpoint-design.md](../specs/2026-06-23-admin-action-history-endpoint-design.md)

**参考实现：** [docs/superpowers/plans/2026-06-20-ipc-to-http-admin.md](2026-06-20-ipc-to-http-admin.md)（IPC → HTTP admin 迁移，沿用其 admin router 结构）

---

## 现有代码上下文（开始 Task 1 前必读）

实施前应熟悉的文件：

- `src/main/db/repositories/action-history.ts` — 当前有 `insert/listByUser/listByUserSince/countByUser`，本任务要加 `list(filter)` + `count(filter)`
- `src/main/modules/admin/handlers/audit.ts` — admin audit 现有 handler（读 unlock_audit_log），本任务新建 `action-history.ts` 与其并列
- `src/main/routes/admin.ts` — admin router，本任务加 1 条 GET 路由
- `src/main/schemas/admin.ts` — admin response schemas，本任务加 `AdminActionHistoryItemSchema` + `ActionHistoryListResponseSchema`
- `tests/integration/admin-endpoints.test.ts` — admin 集成测试模式（beforeAll 模式 + bcrypt + supertest）
- `tests/integration/repos/action-history.test.ts` — repo 测试模式（in-memory DB，每 case 重置）

**不动文件**：
- `src/main/server.ts`（admin router 已在 `/v1/admin` 前缀下，自动继承 admin auth）
- `src/main/modules/audit/action-history-middleware.ts`（写入端已 OK）
- `action_history` 表 schema（v013 已定型）

---

## Task 1: 给 `action-history` repo 加 `list(filter)` + `count(filter)`

**Files:**
- Modify: `src/main/db/repositories/action-history.ts`
- Modify: `tests/integration/repos/action-history.test.ts`

### Step 1.1: 在测试文件加 3 个新测试用例

打开 `tests/integration/repos/action-history.test.ts`，在文件末尾、`describe('insert', ...)` 之后追加新 describe 块：

```typescript
  describe('list (admin filter)', () => {
    it('returns all rows when no filter', () => {
      const result = repo.list({});
      expect(result.total).toBe(3);
      expect(result.rows.length).toBe(3);
    });

    it('filters by user_id', () => {
      const result = repo.list({ user_id: 'u1' });
      expect(result.total).toBe(2);
      expect(result.rows.every(r => r.user_id === 'u1')).toBe(true);
    });

    it('filters by capability_name', () => {
      const result = repo.list({ capability_name: 'headhunter.recommend_candidate' });
      expect(result.total).toBe(1);
      expect(result.rows[0].user_id).toBe('u2');
    });

    it('filters by status', () => {
      const result = repo.list({ status: 'error' });
      expect(result.total).toBe(0);
    });

    it('filters by since/until (inclusive)', () => {
      const result = repo.list({ since: '2026-06-17T00:00:02Z', until: '2026-06-17T00:00:02Z' });
      expect(result.total).toBe(1);
      expect(result.rows[0].capability_name).toBe('employer.express_interest');
    });

    it('respects limit/offset and returns total unchanged', () => {
      const page1 = repo.list({ limit: 2, offset: 0 });
      expect(page1.total).toBe(3);
      expect(page1.rows.length).toBe(2);
      const page2 = repo.list({ limit: 2, offset: 2 });
      expect(page2.total).toBe(3);
      expect(page2.rows.length).toBe(1);
      // pages should be disjoint
      const allIds = [...page1.rows, ...page2.rows].map(r => r.id);
      expect(new Set(allIds).size).toBe(3);
    });
  });
```

### Step 1.2: 跑测试，验证失败

Run: `cd D:\dev\hunter-platform && pnpm vitest run tests/integration/repos/action-history.test.ts`
Expected: 6 failures, "repo.list is not a function"

### Step 1.3: 在 repo 加 `ListFilter` 类型 + `list` 方法

打开 `src/main/db/repositories/action-history.ts`，在文件顶部 `ActionHistoryEntry` interface 之后新增：

```typescript
/**
 * Filter for admin action_history queries. All fields optional; missing
 * fields are omitted from the SQL WHERE clause.
 */
export interface ActionHistoryListFilter {
  user_id?: string;
  capability_name?: string;
  status?: 'success' | 'error';
  since?: string;  // ISO 8601 inclusive lower bound
  until?: string;  // ISO 8601 inclusive upper bound
  limit?: number;  // default 100, max 1000 (validated in route)
  offset?: number; // default 0
}
```

然后在 `createActionHistoryRepo` 函数体内部、return 之前，新增 helper：

```typescript
  function buildWhere(filter: ActionHistoryListFilter): { sql: string; params: unknown[] } {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.user_id)         { where.push('user_id = ?');         params.push(filter.user_id); }
    if (filter.capability_name) { where.push('capability_name = ?'); params.push(filter.capability_name); }
    if (filter.status)          { where.push('status = ?');          params.push(filter.status); }
    if (filter.since)           { where.push('created_at >= ?');     params.push(filter.since); }
    if (filter.until)           { where.push('created_at <= ?');     params.push(filter.until); }
    return { sql: where.length ? ' WHERE ' + where.join(' AND ') : '', params };
  }
```

最后在 return object 里加 `list` 方法（紧挨在 `countByUser` 之后）：

```typescript
    /**
     * List action_history rows with optional filters. Returns rows + total
     * count (for pagination). Sorted by created_at DESC (newest first).
     *
     * Used by GET /v1/admin/action-history. The route layer is responsible
     * for validating limit ∈ [1, 1000] and offset ≥ 0 before calling.
     */
    list(filter: ActionHistoryListFilter): { rows: ActionHistoryEntry[]; total: number } {
      const { sql: whereSql, params } = buildWhere(filter);
      const limit = filter.limit ?? 100;
      const offset = filter.offset ?? 0;
      const total = (db.prepare(
        `SELECT COUNT(*) AS c FROM action_history${whereSql}`
      ).get(...params) as { c: number }).c;
      const rows = db.prepare(
        `SELECT * FROM action_history${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      ).all(...params, limit, offset) as unknown as ActionHistoryEntry[];
      return { rows, total };
    },
```

### Step 1.4: 跑测试，验证通过

Run: `cd D:\dev\hunter-platform && pnpm vitest run tests/integration/repos/action-history.test.ts`
Expected: 6 new tests pass; old tests still pass (0 regression)

### Step 1.5: 跑 typecheck

Run: `cd D:\dev\hunter-platform && pnpm typecheck`
Expected: no errors

### Step 1.6: Commit

```bash
cd D:\dev\hunter-platform
git add src/main/db/repositories/action-history.ts tests/integration/repos/action-history.test.ts
git commit -m "feat(admin): action-history repo list(filter) + count(filter)"
```

---

## Task 2: 新建 admin handler `action-history.ts`

**Files:**
- Create: `src/main/modules/admin/handlers/action-history.ts`

### Step 2.1: 写 handler 文件

Create `src/main/modules/admin/handlers/action-history.ts`:

```typescript
// Migrated/created for /v1/admin/action-history endpoint (2026-06-23).
// Reads from action_history (business action audit log) — distinct from
// admin-handlers/audit.ts which reads from unlock_audit_log (4-step unlock flow).
import type { DB } from '../../../db/connection.js';
import {
  createActionHistoryRepo,
  type ActionHistoryListFilter,
  type ActionHistoryEntry,
} from '../../../db/repositories/action-history.js';

export function createAdminActionHistoryHandler(db: DB) {
  const repo = createActionHistoryRepo(db);
  return {
    list(filter: ActionHistoryListFilter): {
      rows: ActionHistoryEntry[];
      total: number;
    } {
      return repo.list(filter);
    },
  };
}
```

### Step 2.2: 跑 typecheck 验证

Run: `cd D:\dev\hunter-platform && pnpm typecheck`
Expected: no errors

### Step 2.3: Commit

```bash
cd D:\dev\hunter-platform
git add src/main/modules/admin/handlers/action-history.ts
git commit -m "feat(admin): add action-history handler"
```

---

## Task 3: 加 admin schema（`AdminActionHistoryItemSchema` + `ActionHistoryListResponseSchema`）

**Files:**
- Modify: `src/main/schemas/admin.ts`

### Step 3.1: 找到合适的插入点

打开 `src/main/schemas/admin.ts`，在 `AuditItemSchema` 定义附近（行 29-37 附近）之后、`DeadLetterItemSchema` 之前，新增 admin action history 相关的 schema。

### Step 3.2: 追加新 schema

在 `AuditItemSchema` 之后追加：

```typescript
const AdminActionHistoryItemSchema = z.object({
  id: z.number().int(),
  user_id: IdString,
  capability_name: z.string(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  request_summary_json: z.string().nullable(),
  response_summary_json: z.string().nullable(),
  status: z.enum(['success', 'error']),
  error_code: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  trace_id: z.string().nullable(),
  created_at: ISODateTime,
});

const AdminActionHistoryPaginationSchema = z.object({
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
  has_more: z.boolean(),
});
```

然后在文件末尾（已有 `AdminLogListResponseSchema` 之后）新增 export：

```typescript
export const ActionHistoryListResponseSchema = EnvelopeSchema(
  z.object({
    data: z.array(AdminActionHistoryItemSchema),
    pagination: AdminActionHistoryPaginationSchema,
  }),
);
```

### Step 3.3: 跑 typecheck

Run: `cd D:\dev\hunter-platform && pnpm typecheck`
Expected: no errors

### Step 3.4: 跑 admin schema 测试

Run: `cd D:\dev\hunter-platform && pnpm vitest run tests/unit/admin-schemas.test.ts`
Expected: all pass (0 regression — new schemas 不影响既有测试)

### Step 3.5: Commit

```bash
cd D:\dev\hunter-platform
git add src/main/schemas/admin.ts
git commit -m "feat(admin): add action-history response schema"
```

---

## Task 4: 在 admin router 加 GET 路由 + 9 个集成测试

**Files:**
- Modify: `src/main/routes/admin.ts`
- Create: `tests/integration/admin-action-history.test.ts`

### Step 4.1: 创建集成测试文件

Create `tests/integration/admin-action-history.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('admin /v1/admin/action-history', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-ah-test.db');
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

    // Seed: 2 users + 3 action_history rows
    db.prepare(`
      INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
        quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
      VALUES ('u_alice', 'employer', 'Alice', 'a@x', 'h', 'hp_live_',
        100, 0, datetime('now', '+1 day'), 50, 'active', '2026-06-17T00:00:00Z', '2026-06-17T00:00:00Z')
    `).run();
    db.prepare(`
      INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
        quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
      VALUES ('u_bob', 'headhunter', 'Bob', 'b@x', 'h2', 'hp_live_',
        200, 0, datetime('now', '+1 day'), 50, 'active', '2026-06-17T00:00:00Z', '2026-06-17T00:00:00Z')
    `).run();
    db.prepare(`INSERT INTO action_history (user_id, capability_name, target_type, target_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('u_alice', 'employer.create_job', 'job', 'j1', 'success', '2026-06-17T00:00:01Z');
    db.prepare(`INSERT INTO action_history (user_id, capability_name, target_type, target_id, status, error_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run('u_alice', 'employer.express_interest', 'recommendation', 'r1', 'error', 'RATE_LIMITED', '2026-06-17T00:00:02Z');
    db.prepare(`INSERT INTO action_history (user_id, capability_name, target_type, target_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('u_bob', 'headhunter.recommend_candidate', 'recommendation', 'r2', 'success', '2026-06-17T00:00:03Z');
  });

  afterAll(() => { if (db) db.close(); });

  // ---- 401 auth tests ----
  it('401 without bearer', async () => {
    const res = await request(app).get('/v1/admin/action-history');
    expect(res.status).toBe(401);
  });

  it('401 with wrong password', async () => {
    const res = await request(app).get('/v1/admin/action-history').set('Authorization', 'Bearer wrong');
    expect(res.status).toBe(401);
  });

  // ---- 200 happy path tests ----
  it('200 with no filter returns all 3 rows + correct pagination', async () => {
    const res = await request(app).get('/v1/admin/action-history').set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.pagination).toEqual({ total: 3, limit: 100, offset: 0, has_more: false });
    // newest first
    expect(res.body.data[0].capability_name).toBe('headhunter.recommend_candidate');
  });

  it('200 filters by user_id', async () => {
    const res = await request(app).get('/v1/admin/action-history?user_id=u_alice').set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((r: any) => r.user_id === 'u_alice')).toBe(true);
    expect(res.body.pagination.total).toBe(2);
  });

  it('200 filters by capability_name', async () => {
    const res = await request(app).get('/v1/admin/action-history?capability_name=employer.express_interest').set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].capability_name).toBe('employer.express_interest');
  });

  it('200 filters by status=error', async () => {
    const res = await request(app).get('/v1/admin/action-history?status=error').set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].error_code).toBe('RATE_LIMITED');
  });

  it('200 filters by since/until time range', async () => {
    const res = await request(app).get('/v1/admin/action-history?since=2026-06-17T00:00:02Z&until=2026-06-17T00:00:02Z').set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].capability_name).toBe('employer.express_interest');
  });

  it('200 pagination limit/offset + has_more', async () => {
    const page1 = await request(app).get('/v1/admin/action-history?limit=2&offset=0').set('Authorization', adminAuth);
    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.pagination.has_more).toBe(true);
    expect(page1.body.pagination.total).toBe(3);

    const page2 = await request(app).get('/v1/admin/action-history?limit=2&offset=2').set('Authorization', adminAuth);
    expect(page2.status).toBe(200);
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.pagination.has_more).toBe(false);
  });

  // ---- 400 invalid params ----
  it('400 when status is not success or error', async () => {
    const res = await request(app).get('/v1/admin/action-history?status=foo').set('Authorization', adminAuth);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAMS');
  });

  it('400 when limit is out of range (2000 > 1000)', async () => {
    const res = await request(app).get('/v1/admin/action-history?limit=2000').set('Authorization', adminAuth);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAMS');
  });
});
```

### Step 4.2: 跑测试，验证失败（路由还没加）

Run: `cd D:\dev\hunter-platform && pnpm vitest run tests/integration/admin-action-history.test.ts`
Expected: 10 failures — first 2 are 404 (route not found), rest are 404

### Step 4.3: 在 `routes/admin.ts` 加 import + 路由

打开 `src/main/routes/admin.ts`，在文件顶部 import 块中找到 `createAdminAdminLogHandler`，在其后追加：

```typescript
import { createAdminActionHistoryHandler } from '../modules/admin/handlers/action-history.js';
```

然后在 import 块中已有的 `AdminLogListResponseSchema` 之后追加：

```typescript
import {
  // ...已有...
  AdminLogListResponseSchema,
  ActionHistoryListResponseSchema,
} from '../schemas/admin.js';
```

在 `createAdminRouter` 函数体内部、已有的 handler 实例化块（`const adminLog = ...` 之后）追加：

```typescript
  const actionHistory = createAdminActionHistoryHandler(db);
```

最后，在 `// Admin log` 注释之前（也就是 `router.get('/admin-log', ...)` 之前）插入新路由：

```typescript
  // Action history (business action audit log — distinct from /audit which
  // reads unlock_audit_log). See spec §2.
  router.get('/action-history', (req, res, next) => {
    try {
      const status = req.query.status;
      if (status !== undefined && status !== 'success' && status !== 'error') {
        throw Errors.invalidParams('status must be "success" or "error"');
      }
      const limit = req.query.limit !== undefined ? Number(req.query.limit) : 100;
      const offset = req.query.offset !== undefined ? Number(req.query.offset) : 0;
      if (!Number.isFinite(limit) || limit < 1 || limit > 1000) {
        throw Errors.invalidParams('limit must be a number 1-1000');
      }
      if (!Number.isFinite(offset) || offset < 0) {
        throw Errors.invalidParams('offset must be a number >= 0');
      }
      const { rows, total } = actionHistory.list({
        user_id:         typeof req.query.user_id === 'string' ? req.query.user_id : undefined,
        capability_name: typeof req.query.capability_name === 'string' ? req.query.capability_name : undefined,
        status:          status as 'success' | 'error' | undefined,
        since:           typeof req.query.since === 'string' ? req.query.since : undefined,
        until:           typeof req.query.until === 'string' ? req.query.until : undefined,
        limit,
        offset,
      });
      respond(res, ActionHistoryListResponseSchema, {
        ok: true,
        data: rows,
        pagination: { total, limit, offset, has_more: offset + rows.length < total },
      }, { strict: true });
    } catch (e) { next(e); }
  });
```

### Step 4.4: 跑测试，验证全部通过

Run: `cd D:\dev\hunter-platform && pnpm vitest run tests/integration/admin-action-history.test.ts`
Expected: 10 passed

### Step 4.5: 跑 typecheck

Run: `cd D:\dev\hunter-platform && pnpm typecheck`
Expected: no errors

### Step 4.6: Commit

```bash
cd D:\dev\hunter-platform
git add src/main/routes/admin.ts tests/integration/admin-action-history.test.ts
git commit -m "feat(admin): add GET /v1/admin/action-history endpoint + 10 integration tests"
```

---

## Task 5: 更新 `docs/superpowers/skill.md`（加 Admin API 新端点说明）

**Files:**
- Modify: `docs/superpowers/skill.md`

### Step 5.1: 定位 Admin API 表格

打开 `docs/superpowers/skill.md`，搜索 `## 🛠 X. Admin API`（或类似标题——如果在 v1.4 之后此节标题可能略不同）。在该节的端点表格中找到 `admin/audit` 行附近。

### Step 5.2: 在 `/v1/admin/audit` 行之后新增一行

找到形如：

```markdown
| GET    | `/v1/admin/audit` | ... |
```

在其后追加：

```markdown
| GET    | `/v1/admin/action-history` | 业务操作审计（`?user_id&capability_name&status&since&until&limit&offset`）|
```

### Step 5.3: 验证 skill.md 语法（可选）

Run: `cd D:\dev\hunter-platform && pnpm conformance:check 2>&1 | head -30`
Expected: no conformance errors related to admin endpoints (其它不相关错误可忽略)

### Step 5.4: Commit

```bash
cd D:\dev\hunter-platform
git add docs/superpowers/skill.md
git commit -m "docs(skill): add /v1/admin/action-history to admin API table"
```

---

## Task 6: 重新生成 `openapi.json`

**Files:**
- Modify: `docs/superpowers/openapi.json`

### Step 6.1: 跑自动生成脚本

Run: `cd D:\dev\hunter-platform && pnpm openapi:generate`
Expected: openapi.json 被更新，包含 `/v1/admin/action-history` 路径

### Step 6.2: 验证 diff

Run: `cd D:\dev\hunter-platform && pnpm openapi:check`
Expected: PASS

### Step 6.3: 检查 git diff 大小

Run: `cd D:\dev\hunter-platform && git diff --stat docs/superpowers/openapi.json`
Expected: 文件被修改（应有几十到几百行 diff）

### Step 6.4: Commit

```bash
cd D:\dev\hunter-platform
git add docs/superpowers/openapi.json
git commit -m "docs(openapi): regenerate with /v1/admin/action-history"
```

---

## Task 7: 全量回归 + 端到端 smoke test

### Step 7.1: 跑全套测试

Run: `cd D:\dev\hunter-platform && pnpm test`
Expected: 全部通过（既有 200+ 测试 + 新增 17 测试 = 0 回归）

### Step 7.2: 跑 typecheck

Run: `cd D:\dev\hunter-platform && pnpm typecheck`
Expected: no errors

### Step 7.3: 跑 conformance 检查

Run: `cd D:\dev\hunter-platform && pnpm conformance:check`
Expected: PASS

### Step 7.4: 启动 dev server 跑端到端 smoke

```bash
cd D:\dev\hunter-platform
# 启动 server（另一个 terminal）
ADMIN_PASSWORD_HASH=$(node -e "console.log(require('bcryptjs').hashSync('test-admin-pwd', 4))") \
  PLATFORM_ENCRYPTION_KEY=$(node -e "console.log(Buffer.alloc(32).toString('base64'))") \
  WEBHOOK_HMAC_SECRET='test-hmac-secret-1234567890' \
  pnpm api:dev
```

等 3 秒后（另一个 terminal）：

```bash
# 1) 无 bearer → 401
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/v1/admin/action-history
# Expected: 401

# 2) 错密码 → 401
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer wrong" http://localhost:3000/v1/admin/action-history
# Expected: 401

# 3) 正确密码 → 200 with data
curl -s -H "Authorization: Bearer test-admin-pwd" http://localhost:3000/v1/admin/action-history | jq '.pagination, .data | length'
# Expected: pagination 包含 total, limit=100, offset=0, has_more (可能为 false)

# 4) 过滤 user_id
curl -s -H "Authorization: Bearer test-admin-pwd" "http://localhost:3000/v1/admin/action-history?user_id=u_alice" | jq '.data | length'
# Expected: 数字（如果之前注册过 u_alice 用户）

# 5) 非法 status → 400
curl -s -H "Authorization: Bearer test-admin-pwd" "http://localhost:3000/v1/admin/action-history?status=foo" | jq '.error.code'
# Expected: "INVALID_PARAMS"

# 6) 非法 limit → 400
curl -s -H "Authorization: Bearer test-admin-pwd" "http://localhost:3000/v1/admin/action-history?limit=2000" | jq '.error.code'
# Expected: "INVALID_PARAMS"
```

### Step 7.5: 标记完成

```bash
cd D:\dev\hunter-platform
git log --oneline -7
# 应能看到 7 个新 commit (Task 1-6 + 1 初始)：
#   8715316 spec(admin): design for GET /v1/admin/action-history endpoint
#   feat(admin): action-history repo list(filter) + count(filter)
#   feat(admin): add action-history handler
#   feat(admin): add action-history response schema
#   feat(admin): add GET /v1/admin/action-history endpoint + 11 integration tests
#   docs(skill): add /v1/admin/action-history to admin API table
#   docs(openapi): regenerate with /v1/admin/action-history
```

---

## 验收清单（与 spec §11 对齐）

- [ ] `GET /v1/admin/action-history` 端点已加并通过 schema 严格校验
- [ ] 10 个集成测试全过（spec 要求 9 个，本 plan 把"400 非法参数"拆为 status + limit 两个独立 case = 10）
- [ ] 6 个新 repo 测试全过（Task 1）
- [ ] `pnpm typecheck` 无错
- [ ] `pnpm test` 全套通过（既有 200+ 测试 0 回归）
- [ ] `pnpm openapi:check` 通过
- [ ] `pnpm conformance:check` 通过
- [ ] `skill.md` 表格已加新行
- [ ] dev server smoke 6 个 curl 全过
- [ ] 7 个 commit 全部就位

---

## 部署到生产（spec §12）

按顺序执行：

1. 把所有新 commit 推送到 `origin/main`
2. SSH 到生产服务器 `qing3.top`
3. `cd /www/wwwroot/hunter-platform-api && git pull`
4. `pnpm build`（编译到 `out/`）
5. 重启 Node 服务（按现有 pm2 / systemd 流程）
6. nginx reload（如果路由有变；本任务不变 nginx 配置）
7. 远程验证：
   ```bash
   curl -s -H "Authorization: Bearer $ADMIN_PASSWORD" \
     "https://api.hunter-platform.com/v1/admin/action-history?user_id=u_xxx" | jq .
   ```
8. （可选）发 release note — "admin can now query full action_history via GET /v1/admin/action-history"

---

## 风险与回滚

| 风险 | 概率 | 影响 | 缓解 / 回滚 |
|------|------|------|------------|
| PII 泄漏 | 低 | 高 | 中间件 `sanitizeSummary` 写时 throw；Task 1.1 测试只验结构 |
| Admin 端被脚本批量拉 | 低 | 中 | limit ≤ 1000 强制上限；如需更严可加 IP 限流（v2） |
| 与既有 `/admin/audit` 行为冲突 | 极低 | 低 | 独立端点不同路径，0 共享代码 |
| 全表扫性能差 | 中 | 低 | 走 `user_id` / `capability_name` 索引；status 单过滤走 seqscan 可接受 |

**回滚**：每个 Task 单独 commit；如需紧急回滚整组：
```bash
git revert --no-commit <last-commit>..<first-commit-of-this-feature>
git commit -m "revert: admin action-history endpoint (rollback)"
```
