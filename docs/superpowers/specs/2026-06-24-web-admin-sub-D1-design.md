# Web Admin Sub-D1 — Audit 总表 UI + admin 登录日志 Design

> **For agentic workers**: 这是 design spec，配套 implementation plan 在 `docs/superpowers/plans/2026-06-24-web-admin-sub-D1-plan.md`（待 writing-plans skill 输出）。
>
> 续接 Sub-B（v1.5+，merge `0fc7fb3`）。本 spec 是 **Sub-project D1：admin 审计总表 UI + 登录事件补全**。Sub-D2 之后做 per-entity 时间轴（直接复用 D1 的 `admin_action_log`），Sub-D3 做 webhook 发送日志 UI。

## ⚠️ Scope 调整说明

D1 最初设计时假设后端 audit 基础设施要从零建（`audit_log` 表 + middleware + 各种 endpoint）。探索工程后（2026-06-24）发现：

| 原计划 | 实际状态 | 决策 |
|---|---|---|
| `audit_log` 表 | 已存在 `admin_action_log` (v003 migration) + `action_history` (v001/v013) + `unlock_audit_log` (v001) | **复用，不新建** |
| audit middleware | 已存在 `src/main/modules/audit/action-history-middleware.ts` + admin flow 写入 | **复用，不新建** |
| `GET /v1/admin/admin-log` | **已存在**（handler `src/main/modules/admin/handlers/admin-log.ts`） | **复用** |
| `GET /v1/admin/action-history` | **已存在**（2026-06-23 spec 已 ship） | **复用** |
| `GET /v1/admin/audit` | **已存在**（读 `unlock_audit_log`） | **复用** |
| **admin 登录事件表** | ❌ **不存在**（auth.ts 只更新 `last_login_at`，无 audit） | **本次新建** |

**结论**：D1 = 1 个新表 + 1 个新 endpoint + **大量 admin-web UI 工作**（把已有后端能力"接出来"）。

**Goal:**
1. **后端补全**：`admin_login_events` 表 + 登录事件写入 + `GET /v1/admin/login-events` endpoint
2. **前端整合**：admin-web 加 `/admin/audit` 页面（3 个 tab：Admin Actions / User Actions / Login Events），整合 3 个已有/新 endpoint
3. **测试**：后端 ~5 + 前端 ~5，全量 867+ pass

**Architecture:**
- **后端**：1 张新表（v015 migration）+ auth.ts 改造 + 1 个新 handler/endpoint
- **前端**：1 个新页面（3 tab）+ 1 个 diff 展示组件 + 1 个 fetcher 模块 + Layout 加 nav

**Tech Stack（沿用 Sub-A/B）：** React 18, Vite, TypeScript, vanilla CSS, vitest+RTL
**生产 URL：** https://qing3.top/admin/audit （Sub-B 已部署）

---

## 1. 背景与动机

### 1.1 现状（Sub-B 后）

| 项 | 现状 |
|----|------|
| 后端 admin 端点 | 25 个已存在（Sub-A + Sub-B + 之前的 admin 模块迁移）|
| `admin_action_log` 表 | 存 admin 改数据的操作（suspend/unsuspend/adjust-quota/config-change）— handler 已写，**无 admin-web UI** |
| `action_history` 表 | 存 user 业务操作（30+ capability_name）— middleware 自动写，endpoint 已加，**无 admin-web UI** |
| `unlock_audit_log` 表 | 存 4 步解锁流水 — endpoint `/v1/admin/audit` 已加，**无 admin-web UI** |
| **admin 登录日志** | ❌ **完全没记录**（auth.ts 只更新 `admin_users.last_login_at`）|
| admin-web 页面 | 5 个：Login / Dashboard / Users / Candidates / Profile。**无 Audit 类页面** |

### 1.2 真实需求

- **管理"谁动了什么"**：admin 想知道"suspend 这个 user 的同事是谁、什么时候、为什么"
- **调查 user 投诉**：用户说"我账号被乱改了"，admin 要能查 action_history 看到完整业务流水
- **审计安全**：admin login 要有日志（谁在什么时候从哪个 IP 登录过）

