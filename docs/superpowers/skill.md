---
name: hunter-platform
description: Use this skill when the user asks about job search, hiring, headhunters, candidates, recruitment, or talent matching. Connects to the Hunter Platform API for three personas: candidates (find opportunities, approve/reject unlock requests, export or delete their data), headhunters (upload anonymized candidates, recommend to jobs, withdraw, publish to public pool), and employers (post jobs, browse public talent, express interest, unlock contact, mark placements). Provides 46 REST endpoints with API key authentication (Bearer hp_live_xxx). Includes self-discovery via /v1/capabilities and OpenAPI spec at /v1/openapi.json. State machine for recommendations: pending → employer_interested → candidate_approved → unlocked → placed.
---

# 🎯 Hunter Platform — Agent Skill (v1)

> 任何外部 AI Agent 通过本文档即可对接 Hunter Platform。  
> 三角色（**候选人 / 猎头 / 雇主**）共享同一套 HTTP API，纯 API-only 模式，无桌面客户端。

---

## 📝 最近升级（按时间倒序）

### 2026-06-22 — Phase 4: Domain Capability Sets

每个 endpoint 的"业务能力"（含前置条件、配额、副作用）现在集中声明在 `src/main/capabilities/*.ts` 里，handler / OpenAPI / skill.md / 运行时 discovery endpoint 都从这一处派生。

- 46 capabilities 在 5 个文件里声明：`auth`（2）+ `headhunter`（8）+ `employer`（10）+ `candidate`（6）+ `admin`（20）。admin 全 quota_cost=0（IP 限流，不走每日配额）
- `GET /v1/capabilities`（公开）— 列出所有 capability 集（无配额信息）
- `GET /v1/capabilities/me`（需鉴权）— 返回当前用户每个能力的 `available` 状态 + 剩余配额
- 每个 endpoint 响应新增 `x-capability-name: <name>` header（由 `capabilityResolverMiddleware` 在 `respond()` 里 stamp）
- `pnpm capabilities:check` — CI 守门：路由与 capability 声明不一致（缺/多）就失败
- `pnpm capabilities:doc` — 重新生成"角色能力清单"段，自动检测幂等

每个 capability 声明包含: `name`、`description`、`method`、`path`、`response_schema`、`quota_cost`、`preconditions`、`effects`。这让 handler / OpenAPI / skill.md / discovery endpoint 都从同一处生成——新增 endpoint 时改一个文件就够。

### 2026-06-22 — Phase 2: OpenTelemetry + trace_id 串联

每个 HTTP 响应都带 `x-trace-id` header（32 字符 hex，W3C Trace ID 格式）。Agent 客户端应在报错日志里带上这个 ID，以便支持方直接定位到对应的 span / `action_history.trace_id` / webhook delivery。

- **响应头**: `x-trace-id: <32-hex>` — 每个 endpoint 都带（traceContextMiddleware 在 handler 运行前 setHeader）
- **入口 header**: 兼容 W3C `traceparent: 00-<traceId 32>-<spanId 16>-01` — 上游调用方可以延续
- **action_history**: 新增 `trace_id` 列（v011 migration），每次写都自动 stamp
- **Webhook 出口**: payload 携带 `traceparent` 字段，HTTP 头也带，让接收方 Agent 拼接跨系统时间线
- **dev 默认**: ConsoleSpanExporter (无需外部服务); prod 切换: 设 `OTEL_EXPORTER_OTLP_ENDPOINT=...` 即自动用 OTLP exporter
- **测试基线**: 600/600 通过 (117 test files)

实现细节:
- `src/main/telemetry.ts`: SDK init + `withSpan` / `withSpanSync` / `getTraceIdFromContext` / `getTraceparentFromContext` / `traceContextMiddleware`
- 7 个业务 handler 包了自定义 span: `headhunter.recommend` / `employer.claim` / `employer.reject` / `employer.unlock` / `employer.create_placement` / `candidate.approve_unlock` / `candidate.reject_unlock`

### 2026-06-22 — Post-Phase 1 Review 修复

针对 Phase 1 的 19 个 commit 做了一轮 code review，修复了：

- **[CRITICAL C1] 移除 auth middleware 死代码** — `prev_api_key_*` 字段是 v006/v007 引入的 24h grace 机制残留，Bug 1 修复（rotate-key 立即失效）后已不再使用，但代码里仍保留着查询分支。删除 SQL 里的 `OR (prev_api_key_*)` 子句和 `tryVerify` 里的 prev 分支，**任何未来 reversion 必须显式改 auth middleware**——schema-only flip 不会再无声激活 grace。tripwire 注释已写入文件。
- **[HIGH H2] makeStrict() 扩展递归** — 之前只递归 `ZodObject`/`ZodArray`，`ZodUnion` / `ZodDiscriminatedUnion` / `ZodOptional` / `ZodNullable` 不递归。strict mode 实际只在叶子 object 生效。补全 4 个 case。
- **[HIGH H3] schema-coverage test 去歧义** — regex 在字符串字面量里会误匹配。改为先 strip 注释和字符串再匹配。
- **[MEDIUM M2] JobSchema 去重** — 之前在 `schemas/headhunter.ts` 和 `schemas/employer.ts` 重复定义（仅 1 行差异），抽到 `schemas/common.ts`。
- **[MEDIUM M4] respond() 注释对齐实际行为** — 之前注释说"fall back to permissive send"但代码实际 throw。删了 `console.error`（被错误中间件重复 log）+ 改注释。

### 2026-06-21 — Phase 0 (Bug Fixes) + Phase 1 (Structured Output)

**Phase 0**: 修复了 7 个 AI 测试报告里的 bug

| Bug | 修复 |
|---|---|
| 1. rotate-key 不立即失效 | `rotateApiKey()` 单 SQL 原子写,旧 key 立即失效 (无 grace) |
| 2. claim-jobs 不改状态 | 加 `jobs.status='claimed'` 状态(v010 migration) |
| 3. reject-jobs 在已 claim 的 job 仍成功 | 状态机 `status != 'open'` → 409 INVALID_STATE |
| 4. delete-my-data DELETE/POST 不匹配 | openapi 同步到 POST |
| 5. views/audit GET 路由缺失 | 已存在(POST),doc 同步 |
| 6. admin/ping 无鉴权 | 移到 admin router,继承 `createAdminAuthMiddleware` |
| 7. export-my-data 泄露第三方 PII | 区分 self-submitted vs third-party,第三方 PII 脱敏 |

**Phase 1+4**: 全部 64 个 endpoint 走 zod 响应 schema (含 2 个 capability discovery endpoint)

- `respond(res, schema, payload, opts)` helper + 递归 `makeStrict()` 校验
- 强制 0 裸 `res.json` (schema-coverage test 守护)
- `EnvelopeSchema(dataSchema)` 统一 `{ ok: true, data: T }` 形状
- 测试基线: **595/595 通过 (116 test files)**

---

## 🔗 分布式追踪 (Phase 2) — 给 Agent 客户端的契约

> 这部分写给**对接 Hunter Platform 的外部 Agent**——你能从响应里拿到什么、应该怎么回报。

### 响应头

每个 HTTP 响应都带:

```
x-trace-id: 0af7651916cd43dd8448eb211c80319c
```

值是 32 字符小写 hex，符合 W3C Trace ID 格式。当你的 Agent 报错或上报问题时，**在日志里附上 `x-trace-id`**，Hunter Platform 侧能精确还原调用时间线（关联 `action_history.trace_id`、OTel span、webhook 投递记录）。

### 入口 header（可选）

如果你这边已经在用 OpenTelemetry / Jaeger / 自己的 trace 系统，可以在请求里带：

```
traceparent: 00-<你的 traceId 32 hex>-<你的 spanId 16 hex>-01
```

Hunter Platform 会延续你的 trace，让你的 span 和 Hunter 的 span 拼成一条时间线（取决于 W3C propagator 行为；当前实现是 best-effort，不会破坏你的请求）。

### Webhook payload

如果你是接收方（你接的是 webhook 而不是发起调用），Hunter 在投递 webhook 时会带：

```
traceparent: 00-<Hunter traceId>-<Hunter spanId>-01
```

你的 Agent 收到 webhook 时可以读这个 header，把这次 webhook 投递接到你端的 trace 里。

### 调试用法

- 拿到 `x-trace-id` → grep `action_history` 的 `trace_id` 列 → 看到这次请求引发的所有动作
- 拿到 `x-trace-id` → Jaeger/Tempo/Honeycomb UI 搜 → 看到完整 span tree（HTTP + 业务 span + DB span，如果有 auto-instrumentation 的话）

---

## 🔄 状态机 (Phase 3) — 给 Agent 客户端的契约

每个 domain 的状态机集中在 `src/main/flows/<domain>.ts` 一个文件:

- `recommendation.ts` — 8 状态 (pending → employer_interested → candidate_approved → unlocked → placed, 4 terminal)
- `job.ts` — 5 状态 (open → claimed | paused, claimed → filled, terminal: closed/filled)
- `user.ts` — 3 状态 (active → suspended → deleted)

每个 flow 声明:
- `states[from][event] = to` — 合法的状态转移
- `sideEffects['from->to']` — 转移时触发的副作用 (webhook / audit log)

Handler 通过 `applyTransition(flow, from, event, ctx)` 触发转移,返回 `{ next, sideEffect }`。
返回后 handler 自己负责: 写 DB 状态 + 派发 sideEffect (enqueue webhook 等)。
这样 state machine 是一处声明,handler 不会忘记更新 status 或漏发 webhook。

**已知 caveat**: `applyTransition` 抛 `TransitionError` 时,handler 需包成业务错误 (e.g. `Errors.invalidState`) 再抛 — flow 不知道 HTTP 错误码。

---

## 🧭 Capability Discovery (Phase 4)

外部 Agent 启动时建议先调用 `GET /v1/capabilities/me` 查自己的可用能力 + 剩余配额:

```
GET /v1/capabilities           # 公开, 列出所有 role 的所有 capability
GET /v1/capabilities/me        # 鉴权, 返回当前用户的可用 capability + 剩余配额
```

返回的每个 capability 包含: `name`, `method`, `path`, `quota_cost`, `preconditions`, `effects`, `description`。`available: false` 时说明当前不可调用(配额耗尽或前置条件不满足)。

所有 endpoint 的响应也带 `x-capability-name` 响应头,日志里 grep 即可知道调用的是哪个 capability。

`pnpm conformance:check` 在 CI 守门:每个 capability 必须有 scenario test,缺失时构建失败。

---

## 📖 0. 业务模型（先读这一节）

### 0.1 价值流

```
候选人 (PII 加密) ──上传──▶ 猎头 ──推荐──▶ 雇主 ──表达兴趣──▶ 候选人 ──授权──▶ 平台解密 PII ──▶ 雇主
     │                       │              │                                      
     └──▶ 平台抽佣 20%（成功入职后）◀───────┘                                      
```

### 0.2 三角色职责

