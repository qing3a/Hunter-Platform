# Web Admin Sub-E — Config DB-Backed + UI Design

> **For agentic workers:** 这是 design spec，配套 implementation plan 见 `docs/superpowers/plans/2026-06-25-web-admin-sub-E-plan.md`（待 writing-plans skill 输出）。
>
> 续接 Sub-D6（v2.6.0，merge `d16e2dc`）。本 spec 是 **Sub-project E：Config 改造（DB-backed + 即时生效 + audit）**。
>
> ⚠️ **Scope 修正**：初版 spec 曾计划 "Config + Rate-Limit + Webhook 3 类"。**重新审查代码后发现**：
> - Config 当前是写 JSON 文件，**不是 DB**，写后需 restart 服务
> - Rate-Limit UI 写 Config 但**限流 worker 不读**，属欺骗性 UI
> - Webhook 是 `users.agent_endpoint` 模式（user 自己注册），不是 Slack-style 外部订阅
>
> 决定：**Sub-E 只做 Config 改造**。其他两个 spec 取消（等真生产需求）。

---

## ⚠️ 与已有 Sub-project 的关系

| Sub-project | 已交付 | 内容 |
|---|---|---|
| Sub-C / D2 / D3 / D4 / D5 / D6 + Small Fixes | ✅ | 完整 admin 功能 |
| **Sub-E（本 spec）** | 设计中 | **Config DB 化 + 通用 key + audit + UI** |

---

## 1. 背景与动机

### 1.1 现状（Sub-D6 后）

| 项 | 现状 |
|----|------|
| `config` 表 | **不存在** — 写 JSON 文件 `config/desensitization.json` / `config/commission.json` |
| Handler | `config.get()` / `config.set(key, value)` — hardcoded 2 个 key，set() 抛 "Unknown config key" |
| 路由 | `GET /v1/admin/config` + `PUT /v1/admin/config/:key` |
| 写文件 → 立即生效 | ❌ 需 restart 服务（require cache） |
| Audit | ❌ 无 |
| 通用 key | ❌ 只能改 2 个 hardcoded key |
| Frontend | ❌ 无 UI |

### 1.2 真实需求

| 需求 | 痛点 |
|---|---|
| 改 platform_fee_pct 等业务参数 | 需 SSH + restart 服务 |
| 加新 config key | 需改 handler 代码 + deploy |
| Audit 谁改了什么 | 查不到 |
| 写完立即生效 | 需 restart |

### 1.3 非目标

- ❌ Rate-Limit UI（worker 不读，欺骗性 UI）
- ❌ Webhook Subscriptions（user.agent_endpoint 模式，不是 Slack 订阅）
- ❌ i18n / 暗黑模式
- ❌ Reload 服务后失效
- ❌ Config value schema validation（key-value 通用，any JSON）

---

## 2. 架构总览

### 2.1 模块改动图

```
hunter-platform/
├── src/main/
│   ├── routes/admin.ts                      # 改：+auditUserId 透传（PUT /config/:key）
│   ├── schemas/admin.ts                     # 改：+ListConfigResponseSchema + ConfigEntrySchema
│   ├── modules/admin/handlers/config.ts     # 改：DB-backed 替代文件、+audit
│   ├── db/migrations/
│   │   └── v024_config_table.sql (NEW)     # 新增 config 表
│   └── capabilities/admin.ts                # 改：+admin.list_config + +admin.update_config
│
└── admin-web/src/
    ├── pages/
    │   └── SettingsPage.tsx (NEW)          # 1 个 Config tab
    ├── api/
    │   └── config.ts (NEW)                 # listConfig + updateConfig
    └── App.tsx                              # 改：+/admin/settings
```

### 2.2 路由表

| Method | Path | 改动 |
|--------|------|------|
| GET | `/v1/admin/config` | **改**：返回 DB 数据（不是文件） |
| PUT | `/v1/admin/config/:key` | **改**：透传 adminUserId（写 audit） + 写 DB（不是文件） |

### 2.3 数据库改动

**+1 migration**（v024_config_table.sql）：

```sql
-- 替换 JSON 文件 config
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,         -- JSON 序列化的 value
  updated_at TEXT NOT NULL,
  updated_by_admin_user_id TEXT     -- nullable for backward compat
);
CREATE INDEX idx_config_updated ON config(updated_at);
```

**数据迁移**：
- 启动时从 `config/desensitization.json` + `config/commission.json` 读一次
- INSERT 到 `config` 表（如不存在）
- 之后**废弃文件读写**，handler 只用 DB
- 文件保留作为 fallback（首次启动时一次性导入）

### 2.4 Tech Stack

