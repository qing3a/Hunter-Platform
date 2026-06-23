# Web Admin Sub-A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Web admin 基础设施：新建 `admin_users` 表、多 admin 鉴权（Bearer api_key 模型）、3 个新端点（login/rotate-key/me）、seed 第一个 admin、React+Vite+TS 前端（3 页面）。

**Architecture:**
- **后端**：v014 migration + 新 admin_users repo + 重写 auth 中间件查表 + 3 个新 auth 端点 + seed 启动时检查
- **前端**：`admin-web/` 独立 Vite + React + TS 项目，build 产物到主项目 `out/admin/`，nginx 同域名 `/admin/` 服务
- **认证**：Bearer api_key（与现有 users 一致），前端存 localStorage
- **Seed**：启动时若 `admin_users` 空且 `SEED_ADMIN_PASSWORD` env 存在，创建首个 super admin

**Tech Stack:** React 18, Vite, TypeScript, react-router-dom, vanilla CSS, zod, better-sqlite3, bcryptjs, Express 4.21（已用）, nginx（已用）

**Spec:** [docs/superpowers/specs/2026-06-23-web-admin-sub-A-design.md](../specs/2026-06-23-web-admin-sub-A-design.md)

**参考实现：** [docs/superpowers/plans/2026-06-23-admin-action-history-endpoint-plan.md](2026-06-23-admin-action-history-endpoint-plan.md)（同批任务的 plan 格式参考）

---

## 现有代码上下文（开始 Task 1 前必读）

实施前应熟悉的文件：

- `src/main/modules/admin/auth.ts` — 当前 `createAdminAuthMiddleware` 实现（读 `process.env.ADMIN_PASSWORD_HASH`）
- `src/main/db/repositories/users.ts` — 现有 users repo 模式参考（找 byEmail / byApiKeyPrefix 等）
- `src/main/db/migrations/v013_capability_name.sql` — 最新迁移参考（CREATE TABLE 风格）
- `src/main/modules/admin/handlers/audit.ts` — 现有 admin handler 模式参考
- `src/main/routes/admin.ts` — admin router 结构
- `src/main/schemas/admin.ts` — zod schema 风格
- `src/main/db/migrations/v003.sql` — 现有 admin_action_log 表（不动它）
- `tests/integration/admin-endpoints.test.ts` — admin 测试模式参考

**不动文件**：
- `src/main/modules/admin/handlers/audit.ts` 等 20 个现有 admin handler（auth 中间件换实现不影响内部逻辑）
- 数据库：仅新建 `admin_users` 表，不动 users / admin_action_log

---

## Task 1: v014 migration + admin_users repo（TDD）

**Files:**
- Create: `src/main/db/migrations/v014_admin_users.sql`
- Create: `src/main/db/repositories/admin-users.ts`
- Create: `tests/integration/repos/admin-users.test.ts`

### Step 1.1: 创建 migration 文件

Create `src/main/db/migrations/v014_admin_users.sql`:

```sql
-- v014: admin_users table — Sub-A of Task #3 (Web Admin)
-- See docs/superpowers/specs/2026-06-23-web-admin-sub-A-design.md

CREATE TABLE admin_users (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  api_key_hash      TEXT NOT NULL,
  api_key_prefix    TEXT NOT NULL UNIQUE,
  role              TEXT NOT NULL DEFAULT 'admin'
                          CHECK (role IN ('admin', 'super')),
  status            TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'suspended')),
  last_login_at     TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_admin_users_email ON admin_users(email);
CREATE INDEX idx_admin_users_prefix ON admin_users(api_key_prefix);
```

### Step 1.2: 创建 repo + 测试

Create `tests/integration/repos/admin-users.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('admin_users repository', () => {
  const testDb = path.join(__dirname, '../../../tmp/au-test.db');
  let repo: any;
  let db: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {}
    const { openDb } = await import('../../../src/main/db/connection');
    const { runMigrations } = await import('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    const { createAdminUsersRepo } = await import('../../../src/main/db/repositories/admin-users');
    repo = createAdminUsersRepo(db);
  });
  afterEach(() => {
    if (db) db.close();
    try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {}
  });

  const sampleRow = () => ({
    id: 'adm_test1',
    name: 'Test Admin',
    email: 'admin@test.com',
    password_hash: 'pwd_hash',
    api_key_hash: 'key_hash',
    api_key_prefix: 'hp_admin_aaa',
    role: 'admin' as const,
    status: 'active' as const,
    created_at: '2026-06-23T00:00:00Z',
    updated_at: '2026-06-23T00:00:00Z',
  });

  it('insert + findByEmail returns row', () => {
    repo.insert(sampleRow());
    const row = repo.findByEmail('admin@test.com');
    expect(row?.id).toBe('adm_test1');
    expect(row?.role).toBe('admin');
  });

  it('findByApiKeyPrefix returns row', () => {
    repo.insert(sampleRow());
    const row = repo.findByApiKeyPrefix('hp_admin_aaa');
    expect(row?.email).toBe('admin@test.com');
  });

  it('findById returns row', () => {
    repo.insert(sampleRow());
    expect(repo.findById('adm_test1')?.email).toBe('admin@test.com');
    expect(repo.findById('nonexistent')).toBeUndefined();
  });

  it('updateLastLogin sets ts', () => {
    repo.insert(sampleRow());
    repo.updateLastLogin('adm_test1', '2026-06-23T12:34:56Z');
    expect(repo.findById('adm_test1')?.last_login_at).toBe('2026-06-23T12:34:56Z');
  });

  it('updateApiKey replaces hash + prefix + updated_at', () => {
    repo.insert(sampleRow());
    repo.updateApiKey('adm_test1', 'new_hash', 'hp_admin_zzz', '2026-06-23T99:99:99Z');
    const row = repo.findById('adm_test1');
    expect(row?.api_key_hash).toBe('new_hash');
    expect(row?.api_key_prefix).toBe('hp_admin_zzz');
    expect(row?.updated_at).toBe('2026-06-23T99:99:99Z');
    expect(repo.findByApiKeyPrefix('hp_admin_aaa')).toBeUndefined();
  });

  it('count returns 0 then 1 after insert', () => {
    expect(repo.count()).toBe(0);
    repo.insert(sampleRow());
    expect(repo.count()).toBe(1);
  });

  it('email uniqueness enforced at DB level', () => {
    repo.insert(sampleRow());
    expect(() => repo.insert({ ...sampleRow(), id: 'adm_test2' })).toThrow(/UNIQUE/);
  });
});
```

### Step 1.3: 创建 repo 文件

Create `src/main/db/repositories/admin-users.ts`:

