# Web Admin Sub-E — Config / Rate-Limit / Webhook Settings UI Design

> **For agentic workers:** 这是 design spec，配套 implementation plan 见 `docs/superpowers/plans/2026-06-25-web-admin-sub-E-plan-{1,2}.md`（待 writing-plans skill 输出）。
>
> 续接 Sub-D6（v2.6.0，merge `d16e2dc`）。本 spec 是 **Sub-project E：3 类 ops 配置 UI**（Config / Rate-Limit / Webhook Subscriptions）。后续 backlog：i18n、in-site notifications、v2 self-upload + pitch 等。

## ⚠️ 与已有 Sub-project 的关系

| Sub-project | 已交付 | 内容 |
|---|---|---|
| Sub-C / D2 / D3 / D4 / D5 / D6 + Small Fixes | ✅ | 完整 admin 功能（read-only + mutations）|
| **Sub-E（本 spec）** | 设计中 | **3 类配置 UI：Config / Rate-Limit / Webhook Subscriptions** |

**Sub-E 解决的痛点**：
- Config 改动要 SSH 改 DB
- Rate-limit 改要 SQL（且没有 write endpoint）
- Webhook subscriptions 完全没有（hardcoded URL）
- Ops 团队没有 self-service 配置工具

---

## 1. 背景与动机

### 1.1 现状（Sub-D6 后）

| 类别 | Backend | Frontend |
|------|---------|----------|
| **Config** | `GET /v1/admin/config` + `PUT /v1/admin/config/:key` ✅ | ❌ 无 UI |
| **Rate-limit** | `GET /rate-limit/buckets` (view) + `POST /rate-limit/users/:id/clear` ✅ | ❌ 无 UI（且无 write endpoint） |
| **Webhook Subscriptions** | ❌ 无 subscription 表 + 无 endpoint | ❌ 无 UI |

### 1.2 真实需求

| 需求 | 痛点 |
|---|------|
| 改 platform_fee_pct、阈值等业务参数 | 要 SSH 改 DB |
| 调 per-tier / per-user API 速率 | 要 SQL update rate_limit_buckets |
| 添加/删除 webhook 订阅（订阅哪些 events → 推到哪些 URL）| 完全没有 — 全部 hardcoded |
| 失败 webhook 列表 + 重试 | Sub-D3 已做（dead-letter + retry） |
| Webhook 死信写 audit | Sub-D4 已做（retry 写 audit） |

### 1.3 非目标

- ❌ Worker 端改造（webhook 投递逻辑、retry policy 调整）— Sub-E 只做配置 UI
- ❌ i18n / 暗黑模式
- ❌ Rate-limit bucket 实时监控（Sub-D 已有 dashboard 卡片）
- ❌ Webhook payload schema 编辑（subscriber 自己定义 handler）
- ❌ Realtime 配置变更（reload 服务才生效）

---

## 2. 架构总览

### 2.1 模块改动图

```
hunter-platform/
├── src/main/
│   ├── routes/admin.ts                      # 改：+rate-limit write + webhook subscription routes
│   ├── schemas/admin.ts                     # 改：+RateLimitBucketSchema + WebhookSubscriptionSchema
│   ├── db/migrations/
│   │   └── v024_webhook_subscriptions.sql (NEW) # 新增 webhook_subscriptions 表
│   ├── db/repositories/
│   │   ├── webhook-subscriptions.ts (NEW)  # CRUD for subscriptions
│   │   └── rate-limit-buckets.ts (改: 加 setLimit 方法)
│   ├── modules/admin/handlers/
│   │   ├── config.ts (改: +list/write)
│   │   ├── rate-limit.ts (改: +listBuckets + setLimit + clear)
│   │   └── webhooks-subscriptions.ts (NEW)
│   └── capabilities/admin.ts                # 改：+3 capability
│
└── admin-web/src/
    ├── pages/
    │   └── SettingsPage.tsx (NEW)          # 3 tabs (Config / Rate-Limit / Webhooks)
    ├── components/
    │   └── Layout.tsx                       # 改：+ Settings 入口
    ├── api/
    │   ├── config.ts (NEW)                 # listConfig + updateConfig
    │   ├── rate-limit.ts (NEW)             # listBuckets + setLimit + clear
    │   └── webhook-subscriptions.ts (NEW)   # list + create + update + delete
    └── App.tsx                              # 改：+/admin/settings
```

