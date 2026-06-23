# Web Admin Sub-D1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Sub-B 的 admin-web/ 上加 `/admin/audit` 页面（3 tab：Admin Actions / User Actions / Login Events），整合现有 `admin_action_log` + `action_history` 数据源。后端补 1 张 `admin_login_events` 表 + 1 个新 endpoint。

**Architecture:**
- **后端**：1 个 v015 migration + `admin-login-events` repo + auth.ts login 改造 + 1 个新 handler/route；零 breaking 现有 endpoint
- **前端**：admin-web/ 扩 6 个新文件（3 fetcher + 1 diff 组件 + 1 drawer 组件 + 1 page）+ Layout/App 改 2 处；复用 Sub-B 的 apiFetchRaw + Table/Pagination/SearchBar/StatusBadge
- **测试**：后端 +6（5 个 login-events 集成测试 + 1 个 admin-endpoints 回归），前端 +12（6 fetcher + 4 diff + 2 drawer）

**Tech Stack (existing):** React 18, Vite, react-router-dom, vanilla CSS, native fetch, zod, vitest+RTL
**Tech Stack (new):** 无
**Spec:** [docs/superpowers/specs/2026-06-24-web-admin-sub-D1-design.md](../specs/2026-06-24-web-admin-sub-D1-design.md)

---

## 0. Reviewer decisions（plan-only，来自 spec review）

| 反馈点 | 决策 |
|--------|------|
| Scope 缩小（后端 audit 设施已存在） | **不再建 `audit_log` 表 / 不再写 audit middleware**。D1 只做 1 张新表（login_events）+ 1 个新 endpoint + 前端 UI |
| 失败登录也记录 | auth.ts 写 `success=0` 行 + `failure_reason` (`unknown_email` / `invalid_password` / `suspended`) |
| ip 字段在 nginx 反代后 | 假设 `app.set('trust proxy', true)` 已在 Sub-A 配置（验证一下），`req.ip` 应能拿到 `X-Forwarded-For` |
| AuditDiffView PII | 复用 Sub-B 的 `maskName`/`maskEmail` 函数（已 ship），导入即可 |
| Page-level 集成测 | **不写**（沿用 Sub-B 决策，价值低/重 setup）|

---

## 现有代码上下文（开始 Task 1 前必读）

实施前应熟悉的文件：

- `src/main/db/migrations/v003.sql` — 现有 `admin_action_log` 表（参考 schema 风格）
- `src/main/db/migrations/v014_admin_users.sql` — 现有 `admin_users` 表（参考 style）
- `src/main/db/migrations.ts` — migration 注册表（注册新 v015 用）
- `src/main/db/repositories/admin-action-log.ts` — 现有 repo（参考实现风格）
- `src/main/modules/admin/handlers/auth.ts` — **要改造**的 login handler
- `src/main/modules/admin/handlers/admin-log.ts` — 现有 admin-log handler（前端复用，不动）
- `src/main/modules/admin/handlers/action-history.ts` — 现有（前端复用，不动）
- `src/main/schemas/admin.ts` — zod schema（参考 `ActionHistoryListResponseSchema` envelope 风格）
- `src/main/routes/admin.ts` — admin router（在文件末尾加 1 条 route）
- `tests/integration/admin-auth.test.ts` — 现有 auth 测试（参考 setup 风格）
- `admin-web/src/api/raw.ts` — Sub-B `apiFetchRaw`（直接复用）
- `admin-web/src/api/users.ts` — Sub-B fetcher（参考 query 构造风格）
- `admin-web/src/lib/mask.ts` — Sub-B `maskName`/`maskEmail`（直接复用）
- `admin-web/src/components/Layout.tsx` — Sub-A nav（**加 1 个 Link**）
- `admin-web/src/App.tsx` — Sub-A 路由（**加 1 条 Route**）

**不动文件（确保零 breaking）：**
- `src/main/modules/admin/handlers/admin-log.ts` — 不动
- `src/main/modules/admin/handlers/action-history.ts` — 不动
- `src/main/modules/audit/action-history-middleware.ts` — 不动
- 任何 Sub-A / Sub-B 已合入 main 的代码
- `admin-web/src/api/raw.ts` — Sub-B 已 ship，零改动
- `admin-web/src/api/users.ts` / `candidates.ts` / `dashboard.ts` — 不动

---

## File Structure（实施前 map）

### 后端新增/修改

| File | Change |
|------|--------|
| `src/main/db/migrations/v015_admin_login_events.sql` | Create — 1 张表 |
| `src/main/db/migrations.ts` | Modify — 注册 v015 |
| `src/main/db/repositories/admin-login-events.ts` | Create — repo（insert + list + count） |
| `src/main/modules/admin/handlers/auth.ts` | Modify — login 写 login_event（try/catch 包住 insert） |
| `src/main/modules/admin/handlers/login-events.ts` | Create — handler factory |
| `src/main/modules/admin/handlers/audit.ts` | **不存在但路由引用了** — 实际是用 unlock-audit-log 的 read，本次不动；如不存在不影响 D1 |
| `src/main/routes/admin.ts` | Modify — import + 1 条 GET `/login-events` |
| `src/main/schemas/admin.ts` | Modify — 加 `AdminLoginEventSchema` + `LoginEventsListResponseSchema` |
| `docs/superpowers/skill.md` | Modify — §Admin API 表格加 1 行 |
| `docs/superpowers/openapi.json` | Modify — 跑 `pnpm openapi:generate` 自动更新 |
| `tests/integration/admin-login-events.test.ts` | Create — 5 个集成测试 |
| `tests/integration/admin-endpoints.test.ts` | Modify — +1 回归测试（验证 admin-log endpoint 不破） |

### 前端新增

| File | Change |
|------|--------|
| `admin-web/src/api/audit.ts` | Create — 3 fetcher（adminLog / actionHistory / loginEvents） |
| `admin-web/src/api/__tests__/audit.test.ts` | Create — 6 fetcher 测试 |
| `admin-web/src/components/AuditDiffView.tsx` | Create — JSON diff 渲染（带 PII mask） |
| `admin-web/src/components/__tests__/AuditDiffView.test.tsx` | Create — 4 组件测试 |
| `admin-web/src/components/AuditJsonDrawer.tsx` | Create — 右侧 Drawer |
| `admin-web/src/components/__tests__/AuditJsonDrawer.test.tsx` | Create — 2 组件测试 |
| `admin-web/src/pages/AuditPage.tsx` | Create — 3 tab 页面 |
| `admin-web/src/components/Layout.tsx` | Modify — nav 加 Audit Link |
| `admin-web/src/App.tsx` | Modify — 加 audit Route |

---

## Task 1: Backend — v015 migration + admin-login-events repo

**Files:**
- Create: `src/main/db/migrations/v015_admin_login_events.sql`
- Modify: `src/main/db/migrations.ts`
- Create: `src/main/db/repositories/admin-login-events.ts`

- [ ] **Step 1.1: 创建 migration SQL**

Create `src/main/db/migrations/v015_admin_login_events.sql`:

```sql
-- ============================================================================
-- Migration v015: admin_login_events table — Sub-D1 of Task #3 (Audit UI)
-- ============================================================================
-- Records every admin login attempt (success and failure) for security
-- auditing. auth.ts login handler writes a row on every attempt.
-- admin_user_id is nullable because failed logins may have unknown email.
-- ============================================================================

CREATE TABLE admin_login_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id   TEXT,
  email           TEXT NOT NULL,
  success         INTEGER NOT NULL CHECK (success IN (0, 1)),
  failure_reason  TEXT,
  ip              TEXT,
  user_agent      TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_admin_login_events_admin ON admin_login_events(admin_user_id);
CREATE INDEX idx_admin_login_events_created ON admin_login_events(created_at DESC);
CREATE INDEX idx_admin_login_events_success ON admin_login_events(success, created_at DESC);
```

