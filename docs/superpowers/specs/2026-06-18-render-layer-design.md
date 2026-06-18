# Hunter Platform — Render Layer Design

**状态**: Draft
**日期**: 2026-06-18
**作者**: brainstorming session
**前置文档**: [2026-06-17-hunter-platform-design.md](./2026-06-17-hunter-platform-design.md), [2026-06-18-reposition-to-api-first-design.md](./2026-06-18-reposition-to-api-first-design.md)

---

## 1. 概述

### 1.1 一句话定义

为 Hunter Platform API 配套一个**只读视图层（Render Layer）**：4 个 SSR HTML 页面 + 一次性访问令牌机制。外部 Agent（任何能调 API 的程序）在 API 响应里收到一个 `view_url`，终端用户点击该 URL 即可在浏览器看到格式化、可读性强的视图（候选人画像 / 推荐状态时间线 / 用户配额 / 审计日志）。

### 1.2 触发原因

完成 2026-06-18 reposition spec 后，Hunter Platform 是纯 HTTP API。Agent 调用后只能拿到 JSON，对终端用户不友好。需要一种"JSON → 人类可读视图"的轻量机制，避免：
- 开发完整 Web 前端（候选人/猎头/雇主三角色的全功能 UI，工作量 3-6 个月）
- 改造现有 Electron Admin UI（`src/renderer/`，与 node:sqlite bug 耦合）
- 让 Agent 自己渲染 HTML（违反"职责分离"，且无法持久化）

### 1.3 目标（Goals）

1. Agent 调用任意业务 API，响应自动包含 `view_url`（当对应资源有视图时）
2. 终端用户点 `view_url`，浏览器看到无 JS 依赖的纯 HTML（最快首屏、无需登录、SSR）
3. view URL 是**一次性 + 1 小时过期**，安全性等同"短时签名链接"
4. 4 个核心视图覆盖"看了就懂"的场景：候选人画像、推荐状态时间线、用户配额、审计日志

### 1.4 非目标（Non-Goals）

- 不做用户登录 / session / cookie（视图无状态）
- 不做交互式 UI（无表单提交、无筛选、无排序——这些走 API）
- 不做完整 Web 应用（仅 4 个 read-only 视图）
- 不动 `src/renderer/`（继续冻结，与本设计零关系）
- 不引入新依赖（零 npm install）
- 不做 i18n（v1 仅简体中文）
- 不做 `view_token_audit` 表（v1 不记录谁点了链接）

### 1.5 与既有 spec 的关系

- 业务 API 行为完全继承 [2026-06-17-hunter-platform-design.md](./2026-06-17-hunter-platform-design.md)
- 部署形态继承 [2026-06-18-reposition-to-api-first-design.md](./2026-06-18-reposition-to-api-first-design.md)（API-only + Electron 冻结）
- 本 spec 仅新增"视图层 + view_url 注入"，不修改任何业务 endpoint 的语义

---

## 2. 架构总览

```
┌────────────────────────────────────────────────────────────┐
│  External Agent (任何 HTTP 客户端)                          │
└────────────┬───────────────────────────────────────────────┘
             │ POST /v1/headhunter/candidates (Bearer api_key)
             ↓
┌────────────────────────────────────────────────────────────┐
│  Hunter Platform API Server (Express, port 3000)            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ 现有路由层 (auth / candidate / employer / headhunter) │ │
│  │  ↓                                                  │ │
│  │ response → viewUrlInjectorMiddleware                │ │
│  │  ├─ 查 ROUTE_VIEW_MAP[method+path]                  │ │
│  │  ├─ 调 view.generateViewUrl(env, user, type, id)    │ │
│  │  └─ 注入 data.view_url 字段                         │ │
│  └──────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ 新增视图路由 (4 个 GET /view/*)                       │ │
│  │  ├─ viewHandler.* :  validateAndConsume(token)      │ │
│  │  ├─ 读 DB                                           │ │
│  │  ├─ templates.*.render(data)                        │ │
│  │  └─ res.type('text/html').send(html)                 │ │
│  └──────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
             ↓
        view_tokens table (一次性 token, 1h 过期)
        candidates / recommendations / users / action_history
```

**关键设计**：视图层与 API 层共享 Express 进程，共享 SQLite，共享 env——无新进程、无新端口、无新连接。

---

## 3. 数据模型

### 3.1 新增表（v004 migration）