### 1.3 非目标（明确不做）

- ❌ Sub-D2 的 per-entity 时间轴（点击 user/candidate 看到自己的时间线）— D1 是总表视角
- ❌ Sub-D3 的 webhook 发送日志 UI
- ❌ Sub-C 的 mutation 按钮（suspend/unsuspend 在 admin-web 上的可点击按钮）— 仅显示日志，不触发
- ❌ CSV 导出
- ❌ 实时刷新 / SSE
- ❌ 复杂的可视化（图表、treemap）— 表格 + 简单 diff 展示

---

## 2. UI 架构

### 2.1 路由更新

| Path | Component | 鉴权 | 备注 |
|------|-----------|------|------|
| `/admin/login` | LoginPage | 公开 | 已有 |
| `/admin/` | DashboardPage | bearer | 已有 |
| `/admin/users` | UsersPage | bearer | 已有 |
| `/admin/candidates` | CandidatesPage | bearer | 已有 |
| `/admin/profile` | ProfilePage | bearer | 已有 |
| `/admin/audit` | **AuditPage** | bearer | **新增**（3 tab） |

未匹配 → redirect `/admin/`。

### 2.2 共享组件

| 组件 | 文件 | 说明 |
|------|------|------|
| `Layout` | `components/Layout.tsx` | **改**：nav 加 "Audit" 链接 |
| `Table` | `components/Table.tsx` | **复用** Sub-B |
| `Pagination` | `components/Pagination.tsx` | **复用** Sub-B |
| `SearchBar` | `components/SearchBar.tsx` | **复用** Sub-B（可加 `time-from/to` 控件）|
| `StatusBadge` | `components/StatusBadge.tsx` | **复用** Sub-B（success/error 颜色）|
| `MaskedText` | `components/MaskedText.tsx` | **复用** Sub-B 的 mask 函数（包成小组件，diff 里有 PII 时用）|
| `AuditDiffView` | `components/AuditDiffView.tsx` | **新增**：把 `request_summary_json` / `response_summary_json` / `details_json` 渲染成人类可读 |
| `AuditJsonDrawer` | `components/AuditJsonDrawer.tsx` | **新增**：行点击后 Drawer 显示完整 JSON（带语法高亮用 `<pre>`）|

### 2.3 页面草图

#### AuditPage (3 tab)

```
┌──────────────────────────────────────────────────────────┐
│ Hunter Admin  [Users][Candidates][Audit*][Dashboard]...  │
├──────────────────────────────────────────────────────────┤
│  Audit                                                    │
│  [Admin Actions] [User Actions] [Login Events]            │
│                                                            │
│  Tab "Admin Actions":                                      │
│  [🔍 Search action_____] [Target type: all ▾] [Time: ___]  │
│                                                            │
│  ┌───────────┬──────────┬─────────┬──────┬──────────┐    │
│  │ Time      │ Actor    │ Action  │Target│ Reason   │    │
│  ├───────────┼──────────┼─────────┼──────┼──────────┤    │
│  │ 2 min ago │ Alice    │suspend  │ u_5  │spam repor│    │
│  │ 1 hr ago  │ Bob      │config-  │key=X │rate-up   │    │
│  │ 3 hr ago  │ Alice    │mark-paid│ p_3  │inv #1234 │    │
│  └───────────┴──────────┴─────────┴──────┴──────────┘    │
│                                                            │
│  Showing 1-20 of 47    [← Prev] Page 1/3 [Next →]         │
└──────────────────────────────────────────────────────────┘
```

#### Tab "User Actions"

```
┌───────────┬──────────┬──────────────────┬──────┬─────┐
│ Time      │ User     │ Capability       │Status│Dur  │
├───────────┼──────────┼──────────────────┼──────┼─────┤
│ 5 min ago │ u_8a2f   │headhunter.upload │ ✅   │142ms│
│ 10 min ago│ u_3c1d   │express_interest  │ ❌   │ 23ms│
└───────────┴──────────┴──────────────────┴──────┴─────┘
  ↑ 点击行 → Drawer 显示 request/response JSON
```

#### Tab "Login Events"