- [ ] **Step 1.2: 注册 v015 到 migrations.ts**

打开 `src/main/db/migrations.ts`，在数组末尾加 1 行：

```typescript
  { version: 15, description: 'admin_login_events (Sub-D1 audit login log)', file: 'migrations/v015_admin_login_events.sql' },
```

确认上面 1 行的缩进和其他项一致（`  { version: N, ...`），并保证文件末尾的 `];` 还在。

- [ ] **Step 1.3: 创建 admin-login-events repo**

Create `src/main/db/repositories/admin-login-events.ts`:

```typescript
import type { DB } from '../connection.js';

export interface AdminLoginEvent {
  id: number;
  admin_user_id: string | null;
  email: string;
  success: 0 | 1;
  failure_reason: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export function createAdminLoginEventsRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO admin_login_events (admin_user_id, email, success, failure_reason, ip, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const listStmt = db.prepare(`
    SELECT * FROM admin_login_events
    WHERE 1=1
      ${'' /* admin_user_id */}
      ${'' /* success */}
      ${'' /* email */}
      ${'' /* from */}
      ${'' /* until */}
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `);
  const countStmt = db.prepare(`
    SELECT COUNT(*) as cnt FROM admin_login_events WHERE 1=1
      ${'' /* admin_user_id */}
      ${'' /* success */}
      ${'' /* email */}
      ${'' /* from */}
      ${'' /* until */}
  `);
  const findByIdStmt = db.prepare('SELECT * FROM admin_login_events WHERE id = ?');

  return {
    insert(input: Omit<AdminLoginEvent, 'id' | 'created_at'> & { created_at?: string }): number {
      const created_at = input.created_at ?? new Date().toISOString();
      const result = insertStmt.run(
        input.admin_user_id,
        input.email,
        input.success,
        input.failure_reason,
        input.ip,
        input.user_agent,
        created_at,
      );
      return Number(result.lastInsertRowid);
    },
    list(filter: { admin_user_id?: string; success?: 0 | 1; email?: string; from?: string; until?: string; limit?: number; offset?: number } = {}): { rows: AdminLoginEvent[]; total: number } {
      const where: string[] = [];
      const params: any[] = [];
      if (filter.admin_user_id) { where.push('admin_user_id = ?'); params.push(filter.admin_user_id); }
      if (filter.success !== undefined) { where.push('success = ?'); params.push(filter.success); }
      if (filter.email) { where.push('email LIKE ?'); params.push(`%${filter.email}%`); }
      if (filter.from) { where.push('created_at >= ?'); params.push(filter.from); }
      if (filter.until) { where.push('created_at < ?'); params.push(filter.until); }
      const whereSql = where.length ? ' AND ' + where.join(' AND ') : '';
      const total = (db.prepare(`SELECT COUNT(*) as cnt FROM admin_login_events WHERE 1=1${whereSql}`)
        .get(...params) as { cnt: number }).cnt;
      const listSql = `SELECT * FROM admin_login_events WHERE 1=1${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      const rows = db.prepare(listSql).all(...params, filter.limit ?? 50, filter.offset ?? 0) as unknown as AdminLoginEvent[];
      return { rows, total };
    },
    findById(id: number): AdminLoginEvent | undefined {
      return findByIdStmt.get(id) as AdminLoginEvent | undefined;
    },
  };
}
```

- [ ] **Step 1.4: 验证 migration + repo 在测试环境跑通**

Run:
```bash
cd /d/dev/hunter-platform && cat > /tmp/smoke-d1.ts <<'EOF'
import { openDb } from './src/main/db/connection';
import { runMigrations } from './src/main/db/migrations';
import { createAdminLoginEventsRepo } from './src/main/db/repositories/admin-login-events';

const db = openDb(':memory:');
runMigrations(db);
const repo = createAdminLoginEventsRepo(db);
const id = repo.insert({ admin_user_id: 'adm_1', email: 'a@x.com', success: 1, failure_reason: null, ip: '1.2.3.4', user_agent: 'test' });
console.log('inserted id:', id);
const { rows, total } = repo.list({});
console.log('rows:', rows.length, 'total:', total);
console.log('OK');
EOF
npx tsx /tmp/smoke-d1.ts
```
Expected output ends with `OK`. If you see `rows: 1 total: 1` before `OK`, the migration and repo work.

- [ ] **Step 1.5: 删除 smoke 文件**

```bash
rm /tmp/smoke-d1.ts
```

- [ ] **Step 1.6: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/db/migrations/v015_admin_login_events.sql src/main/db/migrations.ts src/main/db/repositories/admin-login-events.ts
git commit -m "feat(admin): v015 migration + admin-login-events repo (Sub-D1)"
```

---

## Task 2: Backend — auth.ts login 写 login_event

**Files:**
- Modify: `src/main/modules/admin/handlers/auth.ts`
- Create: `tests/integration/admin-login-events.test.ts` (但只加这一个 failing test, 其余在 Task 3 加)

- [ ] **Step 2.1: 创建测试文件骨架 + 第 1 个 failing test**

Create `tests/integration/admin-login-events.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { createAdminLoginEventsRepo } from '../../src/main/db/repositories/admin-login-events';

describe('admin login events', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-login-events-test.db');
  let app: any;
  let db: any;
  let loginEventsRepo: ReturnType<typeof createAdminLoginEventsRepo>;
  const ADMIN_PWD = 'login-test-pwd-12345';
  const ADMIN_EMAIL = 'login-test@default.com';

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    try { fs.unlinkSync(testDb + '-wal'); } catch {}
    try { fs.unlinkSync(testDb + '-shm'); } catch {}
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
    loginEventsRepo = createAdminLoginEventsRepo(db);

    // Seed one active admin
    const pwdHash = bcrypt.hashSync(ADMIN_PWD, 4);
    const keyHash = bcrypt.hashSync('hp_admin_login_test_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_login', 'Login Admin', ADMIN_EMAIL, pwdHash, keyHash, 'hp_admin_login', 'admin', 'active',
      '2026-06-24T00:00:00Z', '2026-06-24T00:00:00Z'
    );
  });

  afterAll(() => { if (db) db.close(); });

  it('records a login_event row on successful login', async () => {
    const before = loginEventsRepo.list({}).total;
    const res = await request(app).post('/v1/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PWD });
    expect(res.status).toBe(200);
    const after = loginEventsRepo.list({}).total;
    expect(after).toBe(before + 1);
    const latest = loginEventsRepo.list({}).rows[0];
    expect(latest.email).toBe(ADMIN_EMAIL);
    expect(latest.success).toBe(1);
    expect(latest.admin_user_id).toBe('adm_login');
    expect(latest.failure_reason).toBeNull();
  });
});
```

- [ ] **Step 2.2: 跑测试, 确认 FAIL**

Run:
```bash
cd /d/dev/hunter-platform && pnpm vitest run tests/integration/admin-login-events.test.ts 2>&1 | tail -20
```
Expected: FAIL with `expected 200 to be 200` (实际是 expect fails because total didn't increase — auth.ts doesn't write login_event yet).

如果你看到 `expected 'X' to be 'X + 1'` 或类似的 — 正确, 这就是 TDD 失败状态。

- [ ] **Step 2.3: 改 auth.ts login 写 login_event**

