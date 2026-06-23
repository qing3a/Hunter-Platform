# Hunter Platform — `GET /v1/admin/action-history` Admin 端点 Design

> **For agentic workers:** 这是 design spec，配套 implementation plan 在 `docs/superpowers/plans/2026-06-23-admin-action-history-endpoint-plan.md`。
> 续接 [2026-06-18-action-history-and-industry-map-design.md](2026-06-18-action-history-and-industry-map-design.md) — 中间件和数据已落地，本 spec 只补 admin 读取端点。

**Goal:** 新建 `GET /v1/admin/action-history` HTTP 端点，让管理员能查询 `action_history` 表的全量业务审计数据（中间件已写入 6/22 至今）。现有 `/v1/admin/audit` 保持不变（继续读 `unlock_audit_log`，4 步解锁流水）。

**Architecture:** 复用现有 `action-history` repo 加 `list(filter)` + `count(filter)` 方法，新建 `modules/admin/handlers/action-history.ts`，在 `routes/admin.ts` 加一条 GET 路由，schema 走 zod strict 验证。

**Tech Stack:** Express 4.21, better-sqlite3（已用）, zod（已用）, supertest + vitest（已用）

---

## 1. 背景与动机

### 1.1 当前问题

| 现状 | 影响 |
|------|------|
| `action_history` 表里有数据（中间件从 2026-06-22 挂载起持续写） | 数据已可读 |
| 现有 `/v1/admin/audit` 读 `unlock_audit_log` 表（5 种 unlock 事件） | 看不到 30 种业务操作（upload_candidate/recommend/create_job/express_interest/...） |
| 管理员登录后台看到"审计日志空白" | 误以为审计未工作；排查问题无工具 |

### 1.2 修复后效果

| 端点 | 读 | 用途 |
|------|------|------|
| `GET /v1/admin/audit`（保留） | `unlock_audit_log` | 4 步解锁流水（recommendation 维度） |
| `GET /v1/admin/action-history`（新建） | `action_history` | 全量业务操作审计（user + capability 维度） |

### 1.3 设计原则

- **零回归**：不动现有 `/v1/admin/audit` 端点和 schema
- **admin 字段完整**：admin 比 user 端多见 `response_summary_json` + `trace_id`（用户端刻意隐藏）
- **PII 强制安全**：复用中间件 `sanitizeSummary` 的 PII 拒绝保证，写时拒 PII、读时只剩脱敏数据
- **分页上限**：limit 上限 1000（与 `users.list` 风格一致），防 admin 端被脚本批量拉

---

## 2. API 契约

### 2.1 请求

```
GET /v1/admin/action-history
Authorization: Bearer <ADMIN_PASSWORD>

Query (全部可选):
  user_id          string         过滤某用户
  capability_name  string         过滤某能力（如 headhunter.upload_candidate）
  status           'success' | 'error'
  since            ISO 8601       created_at >= since
  until            ISO 8601       created_at <= until
  limit            int            默认 100，上限 1000
  offset           int            默认 0
```

### 2.2 响应

**200 OK**:
```json
{
  "ok": true,
  "data": [
    {
      "id": 12345,
      "user_id": "user_8a2f3b",
      "capability_name": "headhunter.upload_candidate",
      "target_type": "candidate",
      "target_id": "cand_anon_5f8e2a",
      "request_summary_json": "{\"field_count\":8,\"industry\":\"互联网\"}",
      "response_summary_json": "{\"anonymized_id\":\"cand_anon_5f8e2a\"}",
      "status": "success",
      "error_code": null,
      "duration_ms": 142,
      "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
      "created_at": "2026-06-22T18:23:45.123Z"
    }
  ],
  "pagination": {
    "total": 1234,
    "limit": 100,
    "offset": 0,
    "has_more": true
  }
}
```

**400 Bad Request**（参数校验失败）:
```json
{ "ok": false, "error": { "code": "INVALID_PARAMS", "message": "status must be \"success\" or \"error\"" } }
```

**401 Unauthorized**（admin bearer 缺失/错）:
```json
{ "ok": false, "error": { "code": "UNAUTHORIZED", "message": "..." } }
```

### 2.3 错误码