```sql
-- src/main/db/migrations/v004_view_tokens.sql

CREATE TABLE view_tokens (
  token         TEXT PRIMARY KEY,        -- 64-char hex (crypto.randomBytes(32))
  user_id       TEXT NOT NULL,           -- 生成 token 的 user（用于审计/限流/未来）
  view_type     TEXT NOT NULL,           -- 'candidate' | 'recommendation' | 'user-quota' | 'audit'
  view_id       TEXT NOT NULL,           -- 资源 ID（candidate_id / rec_id / user_id）
  expires_at    TEXT NOT NULL,           -- ISO 8601, = created_at + 1h
  consumed_at   TEXT,                    -- 首次访问时间戳；NULL = 未消耗
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_view_tokens_user ON view_tokens(user_id, created_at);
```

**字段说明**：
- `consumed_at` 是 token 一次性消耗的标记。首次成功访问 view 时设置。
- `expires_at` 在创建时硬编码为 `created_at + 1 hour`。v1 不支持自定义过期时间。
- 未来清理任务可以挂在 cron 上：`DELETE FROM view_tokens WHERE expires_at < datetime('now')`（不在 v1 spec 范围）。

### 3.2 现有表 — 无变化

本设计**不修改**任何已有 schema，只新增 `view_tokens` 表。

---

## 4. 文件级设计

### 4.1 新增文件清单

```
src/main/
├── modules/view/                          # 新模块
│   ├── route-view-map.ts                  # 配置：endpoint → view 类型
│   ├── view-token-repo.ts                 # DB CRUD
│   ├── generate.ts                        # 生成 token + URL
│   ├── validate.ts                        # 校验 token + 标记消耗
│   ├── handler.ts                         # 4 个 GET handler
│   └── templates/                         # SSR HTML 模板
│       ├── shared-css.ts                  # 共享 CSS 字符串
│       ├── candidate.ts                   # 候选人脱敏画像
│       ├── recommendation.ts              # 推荐状态时间线
│       ├── user-quota.ts                  # 用户配额面板
│       ├── audit.ts                       # 审计日志
│       └── error.ts                       # 4 种错误页通用模板
│
├── db/
│   ├── migrations/
│   │   └── v004_view_tokens.sql           # 新增
│   └── repositories/
│       └── view-token.ts                  # 新增（与其它 repo 同模式）

src/main/server.ts                          # MODIFY：注册 view 路由 + view_url 注入中间件

tests/
├── unit/view/
│   ├── route-view-map.test.ts
│   ├── view-token-repo.test.ts
│   ├── generate-validate.test.ts
│   ├── handler.test.ts                    # 错误路径覆盖
│   └── templates.test.ts                  # snapshot
└── integration/
    ├── view-endpoint.test.ts              # 完整 4 个 view URL
    ├── view-url-injection.test.ts         # API 响应自动注入
    └── token-atomicity.test.ts            # 并发 token 消耗
```

### 4.2 各文件责任

| 文件 | 责任 | 大小（约） |
|------|------|----------|
| `route-view-map.ts` | 纯配置表：哪些 endpoint 触发哪种 view，view_id 从响应/参数的哪个字段取。零逻辑。 | 30 行 |
| `view-token-repo.ts` | DB 操作：`create()`、`findValid()`、`markConsumed()`（原子）。零业务逻辑。 | 80 行 |
| `generate.ts` | 业务：`generateViewUrl(env, userId, viewType, viewId)` → 调 repo，组装 URL。 | 30 行 |
| `validate.ts` | 业务：`validateAndConsume(token, viewType)` → 调 repo，返回 `{ ok, reason, resourceId, userId }`。 | 40 行 |
| `handler.ts` | 4 个 express handler，每个 ~30 行。包含 1 个 error page handler。 | 200 行 |
| `templates/candidate.ts` | `render(candidate): string` — 脱敏画像 HTML | 80 行 |
| `templates/recommendation.ts` | `render(rec, history): string` — 状态机时间线 HTML | 100 行 |
| `templates/user-quota.ts` | `render(user, recentActions): string` — 配额 + 限流 HTML | 70 行 |
| `templates/audit.ts` | `render(actions): string` — 审计时间线 HTML | 80 行 |
| `templates/error.ts` | `render({title, message, icon}): string` — 4 种错误页通用模板 | 30 行 |
| `templates/shared-css.ts` | 字符串常量：纯 CSS（无外部依赖） | 150 行 |
| **代码合计** | | **~890 行** |

### 4.3 route-view-map.ts 内容示例

