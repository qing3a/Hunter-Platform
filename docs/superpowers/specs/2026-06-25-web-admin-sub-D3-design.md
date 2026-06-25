# Web Admin Sub-D3 — Webhook 死信 + Placements 列表 Design

> **For agentic workers:** 这是 design spec，配套 implementation plan 在 `docs/superpowers/plans/2026-06-25-web-admin-sub-D3-plan-{1,2}.md`（待 writing-plans skill 输出）。
>
> 续接 Sub-D2（v2.2，merge `eda4ea5`）+ `dc16a5b` (filter URL persistence) + `02794da` (router warning suppression)。本 spec 是 **Sub-project D3：webhook 死信 + Placements 列表**。Sub-D4 之后做 per-entity 详情页，Sub-E 做 config UI。

## ⚠️ 与已有 Sub-project 的关系

| Sub-project | 已交付 | 内容 |
|---|---|---|
| Sub-A | ✅ | 基础设施 + login + profile |
| Sub-B | ✅ | Dashboard 升级 + Users/Candidates 列表 |
| Sub-D1 | ✅ | Audit 总表 UI |
| Sub-C | ✅ | Jobs/Recommendations + 配额调整 + details_json |
| Sub-D2 | ✅ | Per-Entity Timeline（4 entity type） |
| **Sub-D3（本 spec）** | 设计中 | **Webhook 死信 UI + Placements 列表 + 共享 ConfirmModal** |

**Sub-D3 解决的痛点**：
- Webhook 死信无前端页面（admin 只能 SQL 查 `webhook_delivery_queue WHERE status='dead_letter'`）
- Placements 无前端页面（admin 看不到入职、收钱进度）
- mark-paid 触发佣金的 admin action 无 UI（只能在 SQL 改 status）

---

## 1. 背景与动机

### 1.1 现状（Sub-D2 后）

| 项 | 现状 |
|----|------|
| `webhook_delivery_queue` 表 | 已有 dead_letter status，handler `listDeadLetter(limit=50)` 返回 flat array |
| `placements` 表 | 已有 status 字段，handler `list({status})` 返回 max 100 flat array |
| 后端 endpoints | `/v1/admin/webhooks/dead-letter` (GET, flat) + `/v1/admin/webhooks/:id/retry` (POST) + `/v1/admin/placements` (GET, flat) + `/v1/admin/placements/:id/mark-paid` (POST) + `/v1/admin/placements/:id/cancel` (POST) |
| admin-web | 2 个 endpoint 都没前端 UI |
| Dashboard 「Webhook 死信」卡片 | 只显示数量（dashboard.stats.webhooks.dead_letter），无 link |
| `commission.markPaid()` | 已实现，写 admin_action_log |

### 1.2 真实需求

| 需求 | 痛点 |
|---|---|
| 死信监控 | 客户报"没收到通知" → ops 不知道哪个 webhook 失败了 |
| 死信重试 | ops 想手动 retry，但只能改 DB |
| Placements 流水 | ops 想看入职进度 + 收钱 |
| Mark-paid | 财务部想让 admin 在 UI 触发"已付款" |
| Cancel placement | 客户撤单后 admin 想取消（避免自动扣费） |

### 1.3 非目标（明确不做）

- ❌ Sub-D4 per-entity 详情页
- ❌ Sub-E config UI（rate-limit / webhooks / config 写入类）
- ❌ Placement 创建/编辑 UI（业务方自己创建）
- ❌ Webhook 创建/编辑（业务自管）
- ❌ Realtime 刷新（SSE/WebSocket）
- ❌ URL 持久化 filter（避免 scope 膨胀 — Sub-D2 follow-up 已经做过通用 pattern）
- ❌ Webhook retry 写 audit log（已知 limitation，留 Sub-D4）
- ❌ 暗黑模式 / 移动端响应式

---

## 2. 架构总览

### 2.1 模块改动图