打开 `src/main/modules/admin/handlers/auth.ts`, 在文件顶部 import 后, 在 `createAdminAuthHandler` 函数内、`return {` 之前, 加入 `loginEventsRepo` 实例化:

```typescript
import { createAdminLoginEventsRepo } from '../../../db/repositories/admin-login-events.js';
// ... existing imports ...

export function createAdminAuthHandler(db: DB) {
  const repo = createAdminUsersRepo(db);
  const loginEventsRepo = createAdminLoginEventsRepo(db);

  // Helper that NEVER throws (so it can't break login main flow)
  const recordLoginEvent = (
    success: boolean,
    adminUserId: string | null,
    email: string,
    reason: string | null,
    req: Request,
  ) => {
    try {
      loginEventsRepo.insert({
        admin_user_id: adminUserId,
        email,
        success: success ? 1 : 0,
        failure_reason: reason,
        ip: req.ip ?? null,
        user_agent: (req.headers['user-agent'] as string | undefined) ?? null,
      });
    } catch (e) {
      console.warn('[admin-login-events] failed to record login event:', (e as Error).message);
    }
  };

  return {
    /** POST /v1/admin/auth/login */
    async login(req: Request, res: Response, next: (e?: any) => void) {
      try {
        const parsed = AdminLoginRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          recordLoginEvent(false, null, String(req.body?.email ?? ''), 'invalid_request', req);
          throw Errors.invalidParams('email and password required');
        }
        const { email, password } = parsed.data;

        const row = repo.findByEmail(email);
        if (!row) {
          recordLoginEvent(false, null, email, 'unknown_email', req);
          throw Errors.unauthorized('Invalid email or password');
        }
        if (row.status === 'suspended') {
          recordLoginEvent(false, row.id, email, 'suspended', req);
          throw Errors.forbidden('Admin account suspended');
        }

        const ok = await bcrypt.compare(password, row.password_hash);
        if (!ok) {
          recordLoginEvent(false, row.id, email, 'invalid_password', req);
          throw Errors.unauthorized('Invalid email or password');
        }

        // Always generate a fresh api_key on login
        const { hash, key, prefix } = await generateAdminApiKey();
        repo.updateApiKey(row.id, hash, prefix, new Date().toISOString());
        repo.updateLastLogin(row.id, new Date().toISOString());
        recordLoginEvent(true, row.id, email, null, req);

        respond(res, AdminLoginResponseSchema, {
          ok: true,
          data: {
            admin_user_id: row.id,
            name: row.name,
            email: row.email,
            role: row.role,
            api_key: key,
          },
        });
      } catch (e) { next(e); }
    },
    // ... rotateKey, me unchanged ...
  };
}
```

- [ ] **Step 2.4: 跑测试, 确认 PASS**

Run:
```bash
cd /d/dev/hunter-platform && pnpm vitest run tests/integration/admin-login-events.test.ts 2>&1 | tail -10
```
Expected: 1 test passed.

- [ ] **Step 2.5: Typecheck**

Run:
```bash
cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 2.6: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/modules/admin/handlers/auth.ts tests/integration/admin-login-events.test.ts
git commit -m "feat(admin): auth.ts login records admin_login_events (success + failure)"
```

---

## Task 3: Backend — login-events handler + route + schema

**Files:**
- Create: `src/main/modules/admin/handlers/login-events.ts`
- Modify: `src/main/schemas/admin.ts`
- Modify: `src/main/routes/admin.ts`
- Modify: `tests/integration/admin-login-events.test.ts` (加 4 个 API test cases)

- [ ] **Step 3.1: 加 schema 到 schemas/admin.ts**

打开 `src/main/schemas/admin.ts`，找到文件末尾（最后一个 `export const` 之后），追加：

```typescript
const AdminLoginEventSchema = z.object({
  id: z.number().int(),
  admin_user_id: z.string().nullable(),
  email: z.string(),
  success: z.union([z.literal(0), z.literal(1)]),
  failure_reason: z.string().nullable(),
  ip: z.string().nullable(),
  user_agent: z.string().nullable(),
  created_at: ISODateTime,
});

export const LoginEventsListResponseSchema = EnvelopeSchema(
  z.object({
    data: z.array(AdminLoginEventSchema),
    pagination: PaginationSchema,
  }),
);
```

**注意：** `PaginationSchema` 在 Sub-B 已加入此文件。如果你的文件里没有，加：

```typescript
const PaginationSchema = z.object({
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  has_more: z.boolean(),
});
```

放在 Sub-B 加的同样位置（admin.ts 文件中部）。

- [ ] **Step 3.2: 创建 login-events handler**

Create `src/main/modules/admin/handlers/login-events.ts`:

```typescript
import type { DB } from '../../../db/connection.js';
import { createAdminLoginEventsRepo, type AdminLoginEvent } from '../../../db/repositories/admin-login-events.js';

export function createAdminLoginEventsHandler(db: DB) {
  const repo = createAdminLoginEventsRepo(db);
  return {
    list(filter: { admin_user_id?: string; success?: 0 | 1; email?: string; from?: string; until?: string; limit?: number; offset?: number }): { rows: AdminLoginEvent[]; total: number } {
      return repo.list(filter);
    },
  };
}
```

- [ ] **Step 3.3: 加 4 个 failing API tests 到 admin-login-events.test.ts**

打开 `tests/integration/admin-login-events.test.ts`，在 `afterAll(...)` 之后, 现有 `it('records...')` 之后，追加：