```
┌───────────┬──────────┬──────────┬───────┬──────────┐
│ Time      │ Email    │ Admin    │Success│ IP       │
├───────────┼──────────┼──────────┼───────┼──────────┤
│ 2 min ago │ a@x.com  │ Alice    │ ✅    │ 1.2.3.4  │
│ 1 hr ago  │ bad@x.co │ -        │ ❌    │ 5.6.7.8  │
│ 3 hr ago  │ admin@x  │ Alice    │ ✅    │ 1.2.3.4  │
└───────────┴──────────┴──────────┴───────┴──────────┘
```

---

## 3. 后端改动（1 张新表 + 1 个新 endpoint + 2 处小改）

### 3.1 Migration v015: admin_login_events 表

**新文件：`src/main/db/migrations/v015_admin_login_events.sql`**

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
  admin_user_id   TEXT,                                -- nullable for failed/unknown
  email           TEXT NOT NULL,                       -- captured even on failure
  success         INTEGER NOT NULL CHECK (success IN (0, 1)),
  failure_reason  TEXT,                                -- e.g. 'invalid_password', 'suspended'
  ip              TEXT,                                -- from X-Forwarded-For or req.ip
  user_agent      TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_admin_login_events_admin ON admin_login_events(admin_user_id);
CREATE INDEX idx_admin_login_events_created ON admin_login_events(created_at DESC);
CREATE INDEX idx_admin_login_events_success ON admin_login_events(success, created_at DESC);
```

**注册 migration：** 在 `src/main/db/migrations.ts` 加 `{ version: 15, description: 'admin_login_events (Sub-D1)', file: 'migrations/v015_admin_login_events.sql' }`

### 3.2 auth.ts login 改造：写 login_event

**文件：`src/main/modules/admin/handlers/auth.ts`**

```typescript
import { createAdminLoginEventsRepo } from '../../../db/repositories/admin-login-events.js';
// ... in createAdminAuthHandler:
const loginEventsRepo = createAdminLoginEventsRepo(db);

// In login() method, replace existing body with:
//   Step 1: parse + validate (keep as-is)
//   Step 2: lookup + check suspended
//   Step 3: try password (in try/catch)
//   Step 4: on success → write login_event(success=1) → continue with key gen
//           on failure → write login_event(success=0, reason) → throw

const recordLoginEvent = (success: boolean, adminUserId: string | null, email: string, reason?: string) => {
  loginEventsRepo.insert({
    admin_user_id: adminUserId,
    email,
    success: success ? 1 : 0,
    failure_reason: reason ?? null,
    ip: req.ip ?? null,
    user_agent: req.headers['user-agent'] ?? null,
  });
};

// In login():
const row = repo.findByEmail(email);
if (!row) {
  recordLoginEvent(false, null, email, 'unknown_email');
  throw Errors.unauthorized('Invalid email or password');
}
if (row.status === 'suspended') {
  recordLoginEvent(false, row.id, email, 'suspended');
  throw Errors.forbidden('Admin account suspended');
}
const ok = await bcrypt.compare(password, row.password_hash);
if (!ok) {
  recordLoginEvent(false, row.id, email, 'invalid_password');
  throw Errors.unauthorized('Invalid email or password');
}
recordLoginEvent(true, row.id, email);
// ... existing key gen + respond ...
```

**为什么不在 rotateKey 写**：rotateKey 是已登录的 admin 主动操作，已有 `admin_action_log` 通过 capability 流程覆盖（虽然目前没显式写，可后续加）。本 spec 不做。

### 3.3 新建 admin-login-events repository

**新文件：`src/main/db/repositories/admin-login-events.ts`**

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
      [AND admin_user_id = ?]
      [AND success = ?]
      [AND email LIKE ?]
      [AND created_at >= ?]
      [AND created_at < ?]
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `);
  const countStmt = /* same WHERE */;
  return {
    insert(input: Omit<AdminLoginEvent, 'id' | 'created_at'> & { created_at?: string }): void { ... },
    list(filter: { admin_user_id?: string; success?: 0|1; email?: string; from?: string; until?: string; limit?: number; offset?: number }): { rows: AdminLoginEvent[]; total: number } { ... },
  };
}
```

### 3.4 新建 admin-login-events handler + endpoint

**新文件：`src/main/modules/admin/handlers/login-events.ts`**

```typescript
import type { DB } from '../../../db/connection.js';
import { createAdminLoginEventsRepo } from '../../../db/repositories/admin-login-events.js';

