# Changelog

本文档记录 Hunter Platform 的所有重要变更。
最新版本以源码为准。

---

## v2.2.0 (Sub-D2 Plan 1 — Backend Timeline) — 2026-06-25

### 新增功能
- **Per-Entity Timeline 后端 endpoint**：`GET /v1/admin/timeline/:type/:id`
  - `type` ∈ `user | candidate | job | recommendation`
  - UNION 3 个 audit 表（`admin_action_log` + `action_history` + `unlock_audit_log`）
  - 支持 filter：`source`（admin/user/unlock）、`from`/`until` 时间范围、`actor` LIKE 匹配
  - Paginated envelope（page + pageSize 1-200）
- **新 capability**：`admin.get_timeline`（admin role 即可访问，quota_cost: 0）

### 测试
- 后端 +15 个集成测试（覆盖 4 entity type + filter + 边界）

---

## v2.4.0 (Sub-D4 Plan 1 — Backend Detail + Retry Audit) — 2026-06-25

### 新增功能
- **4 个 GET :id endpoint**：`/v1/admin/users/:id` + `/jobs/:id` + `/candidates/:id` + `/recommendations/:id`（返回单条 entity，404 if not found）
- **Webhook retry 写 audit log**（Sub-D3 known limitation fix）：`webhooks.retry()` 现在写 `admin_action_log`（action='retry_webhook'，含 event_type/target_user_id/previous_attempt_count）

### Breaking changes
- `webhooks.retry()` handler signature 加 `adminUserId` 参数（仅 admin-web 调用，Plan 2 同步修复）

### 测试
- 后端 +9 个集成测试

---

## v2.3.0 (Sub-D3 Plan 2 — Frontend Webhooks + Placements) — 2026-06-25

### 新增功能
- **2 个新 page**：
  - `/webhooks/dead-letter` — WebhookDeadLetterPage（filter: event_type/min_attempts/from/until + 重试）
  - `/placements` — PlacementsPage（filter: status/from/until + mark-paid/cancel via ConfirmModal）
- **ConfirmModal 组件**：shared confirm dialog，支持 variant=primary|danger + loading + 内联错误显示
- **API wrappers**：`listDeadLetter` + `retryDeadLetter` + `listPlacements` + `markPaid` + `cancelPlacement`
- **Layout 导航**：+2 nav items (Webhook 死信 / Placements)
- **Dashboard 卡片 link**：Webhook 死信 metric 加 `<Link>` 跳到 /webhooks/dead-letter

### 测试
- 前端 +19 个新测试（API wrapper 9 + ConfirmModal 5 + WebhookDeadLetterPage 4 + PlacementsPage 5 = 23 total, 部分测试因 fix 调整）

---

## v2.3.0 (Sub-D3 Plan 1 — Backend Webhooks + Placements) — 2026-06-25

### 新增功能
- **GET /v1/admin/webhooks/dead-letter**：paginated envelope + 4 个 filter（event_type/min_attempt_count/from/until）
- **GET /v1/admin/placements**：paginated envelope + 3 个 filter（status/from/until）
- **新 capability**：`admin.list_dead_letter`（`admin.list_placements` 已存在，更新 response_schema）

### Breaking changes（admin-web 同步修复）
- 2 个 GET endpoint 之前返回 flat array，现在返回 `{ ok, data, pagination }` envelope
- 仅 admin-web 调用，影响本项目 frontend（Plan 2 同步上 UI）

### 测试
- 后端 +13 个集成测试（webhook 死信 6 + placements 7）
- e2e-m3 测试更新为 envelope 形式

---

## v2.2.0 (Sub-D2 Plan 2 — Frontend Timeline) — 2026-06-25

### 新增功能
- **4 个 per-entity timeline 页面**：
  - `/users/:id/timeline` — UserTimelinePage
  - `/candidates/:id/timeline` — CandidateTimelinePage
  - `/jobs/:id/timeline` — JobTimelinePage
  - `/recommendations/:id/timeline` — RecommendationTimelinePage
- **2 个共享组件**：
  - `<TimelineFilterBar>` — source + from/until + actor + clear 筛选条
  - `<TimelineList>` — 扁平列表，source badge（admin=蓝/user=绿/unlock=橙）+ AuditJsonDrawer 详情查看
- **API wrapper**：`getTimeline(type, id, opts)` + 类型定义
- **列表页入口**：UsersPage / CandidatesPage / JobsPage / RecommendationsPage 行末加「时间轴」Link 跳到对应 timeline 页
- **filter 不持久化到 URL**（Sub-D3 follow-up）