```
hunter-platform/
├── src/main/
│   ├── routes/admin.ts                       # 改：+pagination params + paginated envelope for 2 endpoints
│   ├── schemas/admin.ts                      # 改：+DeadLetterListResponseSchema + PlacementsListResponseSchema
│   ├── modules/admin/handlers/
│   │   ├── webhooks.ts                        # 改：listDeadLetter 返回 { rows, total }
│   │   └── placements.ts                      # 改：list 返回 { rows, total }
│   ├── capabilities/admin.ts                  # 改：+admin.list_dead_letter + +admin.list_placements
│   └── docs/superpowers/skill.md               # 改：capability 列表 +2 行
│
└── admin-web/src/
    ├── pages/
    │   ├── WebhookDeadLetterPage.tsx (NEW)
    │   └── PlacementsPage.tsx (NEW)
    ├── components/
    │   └── ConfirmModal.tsx (NEW)              # 通用确认弹窗（mark-paid/cancel）
    ├── api/
    │   ├── webhooks.ts (NEW)                   # listDeadLetter + retryDeadLetter
    │   └── placements.ts (NEW)                 # list + markPaid + cancel
    ├── components/Layout.tsx                  # 改：nav +2 items
    ├── App.tsx                                # 改：+2 routes
    └── pages/DashboardPage.tsx                # 改：「Webhook 死信」卡片加 link
```

### 2.2 路由表（admin-web）

| Path | 鉴权 | 备注 |
|------|------|------|
| `/admin/login` | 公开 | 已有 |
| `/admin/webhooks/dead-letter` | bearer | **新增** |
| `/admin/placements` | bearer | **新增** |
| 其他已有路由 | bearer | 不变 |

### 2.3 后端 endpoint

| Method | Path | 改动 |
|--------|------|------|
| GET | `/v1/admin/webhooks/dead-letter` | **改**：加 page/pageSize + filter (event_type/min_attempt_count/from/until) + paginated envelope |
| POST | `/v1/admin/webhooks/:id/retry` | 不变 |
| GET | `/v1/admin/placements` | **改**：加 page/pageSize + filter (status/from/until) + paginated envelope |
| POST | `/v1/admin/placements/:id/mark-paid` | 不变 |
| POST | `/v1/admin/placements/:id/cancel` | 不变 |

### 2.4 数据库改动

- ❌ **0 migration**（webhook_delivery_queue + placements 都已存在）

### 2.5 Tech Stack

**沿用现有：** Express 4.21, node:sqlite, zod, vitest, supertest（后端）；React 18, Vite, react-router-dom, vanilla CSS, vitest+jsdom+RTL（前端）

**无新依赖。**

---

## 3. 后端设计

### 3.1 Schema

```typescript
// src/main/schemas/admin.ts

// Webhook dead letter row
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
export { ListDeadLetterResponseSchema };

// Placement row
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
export { ListPlacementsResponseSchema };
```

### 3.2 Handler 改造 — `webhooks.ts`

```typescript
listDeadLetter(filter: {
  event_type?: string;
  min_attempt_count?: number;
  from?: string;
  until?: string;
  limit?: number;
  offset?: number;
}): { rows: DeadLetterRow[]; total: number } {
  const where: string[] = ["status = 'dead_letter'"];
  const params: any[] = [];
  if (filter.event_type) {
    where.push('event_type = ?');
    params.push(filter.event_type);
  }
  if (filter.min_attempt_count) {
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
}
```

### 3.3 Handler 改造 — `placements.ts`

```typescript
list(filter: {
  status?: 'pending_payment' | 'paid' | 'cancelled';
  from?: string;
  until?: string;
  limit?: number;
  offset?: number;
}): { rows: PlacementRow[]; total: number } {
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
           p.anonymized_candidate_id, p.candidate_user_id,
           p.primary_headhunter_id, p.referrer_headhunter_id,
           p.annual_salary, p.platform_fee, p.primary_share, p.referrer_share,
           p.candidate_bonus, p.status, p.created_at, p.updated_at
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
}
```

### 3.4 Route 改造 — `routes/admin.ts`