**沿用现有**：Express 4.21, node:sqlite, zod, vitest, supertest（后端）；React 18, Vite, react-router-dom, vanilla CSS, vitest+jsdom+RTL（前端）

**无新依赖。**

---

## 3. 后端设计

### 3.1 Migration（v024_config_table.sql）

```sql
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_admin_user_id TEXT
);
CREATE INDEX idx_config_updated ON config(updated_at);

-- 首次启动时从文件读（如表为空）+ INSERT OR IGNORE
-- 此 SQL 仅创建表；数据导入在 startup code 做
```

### 3.2 Handler 重构（`src/main/modules/admin/handlers/config.ts`）

```typescript
import type { DB } from '../../../db/connection.js';
import { createAdminActionLogRepo } from '../../../db/repositories/admin-action-log.js';

export type ConfigEntry = {
  key: string;
  value: unknown;  // parsed from value_json
  updated_at: string;
  updated_by_admin_user_id: string | null;
};

export function createAdminConfigHandler(db: DB) {
  const adminLog = createAdminActionLogRepo(db);

  return {
    list(): ConfigEntry[] {
      const rows = db.prepare('SELECT key, value_json, updated_at, updated_by_admin_user_id FROM config ORDER BY key').all() as Array<{
        key: string; value_json: string; updated_at: string; updated_by_admin_user_id: string | null;
      }>;
      return rows.map(r => ({
        key: r.key,
        value: JSON.parse(r.value_json),
        updated_at: r.updated_at,
        updated_by_admin_user_id: r.updated_by_admin_user_id,
      }));
    },

    set(adminUserId: string, key: string, value: unknown): ConfigEntry {
      // Validate key format
      if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/.test(key)) {
        throw new Error('Invalid config key format: must be lowercase.dotted.path');
      }
      const valueJson = JSON.stringify(value);
      const now = new Date().toISOString();
      // UPSERT
      db.prepare(`
        INSERT INTO config (key, value_json, updated_at, updated_by_admin_user_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at,
          updated_by_admin_user_id = excluded.updated_by_admin_user_id
      `).run(key, valueJson, now, adminUserId);
      // Write audit
      adminLog.insert({
        admin_user_id: adminUserId,
        action: 'update_config',
        target_type: 'config',
        target_id: key,
        details_json: JSON.stringify({ value }),
      });
      return { key, value, updated_at: now, updated_by_admin_user_id: adminUserId };
    },
  };
}
```

### 3.3 启动时数据迁移

在 `src/main/server.ts`（或新建 `src/main/startup/config-migration.ts`）：

```typescript
// 启动时一次性迁移
function migrateConfigFromFilesToDB(db: DB) {
  const files = [
    'config/desensitization.json',
    'config/commission.json',
  ];
  for (const f of files) {
    try {
      const content = fs.readFileSync(f, 'utf8');
      const value = JSON.parse(content);
      const key = path.basename(f, '.json');  // 'desensitization' or 'commission'
      db.prepare(`
        INSERT OR IGNORE INTO config (key, value_json, updated_at, updated_by_admin_user_id)
        VALUES (?, ?, ?, NULL)
      `).run(key, content, new Date().toISOString());
    } catch (e) {
      // 文件不存在或解析失败 → 忽略
    }
  }
}
```

调用：在 server.ts `createAppFromDb()` 之后立即调一次。

### 3.4 Route 改造

`src/main/routes/admin.ts`：

```typescript
router.get('/config', (_req, res, next) => {
  try {
    respond(res, ListConfigResponseSchema, { ok: true, data: config.list() }, { strict: true });
  } catch (e) { next(e); }
});
router.put('/config/:key', (req, res, next) => {
  try {
    const adminUserId = (req as any).admin?.id;
    if (!adminUserId) throw Errors.unauthorized();
    const key = req.params.key;
    const value = req.body;
    respond(res, GetConfigResponseSchema, { ok: true, data: config.set(adminUserId, key, value) }, { strict: true });
  } catch (e) { next(e); }
});
```

### 3.5 Schema

```typescript
// src/main/schemas/admin.ts
const ConfigEntrySchema = z.object({
  key: z.string(),
  value: z.unknown(),  // 任意 JSON
  updated_at: ISODateTime,
  updated_by_admin_user_id: z.string().nullable(),
});
const ListConfigResponseSchema = z.object({
  ok: z.literal(true),
  data: z.array(ConfigEntrySchema),
});
const GetConfigResponseSchema = z.object({
  ok: z.literal(true),
  data: ConfigEntrySchema,
});
```

### 3.6 Capability

```typescript
// 在 capabilities/admin.ts 加 2 个
{
  name: 'admin.list_config',
  description: '列出所有 config key-value',
  method: 'GET', path: '/v1/admin/config',
  response_schema: ListConfigResponseSchema,
  quota_cost: 0, preconditions: [],
},
{
  name: 'admin.update_config',
  description: '更新 config key（写 audit）',
  method: 'PUT', path: '/v1/admin/config/:key',
  response_schema: GetConfigResponseSchema,
  quota_cost: 0, preconditions: [],
},
```

### 3.7 错误处理

| 场景 | HTTP | code |
|------|------|------|
| 无 admin token | 401 | UNAUTHORIZED |
| key 格式非法（非 lowercase.dotted）| 400 | INVALID_PARAMS |
| value 不是合法 JSON | 400 | INVALID_PARAMS |

### 3.8 不做

- ❌ Rate-Limit UI（worker 不读）
- ❌ Webhook Subscriptions（user.agent_endpoint 模式）
- ❌ Config value schema validation（key-value 通用）
- ❌ Hot reload worker（不需要——已经是 DB-backed 即时生效）

---

## 4. 前端设计

### 4.1 SettingsPage（单 page，1 个 tab — Config）

```
┌──────────────────────────────────────────────────────────────┐
│  Settings                                                  │
│  [Config]                                                   │
├──────────────────────────────────────────────────────────────┤
│  ┌──────────┬──────────┬──────────────────┬──────┐         │
│  │ Key      │ Value    │ Updated           │ 操作 │         │
│  ├──────────┼──────────┼──────────────────┼──────┤         │
│  │ des...   │ {...}    │ 3 天前 adm_1     │ 编辑 │         │
│  │ com...   │ {...}    │ 1 周前 adm_1     │ 编辑 │         │
│  └──────────┴──────────┴──────────────────┴──────┘         │
│  [+ New Key]                                                │
└──────────────────────────────────────────────────────────────┘
```

点击「编辑」或「+ New Key」→ 弹 Modal（含 key 输入 + value JSON 编辑 + reason 必填）。

### 4.2 路由 + nav

```tsx
// App.tsx
<Route path="/settings" element={<PrivateRoute><SettingsPage /></PrivateRoute>} />

// Layout.tsx — nav 加「Settings」入口
<NavLink to="/admin/settings">Settings</NavLink>
```

### 4.3 API wrapper

```ts
// admin-web/src/api/config.ts
export type ConfigEntry = { key: string; value: unknown; updated_at: string; updated_by_admin_user_id: string | null };

export async function listConfig(): Promise<ConfigEntry[]> { ... }

export async function updateConfig(key: string, value: unknown, reason: string): Promise<ConfigEntry> {
  const env = await apiFetchRaw<ConfigEntry>(`config/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value, reason }),
  });
  if (!env.ok || !env.data) {
    throw new Error(env.error?.message ?? 'Failed to update config');
  }
  return env.data;
}
```

**注意**：updateConfig payload 结构是 `{ value, reason }`（不是直接 value）——这样 spec 里要求 reason 必填（用于 audit）。

### 4.4 编辑 Modal

基于现有 `<ConfirmModal>`，加 textarea 输入 JSON value + key 输入 + reason 输入。

简单方案：新建 `<ConfigEditModal>` 组件（不复用 ConfirmModal，因为 input 字段更复杂）。

```tsx
type ConfigEditModalProps = {
  open: boolean;
  entry: ConfigEntry | null;  // null = 新建
  onClose: () => void;
  onSave: (key: string, value: unknown, reason: string) => Promise<void>;
};
```

JSX：
- Key 输入（新建可编辑，编辑 disabled）
- Value textarea（JSON 格式，输入时 validate 合法 JSON）
- Reason textarea（必填，min 3 chars）
- Save / Cancel 按钮

### 4.5 错误处理

| 场景 | UI |
|------|-----|
| value 不是合法 JSON | Modal 内联红字 |
| reason < 3 chars | Modal 内联红字 |
| Save 失败 | Modal 显示后端 message |
| 401 | client.ts 处理 |
| 成功 | Modal 关闭 + Toast「已保存」+ 列表刷新 |

### 4.6 不做

- ❌ Realtime 同步
- ❌ i18n / 暗黑模式
- ❌ Config value schema validation（key-value 通用）
- ❌ 删除 key（DELETE endpoint，MVP 不做）

---

## 5. 数据流 + Audit 链路

### 5.1 编辑 key

```
[1] SettingsPage 列表 + [编辑] 按钮
    → 弹 ConfigEditModal（key 不可改，value + reason 可改）
    → 用户编辑 value（textarea 实时 validate JSON）
    → 输 reason
    → 点 [保存]
    → validate JSON + reason length
    → onSave(key, value, reason)
    → updateConfig(key, value, reason)
    → PUT /v1/admin/config/:key { value, reason }
    → backend config.set(adminUserId, key, value)
    → UPSERT config table
    → adminLog.insert({ action: 'update_config', target_type: 'config', target_id: key, details: { value } })
    → 响应
    → Modal 关闭
    → Toast「已保存」
    → 列表刷新（show 新 value）