```typescript
export type ViewType = 'candidate' | 'recommendation' | 'user-quota' | 'audit';

export interface ViewMapping {
  type: ViewType;
  /** JSONPath 表达式，从 response body 提取 view_id（生成 token 用） */
  idFrom: string;
  /** JSONPath 表达式，从 request 提取 view_id（GET 路由的 fallback） */
  idFromReq?: string;
}

export const ROUTE_VIEW_MAP: Record<string, ViewMapping> = {
  // 写后返回视图（candidate / recommendation 资源）
  'POST /v1/headhunter/candidates':       { type: 'candidate',      idFrom: 'data.anonymized_id' },
  'POST /v1/headhunter/recommendations':  { type: 'recommendation', idFrom: 'data.recommendation_id' },
  'POST /v1/candidate/recommendations/{id}/approve-unlock':  { type: 'recommendation', idFrom: 'data.recommendation_id' },
  'POST /v1/candidate/recommendations/{id}/reject-unlock':   { type: 'recommendation', idFrom: 'data.recommendation_id' },
  'POST /v1/employer/recommendations/{id}/express-interest': { type: 'recommendation', idFrom: 'data.recommendation_id' },
  'POST /v1/employer/recommendations/{id}/unlock-contact':   { type: 'recommendation', idFrom: 'data.recommendation_id' },

  // 读即返回视图
  'GET /v1/users/{id}/status':            { type: 'user-quota', idFrom: 'params.id' },
  'GET /v1/users/{id}/history':           { type: 'audit',     idFrom: 'params.id' },
};
```

注：v1 共映射 8 个 endpoint。`POST /v1/employer/jobs` 等不映射（jobs 在 v1 没有专门的视图）。未来需要可加。

---

## 5. 数据流

### 5.1 流向 A：API 调用 → 响应含 view_url

```
1. Agent → POST /v1/headhunter/candidates (Bearer api_key)
       ↓
2. authMiddleware 注入 req.user
       ↓
3. handler.createCandidate() 写 DB，返回 { data: { anonymized_id, ... } }
       ↓
4. viewUrlInjectorMiddleware (注册在 authMiddleware 之后、所有 router 之前)
       ├─ 拼 method + req.route.path → 'POST /v1/headhunter/candidates'
       ├─ 查 ROUTE_VIEW_MAP[route]
       ├─ 若无 → next()，不注入
       ├─ 若有 → 用 jsonpath 从 res.body.data 取 view_id
       │       ↓
       │    generate.generateViewUrl(env, req.user.id, type, viewId)
       │       ├─ token = crypto.randomBytes(32).toString('hex')
       │       ├─ expires_at = new Date(Date.now() + 3600_000).toISOString()
       │       ├─ repo.create(token, userId, type, viewId, expires_at)
       │       └─ 返回 `${BASE_URL}/view/${type}/${viewId}?t=${token}`
       │
       └─ res.body.data.view_url = url（若 res.body.data 存在且 res.statusCode < 400）
       ↓
5. Agent 收到 JSON: { data: { anonymized_id: "cand_xxx", view_url: "..." } }
       ↓
6. Agent 把 view_url 文本回复给终端用户
```

### 5.2 流向 B：view URL 访问 → HTML

```
1. 浏览器 → GET /view/candidate/cand_xxx?t=64-hex
       ↓
2. viewHandler.candidateGET(req, res)
       ├─ token = req.query.t
       ├─ 若无 token → return error.render(res, 400, ...)
       ├─ validate.validateAndConsume(token, 'candidate')
       │     ├─ repo.findValid(token) → SELECT ... WHERE token=? AND consumed_at IS NULL AND expires_at > now
       │     ├─ 若 row 为空 → return { ok: false, reason: 'invalid' | 'expired' | 'consumed' }
       │     ├─ 若 view_type !== 'candidate' → return { ok: false, reason: 'type_mismatch' }
       │     ├─ repo.markConsumed(token, now) → UPDATE ... WHERE consumed_at IS NULL
       │     │       （此 UPDATE 影响行数 = 1 才是真"赢"了；race condition 时影响 0 行）
       │     └─ return { ok: true, resourceId: row.view_id, userId: row.user_id }
       ├─ 若 !ok → error.render(res, 410 | 404, ...)
       ├─ DB 读 candidates JOIN candidates_private（应用 desensitize）→ desensitizedCandidate
       ├─ templates.candidate.render(desensitizedCandidate)
       └─ res.set('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(html)
       ↓
3. 浏览器渲染
```

### 5.3 关键不变量（测试要断言）