```typescript
  // Helper: login to obtain a valid api_key
  let adminApiKey = '';
  beforeAll(async () => {
    const loginResp = await request(app).post('/v1/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PWD });
    adminApiKey = loginResp.body.data.api_key;
  });

  it('records login_event on failed login (wrong password)', async () => {
    const before = loginEventsRepo.list({}).total;
    const res = await request(app).post('/v1/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'WRONG-PWD' });
    expect(res.status).toBe(401);
    const after = loginEventsRepo.list({}).total;
    expect(after).toBe(before + 1);
    const latest = loginEventsRepo.list({ success: 0 }).rows[0];
    expect(latest.email).toBe(ADMIN_EMAIL);
    expect(latest.success).toBe(0);
    expect(latest.failure_reason).toBe('invalid_password');
  });

  it('records login_event on unknown email', async () => {
    const before = loginEventsRepo.list({}).total;
    const res = await request(app).post('/v1/admin/auth/login')
      .send({ email: 'unknown@nowhere.com', password: 'anything' });
    expect(res.status).toBe(401);
    const after = loginEventsRepo.list({}).total;
    expect(after).toBe(before + 1);
    const latest = loginEventsRepo.list({ admin_user_id: 'unknown@nowhere.com' as any }).rows[0]
      ?? loginEventsRepo.list({}).rows[0];
    expect(latest.email).toBe('unknown@nowhere.com');
    expect(latest.success).toBe(0);
    expect(latest.failure_reason).toBe('unknown_email');
    expect(latest.admin_user_id).toBeNull();
  });

  it('GET /v1/admin/login-events returns all events when no filter', async () => {
    const res = await request(app).get('/v1/admin/login-events')
      .set('Authorization', `Bearer ${adminApiKey}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.total).toBeGreaterThan(0);
  });

  it('GET /v1/admin/login-events?success=0 returns only failed events', async () => {
    const res = await request(app).get('/v1/admin/login-events?success=0')
      .set('Authorization', `Bearer ${adminApiKey}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((e: any) => e.success === 0)).toBe(true);
  });
```

**注意：** `beforeAll` 块出现 2 次会报错。删除文件里**第一个** `beforeAll` 末尾的 `});`（在 admin seed 后），把第二个 `beforeAll`（用于 adminApiKey）的代码并入第一个。

最终结构是 1 个 `beforeAll` + 1 个 `afterAll` + 5 个 `it`。

- [ ] **Step 3.4: 跑测试, 确认 4 个新 test FAIL（route 还没加）**

Run:
```bash
cd /d/dev/hunter-platform && pnpm vitest run tests/integration/admin-login-events.test.ts 2>&1 | tail -15
```
Expected: 第 1 个 test pass，第 4 + 5 个 FAIL with 404（route 不存在）。

- [ ] **Step 3.5: 在 admin.ts route 加 GET /login-events**

打开 `src/main/routes/admin.ts`:

在顶部 import 区, 找到其他 handler import, 加：

```typescript
import { createAdminLoginEventsHandler } from '../modules/admin/handlers/login-events.js';
import { LoginEventsListResponseSchema } from '../schemas/admin.js';
```

在 `const actionHistory = createAdminActionHistoryHandler(db);` 附近, 加：

```typescript
const loginEvents = createAdminLoginEventsHandler(db);
```

在文件末尾（最后一个 `router.xxx` 之后），加：

```typescript
  router.get('/login-events', (req, res, next) => {
    try {
      const adminId = typeof req.query.admin_id === 'string' ? req.query.admin_id : undefined;
      const successFilter = req.query.success === '1' || req.query.success === '0'
        ? Number(req.query.success) as 0 | 1 : undefined;
      const email = typeof req.query.email === 'string' ? req.query.email : undefined;
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const until = typeof req.query.until === 'string' ? req.query.until : undefined;
      const limit = req.query.limit !== undefined ? Number(req.query.limit) : 50;
      const offset = req.query.offset !== undefined ? Number(req.query.offset) : 0;
      if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
        throw Errors.invalidParams('limit must be a number 1-200');
      }
      if (!Number.isFinite(offset) || offset < 0) {
        throw Errors.invalidParams('offset must be >= 0');
      }
      const { rows, total } = loginEvents.list({ admin_user_id: adminId, success: successFilter, email, from, until, limit, offset });
      respond(res, LoginEventsListResponseSchema, {
        ok: true,
        data: rows,
        pagination: { total, limit, offset, has_more: offset + rows.length < total },
      }, { strict: true });
    } catch (e) { next(e); }
  });
```

- [ ] **Step 3.6: 跑测试, 确认全 5 个 PASS**

Run:
```bash
cd /d/dev/hunter-platform && pnpm vitest run tests/integration/admin-login-events.test.ts 2>&1 | tail -10
```
Expected: 5 tests passed.

- [ ] **Step 3.7: Typecheck**

Run:
```bash
cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 3.8: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/modules/admin/handlers/login-events.ts src/main/schemas/admin.ts src/main/routes/admin.ts tests/integration/admin-login-events.test.ts
git commit -m "feat(admin): GET /v1/admin/login-events endpoint + schema + tests"
```

---

## Task 4: Backend — skill.md + openapi + admin-endpoints 回归 test

**Files:**
- Modify: `docs/superpowers/skill.md`
- Modify: `docs/superpowers/openapi.json` (auto)
- Modify: `tests/integration/admin-endpoints.test.ts`

- [ ] **Step 4.1: 加 1 个回归 test 到 admin-endpoints.test.ts**

打开 `tests/integration/admin-endpoints.test.ts`, 在文件末尾（最后一个 `it(...)` 之后、`describe(...)` 闭合前），加：

```typescript
  describe('Sub-D1 regression: admin-log endpoint unchanged', () => {
    it('GET /v1/admin/admin-log still returns array of admin actions', async () => {
      const res = await request(app).get('/v1/admin/admin-log').set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      // Schema sanity: each row has the AdminLogItemSchema fields
      if (res.body.data.length > 0) {
        const row = res.body.data[0];
        expect(row).toHaveProperty('id');
        expect(row).toHaveProperty('actor');
        expect(row).toHaveProperty('action_type');
        expect(row).toHaveProperty('created_at');
      }
    });
  });
```

- [ ] **Step 4.2: 跑 admin-endpoints test, 确认 PASS**

Run:
```bash
cd /d/dev/hunter-platform && pnpm vitest run tests/integration/admin-endpoints.test.ts 2>&1 | tail -10
```
Expected: 1 new test + all existing tests pass.

- [ ] **Step 4.3: 改 skill.md 加 1 行**

打开 `docs/superpowers/skill.md`, 找到 "Admin API" 表格（搜索 `| GET    | /v1/admin/...` 之类的行）。

在 admin-log 行附近, 加：

```markdown
| GET    | `/v1/admin/login-events` | admin 登录日志（?admin_id&success&email&from&until&limit&offset） |
```

确认格式和同行其他 row 一致（注意列对齐）。

- [ ] **Step 4.4: 重新生成 openapi.json**

Run:
```bash
cd /d/dev/hunter-platform && pnpm openapi:generate 2>&1 | tail -5
```
Expected: openapi.json updated with new endpoint.

如果项目没有 `openapi:generate` script，看 `package.json` 的 scripts 找等效命令（可能是 `tsx scripts/generate-openapi.ts`）。如果完全没这个工具，手动编辑 `docs/superpowers/openapi.json` 加新 endpoint 定义（参考 `login-events` 类似的 entry）。

- [ ] **Step 4.5: 验证 openapi 校验通过**

Run:
```bash
cd /d/dev/hunter-platform && pnpm openapi:check 2>&1 | tail -3
```
Expected: PASS, no dangling paths.

- [ ] **Step 4.6: 跑后端全量回归**

Run:
```bash
cd /d/dev/hunter-platform && pnpm test 2>&1 | tail -5
```
Expected: 823 + 5 + 1 = 829 tests pass (前后数字会因其他测试而略有差异, 看 total 一致).

- [ ] **Step 4.7: Commit**

```bash
cd /d/dev/hunter-platform
git add tests/integration/admin-endpoints.test.ts docs/superpowers/skill.md docs/superpowers/openapi.json
git commit -m "docs(admin): Sub-D1 skill.md + openapi + admin-endpoints regression test"
```

---

## Task 5: Backend — 全量回归 + 后端 build

**Files:** (no changes; verify only)

- [ ] **Step 5.1: 跑后端所有测试**

Run:
```bash
cd /d/dev/hunter-platform && pnpm test 2>&1 | tail -10
```
Expected: All tests pass (829+).

- [ ] **Step 5.2: Typecheck + build**

Run:
```bash
cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -3 && pnpm build 2>&1 | tail -5
```
Expected: typecheck no errors, build produces `out/main/`.

- [ ] **Step 5.3: 本地 curl 冒烟 (optional, 如果本地有 server 跑着)**

```bash
curl -s -X POST http://localhost:3000/v1/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@qing3.top","password":"'$SEED_ADMIN_PASSWORD'"}' | jq .
```

如果返回 200 + api_key:

```bash
KEY=<api_key from above>
curl -s http://localhost:3000/v1/admin/login-events -H "Authorization: Bearer $KEY" | jq '.data | length'
```

Expected: 数字 ≥ 1（你刚才的登录产生的事件 + 任何之前的事件）。

- [ ] **Step 5.4: Commit (no changes; only verify)**

```bash
cd /d/dev/hunter-platform && git status
```
Expected: `nothing to commit, working tree clean`.

如果 Step 5.1 / 5.2 / 5.3 任意一步失败，停下来修。**不要在没修好前进入 Task 6**。

---

## Task 6: Frontend — api/audit.ts (3 fetcher) + 6 tests

**Files:**
- Create: `admin-web/src/api/audit.ts`
- Create: `admin-web/src/api/__tests__/audit.test.ts`

- [ ] **Step 6.1: 写 6 个 failing fetcher tests**

Create `admin-web/src/api/__tests__/audit.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the auth lib so we don't depend on localStorage
vi.mock('../../lib/auth', () => ({
  getToken: () => 'test-token-abc',
  clearToken: vi.fn(),
}));

// Mock fetch globally
const fetchMock = vi.fn();
globalThis.fetch = fetchMock as any;

import { listAdminLog, listActionHistory, listLoginEvents } from '../audit';

describe('audit api fetchers', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: [], pagination: { total: 0, page: 1, pageSize: 50, has_more: false } }),
    });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('listAdminLog hits /v1/admin/admin-log with query params', async () => {
    await listAdminLog({ page: 2, pageSize: 10, actor: 'alice' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/v1/admin/admin-log?page=2&pageSize=10&actor=alice');
    expect(init.headers.Authorization).toBe('Bearer test-token-abc');
  });

  it('listAdminLog returns { data, pagination } on success', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ ok: true, data: [{ id: 1, actor: 'a' }], pagination: { total: 1, page: 1, pageSize: 50, has_more: false } }),
    });
    const result = await listAdminLog();
    expect(result.data).toHaveLength(1);
    expect(result.pagination.total).toBe(1);
  });

  it('listActionHistory hits /v1/admin/action-history', async () => {
    await listActionHistory({ page: 1, capability_name: 'headhunter.upload_candidate', status: 'success' });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/v1/admin/action-history?page=1&capability_name=headhunter.upload_candidate&status=success');
  });

  it('listActionHistory returns { data, pagination }', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ ok: true, data: [{ id: 2, user_id: 'u_1' }], pagination: { total: 1, page: 1, pageSize: 50, has_more: false } }),
    });
    const result = await listActionHistory();
    expect(result.data).toHaveLength(1);
  });

  it('listLoginEvents hits /v1/admin/login-events with success as 0/1', async () => {
    await listLoginEvents({ success: 0, email: 'a', page: 3 });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/v1/admin/login-events?success=0&email=a&page=3');
  });

  it('listLoginEvents returns { data, pagination }', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ ok: true, data: [{ id: 3, email: 'x@y.z', success: 1 }], pagination: { total: 1, page: 1, pageSize: 50, has_more: false } }),
    });
    const result = await listLoginEvents();
    expect(result.data).toHaveLength(1);
  });
});
```

- [ ] **Step 6.2: 跑测试, 确认 FAIL（audit.ts 不存在）**

Run:
```bash
cd /d/dev/hunter-platform/admin-web && pnpm test 2>&1 | tail -15
```
Expected: 6 tests fail with "Cannot find module '../audit'" 或类似.

- [ ] **Step 6.3: 创建 audit.ts (3 fetcher)**

Create `admin-web/src/api/audit.ts`:

```typescript
import { apiFetchRaw } from './raw';

export type AdminLogRow = {
  id: number;
  actor: string;
  action_type: string;
  target_type: string | null;
  target_id: string | null;
  reason: string | null;
  created_at: string;
};

export type ActionHistoryRow = {
  id: number;
  user_id: string;
  capability_name: string;
  target_type: string | null;
  target_id: string | null;
  request_summary_json: string | null;
  response_summary_json: string | null;
  status: 'success' | 'error';
  error_code: string | null;
  duration_ms: number | null;
  trace_id: string | null;
  created_at: string;
};

export type LoginEventRow = {
  id: number;
  admin_user_id: string | null;
  email: string;
  success: 0 | 1;
  failure_reason: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
};

type Paginated<T> = {
  data: T[];
  pagination: { total: number; page: number; pageSize: number; has_more: boolean };
};

function buildQuery(opts: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(opts)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const q = params.toString();
  return q ? `?${q}` : '';
}

export async function listAdminLog(opts: { page?: number; pageSize?: number; actor?: string; action_type?: string; target_type?: string } = {}): Promise<Paginated<AdminLogRow>> {
  const env = await apiFetchRaw<AdminLogRow[]>('admin-log' + buildQuery(opts as any));
  if (!env.ok || !env.data || !env.pagination) throw new Error('Invalid admin-log response');
  return { data: env.data, pagination: env.pagination };
}

export async function listActionHistory(opts: { page?: number; pageSize?: number; user_id?: string; capability_name?: string; status?: 'success' | 'error' } = {}): Promise<Paginated<ActionHistoryRow>> {
  const env = await apiFetchRaw<ActionHistoryRow[]>('action-history' + buildQuery(opts as any));
  if (!env.ok || !env.data || !env.pagination) throw new Error('Invalid action-history response');
  return { data: env.data, pagination: env.pagination };
}

export async function listLoginEvents(opts: { page?: number; pageSize?: number; admin_id?: string; success?: 0 | 1; email?: string; from?: string; until?: string } = {}): Promise<Paginated<LoginEventRow>> {
  const env = await apiFetchRaw<LoginEventRow[]>('login-events' + buildQuery(opts as any));
  if (!env.ok || !env.data || !env.pagination) throw new Error('Invalid login-events response');
  return { data: env.data, pagination: env.pagination };
}
```

- [ ] **Step 6.4: 跑测试, 确认 6 个 PASS**

Run:
```bash
cd /d/dev/hunter-platform/admin-web && pnpm test 2>&1 | tail -10
```
Expected: 6 tests pass.

- [ ] **Step 6.5: Typecheck**

Run:
```bash
cd /d/dev/hunter-platform/admin-web && pnpm typecheck 2>&1 | tail -3
```
Expected: no errors.

- [ ] **Step 6.6: Commit**

```bash
cd /d/dev/hunter-platform
git add admin-web/src/api/audit.ts admin-web/src/api/__tests__/audit.test.ts
git commit -m "feat(admin-web): audit api fetchers (adminLog/actionHistory/loginEvents) + 6 tests"
```

---

## Task 7: Frontend — AuditDiffView 组件 + 4 tests

**Files:**
- Create: `admin-web/src/components/AuditDiffView.tsx`
- Create: `admin-web/src/components/__tests__/AuditDiffView.test.tsx`

- [ ] **Step 7.1: 写 4 个 failing component tests**

Create `admin-web/src/components/__tests__/AuditDiffView.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AuditDiffView from '../AuditDiffView';

describe('AuditDiffView', () => {
  it('renders null when json is null', () => {
    const { container } = render(<AuditDiffView json={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders flat key-value JSON', () => {
    const json = JSON.stringify({ field_count: 8, industry: '互联网' });
    render(<AuditDiffView json={json} />);
    expect(screen.getByText(/field_count/)).toBeInTheDocument();
    expect(screen.getByText(/互联网/)).toBeInTheDocument();
  });

  it('masks PII fields by default (email)', () => {
    const json = JSON.stringify({ email: 'alice@example.com', name: 'Alice Wong' });
    render(<AuditDiffView json={json} />);
    // Full email should NOT appear (it's masked)
    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();
    // Masked form should appear (Sub-B's maskEmail output)
    expect(screen.getByText(/a\*\*\*@\*\*\*/)).toBeInTheDocument();
  });

  it('falls back to raw text when JSON is malformed', () => {
    const { container } = render(<AuditDiffView json="not valid json{" />);
    expect(container.textContent).toContain('not valid json');
  });
});
```

- [ ] **Step 7.2: 跑测试, 确认 FAIL**

Run:
```bash
cd /d/dev/hunter-platform/admin-web && pnpm test 2>&1 | tail -15
```
Expected: 4 tests fail (AuditDiffView doesn't exist).

- [ ] **Step 7.3: 创建 AuditDiffView 组件**

Create `admin-web/src/components/AuditDiffView.tsx`:

```tsx
// Renders a JSON string as a human-readable diff-like view.
// - Parses the JSON (falls back to raw text on parse error)
// - Recursively renders objects/arrays
// - Masks PII fields (email/name/contact) by default using Sub-B's mask helpers
import { maskName, maskEmail, maskContact } from '../lib/mask';

const PII_KEYS = new Set(['email', 'name', 'contact', 'phone']);

function maskIfPii(key: string, value: string): string {
  const lower = key.toLowerCase();
  if (lower === 'email') return maskEmail(value);
  if (lower === 'name') return maskName(value);
  if (lower === 'phone' || lower === 'contact') return maskContact(value);
  return value;
}

function renderValue(value: unknown, maskPii: boolean, keyName?: string): React.ReactNode {
  if (value === null) return <span className="json-null">null</span>;
  if (typeof value === 'boolean') return <span className="json-bool">{String(value)}</span>;
  if (typeof value === 'number') return <span className="json-num">{value}</span>;
  if (typeof value === 'string') {
    const display = (maskPii && keyName && PII_KEYS.has(keyName.toLowerCase()))
      ? maskIfPii(keyName, value)
      : value;
    return <span className="json-str">"{display}"</span>;
  }
  if (Array.isArray(value)) {
    return (
      <ul className="json-array">
        {value.map((v, i) => <li key={i}>{renderValue(v, maskPii)}</li>)}
      </ul>
    );
  }
  if (typeof value === 'object') {
    return (
      <ul className="json-obj">
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <li key={k}>
            <strong>{k}:</strong> {renderValue(v, maskPii, k)}
          </li>
        ))}
      </ul>
    );
  }
  return <span>{String(value)}</span>;
}

export default function AuditDiffView({ json, maskPii = true }: { json: string | null; maskPii?: boolean }) {
  if (json === null || json === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return <pre className="json-raw">{json}</pre>;
  }
  return <div className="audit-diff-view">{renderValue(parsed, maskPii)}</div>;
}
```

- [ ] **Step 7.4: 跑测试, 确认 PASS**

Run:
```bash
cd /d/dev/hunter-platform/admin-web && pnpm test 2>&1 | tail -10
```
Expected: 4 tests pass.

- [ ] **Step 7.5: Typecheck**

Run:
```bash
cd /d/dev/hunter-platform/admin-web && pnpm typecheck 2>&1 | tail -3
```
Expected: no errors.

- [ ] **Step 7.6: Commit**

```bash
cd /d/dev/hunter-platform
git add admin-web/src/components/AuditDiffView.tsx admin-web/src/components/__tests__/AuditDiffView.test.tsx
git commit -m "feat(admin-web): AuditDiffView component (JSON diff + PII mask) + 4 tests"
```

---

## Task 8: Frontend — AuditJsonDrawer 组件 + 2 tests

**Files:**
- Create: `admin-web/src/components/AuditJsonDrawer.tsx`
- Create: `admin-web/src/components/__tests__/AuditJsonDrawer.test.tsx`

- [ ] **Step 8.1: 写 2 个 failing component tests**

Create `admin-web/src/components/__tests__/AuditJsonDrawer.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AuditJsonDrawer from '../AuditJsonDrawer';

describe('AuditJsonDrawer', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<AuditJsonDrawer open={false} onClose={() => {}} title="x" json="{}" />);
    expect(container.querySelector('.drawer-panel')).toBeNull();
  });

  it('renders title and json when open; onClose fires on backdrop click', () => {
    const onClose = vi.fn();
    render(<AuditJsonDrawer open={true} onClose={onClose} title="Request" json='{"a":1}' />);
    expect(screen.getByText('Request')).toBeInTheDocument();
    expect(screen.getByText(/a/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('drawer-backdrop'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 8.2: 跑测试, 确认 FAIL**

Run:
```bash
cd /d/dev/hunter-platform/admin-web && pnpm test 2>&1 | tail -10
```
Expected: 2 tests fail.

- [ ] **Step 8.3: 创建 AuditJsonDrawer 组件**

Create `admin-web/src/components/AuditJsonDrawer.tsx`:

```tsx
import AuditDiffView from './AuditDiffView';

export default function AuditJsonDrawer({
  open,
  onClose,
  title,
  json,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  json: string | null;
}) {
  if (!open) return null;
  return (
    <>
      <div
        className="drawer-backdrop"
        data-testid="drawer-backdrop"
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 99,
        }}
      />
      <aside
        className="drawer-panel"
        style={{
          position: 'fixed', top: 0, right: 0, height: '100vh', width: '480px',
          background: 'white', boxShadow: '-2px 0 8px rgba(0,0,0,0.15)',
          padding: '20px', overflowY: 'auto', zIndex: 100,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button onClick={onClose} className="btn">Close</button>
        </div>
        <AuditDiffView json={json} />
      </aside>
    </>
  );
}
```

- [ ] **Step 8.4: 跑测试, 确认 PASS**

Run:
```bash
cd /d/dev/hunter-platform/admin-web && pnpm test 2>&1 | tail -10
```
Expected: 2 tests pass.

- [ ] **Step 8.5: Typecheck**

Run:
```bash
cd /d/dev/hunter-platform/admin-web && pnpm typecheck 2>&1 | tail -3
```
Expected: no errors.

- [ ] **Step 8.6: Commit**

```bash
cd /d/dev/hunter-platform
git add admin-web/src/components/AuditJsonDrawer.tsx admin-web/src/components/__tests__/AuditJsonDrawer.test.tsx
git commit -m "feat(admin-web): AuditJsonDrawer (right-side drawer for JSON detail) + 2 tests"
```

---

## Task 9: Frontend — AuditPage (3 tabs)

**Files:**
- Create: `admin-web/src/pages/AuditPage.tsx`

- [ ] **Step 9.1: 创建 AuditPage**

Create `admin-web/src/pages/AuditPage.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listAdminLog, listActionHistory, listLoginEvents, type AdminLogRow, type ActionHistoryRow, type LoginEventRow } from '../api/audit';
import { formatDate } from '../lib/format';
import StatusBadge from '../components/StatusBadge';
import Pagination from '../components/Pagination';
import AuditJsonDrawer from '../components/AuditJsonDrawer';

type Tab = 'admin' | 'user' | 'login';

export default function AuditPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = (searchParams.get('tab') as Tab) || 'admin';

  return (
    <div>
      <h2>Audit</h2>
      <nav className="tabs" style={{ marginBottom: 16, borderBottom: '1px solid #ddd' }}>
        {(['admin', 'user', 'login'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setSearchParams({ tab: t })}
            style={{
              padding: '8px 16px',
              border: 'none',
              borderBottom: tab === t ? '2px solid #0066cc' : '2px solid transparent',
              background: 'transparent',
              cursor: 'pointer',
              fontWeight: tab === t ? 'bold' : 'normal',
            }}
          >
            {t === 'admin' ? 'Admin Actions' : t === 'user' ? 'User Actions' : 'Login Events'}
          </button>
        ))}
      </nav>
      {tab === 'admin' && <AdminActionsTab />}
      {tab === 'user' && <UserActionsTab />}
      {tab === 'login' && <LoginEventsTab />}
    </div>
  );
}

function AdminActionsTab() {
  const [page, setPage] = useState(1);
  const [actor, setActor] = useState('');
  const [data, setData] = useState<AdminLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAdminLog({ page, pageSize: 20, actor: actor || undefined });
      setData(res.data);
      setTotal(res.pagination.total);
    } finally { setLoading(false); }
  }, [page, actor]);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <div>
      <input
        type="text"
        placeholder="Search by actor email/id..."
        value={actor}
        onChange={e => { setActor(e.target.value); setPage(1); }}
        style={{ marginBottom: 12, padding: 6, width: 300 }}
      />
      {loading ? <p>Loading...</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={{ padding: 8, textAlign: 'left' }}>Time</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Actor</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Action</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Target</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Reason</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 12, textAlign: 'center', color: '#888' }}>No admin actions recorded</td></tr>
            ) : data.map(row => (
              <tr key={row.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: 8 }}>{formatDate(row.created_at)}</td>
                <td style={{ padding: 8 }}>{row.actor}</td>
                <td style={{ padding: 8 }}><code>{row.action_type}</code></td>
                <td style={{ padding: 8 }}>{row.target_type ? `${row.target_type}:${row.target_id}` : '—'}</td>
                <td style={{ padding: 8 }}>{row.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pagination page={page} pageSize={20} total={total} onPageChange={setPage} />
    </div>
  );
}