```

### 5.2 新建 key

```
[1] SettingsPage [+ New Key] 按钮
    → 弹 ConfigEditModal（key 可编辑）
    → 用户填 key（lowercase.dotted 格式 validate）
    → 填 value（JSON validate）
    → 输 reason
    → 点 [保存]
    → onSave(key, value, reason)
    → updateConfig(key, value, reason)
    → 同上（含 audit）
```

### 5.3 Audit 联动

- `config.set()` 每次写 `admin_action_log`（action='update_config'）
- target_id = key（如 'platform_fee_pct'）
- details_json = JSON.stringify({ value })

可在 AuditPage Admin Actions tab 查所有 config 变更。

### 5.4 失败链路

| 场景 | 表现 |
|------|------|
| key 格式错 | Modal 内联红字 |
| value 不是 JSON | Modal 内联红字 |
| reason < 3 | Modal 内联红字 |
| 401 | 跳 login |
| 后端 400/500 | Modal 显示后端 message |

---

## 6. 测试策略

### 6.1 覆盖目标

| 层 | 范围 | 数量 |
|----|------|------|
| 后端 config handler | list + set + 边界（key 格式/value JSON） | 6 |
| 后端 route | GET + PUT + 401/400 | 4 |
| 前端 API wrapper | listConfig + updateConfig + 边界 | 3 |
| 前端 ConfigEditModal | render + save 流程 + 错误显示 | 3 |
| 前端 SettingsPage | mount 调 listConfig + 弹 Modal + 编辑流程 | 4 |
| **新增总计** | | **~20** |

回归目标：196 + 20 = **216 admin-web 测试**。Backend: 956 + 10 ≈ **966**。

### 6.2 不做

- ❌ E2E
- ❌ 视觉回归
- ❌ 启动时数据迁移测试（手动验证即可）

---

## 7. 验收标准（DoD）

1. ✅ 1 migration（v024 config 表）— 启动时从 JSON 文件导入
2. ✅ handler DB-backed + 即时生效
3. ✅ write 写 audit（action='update_config'）
4. ✅ PUT key 加 reason 必填（与 adjust-quota 同样模式）
5. ✅ SettingsPage 单 tab（Config）
6. ✅ ConfigEditModal（key + value JSON + reason）
7. ✅ ~20 新测试通过
8. ✅ 全 typecheck 干净
9. ✅ 手测 4 步
10. ✅ CHANGELOG v2.7.0

---

## 8. 手测 4 步

```bash
cd D:/dev/hunter-platform && npm run dev
cd D:/dev/hunter-platform/admin-web && npm run dev
```

| # | 操作 | 期望 |
|---|------|------|
| 1 | 侧栏「Settings」→ 看到现有 config keys（desensitization + commission + 任何之前的） | 列表渲染 |
| 2 | 编辑某 key → 弹 Modal → 改 value → 输 reason → 保存 | Toast「已保存」+ 列表更新 |
| 3 | [+ New Key] → 填 `test.value`（lowercase.dotted）+ 合法 JSON value + reason → 保存 | 新 key 出现 |
| 4 | 审计页 → Admin Actions tab | 看到 2 条 update_config 记录（含 key + new value） |

---

## 9. 部署 / 回滚

### 部署
- 后端：1 migration（v024）自动跑。重启服务。文件 fallback 一次性导入。
- 前端：`npm run build` + nginx reload。

### 回滚
- 后端：revert commit。revert migration（v024 schema 留 DB — DROP TABLE config 如需完整回滚）。恢复文件读写（fallback 路径仍在）。
- 前端：revert + rebuild。

---

## 10. 工作量

| 阶段 | 估时 |
|------|------|
| 后端（migration + handler 重构 + audit + route 改 + tests） | 2-3 小时 |
| 前端（1 page + ConfigEditModal + api wrapper + tests） | 2-3 小时 |
| 手测 + 修小问题 | 1 小时 |
| **总计** | **~5-6 小时** |

---

## 11. 后续

| Sub | 内容 | 预计 |
|-----|------|------|
| Sub-F | Rate-Limit write endpoint（按需）+ UI | v2.7.1 |
| Sub-G | Webhook subscriptions（user.agent_endpoint 模式，如需多端点） | v2.8 |
| i18n / in-site notifications / v2-self-upload | 已有 spec backlog | 后续 |

---

**Spec 结束。** 配套 implementation plan 见 `docs/superpowers/plans/2026-06-25-web-admin-sub-E-plan.md`（待 writing-plans skill 输出）。