| 角色 | 做什么 | 调用入口 |
|------|-------|---------|
| **候选人 (candidate)** | 注册；提供简历（脱敏入库）；授权解锁；GDPR 撤回 | `POST /v1/auth/register` → `Bearer hp_live_...` → `/v1/candidate/*` |
| **猎头 (headhunter)** | 上传候选人；推荐给雇主；撤回/公开到池子 | `POST /v1/auth/register` → `Bearer hp_live_...` → `/v1/headhunter/*` |
| **雇主 (employer)** | 发 JD；浏览脱敏人才；表达兴趣；解锁联系方式；创建入职 | `POST /v1/auth/register` → `Bearer hp_live_...` → `/v1/employer/*` |

### 0.3 4 步解锁协议（最关键的业务流程）

```
[1] 猎头 POST /v1/headhunter/recommendations        → status = pending
                          ↓
[2] 雇主 POST /v1/employer/recommendations/{id}/express-interest
                          ↓                         → status = employer_interested
                          ↓
                    webhook → 候选人 agent
                          ↓
[3] 候选人 POST /v1/candidate/recommendations/{id}/approve-unlock
                          ↓                         → status = candidate_approved
                          ↓
[4] 雇主 POST /v1/employer/recommendations/{id}/unlock-contact
                          ↓                         → status = unlocked
                          ↓
                    平台解密 PII → webhook → 雇主
```

> ⚠️ **重要**：4 步必须按顺序；任何一步失败都会触发状态机非法转换（`409 INVALID_STATE`）。
>
> **回退示例**：
> - unlock 失败 → 候选人需重新 `POST /approve-unlock`，再走 employer `/unlock-contact`
> - 候选人 reject → 同一 `(候选人, job)` 对不能再次 recommend，换 job 或换候选人
> - employer 撤回了 express-interest → 同一 rec 需重新从 step 2 开始

### 0.4 平台对 PII 的处理

| 字段类型 | 入库方式 | API 暴露 |
|---------|---------|---------|
| `name` / `phone` / `email` | AES-256-GCM 加密（`v1:<iv||tag||ciphertext>`） | **永不返回**，仅解锁流程结束时通过 webhook 投递 |
| `current_company` / `current_title` / `education_school` | 明文 → 脱敏映射 | 仅返回 `industry` / `title_level` / `education_tier` |
| `expected_salary` / `years_experience` / `skills` | 明文 | 仅返回脱敏后版本（`salary_range`） |

> 💡 **跨猎头分账**：commission 不通过 placement body 传递，由推荐时的 `referrer_headhunter_id` + `commission_split` 自动计算（详见 §2.3）。

---

## 🔐 1. 认证

所有受保护端点都需要 `Authorization: Bearer <api_key>` header。

```bash
curl -H "Authorization: Bearer hp_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
     https://qing3.top/v1/users/{id}/status
```

> ⚠️ **API key 只在注册时返回一次**，丢失后只能 `POST /v1/auth/rotate-key` 轮换（v2 起可用）。

### 1.1 字段命名约定

| 字段含义 | 字段名 | 示例 |
|---------|-------|------|
| 资源自身 ID | `id` | `data.id` |
| 外键 | `<resource_type>_id` | `headhunter_id`, `job_id` |
| 多态外键 | `target_id` | history endpoint |
| **例外** | `anonymized_id` | 脱敏候选人 ID（保留语义，不再叫 `id`） |

---

## 🌐 2. 完整 API 端点

> 💡 **动态配置优先**：行业列表（12+ 类别）、职级正则、薪资带宽、市场排行 — 都通过 `GET /v1/config/*` 与 `/v1/market/*` 实时查询，**不要硬编码**。

### 2.1 通用

| Method | Path | 描述 | 配额 |
|--------|------|------|------|
| POST | `/v1/auth/register` | 注册（三角色之一） | 0 |
| POST | `/v1/auth/rotate-key` | 轮换 API key（旧 key **立即失效**，无 grace period）。响应字段：`data.new_api_key`（**不是** `api_key`） | 1 |
| GET  | `/v1/users/{id}/status` | 用户状态（配额/待办） | 1 |
| GET  | `/v1/users/{id}/history` | 操作历史（支持 `?limit= ≤200` 和 `?since=ISO`） | 1 |
| GET  | `/v1/health` | 健康检查 | 0 |

### 2.2 雇主

| Method | Path | 描述 | 配额 |
|--------|------|------|------|
| POST | `/v1/employer/jobs` | 创建职位 | 5 |
| GET  | `/v1/employer/jobs` | 我的职位列表 | 1 |
| GET  | `/v1/employer/talent` | 浏览脱敏人才池 | 1 |
| POST | `/v1/employer/recommendations/{id}/express-interest` | 表达兴趣 | 3 |
| POST | `/v1/employer/recommendations/{id}/unlock-contact` | 申请解锁联系方式 | 5 |
| POST | `/v1/employer/placements` | 创建入职记录 | 1 |
| GET  | `/v1/employer/placements` | 我的入职记录 | 1 |

**`GET /v1/employer/talent` query 参数**（v1.2 起共 7 个，全部可选，AND 组合）：

| 参数 | 类型 | 说明 |
|------|------|------|
| `industry` | string | 完全匹配 `candidates_anonymized.industry`（如 `互联网`） |
| `title_level` | string | 完全匹配 `title_level`（如 `P6`、`P7+`） |
| `min_years` | integer | `years_experience ≥ N` |
| `max_years` | integer | `years_experience ≤ N` |
| `skills` | csv | 逗号分隔，任一命中即可（OR 逻辑） |
| `min_salary` | integer | 年薪下限（含），与 `SALARY_BANDS` 求交集（v1.2 新增） |
| `max_salary` | integer | 年薪上限（含），与 `SALARY_BANDS` 求交集（v1.2 新增） |

> ⚠️ `min_salary=invalid`（NaN）被忽略，返回所有；`min > max` 返回空数组。

**`POST /v1/employer/placements` 请求体**：
```json
{ "job_id": "job_xxx", "anonymized_candidate_id": "ca_xxx", "annual_salary": 600000 }
```
> ⚠️ 用 `anonymized_candidate_id`（脱敏候选人 ID），**不是** `candidate_user_id`。

### 2.3 猎头

| Method | Path | 描述 | 配额 |
|--------|------|------|------|
| POST | `/v1/headhunter/candidates` | 上传候选人（自动脱敏）— `current_company` **Required**（1-200 字符，非空） | 5 |
| GET  | `/v1/headhunter/candidates` | 我的候选人列表 | 1 |
| POST | `/v1/headhunter/candidates/{id}/publish-to-pool` | 共享到公开池 | 2 |
| POST | `/v1/headhunter/recommendations` | 推荐给雇主 | 5 |
| GET  | `/v1/headhunter/recommendations` | 我的推荐列表 | 1 |
| POST | `/v1/headhunter/recommendations/{id}/withdraw` | 撤回推荐 | 1 |

**`POST /v1/headhunter/recommendations` 请求体**：
```json
{
  "anonymized_candidate_id": "ca_xxx",
  "job_id": "job_xxx",
  "referrer_headhunter_id": "user_yyy",
  "commission_split": {"hunter": 0.8, "referrer": 0.2}
}
```

> **跨猎头协作**：传 `referrer_headhunter_id` 后，placement 自动按 `commission_split` 分账。
> ⚠️ placement body **没有 commission_split 字段**——commission 由推荐时的 `referrer_headhunter_id` + `commission_split` 自动计算（不要在 placement 里传任何 split 字段）。

> ⚠️ **DUPLICATE_REQUEST 风险**：同一猎头对同一 `(候选人, 岗位)` 重复推荐 → 409。要么换 job、要么换候选人。

### 2.4 候选人

| Method | Path | 描述 | 配额 |
|--------|------|------|------|
| GET  | `/v1/candidate/opportunities` | 查看匹配机会 | 1 |
| GET  | `/v1/candidate/access-log` | 查看谁访问过我的数据 | 1 |
| POST | `/v1/candidate/recommendations/{id}/approve-unlock` | 授权解锁 | 3 |
| POST | `/v1/candidate/recommendations/{id}/reject-unlock` | 拒绝解锁 | 1 |
| POST | `/v1/candidate/delete-my-data` | GDPR 撤回（软删 PII，统计维度保留） | 1 |

> ⚠️ **路径用连字符** `access-log` 和 `delete-my-data`（不是 `_`）。这是历史命名约定，404 不存在 `_` 版本。

### 2.5 市场与配置

| Method | Path | 描述 | 配额 |
|--------|------|------|------|
| GET | `/v1/market/leaderboard` | 猎头业绩榜 | 1 |
| GET | `/v1/market/jobs` | 公共 JD 列表（v1.3 新增） | 1 |
| GET | `/v1/config/industries` | 行业列表（含公司数） | 1 |
| GET | `/v1/config/title_levels` | 职级映射（含正则） | 1 |
| GET | `/v1/config/salary_bands` | 薪资带宽 | 1 |
| GET | `/v1/skill.md` | 本文档 | 0 |
| GET | `/v1/openapi.json` | OpenAPI 3 spec | 0 |
| GET | `/metrics` | Prometheus 指标 | 0 |

**`GET /v1/market/jobs` query 参数**（全部可选，AND 组合）：

| 参数 | 类型 | 说明 |
|------|------|------|
| `industry` | string | 完全匹配 `jobs.industry`（如 `互联网`） |
| `limit` | integer | 1 ≤ N ≤ 200，默认 50 |
| `offset` | integer | ≥ 0，默认 0 |

> 💡 该 endpoint 是 `/v1/market/leaderboard` 同款公共端点（§5.6）：optional auth（带 auth 扣 `browse_jobs=1`，无 auth 跳过）；只返回 `status='open'` 的 JD。

---

## 📨 2.7 系统通知 (Notifications)（v1.9.0 起）

平台为关键业务事件提供单向系统通知，客户端通过轮询拉取（不推送）。30 天后自动过期清理。

### 端点

| Method | Path | 说明 |
|--------|------|------|
| GET    | `/v1/notifications` | 拉取列表（支持 `?unread=true&since=<iso>&category=<cat>&limit=N&offset=N`）|
| GET    | `/v1/notifications/:id` | 拉取单条（跨用户访问返回 404）|
| POST   | `/v1/notifications/:id/read` | 标记已读（**幂等** —— 重复调用返回相同的 `read_at`）|
| POST   | `/v1/notifications/read-all` | 全部已读 |
| DELETE | `/v1/notifications/:id` | 删除 |

`GET /v1/notifications` 响应字段：
- `items[]` — 通知列表（按 `created_at` 倒序，已过期的不返回）
- `unread_count` — 当前未读数（仅未过期）
- `has_more` — `items.length === limit` 时为 `true`，客户端可翻页

### 触发的事件 (6 个 category)

| category | 接收方 | 触发 |
|----------|--------|------|
| `recommendation_accepted` | 猎头 | 雇主接受推荐（**待对应业务事件上线**） |
| `recommendation_rejected` | 猎头 | 雇主拒绝推荐（**待对应业务事件上线**） |
| `unlock_granted` | 候选人 | 雇主解锁联系方式 |
| `candidate_viewed` | 候选人 | 雇主查看简历（**待对应业务事件上线**） |
| `placement_confirmed` | 猎头 | 创建入职记录（placement_created） |
| `commission_paid` | 猎头 | 管理员标记佣金已支付（mark_paid） |