| 触发 | HTTP | 错误码 |
|------|------|--------|
| `status` 非 `success`/`error` | 400 | `INVALID_PARAMS` |
| `limit` < 1 或 > 1000 或非数字 | 400 | `INVALID_PARAMS` |
| `offset` < 0 或非数字 | 400 | `INVALID_PARAMS` |
| `since`/`until` 非合法 ISO 8601（DB 层抛错转 500） | 500 | `INTERNAL_ERROR` |
| 无 admin bearer | 401 | `UNAUTHORIZED` |
| admin bearer 错 | 401 | `UNAUTHORIZED` |

---

## 3. 数据访问

### 3.1 SQL 模板

```sql
-- 计数
SELECT COUNT(*) AS c FROM action_history
[WHERE user_id = ?]
[AND capability_name = ?]
[AND status = ?]
[AND created_at >= ?]
[AND created_at <= ?];

-- 列表（动态拼 WHERE）
SELECT * FROM action_history
[WHERE user_id = ?]
[AND capability_name = ?]
[AND status = ?]
[AND created_at >= ?]
[AND created_at <= ?]
ORDER BY created_at DESC
LIMIT ? OFFSET ?;
```

### 3.2 索引复用

- `idx_action_history_user(user_id, created_at)` — v001 — 覆盖 `user_id` 过滤 + 排序
- `idx_action_history_capability(capability_name, created_at)` — v013 — 覆盖 `capability_name` 过滤 + 排序
- `idx_action_history_trace_id(trace_id)` — v011 — admin 用 trace_id 关联 OTel spans
- `status` / `since` / `until` 单过滤走 created_at seqscan，但 result 集小（10K 级）

### 3.3 性能预算

| 场景 | 预期 |
|------|------|
| 10K 行 / 单 user_id 过滤 | p99 < 50ms（走 user_id 索引） |
| 10K 行 / capability_name 过滤 | p99 < 50ms（走 capability 索引） |
| 10K 行 / 全表 | p99 < 200ms（COUNT + SELECT 各一次） |
| 100K 行 | 评估 cursor 分页（v2 考虑） |

---

## 4. 字段差异：Admin 版 vs User 版

| 字段 | `/v1/users/:id/history` (user) | `/v1/admin/action-history` (admin) | 原因 |
|------|-------|-------|------|
| `id` | ✅ | ✅ | — |
| `user_id` | ❌ (隐式从 URL) | ✅ | admin 跨用户查询需要 |
| `capability_name` | ✅ | ✅ | — |
| `target_type` | ✅ | ✅ | — |
| `target_id` | ✅ | ✅ | — |
| `request_summary_json` | ✅ | ✅ | — |
| `response_summary_json` | ❌ | ✅ | admin 调试需要 |
| `status` | ✅ | ✅ | — |
| `error_code` | ✅ | ✅ | — |
| `duration_ms` | ✅ | ✅ | — |
| `trace_id` | ❌ | ✅ | admin OTel 关联 |
| `created_at` | ✅ | ✅ | — |

`users.ts` 的 `ActionHistoryItemSchema` 是 user 视图，**不**直接复用（缺 3 个字段且 user_id 语义不同）。Admin 端新建独立 schema。

---

## 5. 文件改动清单

| 路径 | 类型 | 改动 |
|------|------|------|
| `src/main/schemas/admin.ts` | 改 | 新增 `AdminActionHistoryItemSchema` + `ActionHistoryListResponseSchema` |
| `src/main/db/repositories/action-history.ts` | 改 | 新增 `list(filter)` + `count(filter)` 方法（动态 WHERE） |
| `src/main/modules/admin/handlers/action-history.ts` | 新建 | `createAdminActionHistoryHandler` 工厂 |
| `src/main/routes/admin.ts` | 改 | import 新 handler + 加 1 条 GET 路由 |
| `tests/integration/admin-action-history.test.ts` | 新建 | 9 个集成测试用例 |
| `docs/superpowers/skill.md` | 改 | §X Admin API 表格新增 1 行 |
| `docs/superpowers/openapi.json` | 改 | 跑 `pnpm openapi:generate` 自动更新 |