export function createAdminLoginEventsHandler(db: DB) {
  const repo = createAdminLoginEventsRepo(db);
  return {
    list(filter: Parameters<typeof repo.list>[0]): ReturnType<typeof repo.list> {
      return repo.list(filter);
    },
  };
}
```

**修改 `src/main/routes/admin.ts`：**

```typescript
import { createAdminLoginEventsHandler } from '../modules/admin/handlers/login-events.js';
// ... near other handler instantiation:
const loginEvents = createAdminLoginEventsHandler(db);

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
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) throw Errors.invalidParams('limit must be 1-200');
    if (!Number.isFinite(offset) || offset < 0) throw Errors.invalidParams('offset must be >= 0');
    const { rows, total } = loginEvents.list({ admin_user_id: adminId, success: successFilter, email, from, until, limit, offset });
    respond(res, LoginEventsListResponseSchema, {
      ok: true,
      data: rows,
      pagination: { total, limit, offset, has_more: offset + rows.length < total },
    }, { strict: true });
  } catch (e) { next(e); }
});
```

### 3.5 Schema 更新

**修改 `src/main/schemas/admin.ts`：**

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

### 3.6 不改动的（重要）

- ❌ `admin_action_log` 表不动（D1 只用现有 handler）
- ❌ `action_history` 表不动（2026-06-23 spec 已 ship）
- ❌ `GET /v1/admin/admin-log` 不动（handler 已存在，前端复用）
- ❌ `GET /v1/admin/action-history` 不动（已 ship）
- ❌ `GET /v1/admin/audit` 不动

---

## 4. 前端实现

### 4.1 新建 api/audit.ts

**新文件：`admin-web/src/api/audit.ts`**

复用 Sub-B 的 `apiFetchRaw` pattern（已在 `admin-web/src/api/raw.ts`）：

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

export async function listAdminLog(opts: { page?: number; pageSize?: number; actor?: string; action_type?: string; target_type?: string } = {}): Promise<{ data: AdminLogRow[]; pagination: { total: number; page: number; pageSize: number; has_more: boolean } }> { ... }

export async function listActionHistory(opts: { page?: number; pageSize?: number; user_id?: string; capability_name?: string; status?: 'success' | 'error' } = {}): Promise<{ data: ActionHistoryRow[]; pagination: ... }> { ... }

export async function listLoginEvents(opts: { page?: number; pageSize?: number; admin_id?: string; success?: 0 | 1; email?: string; from?: string; until?: string } = {}): Promise<{ data: LoginEventRow[]; pagination: ... }> { ... }
```

### 4.2 新建 AuditDiffView 组件

**新文件：`admin-web/src/components/AuditDiffView.tsx`**

```typescript
// 把 {field: {old, new}} 或裸 JSON 渲染成人类可读。
// 关键规则:
//   - request_summary_json / response_summary_json 是 JSON 字符串
//   - 先 JSON.parse，try/catch 后 fallback 渲染原文
//   - 嵌套对象用 <ul> 缩进
//   - 含 PII 字段 (name/email/phone/contact) 自动调 Sub-B 的 maskName/maskEmail
//   - StatusBadge 用于 status: 'success' | 'error'
import { maskName, maskEmail, maskContact } from '../lib/mask';

export default function AuditDiffView({ json, maskPii = true }: { json: string | null; maskPii?: boolean }) { ... }
```

### 4.3 新建 AuditJsonDrawer 组件

**新文件：`admin-web/src/components/AuditJsonDrawer.tsx`**

```typescript
// 行点击后弹出的 Drawer，显示完整 request/response + AuditDiffView
// 简单实现：固定 position 右侧滑出 + 灰色 backdrop
// 不引入抽屉库，用 vanilla CSS
export default function AuditJsonDrawer({ open, onClose, title, json }: { ... }) { ... }
```