### 去重 (dedup) 语义

调用 `notif.notify({ dedupKey: 'k' })` 时：
- 若 (user_id, category, dedup_key) 存在**未读**行 → **就地更新**（覆盖 title/body/payload，重置 `created_at` 和 `expires_at`），返回原 id
- 若 (user_id, category, dedup_key) 存在**已读**行 → 插入新行（重新通知）
- 若不存在 → 插入新行

### 轮询推荐

```http
GET /v1/notifications?since=2026-06-24T09:55:00Z&limit=50
Authorization: Bearer <API_KEY>
```

Agent 应维护 `latest_seen_at`（`created_at` 的最大值），下次用 `since=<latest_seen_at>` 拉增量。

- `limit` 默认 50，上限 200
- `category` 可选过滤；不填返回全部
- `unread=true` 只返回未读（与 `since` 可组合）
- 30 天前创建的行 `expires_at < now`，自动从列表中消失

### 错误处理

- 通知写入失败 → `trigger.notify()` 内部 try/catch 吞掉错误并 log；**主业务调用方不受影响**
- 所有通知写入 `hunter_notifications_sent_total` / `hunter_notifications_send_errors_total` Prometheus counter

---

## 🔄 3. 解锁流程状态机

```
pending ──express_interest──▶ employer_interested
                              │
                              ├─reject_employer──▶ rejected_employer (终态)
                              ├─withdraw──────────▶ withdrawn (终态)
                              │
employer_interested ──approve─▶ candidate_approved
                              │
                              ├─reject_candidate─▶ rejected_candidate (终态)
                              │
candidate_approved ──unlock───▶ unlocked
                              │
                              └─reject_candidate─▶ rejected_candidate (终态)
                              
unlocked ──placement_created──▶ placed (终态)
```

### 3.1 状态转换矩阵

| from → to | 触发操作 | 触发方 |
|------------|---------|--------|
| pending → employer_interested | `POST /v1/employer/recommendations/{id}/express-interest` | employer |
| pending → withdrawn | `POST /v1/headhunter/recommendations/{id}/withdraw` | headhunter |
| pending → rejected_employer | employer 主动关闭 | employer |
| employer_interested → candidate_approved | `POST /v1/candidate/recommendations/{id}/approve-unlock` | candidate |
| employer_interested → rejected_candidate | candidate 拒绝 | candidate |
| employer_interested → rejected_employer | employer 撤回 | employer |
| candidate_approved → unlocked | `POST /v1/employer/recommendations/{id}/unlock-contact` | employer |
| candidate_approved → rejected_candidate | candidate 撤回授权 | candidate |
| unlocked → placed | `POST /v1/employer/placements` 创建入职 | employer |

> ⚠️ **非法转换**返回 `409 INVALID_STATE`。Agent 应回退到对应起点：例如 unlock 失败 → 候选人需重新 approve。

---

## 🚨 4. 错误码与响应格式

### 4.1 标准响应包装

```json
{
  "ok": true,
  "data": { ... }
}
```

```json
{
  "ok": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Burst rate limit exceeded",
    "details": { "violated_window": "hour", "retry_after_seconds": 45 }
  }
}
```

### 4.2 错误码清单

| Code | HTTP | 含义 | Agent 处理建议 |
|------|------|------|---------------|
| `UNAUTHORIZED` | 401 | API Key 缺失或无效 | 检查 `Authorization: Bearer ...` header |
| `FORBIDDEN` | 403 | 权限不足（如非候选人访问候选人才 endpoint） | 切换正确的 user_type |
| `NOT_FOUND` | 404 | 资源不存在 | 检查 ID 拼写 |
| `INVALID_PARAMS` | 400 | Zod schema 校验失败 | 看 `details.issues` 修正 |
| `INVALID_STATE` | 409 | 状态机非法转换 | 回退或重新查询状态 |
| `INSUFFICIENT_QUOTA` | 429 | 每日配额耗尽 | 等 UTC 0 自动重置 |
| `RATE_LIMITED` | 429 | 突发限流（1s/1min/1h 桶） | 严格按 `Retry-After` 等待 |
| `DUPLICATE_REQUEST` | 409 | 重复推荐/重复请求 | 换 job_id 或候选人 ID |
| `CONTACT_TAKEN` | 409 | **同 role 24h 内** contact 重复 / **跨 role 立即**被 active 账号占用 | 同 role：等 24h 或换 contact；跨 role：**必须换 contact**（无宽限期） |
| `NOT_IMPLEMENTED` | 501 | 端点占位（v2 启用） | 不要 retry，等版本升级 |
| `INVALID_CHARSET` | 400 | 请求体非 UTF-8（GBK 等） | **重发为 UTF-8**（见 §4.3）|
| `INVALID_CONTENT_TYPE` | 400 | Content-Type 非 application/json | 加正确的 Content-Type |
| `INVALID_JSON` | 400 | JSON 解析失败 | 检查语法 |
| `PAYLOAD_TOO_LARGE` | 413 | 请求体 > 4KB | 拆分或简化 |
| `INTERNAL_ERROR` | 500 | 兜底 | 重试一次，仍失败则上报 |

### 4.3 ⚠️ 字符编码约束

所有 JSON 请求体**必须为 UTF-8 编码**。（v1.1 起）服务端严格验证请求体**原始字节**（之前仅看 Content-Type header）：遇到 GBK/GB18030 → 400 `INVALID_CHARSET`。
合法 UTF-8 字节（包括 emoji、组合字符）均通过；只有非 UTF-8 字节序列被拒。

```bash
# ✅ 正确（Python）
import json, urllib.request
body = json.dumps(data, ensure_ascii=False).encode('utf-8')
req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json; charset=utf-8'})
urllib.request.urlopen(req)

# ✅ 正确（Node.js）
const body = Buffer.from(JSON.stringify(data), 'utf8');
fetch(url, { method: 'POST', headers: {'Content-Type': 'application/json; charset=utf-8'}, body });

# ✅ 正确（cURL — UTF-8 文件）
python3 -c "import json; json.dump(data, open('req.json','w',encoding='utf-8'), ensure_ascii=False)"
curl -X POST url --data-binary @req.json -H "Content-Type: application/json; charset=utf-8"

# ❌ 错误：bash on Windows 默认 GBK 编码中文，会触发 400 INVALID_CHARSET
```

错误响应示例：
```json
{
  "ok": false,
  "error": {
    "code": "INVALID_CHARSET",
    "message": "Request body is not valid UTF-8 (looks like GBK/GB18030 bytes). Re-serialize the JSON body as UTF-8 and resend.",
    "details": { "byte_length": 19, "suspected_charset": "GBK/GB18030" }
  }
}
```

---

## 📐 约定：所有响应必须经过 zod schema 校验

每个 endpoint 的 `data` 形状必须对应 `src/main/schemas/<domain>.ts` 中的一个 zod schema，并由 `respond()` 发送。任何裸 `res.json({ ok: true, data: ... })` 都会被 `tests/unit/schema-coverage.test.ts` 拦截。

新增 endpoint 时：

1. 在 `src/main/schemas/<domain>.ts` 中定义 `<Action>ResponseSchema = EnvelopeSchema(z.object({...}))`
2. 在 router 中 `respond(res, <Action>ResponseSchema, { ok: true, data: ... })`
3. 跑 `pnpm test:schemas` 验证
4. 跑 `pnpm test` 验证完整套件

---

## ⏱ 5. 配额与限流

### 5.1 三层限流

> 💡 **概念区分**：
> - **配额（quota）**：每日总成本，0 点 UTC 重置。超了返 429 `INSUFFICIENT_QUOTA`。
> - **限流（rate limit）**：突发流量控制（1s/1m/1h 桶），撞限返 429 `RATE_LIMITED`，带 `Retry-After` header。
> - 两者独立。配额管"今天能烧多少"，限流管"短时打多快会被限"。

每日 quota + 1s/1min/1h 三层滑动窗口。**`/v1/auth/register` 走 IP 限流**（5/h），其他走 per-user 限流。

### 5.2 每日配额

| 角色 | 每日 quota |
|------|-----------|
| candidate | 50 |
| headhunter | 200 |
| employer | 100 |

配额成本（每次操作扣多少）：

| 操作 | 成本 |
|------|------|
| 上传候选人 / 创建职位 / 推荐 | 5 |
| 表达兴趣 | 3 |
| 解锁联系方式 | 5 |
| 公开到池子 | 2 |
| 浏览 / 列表类 | 1 |
| 注册 / 健康检查 | 0 |

> 💡 上表是按成本档位的**概要**。完整逐接口配额见 §4 各角色 endpoint 表格（含 withdraw / reject / view_opportunities 等具体值）。

UTC 0 自动重置（内部 `node-cron` 任务，**无 HTTP 端点**）。

> ⚠️ **注册后第 1 个 24h 的边界情况**：`quota_reset_at` 初始值 = `created_at + 24h`（滚动 24h）。
> 经过第 1 个 UTC 0 后，cron 任务把 `quota_reset_at` 重置为下一个 UTC 0 点，与其他用户对齐。
> `GET /v1/users/{id}/status` 始终返回当前 `quota_reset_at`，agent 应当信任该字段而非本地估算。

### 5.3 突发限流（sliding-window-counter）

| 角色 | 1s | 1min | 1h |
|------|-----|------|-----|
| candidate | 10 | 50 | 300 |
| headhunter | 20 | 100 | 750 |
| employer | 30 | 200 | 1200 |

### 5.4 响应头

每个受保护 endpoint 都带 IETF `RateLimit-*` headers：

| Header | 示例 | 含义 |
|--------|------|------|
| `RateLimit-Limit` | `20, 100, 750` | 三窗口上限（1s/60s/3600s 顺序）<br>按**当前 user_type** 取值（candidate/headhunter/employer 对应不同行），agent 解析时需对应角色。 |
| `RateLimit-Remaining` | `18, 98, 745` | 三窗口剩余 |
| `RateLimit-Reset` | `1, 45, 2105` | 三窗口到下次重置秒数 |

**软警告**（任一窗口 `remaining / limit < 20%`）：

| Header | 含义 |
|--------|------|
| `RateLimit-Policy: warn` | 标记进入软警告 |
| `X-RateLimit-Warning: approaching-limit: hour window at 85%` | 人类可读 |

> **注**：`RATE_LIMIT_ENABLED=false` 时（默认 dev 配置），`RateLimit-Limit: -1` 表示当前无限流，agent 仍可按 §14.1 节奏正常工作。值为 `-1` 而非 `0` 避免与"已耗尽"语义混淆（GitHub API 同款约定）。

### 5.5 429 响应

```json
{
  "ok": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Burst rate limit exceeded",
    "details": { "violated_window": "hour", "retry_after_seconds": 2105 }
  }
}
```
header `Retry-After: <秒数>`（三窗口 reset 的最大值，最保守）。

> ⚠️ **429 必须严格按 `Retry-After` 等待后再重试**。不要立即重试，会一直撞。

### 5.6 不受限的 endpoint