1. token 唯一性：`crypto.randomBytes(32).toString('hex')` = 64 字符 hex
2. 过期时间：`created_at + 3600s`（hardcoded 1 小时）
3. 消耗原子性：`findValid + markConsumed` 在同一 SQLite 事务（`db.transaction()`）
4. 跨 view_type 不互通：handler 验证 `view_type` 匹配
5. API 失败响应不带 view_url：仅 `res.statusCode < 400 && res.body.data` 时注入
6. view 路由不返回 JSON：除 5xx 外永远返回 `text/html`

---

## 6. 错误处理

### 6.1 Token 校验失败（4 种情况）

| 触发 | HTTP | 页面内容 |
|------|------|---------|
| token 不存在 | **410 Gone** | "🔗 链接无效或已过期。请重新发起请求以获取新链接。" |
| token 已过期（expires_at < now） | **410 Gone** | 同上 |
| token 已消耗（consumed_at IS NOT NULL） | **410 Gone** | "🔗 此链接已被使用（一次性链接）。如需再次查看，请重新发起请求。" |
| token view_type 与 URL 不匹配 | **404 Not Found** | "🔗 资源不存在或您无权访问。" |

### 6.2 资源问题

| 触发 | HTTP | 页面内容 |
|------|------|---------|
| token 通过但资源已被删除 | **404 Not Found** | "🔗 此资源已不存在。" |
| DB 临时错误 | **500** | "⚠️ 服务器临时无法访问，请稍后重试。" |

### 6.3 请求问题

| 触发 | HTTP | 页面内容 |
|------|------|---------|
| URL 路径格式错误 | **404** | Express 默认 |
| 缺少 `?t=` 参数 | **400** | "🔗 缺少访问令牌。" |

### 6.4 错误页实现

所有错误返回 HTML（不是 JSON），保持终端用户体验一致。

```typescript
// templates/error.ts
export function renderErrorPage(opts: {
  httpStatus: number;
  title: string;
  message: string;
  icon: string;
}): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${opts.title} — Hunter Platform</title>
  <style>${SHARED_CSS}</style>
</head>
<body>
  <main class="error">
    <h1>${opts.icon} ${opts.title}</h1>
    <p>${opts.message}</p>
    <p class="hint">如需帮助，请重新发起请求。</p>
  </main>
</body>
</html>`;
}
```

注意：错误页文案**不点名任何特定 Agent 工具**（如不出现 "Claude"）。

---

## 7. 测试策略

### 7.1 测试分层与数量

| 层 | 文件 | 覆盖 | 数量 |
|----|------|------|------|
| Unit | `view-token-repo.test.ts` | create / findValid / markConsumed / 过期判断 | 6 |
| Unit | `generate-validate.test.ts` | generate 形态 / validate 拒绝错/过期/已消耗 | 5 |
| Unit | `route-view-map.test.ts` | 配置完整性（route → view_type 对应真实 endpoint） | 3 |
| Unit | `handler.test.ts` | 各错误场景 → 正确 HTTP + HTML | 5 |
| Unit | `templates.test.ts` | snapshot：4 个 render 函数输出稳定 | 4 |
| Integration | `view-endpoint.test.ts` | 4 个 happy path + token 重用拒绝 | 5 |
| Integration | `view-url-injection.test.ts` | API 响应注入 / 错误不注入 / 未映射不注入 | 5 |
| Integration | `token-atomicity.test.ts` | 并发两个相同 token → 只有一个 200 | 1 |
| **合计** | | | **~34 it** |

### 7.2 关键测试用例

```typescript
// token-atomicity.test.ts
it('two concurrent requests with same token: exactly one succeeds', async () => {
  const { url } = await generateViewUrl(env, 'user_1', 'candidate', 'cand_1');
  const [r1, r2] = await Promise.all([request(app).get(url), request(app).get(url)]);
  const successes = [r1.status, r2.status].filter(s => s === 200).length;
  expect(successes).toBe(1);
});

// view-endpoint.test.ts
it('consumed token returns 410 Gone', async () => {
  const { url } = await generateViewUrl(env, 'user_1', 'candidate', 'cand_1');
  await request(app).get(url);  // first consumes
  const r2 = await request(app).get(url);
  expect(r2.status).toBe(410);
  expect(r2.text).toContain('此链接已被使用');
});

// view-url-injection.test.ts
it('POST /v1/headhunter/candidates success response includes view_url', async () => {
  const res = await request(app).post('/v1/headhunter/candidates')
    .set('Authorization', `Bearer ${key}`)
    .send({...});
  expect(res.body.data.view_url).toMatch(/^\/view\/candidate\/cand_\w+\?t=[a-f0-9]{64}$/);
});