### 2.2 路由表

| Method | Path | 改动 |
|--------|------|------|
| GET | `/v1/admin/config` | **不动** |
| PUT | `/v1/admin/config/:key` | **不动** |
| GET | `/v1/admin/rate-limit/buckets` | **不动** |
| POST | `/v1/admin/rate-limit/users/:id/clear` | **不动** |
| **POST** | **`/v1/admin/rate-limit/buckets`** | **新增**：set per-tier/per-user limit |
| **GET** | **`/v1/admin/webhook-subscriptions`** | **新增**：list |
| **POST** | **`/v1/admin/webhook-subscriptions`** | **新增**：create |
| **PATCH** | **`/v1/admin/webhook-subscriptions/:id`** | **新增**：update |
| **DELETE** | **`/v1/admin/webhook-subscriptions/:id`** | **新增**：delete |

### 2.3 数据库改动

**+1 migration**（v024_webhook_subscriptions.sql）：

```sql
CREATE TABLE webhook_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_url TEXT NOT NULL,
  event_types TEXT NOT NULL,        -- JSON array, e.g. '["placement.paid","candidate.unlocked"]'
  hmac_secret TEXT,                -- nullable, override global WEBHOOK_HMAC_SECRET
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_admin_user_id TEXT
);
CREATE INDEX idx_webhook_subs_enabled ON webhook_subscriptions(enabled);
```

**rate_limit_buckets 表不动** — 已有 `user_id` + `window_start` + `count`，可扩展表示 limit（详见 §3.2）。

### 2.4 Tech Stack

**沿用现有**：Express 4.21, node:sqlite, zod, vitest, supertest（后端）；React 18, Vite, react-router-dom, vanilla CSS, vitest+jsdom+RTL（前端）

**无新依赖。**

---

## 3. 后端设计

### 3.1 Config（0 改动）

已存在 `GET /v1/admin/config` + `PUT /v1/admin/config/:key`。**不需要 backend 改动**。前端加 wrapper。

### 3.2 Rate-Limit 新 endpoint

```typescript
// POST /v1/admin/rate-limit/buckets
// body: { tier?: string, user_id?: string, limit: number, window_seconds: number }
// tier='free' | 'paid' | 'headhunter' (预定义) OR user_id 指定单用户
// 实际机制：rate_limit_buckets 表加 limit_per_window 字段

// Or: 简化方案——直接用 Config 表存 rate-limit config（避免 schema 改动）
//   'rate_limit.tier.free.limit_per_minute' = 10
//   'rate_limit.tier.paid.limit_per_minute' = 100
//   'rate_limit.user.<user_id>.limit_per_minute' = 50
```

**简化方案（推荐）**：用 Config 表存 rate-limit config（key-value 风格）。**0 schema 改动**。前端 UI 读 /config 看 `rate_limit.*` key，写用 PUT /config/:key。

```ts
// 例：PUT /config/rate_limit.tier.free.limit_per_minute
// body: { value: 10, reason: 'ops 调参' }
```

**但**：现有 rate_limit_buckets 表是基于 user_id + window_start 累加的。worker 实际从 env.WEBHOOK_HMAC_SECRET 等常量读 limit。**Sub-E 不改 limit 行为**，只增加「config 存 rate-limit 参数」——是否使用由 worker 自行决定。MVP 阶段只暴露 config 写入 UI。