```typescript
// GET /v1/admin/webhooks/dead-letter
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

// GET /v1/admin/placements
router.get('/placements', (req, res, next) => {
  try {
    const validStatuses = ['pending_payment', 'paid', 'cancelled'] as const;
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    if (status && !(validStatuses as readonly string[]).includes(status)) {
      throw Errors.invalidParams('status must be pending_payment|paid|cancelled');
    }
    const page = req.query.page !== undefined ? Number(req.query.page) : 1;
    const pageSize = req.query.pageSize !== undefined ? Number(req.query.pageSize) : 20;
    if (!Number.isFinite(page) || page < 1) throw Errors.invalidParams('page must be a positive integer');
    if (!Number.isFinite(pageSize) || pageSize < 1 || pageSize > 100) {
      throw Errors.invalidParams('pageSize must be 1-100');
    }
    const { rows, total } = placements.list({
      status: status ? (status as any) : undefined,
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

### 3.5 Capability 同步

新增 2 个 capability：

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

同步到 `docs/superpowers/skill.md`。

### 3.6 错误处理

| 场景 | HTTP | code |
|------|------|------|
| page/pageSize 越界 | 400 | INVALID_PARAMS |
| min_attempt_count < 0 | 400 | INVALID_PARAMS |
| status 非法 | 400 | INVALID_PARAMS |
| from/until 非 ISO | 400 | INVALID_PARAMS |
| 无 token | 401 | UNAUTHORIZED |

### 3.7 不做

- ❌ URL 持久化（避免 scope 膨胀 — 与 Sub-D2 follow-up 解耦）
- ❌ Webhook retry audit log（已知 limitation）
- ❌ Realtime 刷新
- ❌ 任何 schema 变更（0 migration）

---

## 4. 前端设计

### 4.1 共享组件 — `<ConfirmModal>`

```tsx
// 复用 Sub-C Modal 的 portal + ESC + 焦点管理
// 新增：confirmText / cancelText / variant / loading / error

type ConfirmModalProps = {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;       // 默认 '确认'
  cancelText?: string;        // 默认 '取消'
  variant?: 'danger' | 'primary';  // danger = 红按钮（cancel），primary = 蓝按钮（mark-paid）
  loading?: boolean;
  error?: string | null;
  onConfirm: () => Promise<void>;
  onClose: () => void;
};
```

### 4.2 `<WebhookDeadLetterPage>`

布局：
```
[event_type select ▼] [min attempts ___]
[from ___] 至 [until ___] [清除]
┌────────────────────────────────────────────────┐
│ ID │ event_type │ target_user_id │ attempts   │
│    │ last_error │ updated_at │ [重试]        │
└────────────────────────────────────────────────┘
```

- API: `listDeadLetter({ event_type, min_attempt_count, from, until, page, pageSize })`
- 操作：[重试] 按钮（**无确认**，立即触发）
- 成功后：Toast「已加入重试队列」+ 刷新列表（被 retry 的行从 dead_letter 消失）

### 4.3 `<PlacementsPage>`

布局：
```
[status ▼全部] [from] 至 [until] [清除]
┌─────────────────────────────────────────────────────────┐
│ ID │ job_id │ employer │ status │ salary               │
│    │ fee │ created │ [标记已付款] [取消]                  │
└─────────────────────────────────────────────────────────┘
```

- API: `listPlacements({ status, from, until, page, pageSize })`
- 操作（按 status 决定）：
  - `pending_payment` → 显示 [标记已付款] [取消] 两个按钮
  - `paid` → 显示 disabled [已付款]
  - `cancelled` → 显示 disabled [已取消]
- 按钮点击 → 弹 ConfirmModal：
  - mark-paid: `variant='primary'`, message="确认标记为已付款？这将触发佣金结算。"
  - cancel: `variant='danger'`, message="确认取消此 placement？这将无法撤销。"

### 4.4 API wrappers

```ts
// admin-web/src/api/webhooks.ts
export type DeadLetterRow = {
  id: number; target_user_id: string; event_type: string;
  attempt_count: number; last_error: string | null; next_retry_at: string | null;
  created_at: string; updated_at: string;
};

export async function listDeadLetter(opts: {
  page?; pageSize?; event_type?; min_attempt_count?; from?; until?;
}): Promise<Paginated<DeadLetterRow>> { ... }

export async function retryDeadLetter(id: number): Promise<{ id: number; status: string }> { ... }

// admin-web/src/api/placements.ts
export type PlacementStatus = 'pending_payment' | 'paid' | 'cancelled';
export type PlacementRow = { ... };

export async function listPlacements(opts: {
  page?; pageSize?; status?; from?; until?;
}): Promise<Paginated<PlacementRow>> { ... }