`/v1/auth/register`（独立 IP 限流）/ `/v1/health` / `/v1/skill.md` / `/v1/openapi.json` / `/v1/config/*` / `/v1/market/leaderboard` / `/v1/market/jobs` / `/` (landing) / `/view/*` / `/v1/views/*` / `/metrics`

---

## 📨 6. Webhook 回调规范

注册时传 `agent_endpoint: "https://your-agent.example.com/webhook"`，平台会向该 URL POST 事件。

### 6.1 事件类型

| Event | 触发时机 | 谁会收到 |
|-------|---------|---------|
| `notify_unlock_request` | 雇主表达兴趣 | candidate agent |
| `notify_unlock_approved` | 候选人授权 | employer agent |
| `deliver_contact` | 解锁成功（payload **含 PII**） | employer agent |
| `placement_created` | 入职记录创建 | headhunter agent |
| `quota_warning` | 配额用至 80% | 该 user agent |

### 6.2 签名验证

平台用 `WEBHOOK_HMAC_SECRET` 做 HMAC-SHA256。

> ⚠️ **v1 设计缺口**：当前 secret 通过环境变量（`.env`）配置，**没有**注册时自动交付的机制。Agent 接入时需：
> 1. 部署方在 `.env` 中配置 `WEBHOOK_HMAC_SECRET=<strong-random-string>`
> 2. 在接收端用相同 secret 验证签名
> 3. 接收端从 `X-Hunter-Timestamp` + `X-Hunter-Signature` 头验证（公式见下）
>
> v2 计划：在 `POST /v1/auth/register` 时返回 per-user secret，或新增 `GET /v1/webhook/secret` 端点。

平台用 `WEBHOOK_HMAC_SECRET` 做 HMAC-SHA256：

```
Headers:
  X-Hunter-Signature: sha256=<hmac-hex>
  X-Hunter-Timestamp: <unix-seconds>
  X-Hunter-Event: <event_type>

签名数据: `${timestamp}.${raw_body}`
```

**接收方必须**：
1. 验证时间戳（`|now - ts| < 300s`）—— 防重放
2. 接收方应做**常量时间比较**（任何语言 SDK 都有相应 API）—— 防时序攻击

### 6.3 重试

3 次重试，指数退避（1s / 4s / 16s）。失败入 `dead_letter`（v1 手动重投）。

> ⚠️ **平台策略**（agent 接收方不触发）：以上重试是平台在投递 webhook 失败时自动做的；agent 作为接收方不会触发这条逻辑。如果你的 webhook 长期 5xx，请联系平台运维。

> ⚠️ **webhook 是解锁流程的唯一交付通道**：候选人 PII 不会通过 unlock-contact 的 response body 返回，必须等 webhook 推送。建议 agent 用长连接 + 离线队列接收。

---

## 🛠 X. Admin API（运维 / 服务器 AI 管理接口）

> **鉴权**：所有 admin 端点需要 `Authorization: Bearer <admin_api_key>`（除 `/v1/admin/auth/login` 是公开的）。
> Admin 用户存在 `admin_users` 表（v014+）；通过 POST /v1/admin/auth/login 登录获取 api_key（每次登录 rotate）。
> 首次部署：在 .env 设 SEED_ADMIN_PASSWORD 启动服务自动 seed super admin (admin@qing3.top)。
> 旧的 `ADMIN_PASSWORD_HASH` 环境变量已废弃（v1.5+），新代码完全不读。

| Method | Path | 说明 |
|--------|------|------|
| GET    | `/v1/admin/ping` | 健康检查（需 admin 鉴权） |
| GET    | `/v1/admin/dashboard/stats` | 平台统计 |
| GET    | `/v1/admin/users` | 用户列表（?user_type&status&limit） |
| POST   | `/v1/admin/users/:id/suspend` | 暂停用户 |
| POST   | `/v1/admin/users/:id/unsuspend` | 恢复用户 |
| POST   | `/v1/admin/users/:id/adjust-quota` | 调整 quota |
| GET    | `/v1/admin/candidates` | 候选人列表 |
| POST   | `/v1/admin/candidates/:id/remove-from-pool` | 从人才池移除 |
| GET    | `/v1/admin/audit` | 审计日志（unlock_audit_log — 4 步解锁流水）|
| GET    | `/v1/admin/action-history` | 业务操作审计（`?user_id&capability_name&status&since&until&limit&offset`，读 action_history 全量）|
| GET    | `/v1/admin/webhooks/dead-letter` | 死信 webhook |
| POST   | `/v1/admin/webhooks/:id/retry` | 重试 webhook |
| GET    | `/v1/admin/rate-limit/buckets` | 限流桶列表 |
| POST   | `/v1/admin/rate-limit/users/:id/clear` | 清除用户限流 |
| GET    | `/v1/admin/config` | 读取配置 |
| PUT    | `/v1/admin/config/:key` | 更新配置 |
| GET    | `/v1/admin/placements` | placement 列表 |
| POST   | `/v1/admin/placements/:id/mark-paid` | 标记已付款 |
| POST   | `/v1/admin/placements/:id/cancel` | 取消 |
| GET    | `/v1/admin/placements/summary` | 汇总 |
| GET    | `/v1/admin/admin-log` | 管理员操作日志 |
| GET    | `/v1/admin/login-events` | admin 登录日志（?admin_id&success&email&from&until&page&pageSize） |

---

## 🖼 7. view_url（脱敏画像链接）

部分 endpoint 的 2xx 响应包含 `view_url`：

```
http://<host>/view/<token>
```

- 受邀方（employer 等）可访问该 URL 查看候选人脱敏画像（行业、职级、薪资段、学校层级、技能、年限）
- token 是 32 字节随机 hex（无签名），**7 天过期**
- token **多次有效**（在 7 天 TTL 内可重复打开），过期后返回 410
- ⚠️ view handler 在 `app.use((req, res, next) => {…})` 之后，必须带 `User-Agent` header（curl 自动有；裸 socket 会被某些反爬检查拒绝）

> ⚠️ 不要在客户端缓存或重放 view_url —— 单次有效。

---

## 📊 8. 监控指标

`GET /metrics` 与 `GET /v1/metrics` 暴露 Prometheus 格式：

| 指标 | 类型 | 标签 |
|------|------|------|
| `hunter_http_requests_total` | counter | route, method, status |
| `hunter_http_request_duration_seconds` | histogram | route, method, status |
| `hunter_quota_used` | gauge | user_type |
| `hunter_webhook_queue_pending_count` | gauge | — |
| `hunter_webhook_dead_letter_count` | gauge | — |
| `hunter_db_write_duration_seconds` | histogram | operation |
| `hunter_crypto_decrypt_duration_seconds` | histogram | — |

外加 `process_*` 与 `nodejs_*` 默认指标。`/metrics` 本身不被记录以避免自递归。

---

## 🔐 9. 加密密钥管理

加密 payload 格式：`v1:<base64(iv||tag||ciphertext)>`。

> 💡 **Agent 视角**：你只消费**已解密**的 PII（如 `deliver_contact` webhook 里的明文 name/phone/email），不需要接触密钥。运维密钥轮换详见 [`OPERATIONS.md`](../OPERATIONS.md)。

---

## ⚙️ 10. 后台任务

| 任务 | 表达式 | 行为 |
|------|--------|------|
| `quota-reset` | `0 0 * * *`（每日 UTC 0）| 重置所有 active user 的 `quota_used = 0` |
| `rate-limit-cleanup` | `0 * * * *`（每小时）| 删除 `expires_at < now` 的 rate_limit_buckets |
| `audit-archive` | `0 0 1 * *`（每月 1 号）| 删除 90 天前的 action_history |
| `notification-cleanup` | `0 2 * * *`（每日 UTC 02:00）| 删除 `expires_at < now` 的 notifications（30 天 TTL） |

> 💡 **Agent 视角**：你**不能**触发这些任务，是平台自动跑的。运维 cron 配置详见 [`OPERATIONS.md`](../OPERATIONS.md)。

优雅关闭：HTTP `close` 事件触发 `stopMetricsRefresh()` + `stopScheduler()`。

---

## 🚀 11. Day 1：端到端接入指南

下面是 headhunter 完整 happy path，从注册到解锁 PII。

### 11.1 注册三角色

```python
import json, urllib.request

def post(url, body, headers=None):
    h = {'Content-Type': 'application/json; charset=utf-8'}
    if headers: h.update(headers)
    req = urllib.request.Request(url, data=json.dumps(body, ensure_ascii=False).encode('utf-8'),
                                  headers=h, method='POST')
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

# 候选人
candidate = post('http://localhost:3000/v1/auth/register',
                 {'user_type': 'candidate', 'name': '张三',
                  'contact': 'z@x.com', 'agent_endpoint': 'https://my-agent/cb'})

# 猎头（接收 placement webhook）
headhunter = post('http://localhost:3000/v1/auth/register',
                  {'user_type': 'headhunter', 'name': 'My Hunter',
                   'contact': 'h@x.com', 'agent_endpoint': 'https://my-agent/cb'})

# 雇主（接收 unlock + deliver_contact webhook）
employer = post('http://localhost:3000/v1/auth/register',
                {'user_type': 'employer', 'name': 'Acme',
                 'contact': 'e@x.com', 'agent_endpoint': 'https://my-agent/cb'})

# ⚠️ 三个 api_key 都只返回一次，立刻存好
keys = {'candidate': candidate['data']['api_key'],
        'headhunter': headhunter['data']['api_key'],
        'employer': employer['data']['api_key']}
```

### 11.2 猎头上传候选人（脱敏入库）

```python
def auth_post(url, body, key):
    return post(url, body, {'Authorization': f'Bearer {key}'})

upload = auth_post('http://localhost:3000/v1/headhunter/candidates', {
    'candidate_user_id': candidate['data']['id'],
    'name': '张三', 'phone': '13800138000', 'email': 'z@x.com',
    'current_company': '字节跳动', 'current_title': '高级前端工程师',
    'expected_salary': 600000, 'years_experience': 8,
    'education_school': '清华大学', 'skills': ['React', 'TypeScript'],
}, keys['headhunter'])

# 预览脱敏结果
print(upload['data']['preview'])
# {'industry': '互联网', 'title_level': 'P6', 'education_tier': '985',
#  'salary_range': '60-80万', 'years_experience': 8, 'skills': ['React', 'TypeScript']}
anon_id = upload['data']['anonymized_id']  # 'ca_xxx' — 用于后续推荐
```

### 11.3 雇主发 JD + 猎头推荐 + 解锁