function UserActionsTab() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ActionHistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState<{ open: boolean; title: string; json: string | null }>({ open: false, title: '', json: null });

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listActionHistory({ page, pageSize: 20 });
      setData(res.data);
      setTotal(res.pagination.total);
    } finally { setLoading(false); }
  }, [page]);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <div>
      {loading ? <p>Loading...</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={{ padding: 8, textAlign: 'left' }}>Time</th>
              <th style={{ padding: 8, textAlign: 'left' }}>User</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Capability</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Status</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Duration</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 12, textAlign: 'center', color: '#888' }}>No user actions recorded</td></tr>
            ) : data.map(row => (
              <tr key={row.id} style={{ borderTop: '1px solid #eee', cursor: 'pointer' }} onClick={() => setDrawer({ open: true, title: `${row.capability_name} @ ${formatDate(row.created_at)}`, json: row.response_summary_json })}>
                <td style={{ padding: 8 }}>{formatDate(row.created_at)}</td>
                <td style={{ padding: 8 }}>{row.user_id}</td>
                <td style={{ padding: 8 }}><code>{row.capability_name}</code></td>
                <td style={{ padding: 8 }}><StatusBadge status={row.status} /></td>
                <td style={{ padding: 8 }}>{row.duration_ms != null ? `${row.duration_ms}ms` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pagination page={page} pageSize={20} total={total} onPageChange={setPage} />
      <AuditJsonDrawer
        open={drawer.open}
        onClose={() => setDrawer({ open: false, title: '', json: null })}
        title={drawer.title}
        json={drawer.json}
      />
    </div>
  );
}

function LoginEventsTab() {
  const [page, setPage] = useState(1);
  const [successFilter, setSuccessFilter] = useState<'' | '1' | '0'>('');
  const [data, setData] = useState<LoginEventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listLoginEvents({
        page, pageSize: 20,
        success: successFilter ? (Number(successFilter) as 0 | 1) : undefined,
      });
      setData(res.data);
      setTotal(res.pagination.total);
    } finally { setLoading(false); }
  }, [page, successFilter]);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <div>
      <select value={successFilter} onChange={e => { setSuccessFilter(e.target.value as '' | '1' | '0'); setPage(1); }} style={{ marginBottom: 12, padding: 6 }}>
        <option value="">All events</option>
        <option value="1">Success only</option>
        <option value="0">Failure only</option>
      </select>
      {loading ? <p>Loading...</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={{ padding: 8, textAlign: 'left' }}>Time</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Email</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Admin</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Success</th>
              <th style={{ padding: 8, textAlign: 'left' }}>IP</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Reason</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 12, textAlign: 'center', color: '#888' }}>No login events recorded</td></tr>
            ) : data.map(row => (
              <tr key={row.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: 8 }}>{formatDate(row.created_at)}</td>
                <td style={{ padding: 8 }}>{row.email}</td>
                <td style={{ padding: 8 }}>{row.admin_user_id ?? '—'}</td>
                <td style={{ padding: 8 }}>
                  <StatusBadge status={row.success === 1 ? 'success' : 'error'} />
                </td>
                <td style={{ padding: 8 }}>{row.ip ?? '—'}</td>
                <td style={{ padding: 8 }}>{row.failure_reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pagination page={page} pageSize={20} total={total} onPageChange={setPage} />
    </div>
  );
}
```

**注意**：用到的 `formatDate` (from Sub-B `lib/format.ts`), `StatusBadge` (from Sub-B `components/StatusBadge.tsx`), `Pagination` (from Sub-B `components/Pagination.tsx`) 必须都已 ship。验证：检查这些文件存在；如不存在，参考 Sub-B 计划 ship 的版本。

- [ ] **Step 9.2: Typecheck**

Run:
```bash
cd /d/dev/hunter-platform/admin-web && pnpm typecheck 2>&1 | tail -10
```
Expected: no errors. 如果有 import 错，检查 Sub-B 的 `formatDate` / `StatusBadge` / `Pagination` 是否存在并 export 正确名字。

- [ ] **Step 9.3: 手动 build 验证编译过**

Run:
```bash
cd /d/dev/hunter-platform/admin-web && pnpm build 2>&1 | tail -10
```
Expected: build success, output 到 `../out/admin/`.

- [ ] **Step 9.4: Commit**

```bash
cd /d/dev/hunter-platform
git add admin-web/src/pages/AuditPage.tsx
git commit -m "feat(admin-web): AuditPage with 3 tabs (Admin/User Actions + Login Events)"
```

---

## Task 10: Frontend — Layout nav + App 路由

**Files:**
- Modify: `admin-web/src/components/Layout.tsx`
- Modify: `admin-web/src/App.tsx`

- [ ] **Step 10.1: Layout.tsx 加 Audit 链接**

打开 `admin-web/src/components/Layout.tsx`, 找到 `<NavLink to="/admin/candidates"...>` 行, 在其后加：

```tsx
        <NavLink to="/admin/audit" style={navStyle}>Audit</NavLink>