**MVP 决策**：Sub-E 只把 rate-limit config 写入 `Config` 表（key 命名 `rate_limit.*`），**不接入实际限流逻辑**。这避免触碰 worker 端。Future Sub 可以接入。

### 3.3 Webhook Subscription 新表 + 新 endpoint

#### migration（v024_webhook_subscriptions.sql）
```sql
CREATE TABLE webhook_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_url TEXT NOT NULL,
  event_types TEXT NOT NULL,        -- JSON array
  hmac_secret TEXT,                -- nullable
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_admin_user_id TEXT
);
CREATE INDEX idx_webhook_subs_enabled ON webhook_subscriptions(enabled);
```

#### handler
```typescript
// src/main/modules/admin/handlers/webhook-subscriptions.ts
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

export function createAdminWebhookSubscriptionsHandler(db: DB) {
  return {
    list(): WebhookSubscription[] { /* SELECT * */ },
    create(adminUserId: string, data: { target_url, event_types, hmac_secret? }): WebhookSubscription { /* INSERT */ },
    update(id: number, data: Partial<{ target_url, event_types, hmac_secret, enabled }>): WebhookSubscription { /* UPDATE */ },
    delete(id: number): void { /* DELETE */ },
  };
}
```

#### route
```typescript
router.get('/webhook-subscriptions', (req, res, next) => {
  try { respond(res, ListWebhookSubscriptionsResponseSchema, { ok: true, data: webhookSubs.list() }, { strict: true }); }
  catch (e) { next(e); }
});
router.post('/webhook-subscriptions', (req, res, next) => {
  try {
    const adminUserId = (req as any).admin?.id;
    if (!adminUserId) throw Errors.unauthorized();
    const { target_url, event_types, hmac_secret } = req.body ?? {};
    // validate target_url is https/http
    if (!target_url || !event_types) throw Errors.invalidParams('target_url and event_types required');
    respond(res, GetWebhookSubscriptionResponseSchema, { ok: true, data: webhookSubs.create(adminUserId, { target_url, event_types, hmac_secret }) }, { strict: true });
  } catch (e) { next(e); }
});
router.patch('/webhook-subscriptions/:id', (req, res, next) => { /* update */ });
router.delete('/webhook-subscriptions/:id', (req, res, next) => { /* delete */ });
```

### 3.4 Audit 联动

- Config 写 → 已写 audit（config.ts handler 已有 admin_action_log 写入）
- Rate-limit config 写（同 Config 路径）→ 同样写 audit
- Webhook subscription CRUD → **新**：写 admin_action_log（action='create_webhook_subscription' / 'update_webhook_subscription' / 'delete_webhook_subscription'）

### 3.5 错误处理

| 场景 | HTTP | code |
|------|------|------|
| target_url 非 http/https | 400 | INVALID_PARAMS |
| event_types 空数组 | 400 | INVALID_PARAMS |
| id 不存在 | 404 | NOT_FOUND |
| Config key 非法字符 | 400 | INVALID_PARAMS |
| 无 admin token | 401 | UNAUTHORIZED |

### 3.6 共享 schema