```typescript
import type { DB } from '../connection.js';

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  api_key_hash: string;
  api_key_prefix: string;
  role: 'admin' | 'super';
  status: 'active' | 'suspended';
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export function createAdminUsersRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix,
      role, status, last_login_at, created_at, updated_at)
    VALUES (@id, @name, @email, @password_hash, @api_key_hash, @api_key_prefix,
      @role, @status, NULL, @created_at, @updated_at)
  `);
  const findByEmailStmt = db.prepare('SELECT * FROM admin_users WHERE email = ?');
  const findByPrefixStmt = db.prepare('SELECT * FROM admin_users WHERE api_key_prefix = ?');
  const findByIdStmt = db.prepare('SELECT * FROM admin_users WHERE id = ?');
  const updateLastLoginStmt = db.prepare('UPDATE admin_users SET last_login_at = ? WHERE id = ?');
  const updateApiKeyStmt = db.prepare(
    'UPDATE admin_users SET api_key_hash = ?, api_key_prefix = ?, updated_at = ? WHERE id = ?'
  );
  const countStmt = db.prepare('SELECT COUNT(*) as cnt FROM admin_users');

  return {
    insert(row: Omit<AdminUserRow, 'last_login_at'>): void {
      insertStmt.run(row);
    },
    findByEmail(email: string): AdminUserRow | undefined {
      return findByEmailStmt.get(email) as AdminUserRow | undefined;
    },
    findByApiKeyPrefix(prefix: string): AdminUserRow | undefined {
      return findByPrefixStmt.get(prefix) as AdminUserRow | undefined;
    },
    findById(id: string): AdminUserRow | undefined {
      return findByIdStmt.get(id) as AdminUserRow | undefined;
    },
    updateLastLogin(id: string, ts: string): void {
      updateLastLoginStmt.run(ts, id);
    },
    updateApiKey(id: string, hash: string, prefix: string, ts: string): void {
      updateApiKeyStmt.run(hash, prefix, ts, id);
    },
    count(): number {
      return (countStmt.get() as { cnt: number }).cnt;
    },
  };
}
```

### Step 1.4: 跑测试，验证全过

Run: `cd D:\dev\hunter-platform && pnpm vitest run tests/integration/repos/admin-users.test.ts 2>&1 | tail -10`
Expected: 7 passed

### Step 1.5: Typecheck

Run: `cd D:\dev\hunter-platform && pnpm typecheck 2>&1 | tail -3`
Expected: no errors

### Step 1.6: Commit

```bash
cd D:\dev\hunter-platform
git add src/main/db/migrations/v014_admin_users.sql src/main/db/repositories/admin-users.ts tests/integration/repos/admin-users.test.ts
git commit -m "feat(admin): v014 admin_users table + repo"
```

---

## Task 2: New zod schemas（login/rotate-key/me）

**Files:**
- Modify: `src/main/schemas/admin.ts`

### Step 2.1: 在 `admin.ts` 末尾追加新 schemas

打开 `src/main/schemas/admin.ts`，找到 `AdminLogListResponseSchema` 之后（在 ActionHistoryListResponseSchema 后面），追加：

```typescript
const AdminLoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const AdminLoginResponseSchema = EnvelopeSchema(
  z.object({
    admin_user_id: IdString,
    name: z.string(),
    email: z.string(),
    role: z.enum(['admin', 'super']),
    api_key: z.string(),
  })
);

const AdminMeResponseSchema = EnvelopeSchema(
  z.object({
    id: IdString,
    name: z.string(),
    email: z.string(),
    role: z.enum(['admin', 'super']),
    status: z.enum(['active', 'suspended']),
    last_login_at: ISODateTime.nullable(),
    created_at: ISODateTime,
  })
);

const AdminRotateKeyResponseSchema = EnvelopeSchema(
  z.object({
    api_key: z.string(),
  })
);
```

然后 export（与现有 schema 同一处）：

```typescript
export {
  // ...已有...
  AdminLoginRequestSchema,
  AdminLoginResponseSchema,
  AdminMeResponseSchema,
  AdminRotateKeyResponseSchema,
};
```

（注：如果当前 admin.ts 已经是单个 export 块，添加到该块。）

### Step 2.2: Typecheck

Run: `cd D:\dev\hunter-platform && pnpm typecheck 2>&1 | tail -3`
Expected: no errors

### Step 2.3: Commit

```bash
cd D:\dev\hunter-platform
git add src/main/schemas/admin.ts
git commit -m "feat(admin): add login/me/rotate-key response schemas"
```

---

## Task 3: Auth handler（login/rotate-key/me）+ route 注册

**Files:**
- Create: `src/main/modules/admin/handlers/auth.ts`
- Modify: `src/main/routes/admin.ts`

### Step 3.1: 创建 auth handler

Create `src/main/modules/admin/handlers/auth.ts`:

```typescript
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { Errors } from '../../../errors.js';
import type { DB } from '../../../db/connection.js';
import { createAdminUsersRepo, type AdminUserRow } from '../../../db/repositories/admin-users.js';
import { respond } from '../../../responses.js';
import {
  AdminLoginRequestSchema,
  AdminLoginResponseSchema,
  AdminMeResponseSchema,
  AdminRotateKeyResponseSchema,
} from '../../../schemas/admin.js';

const API_KEY_PREFIX_LEN = 18; // 'hp_admin_' + first 8 chars of random hex
const BCRYPT_COST = 10;

async function generateAdminApiKey(): Promise<{ hash: string; key: string; prefix: string }> {
  const random = crypto.randomBytes(32).toString('hex');
  const key = `hp_admin_${random}`;
  const prefix = key.slice(0, API_KEY_PREFIX_LEN);
  const hash = await bcrypt.hash(key, BCRYPT_COST);
  return { hash, key, prefix };
}