**未改动**：
- `src/main/server.ts`（路由在 `routes/admin.ts` 已挂在 `/v1/admin` 前缀下，自动继承 admin auth 中间件）
- `src/main/modules/audit/action-history-middleware.ts`（写入端已 OK）
- `action_history` 表 schema（v013 已定型）

---

## 6. 关键代码骨架

### 6.1 `repositories/action-history.ts` 新增

```ts
type ListFilter = {
  user_id?: string;
  capability_name?: string;
  status?: 'success' | 'error';
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
};

function buildWhere(filter: ListFilter): { sql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.user_id)         { where.push('user_id = ?');         params.push(filter.user_id); }
  if (filter.capability_name) { where.push('capability_name = ?'); params.push(filter.capability_name); }
  if (filter.status)          { where.push('status = ?');          params.push(filter.status); }
  if (filter.since)           { where.push('created_at >= ?');     params.push(filter.since); }
  if (filter.until)           { where.push('created_at <= ?');     params.push(filter.until); }
  return { sql: where.length ? ' WHERE ' + where.join(' AND ') : '', params };
}

return {
  // ... 保留 listByUser, listByUserSince, countByUser, insert
  list(filter: ListFilter): { rows: ActionHistoryEntry[]; total: number } {
    const { sql: whereSql, params } = buildWhere(filter);
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;
    const total = (db.prepare(`SELECT COUNT(*) AS c FROM action_history${whereSql}`)
      .get(...params) as { c: number }).c;
    const rows = db.prepare(
      `SELECT * FROM action_history${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as unknown as ActionHistoryEntry[];
    return { rows, total };
  },
};
```

### 6.2 `modules/admin/handlers/action-history.ts` 新建

```ts
import type { DB } from '../../../db/connection.js';
import { createActionHistoryRepo } from '../../../db/repositories/action-history.js';

export function createAdminActionHistoryHandler(db: DB) {
  const repo = createActionHistoryRepo(db);
  return {
    list(filter: {
      user_id?: string;
      capability_name?: string;
      status?: 'success' | 'error';
      since?: string;
      until?: string;
      limit?: number;
      offset?: number;
    }): { rows: ReturnType<typeof repo.list>['rows']; total: number } {
      return repo.list(filter);
    },
  };
}
```

### 6.3 `schemas/admin.ts` 新增

```ts
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

const PaginationSchema = z.object({
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
  has_more: z.boolean(),
});

