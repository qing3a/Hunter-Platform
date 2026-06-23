# Web Admin Sub-A — Infrastructure Design

> **For agentic workers:** 这是 design spec，配套 implementation plan 在 `docs/superpowers/plans/2026-06-23-web-admin-sub-A-plan.md`。
>
> 续接 Task #1 + #2（已部署到生产）。Task #3（Web 管理后台）拆分为 5 个子项目，本 spec 是 **Sub-project A：基础设施**。

**Goal:** 建立 Web admin 基础设施，让管理员能登录、用 admin api_key 调用现有 20 个 `/v1/admin/*` 端点。本 spec 只交付 login + dashboard 占位 + profile/rotate-key 三个页面。后续 4 个子项目（Sub-B/C/D/E）迭代添加功能页面。

**Architecture:**
- **DB**：v014 migration 新增 `admin_users` 表（独立于 `users`）
- **后端**：重写 `createAdminAuthMiddleware` 查 `admin_users` 表（不再读 `ADMIN_PASSWORD_HASH` 环境变量）；新增 3 个 auth 端点
- **前端**：`admin-web/` 子项目，React 18 + Vite + TypeScript；build 产物放主项目 `out/admin/` 静态目录，由 nginx 服务
- **认证**：Bearer api_key 模型（与现有 regular users 一致），前端存 localStorage
- **Seed**：启动时若 `admin_users` 表为空且 `SEED_ADMIN_PASSWORD` env 存在，创建首个 admin

**Tech Stack:** React 18, Vite, TypeScript, react-router-dom, vanilla CSS（暂不引 UI 库）, zod, better-sqlite3, bcryptjs, Express 4.21（已用）, nginx（已用）

---

## 1. 背景与动机

### 1.1 现状

| 项 | 现状 |
|----|------|
| Admin 鉴权 | 单共享密码（bcrypt hash 在 `.env`），`ADMIN_PASSWORD_HASH` |
| Admin 端点 | **20 个** 全部鉴权（users, candidates, audit, action-history, webhooks, rate-limit, config, placements, admin-log, ping, dashboard）|
| Admin UI | ❌ 无（Electron 已废弃，Web 也未建） |
| `admin_action_log` 表 | ✅ v003.sql 已有，`admin_user_id TEXT NOT NULL` 但无 FK 约束 |

### 1.2 真实需求

- **多管理员身份**：每个 admin 有独立身份，可独立审计（`admin_action_log.admin_user_id` 需要指向真实 admin 记录）
- **现有 20 个端点的鉴权改造**：auth 中间件从"读 env"改为"查表"
- **基础 UI 起步**：login + dashboard 占位 + profile（让运维能登录并改密码/rotate key）
- **平滑过渡**：不能锁出运维（已有 `.admin-password` 文件作为最后手段）

### 1.3 非目标（明确不做，留在后续 Sub-project）

- ❌ Admin 用户 CRUD UI（list/create/delete admins）— Sub-A 之后单独 sub-project
- ❌ RBAC 细粒度权限 — Sub-A 只区分 `admin` / `super` 两个 role
- ❌ Admin 操作 dashboard 可视化 — Sub-E
- ❌ 双因子认证、密码重置流程 — 后续
- ❌ 20 个 admin 端点的对应 UI 页面 — Sub-B/C/D/E
- ❌ UI 组件库（shadcn / antd / tailwind）— 后续按需

---

## 2. API 契约

### 2.1 新增端点

#### POST `/v1/admin/auth/login`

**入参**：
```json
{ "email": "admin@qing3.top", "password": "raw_password" }
```

**200 响应**：
```json
{
  "ok": true,
  "data": {
    "admin_user_id": "adm_a1b2c3",
    "name": "Default Admin",
    "email": "admin@qing3.top",
    "role": "super",
    "api_key": "hp_admin_a1b2c3d4e5f6g7h8i9j0..."
  }
}
```

**401**：`{"ok":false,"error":{"code":"UNAUTHORIZED","message":"Invalid email or password"}}`

**403**：`{"ok":false,"error":{"code":"SUSPENDED","message":"Admin account suspended"}}`

副作用：更新 `last_login_at = now()`

---

#### POST `/v1/admin/auth/rotate-key`

**鉴权**：`Authorization: Bearer <current_admin_api_key>`

**200 响应**：
```json
{ "ok": true, "data": { "api_key": "hp_admin_NEW_KEY..." } }
```

副作用：旧 api_key 立即失效（更新 `api_key_hash` 和 `api_key_prefix`）；客户端必须用新 key 重发请求