```typescript
// 在 schemas/admin.ts 加
const ConfigEntrySchema = z.object({
  key: z.string(),
  value: z.unknown(),  // JSON 任意值
  updated_at: ISODateTime,
  updated_by_admin_user_id: z.string().nullable(),
});
const ListConfigResponseSchema = z.object({
  ok: z.literal(true),
  data: z.array(ConfigEntrySchema),
});

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

### 3.7 不做

- ❌ Webhook 投递逻辑改造（worker 端不读新订阅表，Sub-E 只加管理 UI）
- ❌ Rate-limit 实际限流改造（同理）
- ❌ Webhook 重试 policy 调整
- ❌ Per-event payload schema 编辑

---

## 4. 前端设计

### 4.1 新建 SettingsPage（3 tabs）

```
┌──────────────────────────────────────────────────────────────┐
│  Settings                                                  │
│  [Config]  [Rate-Limit]  [Webhooks]                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Tab 1: Config                                              │
│  ┌──────────┬─────────┬──────────────┬──────┐              │
│  │ Key      │ Value   │ Updated      │ 操作 │              │
│  ├──────────┼─────────┼──────────────┼──────┤              │
│  │ plat...   │ 5       │ 3 周前       │ 编辑 │              │
│  └──────────┴─────────┴──────────────┴──────┘              │
│                                                              │
│  Tab 2: Rate-Limit (读 Config 表的 rate_limit.* keys)        │
│  [刷新]                                                      │
│                                                              │
│  Tab 3: Webhooks                                              │
│  ┌────┬──────────────┬─────────────┬──────┐              │
│  │ ID │ Target URL   │ Event Types │ 操作 │              │
│  ├────┼──────────────┼─────────────┼──────┤              │
│  │ 1  │ https://...  │ [...]       │ 编辑 │              │
│  └────┴──────────────┴─────────────┴──────┘              │
│  [+ New Subscription]                                       │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 路由注册

```tsx
// App.tsx
<Route path="/settings" element={<PrivateRoute><SettingsPage /></PrivateRoute>} />

// Layout.tsx — nav 加 Settings 入口
<NavLink to="/admin/settings">Settings</NavLink>
```

### 4.3 API wrappers

```ts
// admin-web/src/api/config.ts
export type ConfigEntry = { key: string; value: unknown; updated_at: string; updated_by_admin_user_id: string | null };
export async function listConfig(): Promise<ConfigEntry[]> { ... }
export async function updateConfig(key: string, value: unknown, reason: string): Promise<ConfigEntry> { ... }

// admin-web/src/api/rate-limit.ts
export type RateLimitBucket = { user_id: string | null; tier: string; limit_per_minute: number; count: number; ... };
export async function listRateLimits(): Promise<RateLimitBucket[]> { ... }
// 实际：listConfig() filter 'rate_limit.*' keys

// admin-web/src/api/webhook-subscriptions.ts
export type WebhookSubscription = { id: number; target_url: string; event_types: string[]; hmac_secret: string | null; enabled: boolean; ... };
export async function listWebhookSubscriptions(): Promise<WebhookSubscription[]> { ... }
export async function createWebhookSubscription(data): Promise<WebhookSubscription> { ... }
export async function updateWebhookSubscription(id, data): Promise<WebhookSubscription> { ... }
export async function deleteWebhookSubscription(id): Promise<void> { ... }
```

### 4.4 ConfirmModal 复用

- 编辑 Config key → 弹 ConfirmModal（primary + reason）
- 创建/删除/启用/停用 Webhook subscription → 弹 ConfirmModal
- 删除 subscription 选 danger variant

### 4.5 Toast + 错误处理

| 场景 | UI |
|------|-----|
| 成功更新 | Toast「已保存」+ 重新 fetch list |
| 失败 | Modal 内联错误 |
| 401 | client.ts 处理 |
| 网络断开 | Toast「网络错误」 |

### 4.6 不做

- ❌ Realtime 同步（操作后手动刷新）
- ❌ 编辑 audit detail
- ❌ Webhook 测试发送（test ping）— Sub-E+ 范围
- ❌ Rate-limit 实时 bucket 监控（Sub-D 已有 dashboard 卡片）

---

## 5. 数据流 + Audit 链路

### 5.1 改 Config key

```
[1] SettingsPage Tab 1 列表 + Edit 按钮
    → 弹 Modal（primary, 必填 reason）
    → 提交 → updateConfig(key, newValue, reason)
    → PUT /v1/admin/config/:key { value, reason }
    → backend config.set(adminUserId, key, value, reason)
    → UPDATE config + INSERT admin_action_log
    → Toast「已保存」+ 列表刷新
```

### 5.2 改 Webhook subscription