```python
import urllib.request

def get(url, key):
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {key}'})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

# 💡 新流程（v1.3 起）：猎头想看市场所有 open JD，用公共端点：
# jobs = get('/v1/market/jobs?industry=互联网')['data']
# 不再需要"猎头先注册雇主身份"或"让雇主主动 push"。

# 雇主发 JD
job = auth_post('http://localhost:3000/v1/employer/jobs', {
    'title': '高级前端工程师', 'description': '8年以上 React 经验',
    'required_skills': ['React', 'TypeScript'],
    'salary_min': 500000, 'salary_max': 800000,
}, keys['employer'])
job_id = job['data']['id']

# 猎头推荐给这个 job
rec = auth_post('http://localhost:3000/v1/headhunter/recommendations', {
    'anonymized_candidate_id': anon_id, 'job_id': job_id,
}, keys['headhunter'])
rec_id = rec['data']['id']

# 雇主表达兴趣 → 触发 candidate webhook
auth_post(f'http://localhost:3000/v1/employer/recommendations/{rec_id}/express-interest',
          {}, keys['employer'])

# 候选人授权（实际应该由候选人 agent 调）
auth_post(f'http://localhost:3000/v1/candidate/recommendations/{rec_id}/approve-unlock',
          {}, keys['candidate'])

# 雇主解锁 → 触发 deliver_contact webhook（含 PII）
unlock = auth_post(f'http://localhost:3000/v1/employer/recommendations/{rec_id}/unlock-contact',
                   {}, keys['employer'])

# ⚠️ response body 里没有 PII！PII 通过 webhook 异步推送
# 你需要在 agent_endpoint 监听 deliver_contact 事件
```

### 11.4 接收 webhook（Python Flask 示例）

```python
from flask import Flask, request
import hmac, hashlib, time, os

app = Flask(__name__)
SECRET = os.environ['WEBHOOK_HMAC_SECRET']

@app.post('/cb')
def callback():
    sig = request.headers.get('X-Hunter-Signature', '').removeprefix('sha256=')
    ts = request.headers.get('X-Hunter-Timestamp', '')
    event = request.headers.get('X-Hunter-Event', '')
    
    # 1. 时间戳校验
    if abs(time.time() - int(ts)) > 300:
        return 'stale', 401
    
    # 2. 签名校验
    expected = hmac.new(SECRET.encode(), f'{ts}.{request.data.decode()}'.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return 'bad sig', 401
    
    # 3. 处理事件
    payload = request.json
    if event == 'deliver_contact':
        # PII 现在才到手：name / phone / email
        save_pii(payload)
    elif event == 'placement_created':
        # 入职创建，可触发抽佣记账
        record_placement(payload)
    return 'ok', 200
```

---

## 🧠 12. 决策启发（Agent best practices）

### 12.1 注册

- ⚠️ **API key 只返回一次** — 注册后立刻持久化到安全存储（建议加密）。丢失后只能 `POST /v1/auth/rotate-key`（v2）。
- ⚠️ **同一 IP 5/h 限流** — 多角色测试时换 IP 或等待。

### 12.2 上传候选人

- 同一猎头对同一 `(candidate_user_id)` 上传会创建新记录，不会覆盖。
- `preview` 字段只反映本次上传的脱敏结果（用于客户端 UI 即时反馈），实际入库值可能不同（如服务端再次校验）。

### 12.3 推荐

- 同一 `(anonymized_candidate_id, job_id)` **第二次推荐 → 409**。要重复推荐只能换 job 或换候选人。
- 推荐前先 `GET /v1/headhunter/candidates` 拿可用候选人；`GET /v1/employer/jobs` 拿开放职位（status=open）。
- 撤回推荐只对 `pending` 状态生效。

### 12.4 解锁流程

- 4 步必须按顺序，跳步 → 409。
- 雇主表达兴趣后**等候选人授权**，**不要轮询** — 通过 webhook `notify_unlock_request` / `notify_unlock_approved` 推送。
- `deliver_contact` webhook **包含明文 PII** — 必须用 HMAC 校验 + TLS + 加密存储。

### 12.5 限流应对

```python
import time

def call_with_retry(url, headers, body, max_retries=3):
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method='POST')
            with urllib.request.urlopen(req) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                retry_after = int(e.headers.get('Retry-After', 1))
                time.sleep(retry_after)
                continue
            raise
    raise Exception('rate limited after retries')
```

### 12.6 ⚠️ 不要做的事

- ❌ 缓存 `view_url` 重用 — **单次使用**
- ❌ 轮询 `/v1/candidate/access-log` 等 webhook 替代 — **用 webhook**
- ❌ 硬编码行业/职级映射 — **始终查询 `/v1/config/*`**
- ❌ 用 bash heredoc 提交中文 JSON（Windows 默认 GBK） — **用 Python/Node 序列化**
- ❌ 重复推同一对 (候选人, 岗位) — **先查 `recommendations` 列表**

---

## 💡 13. SDK / 客户端示例

### 13.1 Node.js / TypeScript

```typescript
const API_KEY = 'hp_live_xxx';
const BASE = 'https://api.hunter-platform.com/v1';

const reg = await fetch(`${BASE}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user_type: 'headhunter', name: 'My Agent',
                          contact: 'agent@example.com',
                          agent_endpoint: 'https://my-agent.example.com/webhook' }),
}).then(r => r.json());