it('401 error response does NOT include view_url', async () => {
  const res = await request(app).post('/v1/headhunter/candidates').send({...});
  expect(res.body.data?.view_url).toBeUndefined();
});

it('unmapped endpoint does NOT include view_url', async () => {
  const res = await request(app).get('/v1/config/industries')
    .set('Authorization', `Bearer ${key}`);
  expect(res.body.data?.view_url).toBeUndefined();
});
```

### 7.3 不测试

- HTML 视觉正确性（snapshot 即可，不做像素对比）
- CSS 跨浏览器兼容（v1 不支持老浏览器）
- 模板 i18n（v1 仅中文）

---

## 8. 配置与常量

### 8.1 BASE_URL

来源：环境变量 `BASE_URL`，默认 `http://localhost:3000`。

```typescript
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${env.PORT}`;
```

v1 不要求 HTTPS。生产部署时由运维设置 `BASE_URL=https://api.hunter-platform.com`。

### 8.2 Token 过期时间

```typescript
const TOKEN_TTL_MS = 60 * 60 * 1000;  // 1 小时
```

不作为环境变量（v1 写死）。

---

## 9. 实现路径（写作计划输入）

按以下顺序执行：

1. **T1**：创建 v004 migration + 跑 migrations 测试
2. **T2**：实现 `view-token-repo.ts` + 单元测试
3. **T3**：实现 `generate.ts` + `validate.ts` + 单元测试
4. **T4**：实现 `templates/`（5 个文件）+ snapshot 测试
5. **T5**：实现 `handler.ts` + 错误模板 + 单元测试
6. **T6**：实现 `route-view-map.ts` + server.ts 注册 view 路由 + view_url 注入中间件
7. **T7**：集成测试（view-endpoint / view-url-injection / token-atomicity）
8. **T8**：端到端 smoke test（API 调用 → view_url → curl 渲染 HTML）

预计代码 ~890 行 + 测试 ~600 行，1-2 周可完成。

---

## 10. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|-----|------|------|
| view_url 注入中间件破坏现有 API 响应 | 中 | 现有 API 行为变化 | 单元测试覆盖所有 401/403/404/409/500 响应不带 view_url |
| Token 一次性逻辑在并发下失效 | 低 | 安全漏洞 | 原子事务测试 + UPDATE 影响行数断言 |
| 模板渲染出错泄漏未脱敏数据 | 中 | 严重隐私问题 | snapshot 测试 + integration 测试断言只出现脱敏字段 |
| 现有 API 调用方不期望新 `view_url` 字段 | 低 | 兼容性问题 | 字段加在 `data` 嵌套内，老 client 忽略新字段不影响 |
| 4 个视图不足以覆盖所有 view 场景 | 低 | UX 不全 | 显式 ROUTE_VIEW_MAP 配置，未来按需加 |

---

## 11. 决策记录

| 决策 | 选择 | 备选 | 理由 |
|------|-----|------|------|
| 视图渲染方式 | **SSR HTML 字符串模板** | React SPA / EJS / HTMX | 零依赖、零构建、首屏最快、调试容易 |
| Token 存储 | **SQLite（新增 view_tokens 表）** | Redis / 内存 | 项目已用 SQLite，无新依赖 |
| Token 性质 | **一次性 + 1h 过期** | 多次可用 / 仅过期 | 安全性最高，1h 给 Agent 粘贴留余地 |
| view_url 注入位置 | **response 中间件 + 显式 route-view-map 配置** | 各 handler 手动添加 | DRY、易维护、配置驱动 |
| `view_token_audit` 表 | **v1 不做** | v1 就建表 | YAGNI，未来真要再加（不影响 schema） |
| Token 过期时间 | **写死 1 小时** | 环境变量 | v1 简单，未来需要再加 |
| 视图样式 | **inline `<style>` + 共享 CSS 字符串** | 外部 CSS 文件 | 单一 HTML 自包含，部署简单 |
| i18n | **v1 仅简体中文** | 多语言 | YAGNI |
| 与 src/renderer/ 关系 | **完全无关，继续冻结** | 重构 renderer | renderer 与 node:sqlite bug 耦合，独立处理 |

---

## 12. 未来工作（Out of Scope）

- `view_token_audit` 表（点击流审计）
- i18n（多语言）
- 视图交互（筛选、排序——这些走 API 即可）
- 完整 Web 应用（候选人/猎头/雇主登录后操作）
- WebSocket 实时状态推送（推荐状态变化主动推送）
- view_token 清理 cron job
- 视图缓存（同一资源多次生成 token）