### 测试
- 前端 +28 个新测试（API wrapper 5 + FilterBar 3 + List 4 + 4 page × 4 = 16 + 列表 Link 集成）

---

## v2.1.1 (Sub-C Plan 2 — Mutation) — 2026-06-25

### 新增功能
- **UsersPage 调配额按钮**：每行（active 用户）新增「调配额」按钮，弹 QuotaModal 表单
- **QuotaModal**：new_quota 数字输入 + reason 文本域（3-500 字符） + 客户端校验
- **Toast 系统**：lib/toast.tsx + ToastProvider + useToast hook，3 秒自动消失
- **Modal 系统**：portal + ESC + 焦点管理 + body scroll lock
- **AuditPage 详情列**：Admin Actions tab 加「详情」按钮，点开 AuditJsonDrawer 显示 reason

### Bug 修复（**Breaking**）
- **`POST /v1/admin/users/:id/adjust-quota` 不写 audit log 的历史 bug**：
  - handler 现在接 `adminUserId + reason` 参数
  - reason 必填（3-500 字符校验在 route + handler 双层）
  - 写 `admin_action_log` 表，action = `adjust_user_quota`
  - 响应从 `{ user_id, new_quota }` 扩到 `{ user_id, previous_quota, new_quota, reason }`

### 已知限制
- AuditPage「详情」按钮**暂时只显示 reason**，不显示 details_json（previous_quota/new_quota 结构）。要让 details_json 暴露，需要扩展 `/v1/admin/admin-log` endpoint 返回 details_json 字段。留 Sub-D2 范围。

### 测试
- 后端 +7 个集成测试
- 前端 +18 个组件/页面测试（Toast 3 + Modal 4 + QuotaModal 5 + adjustQuota 3 + UsersPage 3）

### Breaking change migration
- 任何外部调用 `adjust-quota` 的脚本必须在 body 加 `reason: "..."`，否则会 400
- 响应 schema 变了——前端同步更新，无其他客户端

---

## v2.1.0 (Sub-C Plan 1 — Read-Only Data) — 2026-06-25

### 新增功能
- **Jobs 列表页**：admin-web `/jobs`，含 status 筛选 + 关键词搜索 + 分页 + 详情侧滑 + CSV 导出
- **Recommendations 列表页**：`/recommendations`，含 8 种 status 筛选 + 关键词 + 时间范围 + 详情 + 导出
- **Dashboard 增量**：4 张职位状态卡片（开放/暂停/已关闭/已招到）+ 3 张推荐卡片（总数/今日新增/待处理 vs 已解锁）
- **后端新 endpoint**：`GET /v1/admin/jobs` + `GET /v1/admin/recommendations`
- **Dashboard stats +7 字段**：total_recommendations / today_new_recommendations / recommendations_pending / recommendations_unlocked / jobs_paused / jobs_closed / jobs_filled
- **新 capability**：`admin.list_jobs` + `admin.list_recommendations`

### Bug 修复
- **Sub-B SearchBar filter 透传**：CandidatesPage / UsersPage 的 status 筛选现在真正传到 API（之前被 silently 丢弃）

### 测试
- 后端 +10 个集成测试
- 前端 +28 个组件/页面测试

### 后续
- **Plan 2**（独立）：adjustQuota 审计修复 + QuotaModal + UsersPage 调配额按钮 + AuditPage 详情列

---

## v1.8.0 — 2026-06-22

**重点**：API 自检（self-policing）+ 3 个 production bug 修复 + 0 skipped tests + 161 行参考客户端。

### ✨ 新增

- **skill.md 一致性测试套件**（Phase 5）— 每个 capability 都有 vitest 测试，调用端点 + 校验 zod schema + 抓 x-trace-id 头。docs/code drift 立即失败。
- **参考客户端** `examples/hunter-client.ts`（Phase 9）— 161 行 TypeScript 类，零额外配置（仅 zod 依赖），外部 AI Agent 开发者可直接拷贝使用。8 个 convenience methods + `HunterError` 类型化错误类。取代 v1.7 deprecated 的 `examples/reference-agent/` CLI smoke test。

### 🐛 修复