export async function markPlacementPaid(id: string): Promise<{ id: string; status: 'paid' }> { ... }
export async function cancelPlacement(id: string): Promise<{ id: string; status: 'cancelled' }> { ... }
```

### 4.5 URL 持久化（**不做**）

每个 page 内部用 `useSearchParams`（直接调），但 **filter 不写 URL**。Sub-D3 收工后可在独立 follow-up 把 useTimelineFilters 通用化再加。本任务控制 scope。

### 4.6 Layout + 路由注册

```tsx
// Layout.tsx — nav + 2 项
<NavLink to="/webhooks/dead-letter">Webhook 死信</NavLink>
<NavLink to="/placements">Placements</NavLink>

// App.tsx — +2 routes
<Route path="/webhooks/dead-letter" element={<PrivateRoute><WebhookDeadLetterPage /></PrivateRoute>} />
<Route path="/placements" element={<PrivateRoute><PlacementsPage /></PrivateRoute>} />
```

### 4.7 Dashboard 改动

「Webhook 死信」MetricCard 加 `<Link>`，点击跳转 `/webhooks/dead-letter`。

### 4.8 错误处理

| 场景 | UI |
|------|-----|
| API 400/404 | Toast（retry）/ ConfirmModal 内显示（mark-paid/cancel） |
| mark-paid 失败 | ConfirmModal 保持打开，显示错误 |
| 网络断开 | Toast「网络错误」 |
| 401 | client.ts 处理 |

### 4.9 不做

- ❌ Placement 详情页（Sub-D4 backlog）
- ❌ Realtime 刷新
- ❌ URL 持久化（避免 scope 膨胀）
- ❌ Webhook retry 写 audit log（已知 limitation）

---

## 5. 数据流 + Audit 链路

### 5.1 Mark-paid 数据流

```
[1] PlacementsPage pending_payment 行末点 [标记已付款]
    → setConfirmState({ open: true, type: 'mark-paid', placement: row })
    → ConfirmModal 弹出（variant=primary, message="...")

[2] 用户点 ConfirmModal [确认]
    → ConfirmModal.handleConfirm 调 markPlacementPaid(placement.id)
    → apiFetchRaw POST /v1/admin/placements/:id/mark-paid
    → 后端 admin auth + commission.markPaid()
    → commission 触发佣金计算 + 通知 + admin_action_log（已写）
    → 响应 { id, status: 'paid' }
    → ConfirmModal onClose
    → Toast「已标记为已付款」
    → load(currentPage) 重拉列表
    → 行 status badge 变 paid，按钮变 disabled
```

### 5.2 Cancel 数据流

类似 mark-paid，variant=danger。

### 5.3 Retry Webhook 数据流

```
[1] 行末点 [重试]
    → 立即调 retryDeadLetter(id)
    → API POST /v1/admin/webhooks/:id/retry
    → 响应 { id, status: 'pending' }
    → Toast「已加入重试队列」
    → load(currentPage) 重拉（被 retry 的行从 dead_letter 消失）