### 4.4 新建 AuditPage

**新文件：`admin-web/src/pages/AuditPage.tsx`**

```typescript
// 3 tab，用 ?tab=admin|user|login URL query 切 tab（刷新保留）
// Tab 1 "Admin Actions": 调 listAdminLog() + Table + SearchBar
//   - SearchBar 含 action_type 下拉 (suspend/unsuspend/adjust-quota/config-change)
//   - 列: time / actor / action / target_type / target_id / reason
//   - 不需要 Drawer（reason 已是直接字段）
// Tab 2 "User Actions": 调 listActionHistory() + Table + SearchBar
//   - 列: time / user_id / capability / status (StatusBadge) / duration
//   - 点击行 → AuditJsonDrawer 显示 request/response summary
// Tab 3 "Login Events": 调 listLoginEvents() + Table + SearchBar
//   - 列: time / email / admin_user_id (or "-" if null) / success (StatusBadge) / ip
//   - 不需要 Drawer
```

### 4.5 Layout + App 路由

**改 `admin-web/src/components/Layout.tsx`**：nav 加 `<NavLink to="/admin/audit">Audit</NavLink>`

**改 `admin-web/src/App.tsx`**：加 `<Route path="/audit" element={<PrivateRoute><AuditPage /></PrivateRoute>} />`

### 4.6 测试覆盖（admin-web/）

| 文件 | 测什么 | 测试数 |
|---|---|---|
| `src/api/__tests__/audit.test.ts` | 3 个 fetcher 的 query 构造 + 响应解析 | ~6 |
| `src/components/__tests__/AuditDiffView.test.tsx` | 渲染嵌套 JSON / mask PII / 错误 JSON fallback | ~4 |
| `src/components/__tests__/AuditJsonDrawer.test.tsx` | open/close + 渲染 json | ~2 |
| **合计** | | **~12** |

**不写**（沿用 Sub-B 决策）：
- ❌ Page-level integration（重 setup，价值低）
- ❌ 真 fetch 测（mock 已经覆盖 query 构造）

---

## 5. 后端测试（5 个集成测试）

**新文件：`tests/integration/admin-login-events.test.ts`**

| # | 场景 | 期望 |
|---|------|------|
| 1 | 成功登录 → DB 写 1 行 admin_login_events (success=1) | 200 + DB row |
| 2 | 密码错 → DB 写 1 行 (success=0, reason='invalid_password') | 401 + DB row |
| 3 | 未知 email → DB 写 1 行 (success=0, reason='unknown_email', admin_user_id=null) | 401 + DB row |
| 4 | 暂停账号登录 → DB 写 1 行 (success=0, reason='suspended') | 403 + DB row |
| 5 | `GET /v1/admin/login-events?success=0` 仅返回失败记录 | 200 + filter 正确 |

**额外**：在 `tests/integration/admin-endpoints.test.ts` 中加 1 个 case 验证 `GET /v1/admin/admin-log` 已有行为不变（防止 Sub-D1 改动破坏）。

---

## 6. 文件改动清单

### 后端
| 路径 | 类型 | 改动 |
|------|------|------|
| `src/main/db/migrations/v015_admin_login_events.sql` | 新建 | 1 张表 |
| `src/main/db/migrations.ts` | 改 | 注册 v015 |
| `src/main/db/repositories/admin-login-events.ts` | 新建 | 1 个 repo |
| `src/main/modules/admin/handlers/auth.ts` | 改 | login 写 login_event |
| `src/main/modules/admin/handlers/login-events.ts` | 新建 | 1 个 handler |
| `src/main/routes/admin.ts` | 改 | import + 1 条 GET 路由 |
| `src/main/schemas/admin.ts` | 改 | 加 2 个 schema |
| `tests/integration/admin-login-events.test.ts` | 新建 | 5 个测试 |
| `tests/integration/admin-endpoints.test.ts` | 改 | +1 回归测试 |
| `docs/superpowers/skill.md` | 改 | §Admin API 表格加 1 行 |
| `docs/superpowers/openapi.json` | 改 | 跑 `pnpm openapi:generate` |