export const ActionHistoryListResponseSchema = EnvelopeSchema(
  z.object({
    data: z.array(AdminActionHistoryItemSchema),
    pagination: PaginationSchema,
  }),
);
```

### 6.4 `routes/admin.ts` 新增路由

```ts
import { createAdminActionHistoryHandler } from '../modules/admin/handlers/action-history.js';
// ...
const actionHistory = createAdminActionHistoryHandler(db);

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
      limit, offset,
    });
    respond(res, ActionHistoryListResponseSchema, {
      ok: true,
      data: rows,
      pagination: { total, limit, offset, has_more: offset + rows.length < total },
    }, { strict: true });
  } catch (e) { next(e); }
});
```

---

## 7. 测试策略

### 7.1 集成测试（9 个用例）

`tests/integration/admin-action-history.test.ts`：

| # | 场景 | 期望 |
|---|------|------|
| 1 | 无 bearer | 401 |
| 2 | 错密码 | 401 |
| 3 | 空过滤 | 200, data 包含全部已写入行, total = 已写入数 |
| 4 | `?user_id=user_xxx` | 200, data 只含该 user 行 |
| 5 | `?capability_name=headhunter.upload_candidate` | 200, data 只含该 capability 行 |
| 6 | `?status=error` | 200, data 只含 status=error 行 |
| 7 | `?since=...&until=...` | 200, data 只含时间范围内行 |
| 8 | 分页：`?limit=10&offset=0` + 后续 `?offset=10` | 200, has_more 正确, total 正确 |
| 9 | `?status=foo` 或 `?limit=2000` | 400, INVALID_PARAMS |

### 7.2 PII 防护回归测试

在 `tests/integration/action-history-middleware.test.ts` 中加 1 个 case：
- 写一个请求 body 包含 `name` 字段 → 中间件 sanitize 抛错 → 跳过该行写入

### 7.3 既有测试

- `tests/integration/admin-endpoints.test.ts` — 不变
- `tests/integration/skill-md-conformance/admin-coverage.test.ts` — 不变（它已覆盖 `/v1/admin/audit`，不动）
- 既有 200+ 测试 — 0 回归

---

## 8. 文档

### 8.1 `docs/superpowers/skill.md` 改动

在 §X Admin API 表格中新增 1 行：

```markdown
| GET    | `/v1/admin/action-history` | 业务操作审计（?user_id&capability_name&status&since&until&limit&offset） |
```

### 8.2 `docs/superpowers/openapi.json` 改动

跑 `pnpm openapi:generate` 自动生成新端点；`pnpm openapi:check` 验证 diff。

---

## 9. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| PII 泄漏到 admin 端 | 低 | 高 | 中间件 `sanitizeSummary` 写时 throw，admin 只能读到已脱敏数据；新增 PII 防护回归测试 |
| Admin 端被脚本批量拉 | 低 | 中 | 限流不在本任务范围（admin bearer 本身是 trusted operator），靠 limit ≤ 1000 兜底 |
| 全表扫描性能差 | 中 | 低 | 现有索引覆盖主查询路径；status/since/until 单过滤走 seqscan 但 result 集小 |
| since/until 非法 ISO 8601 | 低 | 低 | better-sqlite3 prepare 阶段就抛错，被全局 error handler 转 500 |
| count(*) 在大表慢 | 低 | 低 | 10K 行 1ms 内；规模扩大再上 cursor 分页 |

---

## 10. 不在范围内（YAGNI）

- **Cursor 分页**（v2，规模 100K+ 行再考虑）
- **按 `target_id` 过滤**（admin 主要按 user/capability 查；target_id 已知场景直接 SQL）
- **CSV/Excel 导出**（admin 当前用 curl 拿 JSON 够用）
- **多 admin 分权**（admin 端目前是单密码，详见 task #3 设计）
- **实时订阅**（admin 不需要 SSE；查询按需拉）
- **`request_summary_json` 字段展开为结构化列**（保持 JSON 字符串，降低 schema 复杂度）

---

## 11. 验收清单

- [ ] `GET /v1/admin/action-history` 端点已加并通过 schema 严格校验
- [ ] 9 个集成测试全过
- [ ] PII 防护回归测试通过
- [ ] `pnpm typecheck` 无错
- [ ] `pnpm test` 全套通过（既有 200+ 测试 0 回归）
- [ ] `pnpm openapi:check` 通过
- [ ] `skill.md` 表格已加新行
- [ ] 本地 curl 验证：
  - `curl -H "Authorization: Bearer $ADMIN_PASSWORD" http://localhost:3000/v1/admin/action-history | jq .` 返回真实数据
  - `curl http://localhost:3000/v1/admin/action-history` 返回 401
  - `curl -H "Authorization: Bearer wrong" http://localhost:3000/v1/admin/action-history` 返回 401
  - `curl -H "Authorization: Bearer $ADMIN_PASSWORD" "http://localhost:3000/v1/admin/action-history?status=foo"` 返回 400
- [ ] 部署到生产后 `curl https://api.hunter-platform.com/v1/admin/action-history?user_id=user_xxx -H "Authorization: Bearer $ADMIN_PASSWORD" | jq .` 返回该用户历史

---

## 12. 上线检查清单

1. 代码合入 `main` 分支
2. CI 全过
3. 部署到生产（`pnpm build && pnpm start` + nginx reload）
4. curl 验证新端点
5. （可选）发 release note v1.x.y — "admin can now query full action_history via GET /v1/admin/action-history"

---

## 参考

- [2026-06-18-action-history-and-industry-map-design.md](2026-06-18-action-history-and-industry-map-design.md) — 中间件 + INDUSTRY_MAP 设计（本 spec 的前作）
- [2026-06-20-ipc-to-http-admin.md plan](../plans/2026-06-20-ipc-to-http-admin.md) — IPC → HTTP admin 迁移（本 spec 沿用其 admin 鉴权 + 路由结构）
- [2026-06-17-hunter-platform-design.md](2026-06-17-hunter-platform-design.md) §3.1 action_history 表定义