```
[1] Tab 3 列表 + Edit / Delete / + New
    → New: 弹 Modal（target_url + event_types multi-select + optional hmac_secret）
    → 提交 → createWebhookSubscription(data)
    → POST /v1/admin/webhook-subscriptions
    → INSERT subscription + INSERT admin_action_log
    → Toast「已创建」+ 列表刷新
```

### 5.3 Audit 联动

- Config 写、Rate-limit config 写：复用现有 config handler 的 audit 写入
- Webhook subscription CRUD：新写 audit（action='create_webhook_subscription' 等）

### 5.4 失败链路

| 场景 | 表现 |
|------|------|
| target_url 格式错 | Modal 内联错误 |
| event_types 空 | Modal 内联错误 |
| 404 | Modal 显示后端 message |
| 网络断开 | Toast |

---

## 6. 测试策略

### 6.1 覆盖目标

| 层 | 范围 | 数量 |
|----|------|------|
| 后端 webhook-subscription handler | list / create / update / delete | 6 |
| 后端 route | 4 endpoint + 400/401 边界 | 6 |
| 后端 config / rate-limit (无新 endpoint 改) | 仅 0 改动 | 0 |
| 前端 API wrapper | config + webhook-subscription | 4 |
| 前端 page | SettingsPage 3 tabs | 5 |
| **新增总计** | | **~21** |

回归目标：196 + 21 ≈ **217 admin-web 测试**。Backend: 956 + 12 ≈ **968**。

### 6.2 不做

- ❌ E2E
- ❌ 视觉回归

---

## 7. 验收标准（DoD）

1. ✅ SettingsPage 3 tabs 全部工作
2. ✅ Config 列表 + 编辑（含 reason 必填）
3. ✅ Rate-limit 显示「rate_limit.*」Config keys
4. ✅ Webhook subscription CRUD 全部工作
5. ✅ 21 个新测试通过
6. ✅ 全 typecheck 干净
7. ✅ 手测 5 步
8. ✅ CHANGELOG v2.7.0

---

## 8. 手测 5 步

```bash
cd D:/dev/hunter-platform && npm run dev
cd D:/dev/hunter-platform/admin-web && npm run dev
```

| # | 操作 | 期望 |
|---|------|------|
| 1 | 侧栏「Settings」→ Tab Config | 看到 config 列表 |
| 2 | 编辑某 key → 弹 Modal → 输 reason → 保存 | Toast「已保存」+ 值更新 |
| 3 | Tab Rate-Limit | 看到 rate_limit.* keys（空 OK） |
| 4 | Tab Webhooks → + New → 填 target_url + event_types → 创建 | 新订阅出现在列表 |
| 5 | 审计页 → 应能看到 create_webhook_subscription 记录 | 看到新 record |

---

## 9. 部署 / 回滚

### 部署
- 后端：1 migration（v024）+ 4 endpoint。重启服务。
- 前端：1 page + 1 nav 入口。`npm run build` + nginx reload。
- 注意：**新加的 webhook_subscriptions 表只是 metadata 存储，worker 不读，所以重启不需要 reload worker 即可**。

### 回滚
- 后端：revert commit + 删 migration。重置。
- 前端：revert + rebuild。

---

## 10. 工作量

| 阶段 | 估时 |
|------|------|
| 后端（migration + 4 endpoint + handler + tests） | 半天 |
| 前端（1 page 3 tabs + 3 API wrappers + tests） | 1 天 |
| 手测 + 修小问题 | 半天 |
| **总计** | **~2 天** |

---

## 11. 后续

| Sub | 内容 | 预计 |
|-----|------|------|
| Sub-F（Sub-E+） | Worker 接入 rate-limit config + webhook subscriptions 实际投递 | v2.8 |
| i18n 接入 | admin-web 中文化 | v2.9 |
| in-site notifications | 顶部通知 | v2.10 |

---

**Spec 结束。** 配套 implementation plans 见 `docs/superpowers/plans/2026-06-25-web-admin-sub-E-plan-{1,2}.md`（待 writing-plans skill 输出）。