**401**：缺/错 bearer

---

#### GET `/v1/admin/me`

**鉴权**：`Authorization: Bearer <admin_api_key>`

**200 响应**：
```json
{
  "ok": true,
  "data": {
    "id": "adm_a1b2c3",
    "name": "Default Admin",
    "email": "admin@qing3.top",
    "role": "super",
    "status": "active",
    "last_login_at": "2026-06-23T12:34:56.789Z",
    "created_at": "2026-06-23T10:00:00.000Z"
  }
}
```

**401**：缺/错 bearer

---

### 2.2 修改现有端点

**所有现有 `/v1/admin/*` 端点（共 20 个）** 的 auth 中间件实现替换：

**Before**（`createAdminAuthMiddleware` 现有逻辑）：
```typescript
// 读 process.env.ADMIN_PASSWORD_HASH
// bcrypt.compare(password, hash)
// 通过 → req.admin = { /* synthetic single admin */ }
```

**After**：
```typescript
// 读 Authorization: Bearer <api_key>
// 用 api_key 前缀查找 admin_users 行
// bcrypt.compare(api_key, api_key_hash)
// 通过 → req.admin = { id, name, email, role }
```

**`req.admin` shape 变更**（影响所有 admin handler）：
```typescript
// Before: { id?: undefined, role: 'super' }
// After:  { id: 'adm_a1b2c3', name: 'Default Admin', email: '...', role: 'super' | 'admin' }
```

具体 admin handlers 内部如何用 `req.admin`（写入 `admin_action_log` 等），保持不变 — 只是数据来源从 synthetic 变真实记录。

---

## 3. 数据模型

### 3.1 v014 Migration：`src/main/db/migrations/v014_admin_users.sql`