### 前端
| 路径 | 类型 | 改动 |
|------|------|------|
| `admin-web/src/api/audit.ts` | 新建 | 3 个 fetcher |
| `admin-web/src/api/__tests__/audit.test.ts` | 新建 | 6 个测试 |
| `admin-web/src/components/AuditDiffView.tsx` | 新建 | diff 渲染 |
| `admin-web/src/components/AuditJsonDrawer.tsx` | 新建 | drawer |
| `admin-web/src/components/__tests__/AuditDiffView.test.tsx` | 新建 | 4 个测试 |
| `admin-web/src/components/__tests__/AuditJsonDrawer.test.tsx` | 新建 | 2 个测试 |
| `admin-web/src/pages/AuditPage.tsx` | 新建 | 3 tab 页面 |
| `admin-web/src/components/Layout.tsx` | 改 | nav 加 Audit |
| `admin-web/src/App.tsx` | 改 | 加路由 |

### 不改动
- ❌ `admin_action_log` 表 / handler
- ❌ `action_history` 表 / handler / endpoint
- ❌ `unlock_audit_log` 表 / endpoint
- ❌ 任何已有页面 / 组件
- ❌ `apiFetchRaw`（Sub-B 已 ship，零 breaking）

---

## 7. 验收清单

- [ ] 后端 `pnpm test` 823 + 5 + 1 = **829 全过**
- [ ] 前端 `pnpm test` 29 + 12 = **41 全过**
- [ ] `pnpm typecheck` 干净
- [ ] `pnpm openapi:check` 通过（多 1 条新路由）
- [ ] admin-web build 成功
- [ ] 本地 curl 验证：
  - `curl -X POST http://localhost:3000/v1/admin/auth/login -d '{"email":"...","password":"..."}'` → 200，DB 有 login_event
  - `curl -X POST http://localhost:3000/v1/admin/auth/login -d '{"email":"...","password":"WRONG"}'` → 401，DB 有 login_event(success=0)
  - `curl -H "Authorization: Bearer $KEY" http://localhost:3000/v1/admin/login-events | jq .` → 200 + rows
  - `curl -H "Authorization: Bearer $KEY" "http://localhost:3000/v1/admin/login-events?success=0" | jq .` → 仅失败记录
- [ ] 部署到生产后：
  - https://qing3.top/admin/audit 200（login 后）
  - 3 个 tab 都显示真实数据
  - Login Events tab 显示刚才登录产生的记录

---

## 8. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| auth.ts 写 login_event 抛错影响登录主流程 | 低 | 高 | try/catch 包住 insert，失败仅 console.warn，不影响登录响应 |
| IP 在 nginx 反代后都是 `127.0.0.1` | 中 | 中 | 已在 Sub-A 中配 `app.set('trust proxy', true)`，应能拿到 `X-Forwarded-For`；测试时验证 |
| `details_json` 里有 PII，admin log UI 没脱敏 | 中 | 中 | D1 不消费 details_json（只显示 reason）。D2 展开 JSON 时再用 mask 函数 |
| `admin_action_log` 缺 ip/ua 字段（与 login_events 不一致） | 中 | 低 | D1 不动 admin_action_log；后续可加 migration v016 补字段 |
| 前端 3 tab 同时加载性能 | 低 | 低 | D1 是 tab 切换不预加载；fetch 都在 tab 激活时 |
| 已有 Sub-A 用户的 `last_login_at` 字段重复 | 低 | 低 | D1 保留旧字段，新 login_event 是补充关系，不是替代 |

---

## 9. 测试策略

### 后端（vitest integration）
- 5 个 admin-login-events 集成测试（login 成功/失败/未知/暂停/查询）
- 1 个 admin-endpoints 回归测试

### 前端（vitest + jsdom + RTL）
- 6 个 fetcher 测试（query 构造 + 响应解析）
- 4 个 AuditDiffView 测试
- 2 个 AuditJsonDrawer 测试
- **合计 12 个**