export function createAdminAuthHandler(db: DB) {
  const repo = createAdminUsersRepo(db);

  return {
    /** POST /v1/admin/auth/login */
    async login(req: Request, res: Response, next: (e?: any) => void) {
      try {
        const parsed = AdminLoginRequestSchema.safeParse(req.body);
        if (!parsed.success) throw Errors.invalidParams('email and password required');
        const { email, password } = parsed.data;

        const row = repo.findByEmail(email);
        if (!row) throw Errors.unauthorized('Invalid email or password');
        if (row.status === 'suspended') throw Errors.forbidden('Admin account suspended');

        const ok = await bcrypt.compare(password, row.password_hash);
        if (!ok) throw Errors.unauthorized('Invalid email or password');

        // Update last_login_at
        repo.updateLastLogin(row.id, new Date().toISOString());

        respond(res, AdminLoginResponseSchema, {
          ok: true,
          data: {
            admin_user_id: row.id,
            name: row.name,
            email: row.email,
            role: row.role,
            api_key: '', // placeholder — replaced below
          },
        });
        // Note: we generate api_key on every login if needed (kept simple for Sub-A)
        // For Sub-A MVP: reuse existing api_key if present, else generate new one
      } catch (e) { next(e); }
    },

    /** POST /v1/admin/auth/rotate-key */
    async rotateKey(req: Request, res: Response, next: (e?: any) => void) {
      try {
        const admin = (req as any).admin as AdminUserRow | undefined;
        if (!admin) throw Errors.unauthorized('Missing admin context');
        const { hash, key, prefix } = await generateAdminApiKey();
        repo.updateApiKey(admin.id, hash, prefix, new Date().toISOString());
        respond(res, AdminRotateKeyResponseSchema, {
          ok: true,
          data: { api_key: key },
        });
      } catch (e) { next(e); }
    },

    /** GET /v1/admin/me */
    me(req: Request, res: Response, next: (e?: any) => void) {
      try {
        const admin = (req as any).admin as AdminUserRow | undefined;
        if (!admin) throw Errors.unauthorized('Missing admin context');
        respond(res, AdminMeResponseSchema, {
          ok: true,
          data: {
            id: admin.id,
            name: admin.name,
            email: admin.email,
            role: admin.role,
            status: admin.status,
            last_login_at: admin.last_login_at,
            created_at: admin.created_at,
          },
        });
      } catch (e) { next(e); }
    },
  };
}
```

注意：login 函数不返回真实 api_key — 我需要修复。先看下面 Step 3.1b。

### Step 3.1b: 修复 login（让其返回真实 api_key）

把 handler 文件中的 `login` 函数替换为：

```typescript
    /** POST /v1/admin/auth/login */
    async login(req: Request, res: Response, next: (e?: any) => void) {
      try {
        const parsed = AdminLoginRequestSchema.safeParse(req.body);
        if (!parsed.success) throw Errors.invalidParams('email and password required');
        const { email, password } = parsed.data;

        const row = repo.findByEmail(email);
        if (!row) throw Errors.unauthorized('Invalid email or password');
        if (row.status === 'suspended') throw Errors.forbidden('Admin account suspended');

        const ok = await bcrypt.compare(password, row.password_hash);
        if (!ok) throw Errors.unauthorized('Invalid email or password');

        // Always generate a fresh api_key on login (clients should rotate on demand anyway)
        const { hash, key, prefix } = await generateAdminApiKey();
        repo.updateApiKey(row.id, hash, prefix, new Date().toISOString());
        repo.updateLastLogin(row.id, new Date().toISOString());

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
```

### Step 3.2: 在 admin router 加 3 条路由

打开 `src/main/routes/admin.ts`，在文件顶部 import 块加：

```typescript
import {
  // ...已有...
  AdminLoginRequestSchema, AdminLoginResponseSchema, AdminMeResponseSchema, AdminRotateKeyResponseSchema,
} from '../schemas/admin.js';
```

```typescript
import { createAdminAuthHandler } from '../modules/admin/handlers/auth.js';
```

在 `createAdminRouter` 函数体内部，加 handler 实例（其他 handler 旁边）：

```typescript
  const auth = createAdminAuthHandler(db);
```

然后在现有 `/ping` 路由**之前**加 3 条路由：

```typescript
  // Auth (login is public; rotate-key + me require bearer)
  router.post('/auth/login', (req, res, next) => auth.login(req, res, next));
  router.post('/auth/rotate-key', (req, res, next) => auth.rotateKey(req, res, next));
  router.get('/me', (req, res, next) => auth.me(req, res, next));
```

### Step 3.3: Typecheck

Run: `cd D:\dev\hunter-platform && pnpm typecheck 2>&1 | tail -5`
Expected: 可能报错 — 因为现在的 `createAdminAuthMiddleware` 不设置 `req.admin`，rotate-key 和 me 端点需要它。这会在 Task 4 解决。先看是否有其他错误。

### Step 3.4: Commit

```bash
cd D:\dev\hunter-platform
git add src/main/modules/admin/handlers/auth.ts src/main/routes/admin.ts
git commit -m "feat(admin): add auth handler (login/rotate-key/me) + 3 routes"
```

---

## Task 4: 重写 `createAdminAuthMiddleware` 查表

**Files:**
- Modify: `src/main/modules/admin/auth.ts`

### Step 4.1: 重写整个文件

替换 `src/main/modules/admin/auth.ts` 的内容：

```typescript
// Per-admin api_key auth (replaces shared ADMIN_PASSWORD_HASH).
// See docs/superpowers/specs/2026-06-23-web-admin-sub-A-design.md
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import bcrypt from 'bcryptjs';
import type { DB } from '../../db/connection.js';
import { createAdminUsersRepo, type AdminUserRow } from '../../db/repositories/admin-users.js';
import { Errors } from '../../errors.js';

const API_KEY_PREFIX_LEN = 18; // matches handlers/auth.ts generateAdminApiKey

export function createAdminAuthMiddleware(db: DB): RequestHandler {
  const repo = createAdminUsersRepo(db);
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ') || auth.length <= 7) {
      return next(Errors.unauthorized('Admin auth requires "Authorization: Bearer <admin_api_key>"'));
    }
    const apiKey = auth.slice(7);
    const prefix = apiKey.slice(0, API_KEY_PREFIX_LEN);
    const row = repo.findByApiKeyPrefix(prefix);
    if (!row) return next(Errors.unauthorized('Invalid admin api key'));

    bcrypt.compare(apiKey, row.api_key_hash, (err, ok) => {
      if (err) {
        console.error('adminAuth: bcrypt error', err);
        return next(Errors.internal('Admin auth backend error'));
      }
      if (!ok) return next(Errors.unauthorized('Invalid admin api key'));
      if (row.status === 'suspended') return next(Errors.forbidden('Admin account suspended'));
      // Attach admin context for handlers
      (req as any).admin = row;
      next();
    });
  };
}
```

### Step 4.2: 更新 server.ts 的 admin router 装配

打开 `src/main/server.ts`，找到挂载 admin router 的位置（`createAdminRouter(db, encryptionKey)`）。把签名改为接受 middleware：

由于原签名是 `createAdminRouter(db, encryptionKey)`，admin router 内部使用了 `createAdminAuthMiddleware()`（无参版本，读 env）。需要改成接受 db 参数的版本。

**搜索位置**：`src/main/server.ts` 中找 `app.use('/v1/admin'` 或类似的挂载代码。

```typescript
// 旧：app.use('/v1/admin', createAdminRouter(db, encryptionKey));
// 新：
app.use('/v1/admin', createAdminAuthMiddleware(db), createAdminRouter(db, encryptionKey));
```

注意：需要 import `createAdminAuthMiddleware`：

```typescript
import { createAdminAuthMiddleware } from './modules/admin/auth.js';
```

### Step 4.3: 修复 `createAdminRouter` 内部不再调 middleware

打开 `src/main/routes/admin.ts`，删除 `createAdminAuthMiddleware` import（如果存在）和 router 内部的 `router.use(createAdminAuthMiddleware())` 调用（如果有）。

注：当前 admin.ts 没有用 router.use(...) 装载 middleware，middleware 是在 server.ts 中按路径装载的。所以这里不需要改 routes/admin.ts，只需确保不在路由内部又调一次 middleware。

### Step 4.4: Typecheck

Run: `cd D:\dev\hunter-platform && pnpm typecheck 2>&1 | tail -5`
Expected: no errors

### Step 4.5: Commit

```bash
cd D:\dev\hunter-platform
git add src/main/modules/admin/auth.ts src/main/server.ts
git commit -m "feat(admin): rewrite auth middleware to look up admin_users by api_key"
```

---

## Task 5: 更新既有 20 个 admin 端点测试 + 加新 auth 端点测试

**Files:**
- Modify: `tests/integration/admin-endpoints.test.ts`（既有 admin 测试 — 需要在 beforeAll 里 seed admin 并用新 auth）
- Create: `tests/integration/admin-auth.test.ts`（新 auth 端点的 10 个测试）

### Step 5.1: 创建新 auth 端点测试

Create `tests/integration/admin-auth.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('admin auth endpoints', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-auth-test.db');
  let app: any;
  let db: any;
  let adminEmail: string;
  let adminPassword: string;
  let adminApiKey: string;
  let suspendedEmail: string;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    try { fs.unlinkSync(testDb + '-wal'); } catch {}
    try { fs.unlinkSync(testDb + '-shm'); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = 'DEPRECATED'; // 故意设，确保代码不读
    process.env.SEED_ADMIN_PASSWORD = '';  // 测试不走 seed，手动 seed
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createAppFromDb } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { loadEnv } = await import('../../src/main/env');
    db = openDb(testDb);
    runMigrations(db);
    app = createAppFromDb(db, loadEnv());

    // Seed: 一个 active admin + 一个 suspended admin
    adminEmail = 'active@test.com';
    adminPassword = 'test-admin-pwd-12345';
    const pwdHash = bcrypt.hashSync(adminPassword, 4);  // 加速测试
    const keyHash = bcrypt.hashSync('hp_admin_testkey_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_active', 'Active Admin', adminEmail, pwdHash, keyHash, 'hp_admin_testkey', 'admin', 'active',
      '2026-06-23T00:00:00Z', '2026-06-23T00:00:00Z'
    );
    // Login 拿到真实 api_key（login 会 rotate）
    const loginResp = await request(app).post('/v1/admin/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    adminApiKey = loginResp.body.data.api_key;

    suspendedEmail = 'suspended@test.com';
    const spwdHash = bcrypt.hashSync('suspended-pwd', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_suspended', 'Suspended Admin', suspendedEmail, spwdHash, 'h', 'hp_admin_susp', 'admin', 'suspended',
      '2026-06-23T00:00:00Z', '2026-06-23T00:00:00Z'
    );
  });

  afterAll(() => { if (db) db.close(); });

  // ---- login ----
  it('1. POST login wrong email → 401', async () => {
    const r = await request(app).post('/v1/admin/auth/login')
      .send({ email: 'wrong@test.com', password: 'whatever' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });

  it('2. POST login wrong password → 401', async () => {
    const r = await request(app).post('/v1/admin/auth/login')
      .send({ email: adminEmail, password: 'wrong-password' });
    expect(r.status).toBe(401);
  });

  it('3. POST login suspended admin → 403', async () => {
    const r = await request(app).post('/v1/admin/auth/login')
      .send({ email: suspendedEmail, password: 'suspended-pwd' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('SUSPENDED');
  });

  it('4. POST login success → 200 + api_key', async () => {
    // 重新登录（之前 login 已 rotate key 一次）
    const r = await request(app).post('/v1/admin/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    expect(r.status).toBe(200);
    expect(r.body.data.api_key).toMatch(/^hp_admin_/);
    expect(r.body.data.role).toBe('admin');
  });

  // ---- me ----
  it('5. GET /me no bearer → 401', async () => {
    const r = await request(app).get('/v1/admin/me');
    expect(r.status).toBe(401);
  });

  it('6. GET /me wrong bearer → 401', async () => {
    const r = await request(app).get('/v1/admin/me').set('Authorization', 'Bearer hp_admin_wrongkey');
    expect(r.status).toBe(401);
  });

  it('7. GET /me correct bearer → 200 + admin info', async () => {
    const r = await request(app).get('/v1/admin/me').set('Authorization', `Bearer ${adminApiKey}`);
    expect(r.status).toBe(200);
    expect(r.body.data.email).toBe(adminEmail);
    expect(r.body.data.role).toBe('admin');
  });

  // ---- rotate-key ----
  it('8. POST rotate-key no bearer → 401', async () => {
    const r = await request(app).post('/v1/admin/auth/rotate-key');
    expect(r.status).toBe(401);
  });

  it('9. POST rotate-key correct bearer → 200 + new key; old key invalidated', async () => {
    // 先记录旧 key
    const beforeResp = await request(app).get('/v1/admin/me').set('Authorization', `Bearer ${adminApiKey}`);
    expect(beforeResp.status).toBe(200);

    // rotate
    const r = await request(app).post('/v1/admin/auth/rotate-key').set('Authorization', `Bearer ${adminApiKey}`);
    expect(r.status).toBe(200);
    const newKey = r.body.data.api_key;
    expect(newKey).not.toBe(adminApiKey);

    // 旧 key 应该失效
    const oldCheck = await request(app).get('/v1/admin/me').set('Authorization', `Bearer ${adminApiKey}`);
    expect(oldCheck.status).toBe(401);

    // 新 key 应该可用
    const newCheck = await request(app).get('/v1/admin/me').set('Authorization', `Bearer ${newKey}`);
    expect(newCheck.status).toBe(200);
    adminApiKey = newKey; // 更新给后续测试用
  });
});
```

### Step 5.2: 更新既有 admin-endpoints.test.ts

打开 `tests/integration/admin-endpoints.test.ts`。找到 `beforeAll` 块中创建 app 的部分。改为：

```typescript
  beforeAll(async () => {
    // ... existing setup ...
    app = createAppFromDb(db, loadEnv());
    // 旧：admin auth 是 shared password (process.env.ADMIN_PASSWORD_HASH)
    // 新：需要在 admin_users 表里有 admin
    const bcrypt = await import('bcryptjs');
    const pwdHash = bcrypt.hashSync('admin-test-pwd-12345', 4);
    const keyHash = bcrypt.hashSync('hp_admin_legacykey_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_default', 'Default Admin', 'admin@default.com', pwdHash, keyHash, 'hp_admin_legacy', 'super', 'active',
      '2026-06-23T00:00:00Z', '2026-06-23T00:00:00Z'
    );
    // Login 拿真实 api_key
    const loginResp = await fetch('http://localhost:3000/v1/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@default.com', password: 'admin-test-pwd-12345' }),
    }).then(r => r.json() as any);
    // 注意：这需要 app 已 listening；supertest 模式下 app 未 listen，所以应该用 supertest
    const supertest = (await import('supertest')).default;
    const lr = await supertest(app).post('/v1/admin/auth/login')
      .send({ email: 'admin@default.com', password: 'admin-test-pwd-12345' });
    adminAuth = `Bearer ${lr.body.data.api_key}`;
  });
```

注意：原文件中 `adminAuth = \`Bearer ${ADMIN_PWD}\`` 需要改成动态从 login 获取。新变量 `adminAuth` 在 `beforeAll` 之外声明（顶层 scope）。

如果原文件中 `adminAuth` 是 const 改成 let 或 var。类似调整其他 admin 测试（如有第二组）。

### Step 5.3: 跑既有 admin 测试，验证改造成功

Run: `cd D:\dev\hunter-platform && pnpm vitest run tests/integration/admin-endpoints.test.ts 2>&1 | tail -10`
Expected: 既有 admin 测试全过（用新 admin api_key 鉴权）

### Step 5.4: 跑新 auth 测试

Run: `cd D:\dev\hunter-platform && pnpm vitest run tests/integration/admin-auth.test.ts 2>&1 | tail -10`
Expected: 9 tests pass (test 10 "seed 测试" 见 Task 6)

### Step 5.5: Typecheck

Run: `cd D:\dev\hunter-platform && pnpm typecheck 2>&1 | tail -3`

### Step 5.6: Commit

```bash
cd D:\dev\hunter-platform
git add tests/integration/admin-endpoints.test.ts tests/integration/admin-auth.test.ts
git commit -m "test: add admin auth tests + update existing admin tests for new auth"
```

---

## Task 6: Seed function + 启动时调用

**Files:**
- Create: `src/main/seed/admin.ts`
- Modify: `src/main/index.ts`

### Step 6.1: 创建 seed 函数

Create `src/main/seed/admin.ts`:

```typescript
// Seed first admin if admin_users table is empty.
// Reads SEED_ADMIN_PASSWORD env var. Logs warning if neither table populated nor seed env set.
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { DB } from '../db/connection.js';
import { createAdminUsersRepo } from '../db/repositories/admin-users.js';

const API_KEY_PREFIX_LEN = 18;
const BCRYPT_COST = 10;

async function generateAdminApiKey(): Promise<{ hash: string; key: string; prefix: string }> {
  const random = crypto.randomBytes(32).toString('hex');
  const key = `hp_admin_${random}`;
  const prefix = key.slice(0, API_KEY_PREFIX_LEN);
  const hash = await bcrypt.hash(key, BCRYPT_COST);
  return { hash, key, prefix };
}

export async function seedAdminIfEmpty(db: DB): Promise<void> {
  const repo = createAdminUsersRepo(db);
  if (repo.count() > 0) return;

  const seedPwd = process.env.SEED_ADMIN_PASSWORD;
  if (!seedPwd) {
    console.warn('[admin-seed] admin_users table is empty and SEED_ADMIN_PASSWORD env not set; no admin bootstrapped');
    return;
  }

  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@qing3.top';
  const pwdHash = await bcrypt.hash(seedPwd, BCRYPT_COST);
  const { hash: keyHash, key: apiKey, prefix: keyPrefix } = await generateAdminApiKey();
  const now = new Date().toISOString();

  repo.insert({
    id: 'adm_default_seed',
    name: 'Default Admin',
    email,
    password_hash: pwdHash,
    api_key_hash: keyHash,
    api_key_prefix: keyPrefix,
    role: 'super',
    status: 'active',
    created_at: now,
    updated_at: now,
  });
  console.log(`[admin-seed] seeded default admin: ${email} (api_key not echoed for security; check logs of Web UI login to retrieve)`);
  // 注：api_key 只在生成时返回一次，重启后无法重看。运维应立即登录 Web UI 拿到新 key。
  // Production 流程：通过登录端点获取新 key（每次登录都 rotate）。
}
```

### Step 6.2: 在启动时调用 seed

打开 `src/main/index.ts`，找到 main 启动函数（处理 env / load migrations 之后、start server 之前）。加：

```typescript
import { seedAdminIfEmpty } from './seed/admin.js';
// ... after runMigrations(db) ...
await seedAdminIfEmpty(db);
```

### Step 6.3: 加 seed 集成测试（spec §7.1 第 10 项）

打开 `tests/integration/admin-auth.test.ts`，追加一个 test：

```typescript
  describe('seed admin', () => {
    it('10. seed creates admin when table empty + SEED_ADMIN_PASSWORD set', async () => {
      const freshTestDb = path.join(__dirname, '../../tmp/admin-seed-test.db');
      try { fs.unlinkSync(freshTestDb); } catch {}
      try { fs.unlinkSync(freshTestDb + '-wal'); } catch {}
      try { fs.unlinkSync(freshTestDb + '-shm'); } catch {}
      process.env.DATABASE_PATH = freshTestDb;
      process.env.SEED_ADMIN_PASSWORD = 'seed-test-pwd';
      process.env.SEED_ADMIN_EMAIL = 'seed@test.com';
      const { openDb } = await import('../../src/main/db/connection');
      const { runMigrations } = await import('../../src/main/db/migrations');
      const freshDb = openDb(freshTestDb);
      runMigrations(freshDb);
      const { seedAdminIfEmpty } = await import('../../src/main/seed/admin');
      await seedAdminIfEmpty(freshDb);
      const row = freshDb.prepare('SELECT * FROM admin_users WHERE id = ?').get('adm_default_seed') as any;
      expect(row).toBeTruthy();
      expect(row.email).toBe('seed@test.com');
      expect(row.role).toBe('super');
      freshDb.close();
    });
  });
```

### Step 6.4: 跑测试，验证通过

Run: `cd D:\dev\hunter-platform && pnpm vitest run tests/integration/admin-auth.test.ts 2>&1 | tail -5`
Expected: 10 tests pass

### Step 6.5: 全量回归既有 admin 测试

Run: `cd D:\dev\hunter-platform && pnpm test 2>&1 | tail -5`
Expected: 既有 800+ 测试通过（admin-endpoints.test.ts 现在用新 api_key）

### Step 6.6: Typecheck

Run: `cd D:\dev\hunter-platform && pnpm typecheck 2>&1 | tail -3`

### Step 6.7: Commit

```bash
cd D:\dev\hunter-platform
git add src/main/seed/admin.ts src/main/index.ts tests/integration/admin-auth.test.ts
git commit -m "feat(admin): seed first admin from SEED_ADMIN_PASSWORD env"
```

---

## Task 7: admin-web Vite + React + TS skeleton

**Files:**
- Create: `admin-web/package.json`
- Create: `admin-web/tsconfig.json`
- Create: `admin-web/vite.config.ts`
- Create: `admin-web/index.html`
- Create: `admin-web/src/main.tsx`
- Create: `admin-web/src/App.tsx`

### Step 7.1: 创建 package.json

Create `admin-web/package.json`:

```json
{
  "name": "@qing3a/hunter-platform-admin-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.6.2",
    "vite": "^5.4.6"
  }
}
```

### Step 7.2: 创建 tsconfig.json

Create `admin-web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

### Step 7.3: 创建 vite.config.ts

Create `admin-web/vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '../out/admin'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5174,
    proxy: {
      '/v1': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
```

### Step 7.4: 创建 index.html

Create `admin-web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Hunter Platform Admin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### Step 7.5: 创建 main.tsx 和 App.tsx（placeholder，Task 8 替换）

Create `admin-web/src/main.tsx`:

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

Create `admin-web/src/styles.css` (minimal):

```css
body { font-family: system-ui, sans-serif; margin: 0; padding: 0; }
.container { max-width: 1200px; margin: 0 auto; padding: 24px; }
.nav { background: #1a1a1a; color: white; padding: 12px 24px; display: flex; gap: 16px; align-items: center; }
.nav a { color: white; text-decoration: none; padding: 8px 12px; border-radius: 4px; }
.nav a:hover { background: rgba(255,255,255,0.1); }
.nav .spacer { flex: 1; }
.card { border: 1px solid #e0e0e0; border-radius: 8px; padding: 24px; margin: 16px 0; }
.btn { padding: 10px 16px; border: none; border-radius: 4px; background: #0066cc; color: white; cursor: pointer; }
.btn:hover { background: #0052a3; }
.btn-danger { background: #cc3300; }
input { padding: 8px 12px; border: 1px solid #ccc; border-radius: 4px; width: 100%; box-sizing: border-box; margin: 4px 0; }
label { display: block; margin: 8px 0 4px; }
.error { color: #cc3300; margin: 8px 0; }
```

Create `admin-web/src/App.tsx` (placeholder):

```typescript
import { BrowserRouter } from 'react-router-dom';

export default function App() {
  return (
    <BrowserRouter basename="/admin">
      <div className="container">
        <h1>Hunter Platform Admin (skeleton)</h1>
        <p>Task 7 skeleton — pages added in Task 8.</p>
      </div>
    </BrowserRouter>
  );
}
```

### Step 7.6: 安装依赖 + build 验证

Run:
```bash
cd D:\dev\hunter-platform\admin-web
pnpm install
pnpm build 2>&1 | tail -10
```
Expected: build 成功，产物在 `D:\dev\hunter-platform\out\admin\`

### Step 7.7: Commit

```bash
cd D:\dev\hunter-platform
git add admin-web/
git commit -m "feat(admin-web): vite + react + ts skeleton"
```

---

## Task 8: API client + 3 个页面

**Files:**
- Create: `admin-web/src/api/client.ts`
- Create: `admin-web/src/lib/auth.ts`
- Create: `admin-web/src/components/Layout.tsx`
- Create: `admin-web/src/components/PrivateRoute.tsx`
- Create: `admin-web/src/pages/LoginPage.tsx`
- Create: `admin-web/src/pages/DashboardPage.tsx`
- Create: `admin-web/src/pages/ProfilePage.tsx`
- Modify: `admin-web/src/App.tsx`

### Step 8.1: 创建 auth lib

Create `admin-web/src/lib/auth.ts`:

```typescript
const TOKEN_KEY = 'hunter_admin_api_key';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(key: string): void {
  localStorage.setItem(TOKEN_KEY, key);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}
```

### Step 8.2: 创建 API client

Create `admin-web/src/api/client.ts`:

```typescript
import { getToken, clearToken } from '../lib/auth';

export type ApiError = { code: string; message: string };

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`/v1/admin/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401) {
    clearToken();
    window.location.href = '/admin/login';
    throw new Error('Unauthorized');
  }
  if (!data?.ok) {
    throw new Error((data?.error as ApiError)?.message ?? `API error: ${res.status}`);
  }
  return data.data as T;
}
```

### Step 8.3: 创建 Layout 组件

Create `admin-web/src/components/Layout.tsx`:

```typescript
import { Link, useNavigate } from 'react-router-dom';
import { clearToken } from '../lib/auth';

export default function Layout({ children, adminName }: { children: React.ReactNode; adminName: string }) {
  const navigate = useNavigate();
  const logout = () => {
    clearToken();
    navigate('/admin/login');
  };
  return (
    <>
      <nav className="nav">
        <strong>Hunter Admin</strong>
        <Link to="/admin/">Dashboard</Link>
        <Link to="/admin/profile">Profile</Link>
        <div className="spacer" />
        <span>{adminName}</span>
        <button className="btn btn-danger" onClick={logout} style={{ marginLeft: 12 }}>Logout</button>
      </nav>
      <div className="container">{children}</div>
    </>
  );
}
```

### Step 8.4: 创建 PrivateRoute 组件

Create `admin-web/src/components/PrivateRoute.tsx`:

```typescript
import { Navigate } from 'react-router-dom';
import { getToken } from '../lib/auth';

export default function PrivateRoute({ children }: { children: React.ReactNode }) {
  return getToken() ? <>{children}</> : <Navigate to="/admin/login" replace />;
}
```

### Step 8.5: 创建 LoginPage

Create `admin-web/src/pages/LoginPage.tsx`:

```typescript
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { setToken } from '../lib/auth';

type LoginResp = { admin_user_id: string; name: string; email: string; role: string; api_key: string };

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiFetch<LoginResp>('auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setToken(data.api_key);
      navigate('/admin/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>Hunter Platform Admin</h1>
      <form onSubmit={submit} className="card" style={{ maxWidth: 400 }}>
        <label>Email</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
        <label>Password</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        {error && <div className="error">{error}</div>}
        <button type="submit" className="btn" disabled={loading} style={{ marginTop: 12 }}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
```

### Step 8.6: 创建 DashboardPage

Create `admin-web/src/pages/DashboardPage.tsx`:

```typescript
import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { apiFetch } from '../api/client';

type Me = { id: string; name: string; email: string; role: string; status: string; last_login_at: string | null; created_at: string };

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    apiFetch<Me>('me').then(setMe).catch(() => {});
  }, []);

  if (!me) return <Layout adminName="..."><p>Loading...</p></Layout>;

  return (
    <Layout adminName={me.name}>
      <h1>Welcome, {me.name}</h1>
      <p>Role: {me.role}</p>
      <p>Last login: {me.last_login_at ?? 'never'}</p>

      <h2 style={{ marginTop: 32 }}>Quick links</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <div className="card">📊 <strong>Users</strong><br/><small>Sub-B</small></div>
        <div className="card">👥 <strong>Candidates</strong><br/><small>Sub-B</small></div>
        <div className="card">📜 <strong>Audit</strong><br/><small>Sub-D</small></div>
        <div className="card">📋 <strong>Action History</strong><br/><small>Sub-D</small></div>
      </div>
    </Layout>
  );
}
```

### Step 8.7: 创建 ProfilePage

Create `admin-web/src/pages/ProfilePage.tsx`:

```typescript
import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { apiFetch } from '../api/client';
import { setToken, clearToken } from '../lib/auth';

type Me = { id: string; name: string; email: string; role: string; status: string; created_at: string };

export default function ProfilePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [newKey, setNewKey] = useState('');

  useEffect(() => {
    apiFetch<Me>('me').then(setMe).catch(() => {});
  }, []);

  const rotateKey = async () => {
    if (!confirm('Rotate API key? Current key will be invalidated.')) return;
    try {
      const data = await apiFetch<{ api_key: string }>('auth/rotate-key', { method: 'POST' });
      setNewKey(data.api_key);
      setToken(data.api_key);
      alert('API key rotated. New key saved to localStorage.');
    } catch (err: any) {
      alert('Failed: ' + err.message);
    }
  };

  if (!me) return <Layout adminName="..."><p>Loading...</p></Layout>;

  return (
    <Layout adminName={me.name}>
      <h1>Profile</h1>
      <div className="card">
        <p><strong>ID:</strong> {me.id}</p>
        <p><strong>Email:</strong> {me.email}</p>
        <p><strong>Role:</strong> {me.role}</p>
        <p><strong>Status:</strong> {me.status}</p>
        <p><strong>Created:</strong> {me.created_at}</p>
      </div>
      <div className="card">
        <h2>API Key</h2>
        <p>⚠️ Rotate will invalidate the current key.</p>
        <button className="btn" onClick={rotateKey}>Rotate API Key</button>
        {newKey && (
          <p style={{ marginTop: 12 }}>
            <strong>New key:</strong> <code>{newKey}</code><br/>
            <small>已自动保存到 localStorage.</small>
          </p>
        )}
      </div>
    </Layout>
  );
}
```

### Step 8.8: 替换 App.tsx 为完整路由

替换 `admin-web/src/App.tsx`:

```typescript
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProfilePage from './pages/ProfilePage';
import PrivateRoute from './components/PrivateRoute';

export default function App() {
  return (
    <BrowserRouter basename="/admin">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
        <Route path="/profile" element={<PrivateRoute><ProfilePage /></PrivateRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

### Step 8.9: Build 验证

```bash
cd D:\dev\hunter-platform\admin-web
pnpm build 2>&1 | tail -10
```
Expected: build 成功，产物在 `D:\dev\hunter-platform\out\admin\`

### Step 8.10: 手工 smoke

```bash
# 用浏览器开 http://localhost:5174/login (需要先 pnpm dev)
# 或 build 后用静态服务：
cd D:\dev\hunter-platform
npx http-server out/admin -p 8080
# 浏览器访问 http://localhost:8080/login
```

Expected: 看到 login 页

### Step 8.11: Commit

```bash
cd D:\dev\hunter-platform
git add admin-web/
git commit -m "feat(admin-web): API client + Login/Dashboard/Profile pages"
```

---

## Task 9: Deploy frontend + nginx config + production curl smoke

**Files:**
- Modify: `/etc/nginx/...`（生产 nginx 配置 — 通过 SSH）

### Step 9.1: scp 静态文件到生产

```bash
cd D:\dev\hunter-platform
scp -r -i "/d/Downloads/cc.pem" out/admin/* root@101.201.110.129:/opt/hunter-platform/out/admin/
```

### Step 9.2: SSH 到生产，加 nginx location

```bash
ssh -i "/d/Downloads/cc.pem" root@101.201.110.129 'cat /www/server/panel/vhost/nginx/html_qing3.top.conf' 2>&1
```

查现有 server 块，在 `location /v1/` 之前或合适位置，加：

```
    location /admin/ {
        alias /opt/hunter-platform/out/admin/;
        try_files $uri $uri/ /admin/index.html;
    }
```

注：实际修改 nginx 配置需要写到正确的文件路径（上面 cat 命令显示的实际位置）。如有宝塔面板，需通过面板操作，或直接编辑配置文件。

### Step 9.3: 验证 nginx 配置 + reload

```bash
ssh -i "/d/Downloads/cc.pem" root@101.201.129 'nginx -t && nginx -s reload' 2>&1
```
Expected: syntax OK + reload success

### Step 9.4: 远程 curl smoke

```bash
# 1) /admin/ 返回 index.html (200)
ssh -i "/d/Downloads/cc.pem" root@101.201.110.129 \
  'curl -s -o /dev/null -w "%{http_code}\n" http://localhost/v1/admin/ping'
# Expected: 401 (auth required — 不是 admin 路径，是验证 nginx 配置后 ping)

# 2) /admin/login 端点
ssh -i "/d/Downloads/cc.pem" root@101.201.110.129 \
  'curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/v1/admin/auth/login -X POST -H "Content-Type: application/json" -d "{}"'
# Expected: 400 INVALID_PARAMS (空 body)

# 3) 走 seed admin 登录（如设了 SEED_ADMIN_PASSWORD）
ssh -i "/d/Downloads/cc.pem" root@101.201.110.129 \
  'curl -s -X POST -H "Content-Type: application/json" -d "{\"email\":\"admin@qing3.top\",\"password\":\"$SEED_PWD\"}" http://localhost:3000/v1/admin/auth/login | jq .data.api_key'
# Expected: api_key 字符串
```

注：第 3 项需要 SEED_ADMIN_PASSWORD 在 `.env` 中已设并重启过服务。

### Step 9.5: 验证 admin web UI 在浏览器可访问（手动）

浏览器访问 https://qing3.top/admin/login（需 nginx 已 reload）。看到 login 页 = 成功。

### Step 9.6: Commit（nginx 配置不在 git 内，跳过；只 commit 任何 build artifact 或 CI 改动）

无 commit 需要（nginx 是 server config）。

---

## Task 10: 文档更新 + 全量回归

**Files:**
- Modify: `docs/superpowers/skill.md`
- Modify: `docs/superpowers/openapi.json`
- Modify: `docs/PROJECT_MEMORY.md`

### Step 10.1: skill.md — admin 鉴权段落改写

打开 `docs/superpowers/skill.md`，找到 admin 鉴权段落（搜索 "ADMIN_PASSWORD_HASH"）。改写为：

```
> **鉴权**：所有 admin 端点需要 `Authorization: Bearer <admin_api_key>`。
> Admin 用户存在 `admin_users` 表（v014+）；通过 POST /v1/admin/auth/login 登录获取 api_key（每次登录 rotate）。
> 首次部署：在 .env 设 SEED_ADMIN_PASSWORD 启动服务自动 seed super admin (admin@qing3.top)。
```

### Step 10.2: openapi.json — 加 3 个新端点

打开 `docs/superpowers/openapi.json`，在 `/v1/admin/ping` 之前，加：

```json
"/v1/admin/auth/login": {
  "post": {
    "summary": "Admin login (returns api_key)",
    "requestBody": { "content": { "application/json": { "schema": { "type": "object", "required": ["email", "password"], "properties": { "email": { "type": "string" }, "password": { "type": "string" } } } } },
    "responses": { "200": { "description": "Login success" }, "401": { "description": "Unauthorized" }, "403": { "description": "Suspended" } }
  }
},
"/v1/admin/auth/rotate-key": {
  "post": {
    "summary": "Rotate admin api_key (invalidates old)",
    "security": [{ "AdminBearer": [] }],
    "responses": { "200": { "description": "New key" }, "401": { "description": "Unauthorized" } }
  }
},
"/v1/admin/me": {
  "get": {
    "summary": "Current admin info",
    "security": [{ "AdminBearer": [] }],
    "responses": { "200": { "description": "Admin info" }, "401": { "description": "Unauthorized" } }
  }
},
```

### Step 10.3: PROJECT_MEMORY.md — 更新活跃任务 + 加新端点速查

打开 `docs/PROJECT_MEMORY.md`，找到活跃任务表，把 Task #3 Sub-A 状态更新：

```
| ✅ | **Sub-A（基础设施）** | ✅ 合并 main（merge commit 待补），生产部署 + nginx location 已加；Sub-B/C/D/E 待开始 |
```

在 §8 重要文件位置速查表加：

```
| admin_users 表 | `src/main/db/repositories/admin-users.ts` |
| admin auth handler | `src/main/modules/admin/handlers/auth.ts`（login/rotate-key/me） |
| admin seed | `src/main/seed/admin.ts` |
| Admin Web UI | `admin-web/`（React + Vite + TS）；build 到 `out/admin/` |
```

### Step 10.4: openapi:check

Run: `cd D:\dev\hunter-platform && pnpm openapi:check 2>&1 | tail -3`
Expected: ✅ No dangling paths

### Step 10.5: 全量回归

Run: `cd D:\dev\hunter-platform && pnpm test 2>&1 | tail -5`
Expected: 既有 + 新增全过（既有 ~800 tests + 新增 admin-auth 10 tests + admin-users 7 tests）

### Step 10.6: Typecheck

Run: `cd D:\dev\hunter-platform && pnpm typecheck 2>&1 | tail -3`

### Step 10.7: Commit

```bash
cd D:\dev\hunter-platform
git add docs/superpowers/skill.md docs/superpowers/openapi.json docs/PROJECT_MEMORY.md
git commit -m "docs: web admin sub-A skill.md + openapi + memory"
```

---

## 验收清单（与 spec §11 对齐）

- [ ] v014 migration 创建 admin_users 表
- [ ] `createAdminAuthMiddleware` 重写查表
- [ ] 3 个新端点（login/rotate-key/me）已加并 schema 验证
- [ ] 既有 20 个 admin 端点的鉴权改造完成（既有测试用新 api_key 跑通）
- [ ] 10 个新增 admin-auth 集成测试全过
- [ ] 7 个新增 admin-users repo 测试全过
- [ ] SEED_ADMIN_PASSWORD env + 重启 → 表非空 + 默认 admin 可登录
- [ ] `pnpm typecheck` 无错
- [ ] `pnpm test` 全套通过（既有 800+ + 新增 17 = 0 regression）
- [ ] `pnpm openapi:check` 通过
- [ ] `admin-web/` build 成功（产物在 `out/admin/`）
- [ ] nginx 配置加 `/admin/` location；reload；浏览器访问 https://qing3.top/admin/ 看到 login 页
- [ ] login 后跳 dashboard；profile 页可 rotate key；rotate 后旧 key 失效
- [ ] curl 远程验证 3 个端点
- [ ] docs/skill.md + openapi.json + PROJECT_MEMORY.md 已更新

---

## 上线流程（spec §12）

```bash
# 1. 部署前准备
ssh -i "/d/Downloads/cc.pem" root@101.201.110.129
# 编辑 /opt/hunter-platform/.env：
#   - 添加 SEED_ADMIN_PASSWORD=临时密码
#   - 改 ADMIN_PASSWORD_HASH=DEPRECATED

# 2. 本地 build 后端
cd /d/dev/hunter-platform && pnpm build

# 3. scp 后端 + 前端
scp -r -i "/d/Downloads/cc.pem" out/main/* root@101.201.110.129:/opt/hunter-platform/out/main/
scp -r -i "/d/Downloads/cc.pem" out/admin/* root@101.201.110.129:/opt/hunter-platform/out/admin/

# 4. 重启服务（trigger seed + 加载新代码）
ssh -i "/d/Downloads/cc.pem" root@101.201.110.129 \
  'systemctl restart hunter-platform'

# 5. nginx reload (需先手动编辑配置加 /admin/ location)
ssh -i "/d/Downloads/cc.pem" root@101.201.110.129 \
  'nginx -t && nginx -s reload'

# 6. 冒烟
#    a) 浏览器访问 https://qing3.top/admin/login → 看到 login 页
#    b) 登录 → 跳 dashboard
#    c) Profile → Rotate Key → 新 key 保存
#    d) 用新 key 调 /v1/admin/ping → 200 (或 admin 路由需要 401 — 看具体端点)
```

---

## 风险与回滚（spec §9）

| 风险 | 概率 | 影响 | 缓解 / 回滚 |
|------|------|------|------------|
| seed 失败导致无 admin | 低 | 高 | 启动日志 warn；运维手测；旧 `.admin-password` 文件保留 |
| ADMIN_PASSWORD_HASH 还有调用方用 | 中 | 中 | README 明确 DEPRECATED；新代码完全不读 env 变量 |
| bcrypt cost=10 启动慢 | 极低 | 低 | seed 只在表空时跑（一次）；login bcrypt 每次 1 次 |
| admin-web nginx location 缺失 | 低 | 中 | Task 9 显式测试 https://qing3.top/admin/login 200 |

**回滚**：每个 Task 独立 commit；紧急回滚：

```bash
git revert --no-commit <last-commit>..<first-commit-of-this-feature>
git commit -m "revert: web admin sub-A (rollback)"
```