- **3 个 admin production bug**（Phase 8）— handler 返回的 shape 与 zod schema 不一致，之前 strict 模式下返 500：
  - `POST /v1/admin/candidates/:id/remove-from-pool`：返回 `is_public_pool` 改为 `removed: true`
  - `POST /v1/admin/rate-limit/users/:id/clear`：返回 `deleted` 改为 `cleared: true`
  - `GET /v1/admin/placements/summary`：重写为 5 字段（`total_count`/`pending_payment_count`/`paid_count`/`cancelled_count`/`total_revenue`）
- **8 个 admin handler 静默泄露 PII/secret**（Phase 6）— 之前用 `SELECT *` + 静默 strip 不一致字段，会泄露 `contact`、`api_key_*` 等。改为列投影 + `{ strict: true }`，现在保证 `/v1/admin/users` 返回正好 9 个字段。
- **schema-shape 测试 helper bug**（Phase 7）— `pathParamsFor()` 漏掉 `admin.adjust_user_quota` 的 case，导致 path 变 `/v1/admin/users//adjust-quota`（空 :id）返 404。

### 🔧 内部

- 所有 admin route 加 `{ strict: true }`（Phase 6）— 不一致字段立即 ZodError 500，不再静默。
- 22 个原 skipped 测试填好（Phase 7），拆 4 个文件：main（25 simple）+ destructive（2）+ flow（7）+ admin-precondition（12）。
- Conformance suite **0 skipped**（Phase 8 refactor）— 21 个复杂 capability 通过 `COMPLEX_CAPS` set 在主文件过滤，sibling 文件独占 coverage。

### 📊 数据

- 测试：509 → 641 → **779**（+53%）
- Skipped：22 → **0**
- Capability 覆盖率：24/46 → **46/46**
- Strict-mode 路由：0 → **20**
- 公开 bug 抓获：0 → **3**（已修）

详见 `docs/superpowers/releases/v1.8.md`。

---

## v1.4.1 — 2026-06-20

**跨度合并发布**：本版本一次性收口 v1.0.2 之后未提交的全部工作（v1.1 / v1.2 / v1.3 / v1.3.1 / v1.4 五个未发布版本的代码累积）以及 v1.4.1 的 7 大类未文档化新功能。

**重点**：API-only 重定位（删除 Electron 桌面客户端）+ 严格 UTF-8 + 完整鉴权/限流/审计 + GDPR 软删 + 公开市场端点 + 一次性 token 视图 + 公共 dashboard + landing v2 + 参考 Agent。

### ✨ 新增功能（7 大类）

#### 1. 鉴权/账户

| 端点 | 说明 | 配额 |
|------|------|------|
| `POST /v1/auth/rotate-key` | 轮换当前用户的 API key（旧 key 24h grace） | 1 |
| `POST /v1/candidate/delete-my-data` | GDPR 软删：抹除 PII + 立即失效 API key | 1 |
| `GET /v1/users/{id}/history` | 查询本人操作历史（支持 `?limit=` `?since=` `?offset=`） | 1 |

#### 2. 公开端点

| 端点 | 说明 |
|------|------|
| `GET /v1/market/jobs` | 猎头无需注册雇主身份即可看市场所有 open JD；可选 `industry` / `limit` / `offset` query 参数；optional auth 时扣 1 quota |
| `GET /v1/market/leaderboard` | 公开排行榜；optional auth（之前误要求 Bearer，v1.4.1 改为可选） |
| `GET /v1/config/{industries,title_levels,salary_bands}` | 公开配置端点；optional auth |
| `GET /v1/headhunter/candidates` | 猎头候选人列表（公开化） |
| `GET /v1/employer/talent` | 新增 `min_salary` / `max_salary` query 参数：与 `SALARY_BANDS` 求交集过滤 |

#### 3. 限流重设计

- 算法：fixed-window → **sliding-window-counter**
- 1h 阈值上调 1.5x（candidate 200→300、headhunter 500→750、employer 800→1200）
- 响应新增 IETF `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` 头
- 任一窗口 remaining < 20% 时新增 `RateLimit-Policy: warn` 头（软警告）
- 429 响应 `Retry-After` 始终存在；撞限后能渐进恢复
- 旁路：`RATE_LIMIT_ENABLED=false`（关闭所有限流）+ `X-RateLimit-Skip: 1`（跳过单次请求）

#### 4. action_history 审计中间件

- 路由级审计中间件（`AUDITED_PREFIXES` 改为前缀匹配，覆盖 `/v1/auth/*` 和 `/v1/users/*`）
- 完整 `action_type` 枚举映射表（`src/main/modules/audit/route-action-map.ts`）
- last-segment fallback：未匹配时用 last resource segment
- 5 步 PII 隔离：写入审计时过滤 PII 字段