### 全量回归
- 后端 823 + 5 + 1 = 829
- 前端 29 + 12 = 41
- 合并：870 测试

---

## 10. 部署

### Build & ship

```bash
cd /d/dev/hunter-platform
pnpm build                  # 后端 → out/main/
cd admin-web
pnpm test && pnpm build     # 前端 → ../out/admin/

# SCP
scp -r -i /d/Downloads/cc.pem out/main/* root@101.201.110.129:/opt/hunter-platform/out/main/
scp -r -i /d/Downloads/cc.pem out/admin/* root@101.201.110.129:/opt/hunter-platform/out/admin/

# 重启
ssh -i /d/Downloads/cc.pem root@101.201.110.129 'systemctl restart hunter-platform'

# 冒烟
ssh -i /d/Downloads/cc.pem root@101.201.110.129 \
  'curl -s https://qing3.top/v1/admin/login-events -H "Authorization: Bearer $KEY" | jq .data | length'
```

### Nginx 无需变更

---

## 11. 不在范围（YAGNI）

- ❌ Sub-C mutation 按钮（suspend/unsuspend 可点击）— 仅显示
- ❌ Sub-D2 per-entity 时间轴（点击 user/candidate 看自己历史）
- ❌ Sub-D3 webhook 发送日志 UI
- ❌ Sub-E config + rate-limit + admin CRUD UI
- ❌ CSV 导出
- ❌ 实时刷新 / SSE / WebSocket
- ❌ admin 密码修改 UI
- ❌ 复杂的图表 / treemap
- ❌ `admin_action_log` 加 ip/ua 字段（v016+ 考虑）
- ❌ audit 保留期策略（永久保留，超大规模再分表）

---

## 12. 后续 Sub-projects（不在本 spec）

- **Sub-D2**：action-history per-entity 时间轴（点击 user/candidate → Drawer 显示其历史）— 直接复用 D1 的 AuditDiffView 和 action_history 数据
- **Sub-D3**：webhook 发送日志 UI（用 `GET /v1/admin/webhooks/dead-letter` + retry 按钮）
- **Sub-E**：config 页面（get/put）+ rate-limit 页面（buckets + clear）+ admin 用户 CRUD

---

## 13. 任务拆分（待 plan 细化）

**后端（5 task）**：
1. v015 migration + admin-login-events repo
2. auth.ts login 改造（写 login_event + try/catch）
3. login-events handler + route
4. schema 更新 + skill.md + openapi
5. 5 个集成测试 + 1 个回归测试

**前端（5 task）**：
6. api/audit.ts（3 fetcher）+ 6 个测试
7. AuditDiffView 组件 + 4 个测试
8. AuditJsonDrawer 组件 + 2 个测试
9. AuditPage（3 tab）
10. Layout nav + App 路由

**收尾（2 task）**：
11. 全量回归（870 pass）+ typecheck + openapi + build
12. 部署到生产 + merge

---

## 参考

- [2026-06-24-web-admin-sub-B-design.md](2026-06-24-web-admin-sub-B-design.md) — Sub-B spec（沿用架构风格）
- [2026-06-24-web-admin-sub-B-plan.md](../plans/2026-06-24-web-admin-sub-B-plan.md) — Sub-B plan（沿用 task 拆分风格）
- [2026-06-23-admin-action-history-endpoint-design.md](2026-06-23-admin-action-history-endpoint-design.md) — action-history endpoint（前端直接消费）
- [2026-06-18-action-history-and-industry-map-design.md](2026-06-18-action-history-and-industry-map-design.md) — action_history 表 + middleware
- `src/main/db/migrations/v003.sql` — admin_action_log 表
- `src/main/db/migrations/v014_admin_users.sql` — admin_users 表
- `src/main/modules/admin/handlers/admin-log.ts` — 现有 admin-log handler
- `src/main/modules/admin/handlers/auth.ts` — 要改造的登录 handler
- `src/main/routes/admin.ts` — admin 路由（加 1 条）
- `admin-web/src/api/raw.ts` — apiFetchRaw pattern（直接复用）
- `admin-web/src/lib/mask.ts` — maskName/maskEmail 函数（diff 渲染用）