```sql
-- v014: admin_users table + deprecate shared ADMIN_PASSWORD_HASH
-- Sub-A of Task #3 (Web Admin) — see docs/superpowers/specs/2026-06-23-web-admin-sub-A-design.md

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

无 FK 约束指向 `admin_action_log.admin_user_id`（避免 schema 变更爆炸；逻辑上保证一致）。

### 3.2 repo 接口：`src/main/db/repositories/admin-users.ts`

```typescript
interface AdminUserRow {
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

interface AdminUserRepo {
  findByEmail(email: string): AdminUserRow | undefined;
  findByApiKeyPrefix(prefix: string): AdminUserRow | undefined;  // login 时用
  findById(id: string): AdminUserRow | undefined;
  insert(row: Omit<AdminUserRow, 'last_login_at'>): void;
  updateLastLogin(id: string, ts: string): void;
  updateApiKey(id: string, hash: string, prefix: string, ts: string): void;
  count(): number;  // seed 时判断是否为空
}
```

---

## 4. Seed 流程

### 4.1 触发条件

在 `src/main/index.ts` 启动序列中：

```typescript
// 启动时检查
const adminCount = adminUserRepo.count();
if (adminCount === 0) {
  const seedPassword = process.env.SEED_ADMIN_PASSWORD;
  if (seedPassword) {
    const { hash: passwordHash } = await bcrypt.hash(seedPassword, 10);
    const { hash: apiKeyHash, key: apiKey, prefix: apiKeyPrefix } = await generateAdminApiKey();
    adminUserRepo.insert({
      id: 'adm_default_seed',
      name: 'Default Admin',
      email: process.env.SEED_ADMIN_EMAIL ?? 'admin@qing3.top',
      password_hash: passwordHash,
      api_key_hash: apiKeyHash,
      api_key_prefix: apiKeyPrefix,
      role: 'super',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    console.log('[admin-seed] seeded default admin: ' + process.env.SEED_ADMIN_EMAIL ?? 'admin@qing3.top');
  } else {
    console.warn('[admin-seed] admin_users empty; set SEED_ADMIN_PASSWORD env to bootstrap first admin');
  }
}
```

### 4.2 `generateAdminApiKey()` 逻辑

```typescript
async function generateAdminApiKey(): Promise<{ hash: string; key: string; prefix: string }> {
  const random = crypto.randomBytes(32).toString('hex');  // 64 chars
  const key = `hp_admin_${random}`;                       // ~73 chars total
  const prefix = key.slice(0, 18);                        // 'hp_admin_' + 8 chars (用于 lookup)
  const hash = await bcrypt.hash(key, 10);
  return { hash, key, prefix };
}
```

### 4.3 运维流程

1. **第一次部署前**：在 `/opt/hunter-platform/.env` 加 `SEED_ADMIN_PASSWORD=临时密码`（至少 12 字符）
2. **启动服务**：`systemctl restart hunter-platform`，日志会显示 `[admin-seed] seeded default admin: admin@qing3.top`
3. **登录 Web UI**：用 admin@qing3.top + 临时密码登录 → `/admin/`
4. **立即 rotate key**：在 ProfilePage 点 "Rotate API Key"，新 key 保存到 localStorage
5. **清理 ENV**：把 `ADMIN_PASSWORD_HASH=...` 改为 `ADMIN_PASSWORD_HASH=DEPRECATED`（保留作为历史文档，不被代码读取）；`SEED_ADMIN_PASSWORD` 可删（下次重启已 seed 完成，不再触发）
6. **（可选）改密码**：在 ProfilePage 加"Change Password"按钮 — 列入 Sub-A **之后**的子项目（YAGNI，不在本 spec）

---

## 5. 前端架构（`admin-web/`）

### 5.1 项目结构

```
admin-web/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/
│   ├── main.tsx              # React entry
│   ├── App.tsx               # Router root
│   ├── api/
│   │   └── client.ts         # fetch wrapper with bearer header
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── DashboardPage.tsx
│   │   └── ProfilePage.tsx
│   ├── components/
│   │   ├── Layout.tsx        # Nav bar + content area
│   │   └── PrivateRoute.tsx  # Auth guard
│   ├── lib/
│   │   ├── auth.ts           # localStorage token management
│   │   └── api.ts            # API base URL
│   └── styles.css
```

### 5.2 路由

| Path | Component | 鉴权 |
|------|-----------|------|
| `/admin/login` | LoginPage | 不需要（公开） |
| `/admin/` | DashboardPage | 需 bearer |
| `/admin/profile` | ProfilePage | 需 bearer |

未匹配的 path → redirect `/admin/`

### 5.3 构建配置（vite.config.ts）

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../out/admin',                  // 产物放主项目 out/admin/
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5174,
    proxy: {
      '/v1': {
        target: 'http://localhost:3000',     // dev server proxy to API
        changeOrigin: true,
      },
    },
  },
});
```

### 5.4 API client 鉴权流（`api/client.ts`）

```typescript
const TOKEN_KEY = 'hunter_admin_api_key';

export function getToken(): string | null { return localStorage.getItem(TOKEN_KEY); }
export function setToken(key: string) { localStorage.setItem(TOKEN_KEY, key); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

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
  if (res.status === 401) { clearToken(); window.location.href = '/admin/login'; throw new Error('Unauthorized'); }
  const data = await res.json();
  if (!data.ok) throw new Error(data.error?.message ?? 'API error');
  return data.data;
}
```

### 5.5 LoginPage UI（草图）

```
┌─────────────────────────────────┐
│   Hunter Platform Admin          │
│                                  │
│   ┌───────────────────────────┐  │
│   │ Email:    [____________]  │  │
│   │ Password: [____________]  │  │
│   │                           │  │
│   │ [        Sign in        ] │  │
│   └───────────────────────────┘  │
└─────────────────────────────────┘
```

### 5.6 DashboardPage UI（占位 — Sub-B/C/D/E 填充）

```
┌─────────────────────────────────────────────────┐
│ Hunter Admin  [Logout]  Profile                  │
├─────────────────────────────────────────────────┤
│  Welcome, {name}                                 │
│  Role: {role}                                    │
│  Last login: {last_login_at}                     │
│                                                  │
│  [Users]  [Candidates]  [Audit]  [Action History]│  ← 后续 Sub-B/C/D/E
└─────────────────────────────────────────────────┘
```

### 5.7 ProfilePage UI

```
┌─────────────────────────────────────────────────┐
│ Hunter Admin  [Logout]  Profile                  │
├─────────────────────────────────────────────────┤
│  Admin info                                     │
│    ID: adm_a1b2c3                               │
│    Email: admin@qing3.top                        │
│    Role: super                                  │
│    Created: 2026-06-23                          │
│                                                  │
│  API Key:                                        │
│    hp_admin_xxxxxxxx (last 4 shown)             │
│    [Rotate API Key]                              │
│                                                  │
│  ⚠️ Rotate will invalidate current key.          │
└─────────────────────────────────────────────────┘
```

---

## 6. 部署

### 6.1 Build & ship

```bash
# 本地 build
cd /d/dev/hunter-platform/admin-web
pnpm install && pnpm build
# 产物在 /d/dev/hunter-platform/out/admin/

# scp 到生产
scp -r -i "/d/Downloads/cc.pem" \
  /d/dev/hunter-platform/out/admin/* \
  root@101.201.110.129:/opt/hunter-platform/out/admin/

# 不需重启服务（静态文件）
```

### 6.2 nginx 配置修改

在 `/www/server/panel/vhost/nginx/html_qing3.top.conf` 中加一个 location：

```nginx
location /admin/ {
    alias /opt/hunter-platform/out/admin/;
    try_files $uri $uri/ /admin/index.html;
    # SPA fallback — 所有 /admin/* 不匹配文件时回 index.html
}
```

确保 `/admin/index.html` 可由 nginx 读取（chmod 644 即可）。

### 6.3 Nginx reload

```bash
ssh -i "/d/Downloads/cc.pem" root@101.201.110.129 'nginx -t && nginx -s reload'
# 或：/etc/init.d/nginx reload
```

---

## 7. 测试策略

### 7.1 集成测试（10 个）

`tests/integration/admin-auth.test.ts`：

| # | 场景 | 期望 |
|---|------|------|
| 1 | POST login 错 email | 401 UNAUTHORIZED |
| 2 | POST login 错 password | 401 UNAUTHORIZED |
| 3 | POST login suspended admin | 403 SUSPENDED |
| 4 | POST login 成功 | 200 + api_key |
| 5 | GET /admin/me 无 bearer | 401 |
| 6 | GET /admin/me 错 bearer | 401 |
| 7 | GET /admin/me 正确 bearer | 200 + 当前 admin 信息 |
| 8 | POST rotate-key 无 bearer | 401 |
| 9 | POST rotate-key 正确 bearer | 200 + 新 api_key；旧 key 调用 /me 返回 401 |
| 10 | seed 测试：空 admin_users + SEED_ADMIN_PASSWORD → 重启 → 表非空 | 1 个 admin 行；id='adm_default_seed' |

### 7.2 既有测试

- 既有 20 个 admin 端点测试需要重新 seed admin → 改成在 `beforeAll` 用 seed 流程注册 admin 并拿 api_key；保留测试行为不变
- 0 regression 目标：797/797 → 期望 797+10 = 807/807（最终数字 = 既有 + Sub-A 新增）

### 7.3 验证清单

- [ ] 10 个新集成测试全过
- [ ] `pnpm typecheck` 无错
- [ ] `pnpm test` 全套通过（既有 797+ + 新 10 = 0 regression）
- [ ] `pnpm openapi:check` 通过
- [ ] `admin-web/` build 成功
- [ ] curl 验证：
  ```bash
  # 1) 登录
  curl -X POST -H "Content-Type: application/json" \
    -d '{"email":"admin@qing3.top","password":"..."}' \
    https://qing3.top/v1/admin/auth/login
  # Expected: {"ok":true,"data":{...,"api_key":"hp_admin_..."}}
  
  # 2) 拿 me
  curl -H "Authorization: Bearer hp_admin_..." \
    https://qing3.top/v1/admin/me
  # Expected: {"ok":true,"data":{...}}
  ```

---

## 8. 文档改动

| 路径 | 改动 |
|------|------|
| `docs/superpowers/skill.md` | admin 鉴权段落改写：从"shared password" → "per-admin api_key via admin_users table" |
| `docs/superpowers/openapi.json` | 加 3 个新端点 (`/v1/admin/auth/login`, `/v1/admin/auth/rotate-key`, `/v1/admin/me`) + AdminLoginRequest/Response schemas |
| `docs/PROJECT_MEMORY.md` | 活跃任务 Sub-A 状态；新增 admin_users schema 速查；§1b 部署速查加 nginx location 块示例 |
| `OPERATIONS.md` | 加 SEED_ADMIN_PASSWORD env 变量说明 |
| `README.md` | 加 Web admin 入口链接（指向 https://qing3.top/admin/） |

---

## 9. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| seed 失败导致无 admin 可登录 | 低 | 高 | 启动日志 warn；运维手测登录；旧 `.admin-password` 文件保留作为最后 fallback |
| 旧 API 调用方（Curl/Postman）配置 hard-coded 共享密码 | 中 | 中 | README 明确 "shared password 已废弃，用 /v1/admin/auth/login" |
| 前端 build 静态文件 nginx 权限 | 低 | 中 | `chmod 644 /opt/hunter-platform/out/admin/index.html` |
| localStorage XSS 风险 | 低 | 中 | admin API key 不能做用户操作；CSP 在 nginx 设 `default-src 'self'` |
| bcrypt cost=10 启动慢 | 极低 | 低 | seed 只在表为空时跑（一次）；login 时也 bcrypt compare 但只 1 次 |

---

## 10. 不在范围内（YAGNI）

- ❌ Admin CRUD UI（list/create/delete）— 单独 sub-project
- ❌ 改密码端点 — Sub-A 之后
- ❌ 忘记密码流程 — Sub-A 之后
- ❌ 双因子认证 — Sub-A 之后
- ❌ 20 个 admin 端点的对应 UI — Sub-B/C/D/E
- ❌ 审计 dashboard（admin_action_log 可视化）— Sub-E
- ❌ Admin 操作时 session timeout — 客户端用 token 失效代替 server-side timeout
- ❌ nginx HTTPS/证书管理 — 假设现有证书覆盖新路径
- ❌ UI 组件库（shadcn/antd/tailwind） — 用 vanilla CSS 起步
- ❌ i18n（多语言） — 后续
- ❌ 单元测试覆盖率门槛 — 集成测试已足够覆盖本 spec 范围

---

## 11. 验收清单（与 spec §7.3 对齐）

- [ ] v014 migration 创建 admin_users 表
- [ ] `createAdminAuthMiddleware` 重写查表
- [ ] 3 个新端点（login/rotate-key/me）已加并 schema 验证
- [ ] 现有 20 个 admin 端点的鉴权改造完成（既有测试用新 api_key 重写）
- [ ] 10 个新增集成测试全过
- [ ] `pnpm typecheck` 无错
- [ ] `pnpm test` 全套通过（既有 797+ + 新 10 = 0 regression）
- [ ] `pnpm openapi:check` 通过
- [ ] `admin-web/` build 成功（产物在 `out/admin/`）
- [ ] SEED_ADMIN_PASSWORD env + 重启 → 表非空 + 默认 admin 可登录
- [ ] nginx 配置加 `/admin/` location；reload；浏览器访问 https://qing3.top/admin/ 看到 login 页
- [ ] login 后跳 dashboard；profile 页可 rotate key；rotate 后旧 key 失效
- [ ] curl 远程验证 3 个端点

---

## 12. 上线检查清单

1. 代码合入 `main` 分支
2. CI 全过
3. **生产部署前必做**：
   - 在 `.env` 设 `SEED_ADMIN_PASSWORD=某个临时密码`
   - 把 `ADMIN_PASSWORD_HASH` 改为 `DEPRECATED`（保留作为历史）
4. 部署：
   ```bash
   # 后端
   cd /opt/hunter-platform && git pull && pnpm build
   scp -r out/* root@101.201.110.129:/opt/hunter-platform/out/
   
   # 前端
   cd admin-web && pnpm build
   scp -r out/admin/* root@101.201.110.129:/opt/hunter-platform/out/admin/
   
   # 重启
   ssh root@101.201.110.129 'systemctl restart hunter-platform'
   
   # nginx
   ssh root@101.201.110.129 'nginx -t && nginx -s reload'
   ```
5. **冒烟测试**：
   - SSH 进生产，curl localhost:3000 看 seed 日志
   - 浏览器访问 https://qing3.top/admin/，看到 login 页
   - 用 seed admin 登录 + rotate key + 用新 key 调 `/v1/admin/ping`
6. （可选）发 release note v1.x.y — "Web admin login now uses per-admin api_key"

---

## 13. 后续 Sub-projects（不在本 spec）

- **Sub-B**：监控仪表盘（dashboard stats + candidates list + users list — read-only 优先）
- **Sub-C**：操作面板（suspend/unsuspend/adjust-quota/remove-from-pool/mark-paid/cancel/retry 等 mutations）
- **Sub-D**：审计（audit + action-history + admin-log + webhooks/dead-letter）
- **Sub-E**：配置（config get/put + rate-limit buckets/clear + admin user CRUD）

每个 sub-project 走同样的 brainstorm → spec → plan → impl 循环。

---

## 参考

- [2026-06-23-admin-action-history-endpoint-design.md](2026-06-23-admin-action-history-endpoint-design.md) — Task #1（已完成部署）
- [2026-06-23-required-current-company-design.md](2026-06-23-required-current-company-design.md) — Task #2（已完成部署）
- [2026-06-20-ipc-to-http-admin.md plan](../plans/2026-06-20-ipc-to-http-admin.md) — IPC → HTTP admin 迁移历史
- `src/main/modules/admin/auth.ts` — 当前 single-password 实现（将被重写）
- `src/main/db/migrations/v003.sql` — admin_action_log 表（已有）
- `src/main/db/migrations/v001.sql` — users 表（user_type CHECK 约束）