#### 5. 一次性 token 视图层

- `POST /v1/views/audit/{user_id}`：审计视图（24h 过期）
- `POST /v1/views/recommendation/{rec_id}`：推荐视图（单次使用）
- `view_url` 字段在响应里返回；客户端打开后看到人类可读的 HTML 渲染

#### 6. landing v2 + 公共 dashboard

- landing 页面 v2（marketplace 风格 + social proof）
- 公共 `GET /dashboard` 端点

#### 7. 参考 Agent

- `examples/reference-agent/`：自动验证 skill.md 列出的 27 个端点
- 跑通 37 个端点（多角色测试自然重复）
- 用作 contract test、参考实现、CI 烟雾测试

### 🐛 Bug 修复

| # | 症状 | 修复 |
|---|------|------|
| 1 | 未匹配 `/v1/*` 路由返 Express 默认 HTML 404 页 | 全局 404 JSON 兜底中间件（`src/main/server.ts`） |
| 2 | `/v1/config/*`、`/v1/market/leaderboard` 无 Bearer 返 401（与 skill.md §5.6 矛盾） | 改用 `optionalAuthMiddleware`（仅尝试认证，不强制） |
| 3 | 同一 `contact` 跨 `user_type` 注册返 `DUPLICATE_REQUEST` | 错误码改 `CONTACT_TAKEN`；message 区分同 role / 跨 role；schema 不变（应用层校验） |
| 4 | `action_history.action_type` 是 raw path（`unknown_get_v1_employer_placements`） | 完整枚举映射表 `src/main/modules/audit/route-action-map.ts`；fallback 用 last resource segment |
| 5 | `POST /v1/candidate/delete-my-data` 抛 500 `NOT NULL constraint failed: users.name` | `v008_gdpr_nullable.sql`（新增），含 v006/v007 全部 18 列 |
| 6 | `/v1/auth/rotate-key` 没被审计 | `AUDITED_PREFIXES` 改为 `['/v1/auth', '/v1/users', ...]` 前缀匹配 |
| 7 | 严格 UTF-8 请求体未验收（之前仅看 Content-Type） | 新 `utf8-only` 中间件：验证原始字节 + 启发式 GBK 检测 |

### ⚠️ Breaking Changes

| 项目 | v1.0 行为 | v1.4.1 行为 |
|------|----------|------------|
| **Electron 桌面客户端** | 已存在 | **删除**。Admin UI 不再附带。如需后台管理，用 `/v1/auth/rotate-key` 等 REST 端点。 |
| **API 响应字符编码** | 仅检查 Content-Type charset header | 严格验证请求体**原始字节**：遇到 GBK/GB18030 → 400 `INVALID_CHARSET` |
| **限流算法** | fixed-window-counter | sliding-window-counter，1h 阈值 1.5x |
| **access-log 路径** | `/v1/candidate/access_log` | `/v1/candidate/access-log`（连字符） |
| **delete-my-data 路径** | 不存在 | `/v1/candidate/delete-my-data`（连字符，POST） |
| **contact 跨 role 唯一** | 错误地禁止（用 `DUPLICATE_REQUEST` 报错） | 允许（用 `CONTACT_TAKEN` 区分信息） |
| **Job.requirements 字段** | 存在 | **从 API 表面删除**。客户端不要再依赖该字段。 |
| **config/market 鉴权** | 强制 Bearer | optional auth（无 Bearer 也可调，扣 1 quota/天） |

### 📝 新增配置

```bash
# 关闭所有限流（per-user sliding window + IP register）
# 仅用于本地开发/测试；生产保持默认（开启）
RATE_LIMIT_ENABLED=false  # 默认 true
```

```bash
# 跳过单次请求的限流（debug 用）
curl -H "X-RateLimit-Skip: 1" ...
```

```bash
# API-first 重定位后 DB 路径 env 化（默认 ./tmp/hunter.db）
DATABASE_PATH=/var/lib/hunter/hunter.db
```

### 🗄️ 数据库变更

| Migration | 内容 |
|-----------|------|
| `v006_api_key_grace_period.sql` | API key 表加 grace_period_until 列，支持 rotate-key 24h grace |
| `v007_grace_period_slot.sql` | 补全 v006 的所有列（共 18 列） |
| `v008_gdpr_nullable.sql` | `users.name`、`users.contact`、`candidates_private.{name_enc, phone_enc, email_enc}` 改为 nullable，支持 GDPR 软删 |