```

确认缩进和同行其他 NavLink 一致。

- [ ] **Step 10.2: App.tsx 加 audit 路由**

打开 `admin-web/src/App.tsx`:

加 import:

```tsx
import AuditPage from './pages/AuditPage';
```

在 candidates Route 之后, 加:

```tsx
        <Route path="/audit" element={<PrivateRoute><AuditPage /></PrivateRoute>} />
```

确认缩进和其他 Route 一致。

- [ ] **Step 10.3: Typecheck + build**

Run:
```bash
cd /d/dev/hunter-platform/admin-web && pnpm typecheck 2>&1 | tail -3 && pnpm build 2>&1 | tail -5
```
Expected: no errors, build success.

- [ ] **Step 10.4: 跑全部前端测试**

Run:
```bash
cd /d/dev/hunter-platform/admin-web && pnpm test 2>&1 | tail -10
```
Expected: 29 + 12 = 41 tests pass.

- [ ] **Step 10.5: Commit**

```bash
cd /d/dev/hunter-platform
git add admin-web/src/components/Layout.tsx admin-web/src/App.tsx
git commit -m "feat(admin-web): nav link + route for /admin/audit"
```

---

## Task 11: 全量回归 (后端 + 前端 + build + openapi)

**Files:** (no changes; verify only)

- [ ] **Step 11.1: 后端全量测试**

Run:
```bash
cd /d/dev/hunter-platform && pnpm test 2>&1 | tail -10
```
Expected: 829+ tests pass.

- [ ] **Step 11.2: 前端全量测试**

Run:
```bash
cd /d/dev/hunter-platform/admin-web && pnpm test 2>&1 | tail -10
```
Expected: 41 tests pass.

- [ ] **Step 11.3: 全量 typecheck**

Run:
```bash
cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -3 && cd admin-web && pnpm typecheck 2>&1 | tail -3
```
Expected: both clean.

- [ ] **Step 11.4: openapi 校验**

Run:
```bash
cd /d/dev/hunter-platform && pnpm openapi:check 2>&1 | tail -3
```
Expected: no dangling paths, exit 0.

- [ ] **Step 11.5: 后端 build + 前端 build**

Run:
```bash
cd /d/dev/hunter-platform && pnpm build 2>&1 | tail -3 && cd admin-web && pnpm build 2>&1 | tail -3
```
Expected: both success.

- [ ] **Step 11.6: git status 干净**

Run:
```bash
cd /d/dev/hunter-platform && git status
```
Expected: `nothing to commit, working tree clean`.

如果 11.1-11.5 任意一步失败，**停下修**。不要带着失败进入 Task 12。

---

## Task 12: 部署到生产 + merge

**Files:** (no code changes; deployment only)

- [ ] **Step 12.1: 创建 feature 分支**

Run:
```bash
cd /d/dev/hunter-platform && git checkout -b feature/web-admin-sub-D1
```

- [ ] **Step 12.2: 验证分支和 commit history**

Run:
```bash
git log --oneline main..HEAD
```
Expected: 11 commits (Task 1-10 + 一些 docs 改动) on top of main.

- [ ] **Step 12.3: 本地构建产物**

```bash
cd /d/dev/hunter-platform && pnpm build 2>&1 | tail -3 && cd admin-web && pnpm build 2>&1 | tail -3
```
Expected: `out/main/` 和 `out/admin/` 都生成.

- [ ] **Step 12.4: SCP 到生产**

```bash
scp -r -i /d/Downloads/cc.pem out/main/* root@101.201.110.129:/opt/hunter-platform/out/main/
scp -r -i /d/Downloads/cc.pem out/admin/* root@101.201.110.129:/opt/hunter-platform/out/admin/
```
Expected: 无 error (文件传完).

- [ ] **Step 12.5: 重启服务**

```bash
ssh -i /d/Downloads/cc.pem root@101.201.110.129 'systemctl restart hunter-platform'
```
Expected: 无 output (或 "OK").

- [ ] **Step 12.6: 远程冒烟测试 — 登录**

```bash
ssh -i /d/Downloads/cc.pem root@101.201.110.129 \
  'curl -s -X POST https://qing3.top/v1/admin/auth/login \
   -H "Content-Type: application/json" \
   -d "{\"email\":\"admin@qing3.top\",\"password\":\"$SEED_ADMIN_PASSWORD\"}" | jq -r .data.api_key'
```
Expected: 输出 1 个 api_key 字符串.

把 api_key 存到变量:

```bash
KEY=$(ssh -i /d/Downloads/cc.pem root@101.201.110.129 \
  'curl -s -X POST https://qing3.top/v1/admin/auth/login \
   -H "Content-Type: application/json" \
   -d "{\"email\":\"admin@qing3.top\",\"password\":\"'$SEED_ADMIN_PASSWORD'\"}" | jq -r .data.api_key')
```

- [ ] **Step 12.7: 远程冒烟 — login-events endpoint**

```bash
ssh -i /d/Downloads/cc.pem root@101.201.110.129 \
  "curl -s https://qing3.top/v1/admin/login-events -H 'Authorization: Bearer $KEY' | jq '.data | length'"
```
Expected: 输出 ≥ 1（你刚才登录 + 历史事件）.

- [ ] **Step 12.8: 远程冒烟 — admin-web 页面**

浏览器打开 https://qing3.top/admin/audit，登录后看到 3 个 tab。

- [ ] **Step 12.9: Merge to main + 删 feature 分支**

```bash
cd /d/dev/hunter-platform
git checkout main
git merge --no-ff feature/web-admin-sub-D1 -m "Merge feature/web-admin-sub-D1: Audit log UI + admin login events"
git branch -d feature/web-admin-sub-D1
```

- [ ] **Step 12.10: 最终 commit (merge commit)**

```bash
cd /d/dev/hunter-platform && git log --oneline -3
```
Expected: 看到 merge commit 在最上.

无新代码 commit — merge commit 自动产生.

---

## 验收清单

- [ ] 后端 `pnpm test` 829+ pass
- [ ] 前端 `pnpm test` 41 pass
- [ ] `pnpm typecheck` 干净 (后端 + 前端)
- [ ] `pnpm openapi:check` 通过
- [ ] 后端 + 前端 build 成功
- [ ] 11 个独立 commit + 1 merge commit
- [ ] feature 分支删除
- [ ] 生产 https://qing3.top/admin/audit 3 tab 都能加载数据
- [ ] login-events endpoint 在生产返回 ≥ 1 行

---

## 风险与回滚

| 风险 | 概率 | 缓解 |
|------|------|------|
| auth.ts login_event 写失败 | 极低 | try/catch 包住，console.warn 不抛（见 Task 2.3）|
| IP 全是 127.0.0.1 | 中 | 验证 `app.set('trust proxy')` 配置；如未配，加 migration 之外的 1 行 server.ts 改动（不算 breaking）|
| Sub-B 的 formatDate/StatusBadge/Pagination API 与本 plan 假设不一致 | 低 | Task 9.2 typecheck 会暴露，立刻对齐 |
| Production 部署时 `systemctl restart` 失败 | 极低 | SSH 看日志回滚 `cp -r out/main/ /tmp/old-main-$(date)` |

---

## 不在范围（YAGNI）

- ❌ Sub-D2 (per-entity 时间轴)
- ❌ Sub-D3 (webhook 发送日志)
- ❌ Sub-C mutation 按钮
- ❌ Sub-E config/rate-limit/admin CRUD
- ❌ admin 密码修改 UI
- ❌ 实时刷新 / SSE
- ❌ CSV 导出
- ❌ `admin_action_log` 加 ip/ua 字段

---

## 参考

- [2026-06-24-web-admin-sub-D1-design.md](../specs/2026-06-24-web-admin-sub-D1-design.md) — 本 plan 的 spec
- [2026-06-24-web-admin-sub-B-plan.md](2026-06-24-web-admin-sub-B-plan.md) — 沿用 task 拆分风格
- [2026-06-24-web-admin-sub-B-design.md](../specs/2026-06-24-web-admin-sub-B-design.md) — Sub-B spec
- [2026-06-23-admin-action-history-endpoint-design.md](../specs/2026-06-23-admin-action-history-endpoint-design.md) — action-history endpoint
- `src/main/db/migrations/v003.sql` — admin_action_log 表（参考）
- `src/main/db/migrations/v014_admin_users.sql` — admin_users 表（参考）
- `src/main/db/repositories/admin-action-log.ts` — repo 风格参考
- `src/main/modules/admin/handlers/auth.ts` — **要改造**的 handler
- `src/main/routes/admin.ts` — admin 路由（加 1 条）
- `admin-web/src/api/raw.ts` — apiFetchRaw（直接复用）
- `admin-web/src/api/users.ts` — fetcher 风格参考
- `admin-web/src/lib/mask.ts` — maskName/maskEmail（直接复用）