```

### 5.4 Audit 联动

- **mark-paid** → `commission.markPaid()` 内部已写 `admin_action_log`（action=`mark_placement_paid`）—— **不动**
- **cancel** → handler 已写 `admin_action_log`（action=`cancel_placement`）—— **不动**
- **retry webhook** → handler 只改 status，**不写 audit log**（已知 limitation，留 Sub-D4）

### 5.5 失败链路

| 场景 | 表现 |
|------|------|
| API 400（invalid status） | Toast「参数错误」 |
| API 404（placement 不存在） | Toast「placement 不存在」 |
| mark-paid 失败（commission 错） | ConfirmModal 保持打开，显示错误内联 |
| 网络断开 | Toast「网络错误」 |
| 401 | 清 token + 跳 login |

### 5.6 状态管理矩阵

| 状态 | 存储 |
|------|------|
| filter 值（event_type/min_attempt/from/until/status） | useState（page 内） |
| page | useState |
| rows + pagination | useState |
| loading | useState |
| ConfirmModal state（open/type/placement） | useState |
| Toast | ToastContext（全局） |

URL 不持久化（avoid scope creep）。

---

## 6. 测试策略

### 6.1 覆盖目标

| 层 | 范围 | 数量 |
|----|------|------|
| 后端 handler | webhook listDeadLetter + placements list 各 4 case（filter + pagination + 同值 + 不存在） | 8 |
| 后端 route | GET 2 endpoint + 400/401 | 4 |
| 前端 API wrapper | 4 函数（listDeadLetter / retry / listPlacements / markPaid / cancel） | 4 |
| 前端组件 | ConfirmModal + 2 page render | 6 |
| 前端 page | webhook + placements 各 4 case | 8 |
| Dashboard link | 「Webhook 死信」卡片 link | 1 |
| **新增总计** | | **~31** |

回归目标：1058 + 31 ≈ **1089 测试**。

### 6.2 后端测试

#### `admin-webhooks.test.ts`（或扩展 `admin-endpoints.test.ts`）
```
1. GET /v1/admin/webhooks/dead-letter returns paginated envelope (default 20/page)
2. with filter event_type='payment.succeeded' returns only matching rows
3. with filter min_attempt_count=3 returns rows with attempts >= 3
4. with from/until time range restricts by updated_at
5. POST /v1/admin/webhooks/:id/retry sets status=pending, returns { id, status }
6. retry non-existent → 404
```

#### `admin-placements.test.ts`
```
1. GET /v1/admin/placements returns paginated envelope
2. with filter status='paid' returns only paid rows
3. with from/until restricts by created_at
4. POST /v1/admin/placements/:id/mark-paid sets status=paid
5. POST /v1/admin/placements/:id/cancel sets status=cancelled (with admin_action_log)
6. cancel paid placement → 400 invalid_state
7. non-existent → 404
```

### 6.3 前端测试

#### `api/webhooks.test.ts`
```
1. listDeadLetter calls correct endpoint with query params
2. retryDeadLetter POSTs to /:id/retry
3. throws on non-ok response
```

#### `api/placements.test.ts`
```
1. listPlacements calls with query params (status/from/until)
2. markPlacementPaid POSTs to /:id/mark-paid
3. cancelPlacement POSTs to /:id/cancel
4. throws on non-ok
```

#### `components/ConfirmModal.test.tsx`
```
1. renders title + message + 2 buttons
2. clicking confirm calls onConfirm
3. clicking cancel calls onClose
4. loading=true disables buttons
5. error prop shown inline
```

#### `pages/WebhookDeadLetterPage.test.tsx`
```
1. mount calls listDeadLetter
2. changing event_type triggers refetch
3. clicking 重试 calls retryDeadLetter
4. shows empty state when no rows
```

#### `pages/PlacementsPage.test.tsx`
```
1. mount calls listPlacements
2. changing status triggers refetch
3. clicking 标记已付款 opens ConfirmModal
4. confirming calls markPlacementPaid + updates list
5. clicking 取消 opens danger ConfirmModal
```

### 6.4 测试基础设施

- 沿用 vitest + supertest（后端）+ vitest + jsdom + RTL（前端）
- 复用已有 helper
- Mock API with `vi.mock`
- Real DB via in-memory node:sqlite

### 6.5 不做

- ❌ E2E（Playwright）
- ❌ 视觉回归
- ❌ 性能测试
- ❌ Mutation testing

---

## 7. 验收标准（DoD）

1. ✅ 后端 2 个 GET endpoint 返回 paginated envelope
2. ✅ 后端 ~12 集成测试通过
3. ✅ 2 个 page 渲染、filter、mutations 都工作
4. ✅ ConfirmModal mark-paid 触发佣金（不破坏现有 commission.markPaid 测试）
5. ✅ ~19 新前端测试通过 + 现有不退
6. ✅ Capability：`admin.list_dead_letter` + `admin.list_placements`
7. ✅ 全 typecheck 干净
8. ✅ 手测 7 步全通过（dev 模式）
9. ✅ CHANGELOG v2.3.0 条目
10. ✅ Spec + Plan + HANDOFF 同步 git

---

## 8. 手测 7 步（dev 模式）

```bash
# Terminal 1
cd D:/dev/hunter-platform && npm run dev