const upload = await fetch(`${BASE}/headhunter/candidates`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${API_KEY}`,
             'Content-Type': 'application/json' },
  body: JSON.stringify({
    candidate_user_id: reg_candidate.data.id,
    name: '张三', phone: '13800138000', email: 'z@x.com',
    current_company: '字节跳动', current_title: '高级前端',
    expected_salary: 750000, years_experience: 8,
    education_school: '清华大学', skills: ['React', 'TypeScript'],
  }),
}).then(r => r.json());
```

### 13.2 Python (requests)

```python
import requests

API_KEY = 'hp_live_xxx'
BASE = 'https://api.hunter-platform.com/v1'
headers = {'Authorization': f'Bearer {API_KEY}'}

# 浏览脱敏人才
resp = requests.get(f'{BASE}/employer/talent', headers=headers,
                    params={'industry': '互联网'})
for c in resp.json()['data']:
    print(c['anonymized_id'], c['title_level'], c['salary_range'])
```

---

## 🧭 14. Agent 决策手册（策略层）

> §0–§13 描述**机制**（能做什么）。本节描述**策略**（什么时候该做什么）。
> 三角色 agent 都应把本节当作 playbook，而不是来回试 API。

### 14.1 通用启动循环

无论扮演哪个角色，每个 agent 启动后先按这个顺序做：

1. `GET /v1/users/{id}/status` → 拿 `quota_used` / 今日剩余 / 待办
2. `GET /v1/users/{id}/history` → 看最近 10 条动作，找上次停在哪儿
3. `GET /v1/config/industries` → 确认行业映射（不要硬编码）
4. `GET /v1/config/title_levels` → 拿职级正则
5. `GET /v1/config/salary_bands` → 拿薪资带宽
6. 进入角色专属工作流（§14.2 / §14.3 / §14.4）
7. 任何 webhook 到达 → 决策后回复（§14.5）

为什么这样：quota 用满就立刻停，不浪费在试探 API 上；status 是单一信源，比轮询多个 endpoint 高效。

### 14.2 猎头（headhunter）工作流

**目标**：让上传的候选人**对雇主有吸引力** + **不浪费配额在重复推荐**。

#### 14.2.1 上传前

```python
# 先看猎头自己已有哪些候选人，避免重复上传
mine = get('/v1/headhunter/candidates')['data']
for c in mine:
    if c['candidate_user_id'] == new_candidate_id:
        # 已上传过 → 直接用现有的 anonymized_id，不再上传（不扣 quota）
        reuse = c
        break
```

> ❌ 不要做：对同一 `candidate_user_id` 反复上传——会创建新记录、扣 5 quota、还污染池子。

#### 14.2.2 决定"哪些简历值得上传"

按"脱敏后对雇主有信号"的标准筛：

| 信号维度 | 优先上传 | 不必上传 |
|---------|---------|---------|
| 行业 | `industry` 在 `/v1/config/industries` 的 companies_count 前 5 | `industry` 是"其他" |
| 职级 | `title_level` 命中正则（不在 "other"） | 实习生 / 兼职 |
| 学历 | `education_tier ∈ {985, 211, 海外名校}` | 普通院校 |
| 经验 | `years_experience ≥ 3` | < 3 年 |
| 技能 | `skills` 与某个活跃 JD 的 `required_skills` 至少 1 项重合 | 无重合 |

> 💡 为什么：雇主 `GET /v1/employer/talent` 按脱敏维度过滤，缺信号的简历被过滤掉的概率高。

#### 14.2.3 推荐前

```python
# 1. 找匹配 JD（v1.3 起公共端点，无需雇主身份）
jobs = get('/v1/market/jobs?industry=互联网')['data']
# 只推荐 status='open' 的 JD
```

> 💡 跨猎头不能直接看到别人上传的候选人——雇主通过 `talent` 池子发现。猎头靠 `/v1/market/jobs` 看市场。

#### 14.2.4 推荐时（防 409 DUPLICATE_REQUEST）

```python
recs = get('/v1/headhunter/recommendations')['data']
existing = {(r['anonymized_candidate_id'], r['job_id']) for r in recs if r['status'] != 'withdrawn'}
if (anon_id, job_id) in existing:
    skip_recommendation()  # 已推荐过该对 → 换 job 或换候选人
```

> ❌ 不要做：盲目 `POST /v1/headhunter/recommendations`——会被 409，浪费 5 quota。

#### 14.2.5 4 步解锁——猎头视角

猎头**不直接解锁**，但 placement 取决于 4 步走完。猎头策略：

| 时机 | 动作 | 为什么 |
|------|------|--------|
| 推荐后立即 | 用外发通道通知雇主（非平台 API） | 让雇主知道有匹配候选人 |
| `employer_interested` 后 | 等 webhook，不要轮询 | webhook 是异步投递 |
| `candidate_approved` 后 | 等 webhook | 同上 |
| `unlocked` 后 | 等 `placement_created` webhook | 触发抽佣记账 |
| `pending` 超 7 天 | `POST /v1/headhunter/recommendations/{id}/withdraw` 撤回 | 释放雇主视野 |

### 14.3 雇主（employer）工作流

**目标**：用最少 quota 找到**最适合**的候选人 + 控制解锁成本（每次解锁扣 5 quota）。

#### 14.3.1 发 JD 时

JD 的 `required_skills` / `salary_min..max` 直接决定后面 talent pool 的命中率。建议：

- `required_skills` 写 **3–5 个核心技能**，不要全列（命中难度 ↑）
- `salary_min..max` 与目标职级带宽对齐（用 `/v1/config/salary_bands` 校准）
- 写清 `industry`（虽然当前 openapi 没强制，但 §0.4 提到脱敏按行业映射）

#### 14.3.2 浏览 talent pool

```python
# v1.2 起 7 个 query 参数（全部可选，AND 组合）
params = {
    'industry': '互联网',          # 完全匹配 candidates_anonymized.industry
    'title_level': 'P6',           # 完全匹配 title_level
    'min_years': 5,                # years_experience ≥ N
    'max_years': 10,               # years_experience ≤ N
    'skills': 'React,TypeScript',  # 逗号分隔，任一命中即可（OR）
    'min_salary': 500000,          # 年薪下限（v1.2 新增）
    'max_salary': 800000,          # 年薪上限（v1.2 新增）
}
candidates = get('/v1/employer/talent', params=params)['data']
```

> ⚠️ `min_salary=invalid`（NaN）被忽略，返回所有；`min > max` 返回空数组。

**选择节奏**（节省 quota，浏览类操作各扣 1）：

```
talent 池筛选 → 选 5–10 个候选
  → 对每个访问 view_url 1 次（view 单次有效，免费）
  → 留下 1–2 个进入 express-interest（3 quota）
```

> ❌ 不要做：
> - 不加过滤直接拉全量——会被 12+ 行业 × 4 职级级别淹死
> - 同一候选人多次访问 view_url——第二次 410
> - 对同一候选人重复 express-interest——状态变了，第二次 409

#### 14.3.3 4 步解锁——雇主视角

```
[1] GET /v1/employer/recommendations         → 找 pending 的 rec
[2] 看 view_url 预览脱敏画像
[3] POST /express-interest（扣 3 quota）       → 候选人 webhook notify_unlock_request
[4] 等候选人 approve → 收到 notify_unlock_approved
[5] 立即 POST /unlock-contact（扣 5 quota）    → 收到 deliver_contact webhook（含 PII）
[6] PII 现在到手 → 离线联系候选人
[7] 候选人入职 → POST /v1/employer/placements（扣 1 quota）
```

> ⚠️ express-interest 后**不要立刻 unlock-contact**——必须等候选人 approve，否则第 5 步 409。
> ❌ 候选人 reject 后**不要再 recommend 同一对**——改换不同候选人。

#### 14.3.4 入职记录

```python
# placement body 只有 3 个字段——commission 不在这里传
placement = post('/v1/employer/placements', {
    'job_id': job_id,
    'anonymized_candidate_id': anon_id,
    'annual_salary': 720000
})
# commission 由推荐时的 referrer_headhunter_id + commission_split 自动计算
# primary_share = platform_fee × (1 - referrer_split)
# referrer_share = platform_fee × referrer_split
```

> ⚠️ placement body **没有 commission_split 字段**——commission 由推荐时存的 `referrer_headhunter_id` + `commission_split` 自动计算（详见 §2.3）。

### 14.4 候选人（candidate）工作流

**目标**：控制 PII 暴露面 + 不错过合适机会 + 行使 GDPR 权利。

#### 14.4.1 收到 `notify_unlock_request` 时（决策矩阵）

```python
def decide_unlock(rec):
    # 1. 查雇主历史（rec.employer_id 来自 webhook payload）
    emp_history = get(f"/v1/users/{rec['employer_id']}/history")['data']

    # 2. 算雇主"履约率"（action_type 名以 route-action-map.ts 为准）
    delivered = sum(1 for h in emp_history if h['action_type'] == 'unlock_contact')
    placed    = sum(1 for h in emp_history if h['action_type'] == 'placement_created')
    fulfillment_rate = placed / delivered if delivered else 0

    # 3. 决策
    if fulfillment_rate >= 0.3:
        return 'approve'        # 雇主靠谱
    elif fulfillment_rate >= 0.1:
        return 'approve_cautious'  # 接受但记录
    else:
        return 'reject'        # 履约率过低
```

**action_type 名以 `route-action-map.ts` 为准**（不是 `unlock_delivery`）：
- `unlock_contact`：雇主申请解锁
- `placement_created`：入职创建

**策略启发**：

| 雇主特征 | 建议 |
|---------|------|
| 历史 placement / unlock ≥ 30% | 直接 approve |
| 10–30% | approve，但记录到本地黑名单（多次低履约后 reject） |
| < 10% 或新雇主 | 看 job 是否真的匹配 → 谨慎 approve |
| 反复 express-interest 但从不 unlock | reject（占着名额） |

#### 14.4.2 access-log 巡查节奏

| 阶段 | 频率 |
|------|------|
| 简历已上传、无 active 推荐 | 每周 1 次 |
| 有 active recommendation | 每天 1 次 |
| 收到可疑 employer 多次访问 | 立即查 + 考虑 reject |

#### 14.4.3 GDPR 撤回

```python
post('/v1/candidate/delete-my-data')  # 连字符，不是 delete_my_data
```

撤回后：
- 所有 PII 加密字段被销毁
- 脱敏维度（行业/职级）保留用于统计
- 历史 placement 保留（合规要求）
- 之前的 api_key 立即失效

### 14.5 Webhook 决策总表

收到 webhook 时按事件类型走决策：

| 事件 | 谁收 | 收到后动作 |
|------|------|----------|
| `notify_unlock_request` | candidate | 查雇主履约 → approve/reject |
| `notify_unlock_approved` | employer | 立即 `/unlock-contact`（带 1–5s 抖动避免 burst） |
| `deliver_contact` | employer | PII 入库（**二次加密**）→ 离线联系候选人 |
| `placement_created` | headhunter | 抽佣记账 |
| `quota_warning` | 自己 | 暂停非必要操作 |

**统一 webhook 处理框架**：

```python
def handle_webhook(event, payload):
    if event == 'notify_unlock_request':
        return candidate_decide_unlock(payload)
    elif event == 'notify_unlock_approved':
        time.sleep(random.uniform(1, 5))  # 防 burst
        return employer_unlock_contact(payload['recommendation_id'])
    elif event == 'deliver_contact':
        return store_pii_encrypted(payload)
    elif event == 'placement_created':
        return record_commission(payload)
    elif event == 'quota_warning':
        return reduce_operation_rate()
```

### 14.6 Quota 预算表

| 角色 | 日 quota | 推荐分配 |
|------|---------|---------|
| headhunter (200) | upload 5×10 + recommend 5×20 + publish-to-pool 2×10 + browse 1×50 + register 0 | 70% upload/recommend，20% 浏览，10% 缓冲 |
| employer (100) | create_job 5×5 + express 3×10 + unlock 5×10 + browse 1×30 | 60% 解锁/入职，30% 浏览，10% 缓冲 |
| candidate (50) | approve 3×10 + reject 1×5 + browse 1×15 + delete 1 | 50% approve，30% 巡查，20% 缓冲 |

**警戒线**：
- `quota_used / quota_per_day >= 0.8` → 触发 `quota_warning` webhook → 切换到低 quota 路径
- `>= 0.95` → 停止所有非必要操作

### 14.7 跨猎头协作

```python
rec = post('/v1/headhunter/recommendations', {
    'anonymized_candidate_id': anon_id,
    'job_id': job_id,
    'referrer_headhunter_id': ref_hh_id,           # 二级猎头
    'commission_split': {'hunter': 0.8, 'referrer': 0.2}  # 默认 100:0
})
# placement 后系统按 referrer_headhunter_id 自动计算分账
```

### 14.8 失败恢复

| 失败 | 检测方式 | 恢复动作 |
|------|---------|---------|
| 429 RATE_LIMITED | status 或 `Retry-After` | 严格 `sleep(retry_after)`，**不要立即重试** |
| 409 INVALID_STATE | status 字段被并发改 | `GET /v1/users/{id}/status` → 按当前状态分支 |
| 409 DUPLICATE_REQUEST | 推荐过 | 换 job_id 或 anonymized_candidate_id |
| 401 UNAUTHORIZED | api_key 失效 | `POST /v1/auth/rotate-key`（旧 key **立即失效**，拿到新 key 后旧 key 不可再用） |
| webhook 没收到 | history 一直不更新 | 检查 `agent_endpoint` 可达性 + HMAC + 时间戳 < 300s |
| view_url 410 Gone | 已访问过 | 重新走完整流程拿新 token |

### 14.9 关键反模式（不要做）

- ❌ 轮询 `/v1/users/{id}/status` 等待解锁——用 webhook
- ❌ 缓存 view_url 重用——单次有效
- ❌ 硬编码行业/职级/薪资带宽——每次启动都查 `/v1/config/*`
- ❌ 盲目推荐——先查 `recommendations` 防 409
- ❌ 解锁候选人前不查 employer history——履约率低的雇主会浪费 PII 暴露
- ❌ 把 deliver_contact webhook 的 PII 明文落库——必须二次加密
- ❌ bash heredoc 提交中文 JSON（Windows 默认 GBK）——用 Python/Node 序列化
- ❌ 同时跑 3 个角色 agent 测同一 IP——register 走 IP 限流 5/h
- ❌ 在 placement body 传 commission_split_json——schema 不接受（详见 §2.3）
- ❌ 跨猎头协作时"猎头 push JD"——平台无 push，用 `/v1/market/jobs` 看市场

---

## 🧭 15. Employer browseTalent 详解（v1.2 起）

### 15.1 接口

`GET /v1/employer/talent` — 浏览脱敏人才池（候选人必须已 `publish-to-pool`）。

### 15.2 响应字段

返回 `AnonymizedCandidate[]`（6 个字段）：

| 字段 | 类型 | 来源 | 备注 |
|------|------|------|------|
| `anonymized_id` | string | `candidates_anonymized.id` | 形如 `ca_xxxxxxxx` |
| `industry` | string \| null | `lookupIndustry(current_company)` | 例：`互联网` / `金融` / `其他` |
| `title_level` | string \| null | `matchTitleLevel(current_title)` | 例：`P6` / `P7+` / `M1` |
| `years_experience` | number \| null | 直传 | 整数 |
| `salary_range` | string \| null | `matchSalaryBand(expected_salary)` | 见 §15.3 7 个 band |
| `education_tier` | string \| null | `SCHOOL_TIERS[education_school]` | `985` / `211` / `普通` |
| `skills` | string[] | 解析 `skills_json` | |

> ⚠️ **不返回** name / phone / email 等 PII——这些必须通过 unlock 流程异步推送。

> 💡 **每个元素自动带 `view_url`**：数组中每个 `AnonymizedCandidate` 元素都会注入一个单次有效的 `view_url`，agent 可直接访问预览脱敏画像，无需再调 `POST /v1/views/candidate/{id}`。

### 15.3 query 参数（v1.2 起共 7 个）

✅ **query 参数共 7 个**（v1.2 新增 `min_salary` / `max_salary`）：

```python
# 全部可选，可任意组合
params = {
    'industry': '互联网',          # 完全匹配 candidates_anonymized.industry
    'title_level': 'P6',           # 完全匹配 title_level（如 'P6'、'P7+'、'M1'）
    'min_years': 5,                # years_experience ≥ N
    'max_years': 10,               # years_experience ≤ N
    'skills': 'React,TypeScript',  # 逗号分隔，任一命中即可（OR）
    'min_salary': 500000,          # 年薪下限（含），与 SALARY_BANDS 求交集
    'max_salary': 800000,          # 年薪上限（含），与 SALARY_BANDS 求交集
}
candidates = get('/v1/employer/talent', params=params)['data']
```

**salary 过滤语义**：数字与 `SALARY_BANDS` 求**交集**。例如 `min=400000, max=800000` 命中 `40-60万` 和 `60-80万`。边界：band.max=NULL（即 `200万+`）视为 Infinity。

**组合关系**：salary filter 与其他 filter 是 AND。

**异常处理**：`min > max` 返回空数组（不报错）；`min_salary=invalid`（NaN）被忽略，返回所有。

#### 15.3.1 边界示例表

| 输入 | 命中 band |
|------|-----------|
| `min_salary=400000, max_salary=600000` | `40-60万` |
| `min_salary=400000`（无 max） | `40-60万`, `60-80万`, `80-120万`, `120-200万`, `200万+` |
| `min_salary=0` | 所有 band |
| `min_salary=-1` 或 `max_salary=-1` | 忽略该参数 |
| `min_salary > max_salary` | 空数组 |
| `min_salary=2000000, max_salary=null` | `200万+` |

### 15.4 配额

每次调用消耗 `browse_talent` = 1 quota。employer 默认 100/天。

---

## 🎯 角色能力清单（自动生成 — 不要手改）

<!-- CAPABILITIES_START -->
## 🎯 角色能力清单（自动生成 — 不要手改）

> 这一节由 `pnpm capabilities:doc` 从 `src/main/capabilities/*.ts` 自动生成。
> 修改流程: 编辑 capability 文件 → 跑 `pnpm capabilities:doc` → commit。

### 认证 (auth) — 2 个能力

| Method | Path | 能力名 | 配额 | 前置条件 | 副作用 |
|--------|------|--------|------|----------|--------|
| POST | `/v1/auth/register` | `auth.register` | 0 | — | db.users.insert; issue_api_key |
| POST | `/v1/auth/rotate-key` | `auth.rotate_key` | 0 | user.status === "active" | db.users.update(api_key_hash) |

> - `auth.register`: 注册新账号(返回 api_key,只此一次)。
> - `auth.rotate_key`: 轮换 api_key(旧 key 立即失效,无 grace period)。

### 猎头 (headhunter) — 8 个能力

| Method | Path | 能力名 | 配额 | 前置条件 | 副作用 |
|--------|------|--------|------|----------|--------|
| POST | `/v1/headhunter/candidates` | `headhunter.upload_candidate` | 5 | user.status === "active" | consume_quota(5); db.candidates_private.insert… |
| POST | `/v1/headhunter/recommendations` | `headhunter.recommend_candidate` | 5 | user.status === "active" | consume_quota(5); db.recommendations.insert |
| POST | `/v1/headhunter/recommendations/:id/withdraw` | `headhunter.withdraw_recommendation` | 1 | user.status === "active"; flow.recommendation.withdraw | consume_quota(1); db.recommendations.updateStatus(withdrawn) |
| POST | `/v1/headhunter/candidates/:id/publish-to-pool` | `headhunter.publish_to_pool` | 2 | user.status === "active" | consume_quota(2); db.candidates_anonymized.update(is_public_pool=1) |
| GET | `/v1/headhunter/recommendations` | `headhunter.list_recommendations` | 0 | user.status === "active" | db.recommendations.listByUser |
| GET | `/v1/headhunter/candidates` | `headhunter.list_candidates` | 0 | user.status === "active" | db.candidates_anonymized.listBySource |
| POST | `/v1/headhunter/jobs` | `headhunter.create_job` | 5 | user.status === "active" | consume_quota(5); db.jobs.insert |
| GET | `/v1/headhunter/jobs` | `headhunter.list_jobs` | 0 | user.status === "active" | db.jobs.listBySource |

> - `headhunter.upload_candidate`: 上传候选人简历(加密入库,生成脱敏版本)。
> - `headhunter.recommend_candidate`: 把已上传的候选人推荐给指定 job(状态: pending)。
> - `headhunter.withdraw_recommendation`: 撤回已提交的推荐(只在 pending / employer_interested 状态可撤回)。
> - `headhunter.publish_to_pool`: 把候选人公开到公共池(让其他猎头/雇主可见)。
> - `headhunter.list_recommendations`: 列出我提交过的所有推荐。
> - `headhunter.list_candidates`: 列出我上传过的所有候选人(脱敏预览)。
> - `headhunter.create_job`: 猎头代雇主建岗(用 create_for_employer_id)。
> - `headhunter.list_jobs`: 列出我建过的所有 job。

### 雇主 (employer) — 10 个能力

| Method | Path | 能力名 | 配额 | 前置条件 | 副作用 |
|--------|------|--------|------|----------|--------|
| POST | `/v1/employer/placements` | `employer.create_placement` | 0 | user.status === "active"; flow.recommendation.place | db.placements.insert; webhook: placement_created |
| GET | `/v1/employer/placements` | `employer.list_placements` | 0 | user.status === "active" | db.placements.listByUser |
| POST | `/v1/employer/jobs` | `employer.create_job` | 5 | user.status === "active" | consume_quota(5); db.jobs.insert |
| GET | `/v1/employer/jobs` | `employer.list_jobs` | 0 | user.status === "active" | db.jobs.listByEmployer |
| GET | `/v1/employer/talent` | `employer.browse_talent` | 1 | user.status === "active" | consume_quota(1); db.candidates_anonymized.listPublicPool |
| POST | `/v1/employer/recommendations/:id/express-interest` | `employer.express_interest` | 3 | user.status === "active"; flow.recommendation.express_interest | consume_quota(3); webhook: notify_unlock_request |
| POST | `/v1/employer/recommendations/:id/unlock-contact` | `employer.unlock_contact` | 5 | user.status === "active"; flow.recommendation.unlock | consume_quota(5); webhook: deliver_contact (PII) |
| GET | `/v1/employer/pending-claims` | `employer.list_pending_claims` | 0 | user.status === "active" | db.jobs.listPendingClaims |
| POST | `/v1/employer/claim-jobs/:id` | `employer.claim_job` | 0 | user.status === "active"; flow.job.claim | db.jobs.updateStatus(claimed) |
| POST | `/v1/employer/reject-jobs/:id` | `employer.reject_job` | 0 | user.status === "active"; flow.job.reject | db.jobs.updateStatus(closed) |

> - `employer.create_placement`: 创建 placement 记录(标记候选人入职成功,平台费按 commission_split 计算)。
> - `employer.list_placements`: 列出我创建的 placement 记录。
> - `employer.create_job`: 创建 job(开放给猎头推荐候选人)。
> - `employer.list_jobs`: 列出我创建过的所有 job。
> - `employer.browse_talent`: 浏览公共池中的脱敏候选人(雇主可以预览行业/职级/年限)。
> - `employer.express_interest`: 对某条 recommendation 表达兴趣(触发 unlock 请求,通知候选人)。
> - `employer.unlock_contact`: 解锁候选人联系方式(候选人已 approve_unlock 后才能调)。
> - `employer.list_pending_claims`: 列出我发布的、等待我 claim 或 reject 的 job(从猎头代建过来的)。
> - `employer.claim_job`: 认领一个由猎头代建的 job(把 job 状态从 open 变为 claimed)。
> - `employer.reject_job`: 拒绝一个由猎头代建的 job(关闭该 job)。

### 候选人 (candidate) — 6 个能力

| Method | Path | 能力名 | 配额 | 前置条件 | 副作用 |
|--------|------|--------|------|----------|--------|
| GET | `/v1/candidate/opportunities` | `candidate.view_opportunities` | 1 | user.status === "active" | consume_quota(1); db.recommendations.listByCandidate |
| GET | `/v1/candidate/access-log` | `candidate.access_log` | 0 | user.status === "active" | db.unlock_audit.listByCandidate |
| GET | `/v1/candidate/export-my-data` | `candidate.export_my_data` | 0 | user.status === "active" | db.dump.candidate |
| POST | `/v1/candidate/recommendations/:id/approve-unlock` | `candidate.approve_unlock` | 3 | user.status === "active"; flow.recommendation.approve_unlock | consume_quota(3); webhook: notify_unlock_approved |
| POST | `/v1/candidate/recommendations/:id/reject-unlock` | `candidate.reject_unlock` | 1 | user.status === "active"; flow.recommendation.reject_candidate | consume_quota(1); db.recommendations.updateStatus(rejected_candidate) |
| POST | `/v1/candidate/delete-my-data` | `candidate.delete_my_data` | 0 | user.status === "active"; flow.user.delete | db.candidates_private.clear; db.users.markDeleted |

> - `candidate.view_opportunities`: 列出所有雇主对我表达过兴趣的推荐(解锁请求列表)。
> - `candidate.access_log`: 查询谁看过我的脱敏数据(解锁审计日志)。
> - `candidate.export_my_data`: 导出我所有个人数据(GDPR data portability)。
> - `candidate.approve_unlock`: 批准雇主解锁我的联系方式(状态: employer_interested → candidate_approved)。
> - `candidate.reject_unlock`: 拒绝雇主解锁我的联系方式。
> - `candidate.delete_my_data`: GDPR right-to-be-forgotten(清空 PII,保留脱敏数据)。

### 管理员 (admin) — 20 个能力

| Method | Path | 能力名 | 配额 | 前置条件 | 副作用 |
|--------|------|--------|------|----------|--------|
| GET | `/v1/admin/ping` | `admin.ping` | 0 | — | — |
| GET | `/v1/admin/dashboard/stats` | `admin.dashboard_stats` | 0 | — | db.aggregate.stats |
| GET | `/v1/admin/users` | `admin.list_users` | 0 | — | db.users.listAll |
| POST | `/v1/admin/users/:id/suspend` | `admin.suspend_user` | 0 | flow.user.suspend | db.users.updateStatus(suspended); admin_action_log: suspend_user |
| POST | `/v1/admin/users/:id/unsuspend` | `admin.unsuspend_user` | 0 | flow.user.unsuspend | db.users.updateStatus(active); admin_action_log: unsuspend_user |
| POST | `/v1/admin/users/:id/adjust-quota` | `admin.adjust_user_quota` | 0 | — | db.users.updateQuota; admin_action_log: adjust_quota |
| GET | `/v1/admin/candidates` | `admin.list_candidates` | 0 | — | db.candidates_anonymized.listAll |
| POST | `/v1/admin/candidates/:id/remove-from-pool` | `admin.remove_from_pool` | 0 | — | db.candidates_anonymized.update(is_public_pool=0) |
| GET | `/v1/admin/audit` | `admin.audit_log` | 0 | — | db.unlock_audit.list |
| GET | `/v1/admin/webhooks/dead-letter` | `admin.webhook_dead_letter` | 0 | — | db.webhook_deliveries.listDeadLetter |
| POST | `/v1/admin/webhooks/:id/retry` | `admin.retry_webhook` | 0 | — | db.webhook_deliveries.update(status=pending) |
| GET | `/v1/admin/rate-limit/buckets` | `admin.rate_limit_buckets` | 0 | — | db.rate_limit.listBuckets |
| POST | `/v1/admin/rate-limit/users/:id/clear` | `admin.clear_user_rate_limit` | 0 | — | db.rate_limit.clearUser |
| GET | `/v1/admin/config` | `admin.get_config` | 0 | — | db.config.getAll |
| PUT | `/v1/admin/config/:key` | `admin.put_config` | 0 | — | db.config.set; admin_action_log: config_change |
| GET | `/v1/admin/placements` | `admin.list_placements` | 0 | — | db.placements.listAll |
| POST | `/v1/admin/placements/:id/mark-paid` | `admin.mark_placement_paid` | 0 | — | db.placements.updateStatus(paid) |
| POST | `/v1/admin/placements/:id/cancel` | `admin.cancel_placement` | 0 | — | db.placements.updateStatus(cancelled) |
| GET | `/v1/admin/placements/summary` | `admin.placements_summary` | 0 | — | db.placements.aggregate |
| GET | `/v1/admin/admin-log` | `admin.admin_log` | 0 | — | db.admin_action_log.list |
| GET | `/v1/admin/login-events` | `admin.login_events` | 0 | — | db.admin_login_events.list |
| GET | `/v1/admin/jobs` | `admin.list_jobs` | 0 | — | db.jobs.listAll |
| GET | `/v1/admin/recommendations` | `admin.list_recommendations` | 0 | — | db.recommendations.listAll |

> - `admin.ping`: Admin 健康检查 ping。
> - `admin.dashboard_stats`: 平台总览统计(用户/候选人/job/placement 数)。
> - `admin.list_users`: 列出所有用户(支持过滤 user_type / status)。
> - `admin.suspend_user`: 暂停某个用户的账号。
> - `admin.unsuspend_user`: 恢复被暂停的账号。
> - `admin.adjust_user_quota`: 调整用户的每日配额上限。
> - `admin.list_candidates`: 列出所有脱敏候选人(管理员视图,含 PII 关联)。
> - `admin.remove_from_pool`: 把候选人从公共池移除(违规内容处理)。
> - `admin.audit_log`: 查看平台 audit_log(谁在什么时间调用了什么 endpoint)。
> - `admin.webhook_dead_letter`: 列出 webhook dead-letter 队列(投递失败待重试的事件)。
> - `admin.retry_webhook`: 手动重试 dead-letter 中的某个 webhook 投递。
> - `admin.rate_limit_buckets`: 查看当前所有 rate-limit bucket 状态(per-user + per-second/minute/hour)。
> - `admin.clear_user_rate_limit`: 清空某个用户的 rate-limit bucket(解除误限)。
> - `admin.get_config`: 读取平台动态配置。
> - `admin.put_config`: 写入/覆盖平台动态配置项。
> - `admin.list_placements`: 列出所有 placement 记录(管理员视图)。
> - `admin.mark_placement_paid`: 把 placement 标记为已支付(财务确认)。
> - `admin.cancel_placement`: 取消一个 placement(候选人未入职等异常情况)。
> - `admin.placements_summary`: placement 总览统计(count / pending / paid / cancelled / total revenue)。
> - `admin.admin_log`: 查看 admin 操作日志(谁在什么时间做了什么管理动作)。
> - `admin.list_jobs`: 列出所有 jobs(含 employer_name),支持 status 筛选 + 关键词搜索。
> - `admin.list_recommendations`: 列出所有 recommendations(含 job_title + headhunter_name),支持 status 筛选 + 关键词 + 时间范围。

<!-- CAPABILITIES_END -->

## 📚 附录 A. v1 范围

- ✅ 注册 / 认证 / 三角色基础
- ✅ 候选人上传 + 服务端脱敏
- ✅ 雇主发 JD + 浏览脱敏人才
- ✅ 猎头推荐 + 跨猎头协作（UNIQUE 防重复）
- ✅ 4 步解锁协议 + Webhook 异步投递
- ✅ AES-256-GCM PII 加密 + 密钥轮换
- ✅ 每日配额 + 三层滑动窗口限流
- ✅ Prometheus 指标 + Cron + Webhook 重试
- ✅ 严格 UTF-8 中间件（拒绝 GBK 字节乱码）

（v1.1+ 进展见 §B changelog；v2 待规划）

---

## 📚 附录 B. Changelog

| 版本 | 日期 | 变化 |
|------|------|------|
| v1.8 | 2026-06-22 | **Conformance Tests (v1.7 upgrade)**: 12 个 vitest scenario 文件覆盖 46 capabilities 的端到端契约。`tests/integration/skill-md-conformance/` 是 vitest-native contract test,模拟"读 skill.md 的客户端"调每个 endpoint 并验响应 shape。`pnpm conformance:gen` 从 capabilities 生成 scenario stubs；`pnpm conformance:check` CI 守门(缺场景则失败)。`examples/reference-agent/` CLI 标记 `@deprecated`,v1.9 删除。641 → 760 tests pass |
| v1.7 | 2026-06-22 | **Phase 4**: Domain Capability Sets。46 capabilities 在 `src/main/capabilities/{auth,headhunter,employer,candidate,admin}.ts` 声明（5 文件 / 5 角色）。`GET /v1/capabilities`（公开）+ `GET /v1/capabilities/me`（鉴权）。`x-capability-name` 响应头。`pnpm capabilities:check` CI 守门；`pnpm capabilities:doc` 自动生成 skill.md 角色能力段。641 tests pass |
| v1.6 | 2026-06-22 | **Phase 3**: 显式状态机。recommendation / job / user 三个 flow 集中到 `src/main/flows/`。删除旧 `modules/unlock/state-machine.ts`。622 tests pass |
| v1.5 | 2026-06-22 | **Phase 2**: OpenTelemetry + trace_id 串联; x-trace-id 响应头; action_history.trace_id (v011); webhook traceparent (v012); 7 个业务 span; 600 tests pass |
| v1.4 | 2026-06-22 | **Phase 0 + Phase 1**: 修复 7 个 bug (rotate-key 立即失效 / claim 状态机 / admin/ping 鉴权 / PII 脱敏 等); 全部 endpoint 走 zod 响应 schema; 595 tests pass |
| v1.3 | 2026-06 | 新增 `GET /v1/market/jobs` 公共端点；13 项 skill.md polish |
| v1.2 | 2026-06 | `GET /v1/employer/talent` 新增 `min_salary`/`max_salary` query 参数 |
| v1.1 | 2026-06 | API-only 模式；新增 `/v1/auth/rotate-key`、`/v1/candidate/delete-my-data`、`/v1/users/{id}/history` |
| v1.0 | 2026-06 | 初始发布；API-only 模式（移除 Electron 桌面客户端） |
| v1.0 | 2026-06 | `utf8-only` 中间件增强：实际检测字节编码（之前仅看 Content-Type） |
| v1.0 | 2026-06 | 修复 `access_log` 旧下划线版 → `access-log` 连字符 |

---

## 📚 附录 C. 端点 → OpenAPI 对照

OpenAPI 3 spec 见 [`/v1/openapi.json`](https://qing3.top/v1/openapi.json)。

- ✅ OpenAPI 包含**所有 HTTP 端点**（v1.9 时点：74 条路径 / 69 operations）
- ⚠️ OpenAPI 的 schema 描述比 skill.md 简略；**以 skill.md §2 主文为准**，OpenAPI 仅作 schema 参考
- 验证：`pnpm openapi:check` 会扫 `src/main/routes/*.ts` 与 openapi.json 对照，保证 0 forward gap
- 历史说明：本附录在 v1.3 时期曾声称"11+ 端点未声明"，该说法已过时；v1.4 起 openapi.json 已与 routes 保持同步

Agent 集成时，先看 §2 endpoint 表 + query 参数，再核对 OpenAPI 是否覆盖。

---

## 📚 附录 D. 相关链接

- 源码仓库：`https://github.com/qing3a/Hunter-Platform`（v1）
- 部署文档：`docs/DEPLOYMENT.md`（v1）
- OpenAPI spec：`docs/superpowers/openapi.json`
- 监控 dashboard：`/metrics`（Prometheus 格式）

---

## 🆘 附录 E. 调试清单

| 症状 | 检查项 |
|------|--------|
| 401 UNAUTHORIZED | `Authorization: Bearer hp_live_...` header 是否正确 |
| 403 FORBIDDEN | 用户类型是否对（candidate 不能用 `/v1/employer/*`）|
| 404 NOT_FOUND | 路径拼写，特别是 `access-log` 用连字符 |
| 400 INVALID_CHARSET | 请求体必须是 UTF-8（§4.3）|
| 409 DUPLICATE_REQUEST | 同一 `(候选人, job)` 重复推荐 |
| 409 INVALID_STATE | 状态机非法转换，按 §3 检查当前 status |
| 429 RATE_LIMITED | 严格按 `Retry-After` 等待 |
| view_url 410 Gone | token 单次使用，重新走流程生成新 token |
| view_url 410 Gone（1h 后）| token 过期，重新走完整流程 |
| view_url 401 Unauthorized | agent_endpoint 已撤销，重新注册或联系 owner |
| webhook 收不到 | 检查 `agent_endpoint` 是否可达、签名校验是否过、时间戳是否在 300s 内 |
| 脱敏字段是 `其他` / `未分类` | 输入值不在 `config/industry_map.json` 和正则规则中，详见 §0.4 |

### view_url 失效条件（两种独立）

| 触发条件 | 状态码 | 含义 |
|----------|--------|------|
| 同一 token 第二次访问 | 410 Gone | **单次使用**——已消费 |
| 同一 token 1h 后访问 | 410 Gone | **token 过期** |

两者都返 410，agent 需重新走 unlock 流程生成新 token。

---

## ⚙️ 附录 F. 环境变量

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `PLATFORM_ENCRYPTION_KEY` | ✅ | — | AES-256-GCM 密钥，base64 of 32 bytes。单 key 模式。 |
| `PLATFORM_ENCRYPTION_KEYS` | ❌ | — | 多 key 轮换模式：`v1:<b64>,v2:<b64>`，最新 key 用于加密 |
| `WEBHOOK_HMAC_SECRET` | ✅ | — | webhook 签名密钥，≥ 16 字符 |
| `ADMIN_PASSWORD_HASH` | ✅ | — | bcrypt 哈希 |
| `DATABASE_PATH` | ❌ | `./data/hunter.db` | SQLite 文件路径 |
| `PORT` | ❌ | `3000` | HTTP 监听端口 |
| `NODE_ENV` | ❌ | `development` | `development` / `test` / `production` |
| `LOG_LEVEL` | ❌ | `info` | `debug` / `info` / `warn` / `error` |
| `RATE_LIMIT_ENABLED` | ❌ | `true` | `false` 关闭所有限流（per-user sliding window + IP register）；仅本地开发/测试用 |

### 调试技巧

```bash
# 跳过单次请求的限流（不开 RATE_LIMIT_ENABLED 时调试用）
curl -H "X-RateLimit-Skip: 1" ...
```

---

## 🗄️ 附录 G. DB Migrations

| 版本 | 内容 | 影响 |
|------|------|------|
| v001 | 基线（users、candidates、idempotency、rate_limit、action_history） | — |
| v002 | jobs、recommendations、unlock_audit_log、webhook_delivery_queue | — |
| v003 | placements、admin_action_log | — |
| v004 | view_tokens 表（render-layer） | — |
| v005 | jobs.required_skills_json | — |
| v006 | users.api_key_expires_at（rotate-key grace period 基础） | 新 API：`POST /v1/auth/rotate-key` |
| v007 | users prev_api_key_hash/prefix/expires_at（完整 grace slot） | — |
| **v008** | **GDPR soft-delete**：users.name/contact 和 candidates_private.{name_enc, phone_enc, email_enc} 改为 nullable | 新 API：`POST /v1/candidate/delete-my-data` |

v008 是为支持 GDPR 软删（`POST /v1/candidate/delete-my-data`）添加的：原本这些字段在 v001 schema 都是 NOT NULL，删除时 set NULL 抛 `NOT NULL constraint failed`。v008 用 SQLite 12-step recreate 模式把字段改为 nullable。