### 📖 文档

- `docs/superpowers/skill.md`：完整重写（从"API 端点列表"升级为"业务模型 + 端点 + 决策启发 + 运营建议"结构）；增加 §14「Agent 决策手册」（~280 行策略层：通用启动循环 + 三角色工作流 + webhook 决策 + quota 预算 + 跨猎头协作 + 失败恢复 + 9 条反模式）
- `docs/superpowers/openapi.json`：从 18 条路径扩展到 **29 条路径**，与 skill.md §2 一致；`info.version` 升级到 1.4.1
- `docs/OPERATIONS.md`：**新建**（从 skill.md §9/§10 拆出来的运维指南，~150 行：环境变量 / 密钥轮换 / cron / 优雅关闭 / DB 迁移）
- `docs/CHANGELOG.md`：本文件（顶部覆盖重写为 v1.4.1 主条目）
- `docs/FIX_PLAN*.md`：6 个历史执行计划入库（v1.1 / v1.2 salary / v1.2 skill14 / v1.3 / v1.3.1 / v1.4）
- `examples/reference-agent/`：参考 Agent 实现（自动验证 27 端点）
- `scripts/generate-openapi.ts`：**新建**，从 `src/main/routes/*.ts` 提取路由 → 生成 openapi.json
- `tests/scripts/openapi-coverage.test.ts`：**新建**，4 个测试覆盖 `generate-openapi.ts`

### ✅ 验证

- `pnpm test`: **391 / 391 PASS**（373 from v1.1 + 8 from v1.2 employer-talent-filter + 6 from v1.3 market-jobs + 4 from v1.4 openapi-coverage = 391）
- `pnpm typecheck`: 0 errors
- `pnpm openapi:check`: ✓ openapi.json is up to date
- `pnpm build`: 成功（`out/main/index.js` 存在）
- E2E happy path 全通
- view_url 单次有效（200/410/410）
- Webhook 投递合法（HMAC + PII）
- 参考 Agent 37/37 endpoint passed

---

## v0.3.1 — Misc Fixes (2026-06-19)

**功能新增**:
- `POST /v1/candidate/recommendations/:id/approve-unlock` 后，employer 端会收到新 webhook 事件 `notify_unlock_approved`（payload: recommendation_id / anonymized_candidate_id / candidate_user_id / approved_at，不含 PII）

**文档补充**:
- `view_url` 字段在 skill.md 新增"视图链接"章节

**API 变更**:
- Job 对象的 `requirements` 字段已从 API 表面删除。客户端不要再依赖该字段。
- 请求 `Content-Type` 校验：非 GET 请求必须为 `application/json`（含或不含 charset 都行，**默认 utf-8** per RFC 8259）或 `application/json; charset=utf-8`。`charset=gbk` 等错误编码返回 400 `INVALID_CHARSET`。

**质量改进**:
- `SCHOOL_TIERS` 扩到完整 39 所 985（之前只 6 所，其他 985 校会错误地映射为 "普通"）

---

## v0.3.0 — Rate Limit Redesign (2026-06-19)

**Breaking change for Agent 集成方**: 限流算法从 fixed-window 改为 sliding-window-counter。

- 1h 阈值上调 1.5x（candidate 200→300、headhunter 500→750、employer 800→1200）
- 所有认证响应新增 IETF `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` headers
- 任一窗口 remaining < 20% 时新增 `RateLimit-Policy: warn` 头
- 429 响应 `Retry-After` 字段始终存在
- 撞限后能渐进恢复，不再"锁一整窗口"

**Action required**: 客户端应主动读 `RateLimit-Remaining` 头进行节流；收到 429 时严格按 `Retry-After` 重试。

完整文档：[docs/superpowers/skill.md](../superpowers/skill.md) 的"限流"章节。

---

## v0.1.0 — 2026-06-18（基线）

- 三角色注册/认证
- 候选人上传 + 服务端脱敏
- 雇主发 JD + 浏览脱敏人才
- 猎头推荐 + 跨猎头协作（UNIQUE 防重复）
- 4 步解锁协议 + Webhook 异步投递
- AES-256-GCM PII 加密 + 密钥轮换
- 每日配额 + 三层滑动窗口限流
- Prometheus 指标 + Cron + Webhook 重试
- Electron 桌面客户端（v1.1 已删除）