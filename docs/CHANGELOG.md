# Changelog

本文档记录 Hunter Platform 的所有重要变更。
最新版本以源码为准。

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