# Terminal 2
cd D:/dev/hunter-platform/admin-web && npm run dev
```

| # | 操作 | 期望 |
|---|------|------|
| 1 | http://localhost:5174/admin/login | 登录 |
| 2 | 进「Webhook 死信」侧边栏 | list 渲染 |
| 3 | 改 event_type filter / 日期范围 | 列表刷新 |
| 4 | 点某行 [重试] | 立即触发 + Toast「已加入重试队列」+ 行消失 |
| 5 | 进「Placements」侧边栏 | list 渲染 |
| 6 | 改 status filter | 列表刷新 |
| 7 | 点 pending_payment 行的 [标记已付款] → 弹确认 → 点 [确认] | Toast「已标记为已付款」+ 状态变 paid + 按钮变 disabled |

任一步失败，按错误排查。

---

## 9. 部署与回滚

### 部署顺序

1. 后端（Plan 1）+ 测试 → `npm run test` → merge → 自动部署
2. 前端（Plan 2）+ 测试 → `npm run test` → `npm run build` → 推到 `out/admin/` → nginx reload

### 回滚

- 后端：revert commit + 重启
- 前端：revert commit + 重新 build
- 数据库：0 改动，无迁移回滚需求

---

## 10. 工作量预估

| 阶段 | 估时 |
|------|------|
| 后端 handler + route + schema + capability | 3 小时 |
| 后端测试 | 1.5 小时 |
| 前端 2 page + ConfirmModal + api wrappers | 4 小时 |
| 前端测试 | 2 小时 |
| 手测 + 修小问题 | 1 小时 |
| **总计** | **~1.5 个工作日** |

---

## 11. 后续（明确不在 Sub-D3 范围）

| Sub-project | 内容 | 预计 |
|---|---|---|
| Sub-D4 | Per-entity 详情页（含 webhook retry 写 audit log） | v2.4 |
| Sub-E | config 写入类 UI（rate-limit / webhooks / config） | v2.5 |
| Sub-D3 follow-up | filter URL 持久化（通用化 useTimelineFilters） | v2.3.1 |

---

## 附录 A：UI 草图

### WebhookDeadLetterPage
```
┌──────────────────────────────────────────────────────────────────┐
│ 猎头管理后台                          Admin                       │
├──────────────┬───────────────────────────────────────────────────┤
│              │ Webhook 死信队列                                │
│ 仪表盘       │ ┌──────────────────────────────────────────────┐ │
│ 用户         │ │ [event_type ▼] [min attempts ___]            │ │
│ 候选人       │ │ [from] 至 [until]  [清除]                    │ │
│ 职位         │ └──────────────────────────────────────────────┘ │
│ 推荐 ◀       │ ┌──────────────────────────────────────────────┐ │
│ Webhook 死信  │ │ 1 小时前                                  │ │
│ Placements ◀ │ │ event_type: payment.succeeded               │ │
│ 审计         │ │ target_user: usr_xxx                        │ │
│ 我的         │ │ attempts: 5   last_error: HTTP 500          │ │
│              │ │ [重试]                                     │ │
│              │ └──────────────────────────────────────────────┘ │
│              │ < 1 2 3 ... >                                 │
└──────────────┴───────────────────────────────────────────────────┘
```

### PlacementsPage
```
┌──────────────────────────────────────────────────────────────────┐
│ Placements                                                     │
├──────────────────────────────────────────────────────────────────┤
│ [status ▼全部]  [from] 至 [until]  [清除]                       │
│ ┌────────────────────────────────────────────────────────────┐│
│ │ ID          │ job_id │ employer │ status      │ annual_salary ││
│ │ place_001   │ job_X  │ u_emp    │ pending ✓   │ 500000         ││
│ │                                                            ││
│ │ [标记已付款] [取消]                                      ││
│ └────────────────────────────────────────────────────────────┘│
│ < 1 2 3 ... >                                                 │
└──────────────────────────────────────────────────────────────────┘
```

### ConfirmModal
```
┌─────────────────────────────────────────┐
│ 标记为已付款                       [×] │
├─────────────────────────────────────────┤
│ 确认标记为已付款？这将触发佣金结算。    │
│                                         │
│                                         │
├─────────────────────────────────────────┤
│              [取消]    [确认]            │
└─────────────────────────────────────────┘
```

---

**Spec 结束。** 配套 implementation plans 见 `docs/superpowers/plans/2026-06-25-web-admin-sub-D3-plan-{1,2}.md`（待 writing-plans skill 输出）。