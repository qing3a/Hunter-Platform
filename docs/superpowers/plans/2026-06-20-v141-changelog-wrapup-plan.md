# v1.4.1 Changelog Wrap-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `d:/dev/hunter-platform` 工作区里 v1.1~v1.4+1.4.1 的全部工作（86 commit worth、57 modified + 15 deleted + 15 untracked）作为 1 个 git commit + annotated tag v1.4.1 收口，发到 GitHub 并创建 GitHub Release。

**Architecture:** 线性 10 任务流水线：4 件套验证 → 4 处文件编辑（CHANGELOG/package.json/openapi.json/release notes）→ pre-commit 校对 → commit → tag → push → GitHub Release。每步独立验证、有失败处理。

**Tech Stack:** TypeScript, vitest, better-sqlite3, pnpm, Git, GitHub CLI (gh)。

**Reference spec:** `docs/superpowers/specs/2026-06-20-v141-changelog-wrapup-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `docs/CHANGELOG.md` | Modify | 顶部覆盖重写为 v1.4.1 主条目（吸掉 v1.1~v1.4） |
| `package.json` | Modify | `version: 0.1.0 → 1.4.1` |
| `docs/superpowers/openapi.json` | Modify | `info.version: 1.0.0 → 1.4.1` |
| `docs/superpowers/release-notes/2026-06-20-v1.4.1.md` | Create | v1.4.1 release notes（参照 2026-06-19-v1.0.md） |
| 1 git commit | Create | `release: v1.4.1 — 跨度合并 v1.1~v1.4+1.4.1` |
| 1 annotated tag | Create | `v1.4.1` |
| 1 GitHub Release | Create | `v1.4.1` on `qing3a/Hunter-Platform` |

---

## Task 1: 发版前 4 件套验证

**Files:** 无修改，仅运行命令。

- [ ] **Step 1: 跑 `pnpm test`**

```bash
cd /d/dev/hunter-platform && pnpm test 2>&1 | tail -40
```

预期：末行显示 `Test Files  X passed (X)` + `Tests  X passed (X)`，**没有 failed**。CHANGELOG v1.4 声称 391/391，但实际数字以本次为准。

失败处理：列失败清单给用户决定。

- [ ] **Step 2: 跑 `pnpm typecheck`**

```bash
cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -20
```

预期：末行 `0 errors`。

失败处理：列错误位置，等用户决定。

- [ ] **Step 3: 跑 `pnpm openapi:check`**

```bash
cd /d/dev/hunter-platform && pnpm openapi:check 2>&1 | tail -20
```

预期：末行 `✓ openapi.json is up to date` 或类似成功信息。

失败处理：跑 `pnpm openapi:generate` 重生成并比对 diff。

- [ ] **Step 4: 跑 `pnpm build`**

```bash
cd /d/dev/hunter-platform && pnpm build 2>&1 | tail -20
```

预期：无 error。验证产物：

```bash
cd /d/dev/hunter-platform && ls -la out/main/index.js
```

预期：文件存在，size > 0。

失败处理：看 tsconfig 报错，等用户决定。

- [ ] **Step 5: 记录实际数字**

把 4 步的实际数字（test 通过数、typecheck 错误数、openapi:check 结果、build 状态）记下来，下一步会用到。如果数字与 CHANGELOG v1.4 声称的 391 不一致，**停下来**告知用户，由用户决定是否继续。

- [ ] **Step 6: 提交验证结果**

```bash
cd /d/dev/hunter-platform && git add -A && git commit --allow-empty -m "ci: v1.4.1 pre-release validation passed

- pnpm test: <N>/<N> PASS
- pnpm typecheck: 0 errors
- pnpm openapi:check: OK
- pnpm build: OK" && git reset HEAD~1
```

说明：用 `--allow-empty` 留个 commit 记录，验证完再 `git reset HEAD~1` 撤掉（保留 working tree 不动）。如果用户希望保留这个 commit，跳过 reset。

---

## Task 2: 改写 `docs/CHANGELOG.md` 顶部为 v1.4.1 主条目

**Files:**
- Modify: `docs/CHANGELOG.md`（顶部替换 v1.1~v1.4 五个条目为一个 v1.4.1 主条目）

- [ ] **Step 1: 备份当前 CHANGELOG**

```bash
cp /d/dev/hunter-platform/docs/CHANGELOG.md /d/dev/hunter-platform/docs/CHANGELOG.md.bak-v1.4.1-pre
```

- [ ] **Step 2: 读当前文件前 5 行确认结构**

```bash
head -5 /d/dev/hunter-platform/docs/CHANGELOG.md
```

预期：

```
# Changelog

本文档记录 Hunter Platform 的所有重要变更。
最新版本以源码为准。
```

- [ ] **Step 3: 替换顶部为 v1.4.1 主条目**

把文件前 192 行（从 `# Changelog` 到 `v0.3.0 章节结束后的第一个 `---`）整段替换为以下内容。`v0.3.1`（2026-06-19）之前的 v0.3.0、v0.1.0 条目保留。

**写入 v1.4.1 主条目**（**全部 156 行**）：

```markdown
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

```

- [ ] **Step 4: 保留 v0.3.1 / v0.3.0 / v0.1.0 三个旧条目**

新 v1.4.1 主条目写完后，原文件的 v0.3.1、v0.3.0、v0.1.0 三个条目（从"## v0.3.1 — Misc Fixes"开始到文件末尾）需要**原样保留**在 v1.4.1 主条目下方。

用以下命令把 v0.3.1 开始的剩余内容追加到新写的主条目之后：

```bash
grep -n "^## v0.3.1" /d/dev/hunter-platform/docs/CHANGELOG.md.bak-v1.4.1-pre
```

找到 v0.3.1 起始行号（预期：第 161 行左右）后：

```bash
# 假设 v0.3.1 起始行号是 161
tail -n +161 /d/dev/hunter-platform/docs/CHANGELOG.md.bak-v1.4.1-pre >> /d/dev/hunter-platform/docs/CHANGELOG.md
```

- [ ] **Step 5: 校对文件结构**

```bash
cd /d/dev/hunter-platform && grep -n "^## v" docs/CHANGELOG.md
```

预期输出（4 个 `##` 标题行，v1.4.1 在最上）：

```
8:## v1.4.1 — 2026-06-20
166:## v0.3.1 — Misc Fixes (2026-06-19)
189:## v0.3.0 — Rate Limit Redesign (2026-06-19)
203:## v0.1.0 — 2026-06-18（基线）
```

如果行号或顺序不对，重新检查文件。

- [ ] **Step 6: 删除备份**

```bash
rm /d/dev/hunter-platform/docs/CHANGELOG.md.bak-v1.4.1-pre
```

---

## Task 3: bump `package.json` version

**Files:**
- Modify: `package.json`（第 3 行 `version` 字段）

- [ ] **Step 1: 编辑 version**

```bash
cd /d/dev/hunter-platform && sed -i 's/"version": "0.1.0"/"version": "1.4.1"/' package.json
```

- [ ] **Step 2: 校对**

```bash
cd /d/dev/hunter-platform && grep '"version"' package.json
```

预期：`"version": "1.4.1",`

失败处理：手动用编辑器打开 `package.json` 检查 JSON 是否合法（`node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)"`）。

- [ ] **Step 3: 顺手校对没有 electron 残留**

```bash
cd /d/dev/hunter-platform && grep -i electron package.json
```

预期：no matches（CHANGELOG v1.1 已声明删除 electron 相关 dev deps）。

如果还有 electron 字符串，停下来告诉用户，由用户决定是手动清掉还是先 commit 当前状态。

---

## Task 4: bump `docs/superpowers/openapi.json` info.version

**Files:**
- Modify: `docs/superpowers/openapi.json`（`info.version` 字段）

- [ ] **Step 1: 编辑 info.version**

```bash
cd /d/dev/hunter-platform && sed -i 's/"version": "1.0.0"/"version": "1.4.1"/' docs/superpowers/openapi.json
```

**注意**：JSON 里可能有多处 `"version": "1.0.0"`，要确认是 `info.version` 而不是某个 schema 的 version（如 `PAYMENT_API_VERSION` 之类）。用下面命令先看：

```bash
cd /d/dev/hunter-platform && grep -n '"version"' docs/superpowers/openapi.json | head -5
```

预期：info 块里有一行 `"version": "1.0.0"`；其他 version 字段（如 api 的 version）不应被替换。如果只有 1 行匹配上面 `sed` 即可；如果有多行匹配 `1.0.0`，**停下来**告诉用户哪些行需要改。

- [ ] **Step 2: 校验 JSON 合法 + 校对**

```bash
cd /d/dev/hunter-platform && node -e "const o = require('./docs/superpowers/openapi.json'); console.log('info.version =', o.info.version);"
```

预期：`info.version = 1.4.1`

- [ ] **Step 3: 跑 openapi:check 确认仍然一致**

```bash
cd /d/dev/hunter-platform && pnpm openapi:check 2>&1 | tail -10
```

预期：仍然 `✓ openapi.json is up to date`（手动改的 version 字段不影响生成脚本的输出比对，因为脚本比对的应该是 path/schemas 而不是 version）。

如果失败，**停下来**告诉用户。

---

## Task 5: 新建 `docs/superpowers/release-notes/2026-06-20-v1.4.1.md`

**Files:**
- Create: `docs/superpowers/release-notes/2026-06-20-v1.4.1.md`

- [ ] **Step 1: 复制模板**

```bash
cp /d/dev/hunter-platform/docs/superpowers/release-notes/2026-06-19-v1.0.md /d/dev/hunter-platform/docs/superpowers/release-notes/2026-06-20-v1.4.1.md
```

- [ ] **Step 2: 改标题与基础元信息**

```bash
cd /d/dev/hunter-platform && sed -i \
  -e 's/# Release Notes — 2026-06-19 — v1.0 Reference Agent & Docs Polish/# Release Notes — 2026-06-20 — v1.4.1 跨度合并发布/' \
  -e 's/\*\*版本\*\*: 0.2.1 → 1.0.0/**版本**: v1.0.2 → v1.4.1（跨度合并）/' \
  -e 's/\*\*日期\*\*: 2026-06-19/**日期**: 2026-06-20/' \
  -e 's/\*\*commits since 0.2.1\*\*: 8 new (b42ba15..HEAD)/**commits since v1.0.2**: 86 commits 在工作区累积，跨度合并为单 commit/' \
  docs/superpowers/release-notes/2026-06-20-v1.4.1.md
```

- [ ] **Step 3: 改 TL;DR 段**

用编辑器把 TL;DR 段从 v1.0 的内容改写为 v1.4.1 的：

```markdown
## TL;DR

v1.4.1 是项目的"跨度合并发布"——一次性收口 v1.0.2 之后未提交的全部工作（v1.1~v1.4 五个未发布版本的代码累积）和 v1.4.1 的 7 大类新功能。

**状态**：✅ 项目从"实验性 v1"演进到"API-first 生产可用"——删除 Electron 桌面客户端、严格 UTF-8 强制、限流 sliding-window + IETF 头、GDPR 软删、审计中间件、视图层、landing v2、参考 Agent。

**测试**：373 (v1.1 baseline) + 8 (v1.2 employer-talent-filter) + 6 (v1.3 market-jobs) + 4 (v1.4 openapi-coverage) = **391 / 391 PASS**。
```

- [ ] **Step 4: 改 What's New 段为 v1.4.1 实际内容**

把 "What's New" 整段替换为 v1.4.1 的 7 大类（鉴权/账户、公开端点、限流、action_history 审计、视图层、landing+dashboard、参考 Agent）—— 内容可以直接从 CHANGELOG v1.4.1 主条目复制"✨ 新增功能"段。

- [ ] **Step 5: 改 Stats 表**

```markdown
## Stats

| 项 | v1.0.2 | v1.4.1 | 变化 |
|----|--------|--------|------|
| Endpoint coverage (skill.md) | 18 | **29** | +11 |
| Endpoint tested by reference agent | 0 | **37** | NEW |
| Integration tests | 177 | 387 | +210 |
| OpenAPI 自动生成 | 无 | **有**（`pnpm openapi:generate`） | NEW |
| OpenAPI 覆盖测试 | 无 | **4** | NEW |
| Spec docs | 8 | 8 | — |
| Plan docs | 16 | 16 | — |
| Release notes | 3 | **4** | +1 (this) |
| New example app | 1 | 1 | — |
| Electron 客户端 | **已删** | **已删** | v1.1 删除 |
| DB migrations | 5 | 8 | +3 (v006/v007/v008) |
| 鉴权/限流审计 | 基础 | **完整中间件** | 重设计 |
| 一次性 token 视图 | 无 | **5 种类型** | NEW |
```

- [ ] **Step 6: 改项目最终能力 / 工程能力段**

把 v1.0 的描述（"三角色 API（27 endpoints）"等）更新为 v1.4.1 的（"三角色 API（29 endpoints）"等）。直接从 CHANGELOG v1.4.1 主条目复制相应段。

- [ ] **Step 7: 改 Migration Notes**

```markdown
## Migration Notes

**从 v1.0.2 → v1.4.1**：跨度合并，5 个未发布版本累积的工作一次性发布。

**Breaking changes**：见 CHANGELOG v1.4.1 主条目"⚠️ Breaking Changes"段，共 8 条。

**给 Agent / API consumer 的建议**：

- **必做**：客户端不要再依赖 Job 对象的 `requirements` 字段（已删除）。
- **必做**：使用 `RateLimit-Remaining` 头做主动节流；收到 429 时严格按 `Retry-After` 重试。
- **建议**：调用 `/v1/config/*` 和 `/v1/market/leaderboard` 不需要 Bearer 了（optional auth）；不传也行但会扣 1 quota/天。
- **建议**：用 `POST /v1/auth/rotate-key` 定期轮换 API key（旧 key 24h 仍有效）。
- **建议**：跑 `npx tsx examples/reference-agent/src/index.ts` 验证你的集成还在工作。
```

- [ ] **Step 8: 校对 release notes**

```bash
cd /d/dev/hunter-platform && wc -l docs/superpowers/release-notes/2026-06-20-v1.4.1.md
```

预期：~150-200 行（v1.0 模板是 148 行，我们只会更长）。

---

## Task 6: pre-commit 校对

**Files:** 无修改，仅校对。

- [ ] **Step 1: `git status` 看完整清单**

```bash
cd /d/dev/hunter-platform && git status
```

预期：4 个 modified（CHANGELOG.md、package.json、openapi.json、skill.md 注意 skill.md 应该已经 modified）+ 16 个 untracked（15 + 新增 release notes/2026-06-20-v1.4.1.md）+ 15 个 deleted（Electron 整目录）。

如果数量对不上，停下来告诉用户。

- [ ] **Step 2: `git diff --stat` 看变更规模**

```bash
cd /d/dev/hunter-platform && git diff --stat | tail -20
```

预期：+几百到 +几千行（含 Electron 整目录删除带来的负向行数）。

- [ ] **Step 3: 抽查关键修改**

```bash
cd /d/dev/hunter-platform && git diff package.json | head -20
cd /d/dev/hunter-platform && git diff docs/superpowers/openapi.json | head -20
```

预期：
- `package.json`：仅 `version` 字段从 `0.1.0` 变 `1.4.1`
- `openapi.json`：仅 `info.version` 字段从 `1.0.0` 变 `1.4.1`

如果 diff 出现其他无关改动，停下来告诉用户。

- [ ] **Step 4: 抽查 CHANGELOG 顶部**

```bash
cd /d/dev/hunter-platform && head -10 docs/CHANGELOG.md
cd /d/dev/hunter-platform && sed -n '7,9p' docs/CHANGELOG.md
```

预期：

```
# Changelog
...
---

## v1.4.1 — 2026-06-20
```

---

## Task 7: 提交（1 个 commit）

**Files:** 一次性加入所有 modified + untracked + deleted。

- [ ] **Step 1: `git add -A`**

```bash
cd /d/dev/hunter-platform && git add -A
```

- [ ] **Step 2: 校对 staged 内容**

```bash
cd /d/dev/hunter-platform && git status --short | head -30
cd /d/dev/hunter-platform && git diff --cached --stat | tail -10
```

预期：所有 `?? ` 前缀的 untracked 文件变 `A `；所有 ` M` 前缀的 modified 变 `M `（stage 标记）；所有 ` D` 前缀的 deleted 变 `D `。

如果还有 `??` 残留，停下来告诉用户。

- [ ] **Step 3: 写 commit**

```bash
cd /d/dev/hunter-platform && git commit -m "release: v1.4.1 — 跨度合并 v1.1~v1.4+1.4.1

本 commit 一次性收口 v1.0.2 之后未提交的全部工作 + v1.4.1 新增，
作为项目首个'跨度合并'发布。具体内容见 docs/CHANGELOG.md 的 v1.4.1 条目
与 docs/superpowers/release-notes/2026-06-20-v1.4.1.md。

总变更：~80 files changed（+3000+ / -2800+ 含 Electron 删行）

验证：pnpm test 391/391 / pnpm typecheck 0 / pnpm openapi:check OK / pnpm build OK

范围：
- v1.1: rotate-key / delete-my-data / history / 7 bug fixes / Electron 删除 / UTF-8 / GDPR
- v1.2: employer/talent salary filter
- v1.3: GET /v1/market/jobs
- v1.3.1: 6 项文档 polish
- v1.4: §14 Agent 决策手册 / OPERATIONS.md / OpenAPI 自动生成
- v1.4.1: action_history 审计 / 视图层 / landing v2 / 公共 dashboard / INDUSTRY_MAP / 新增端点 / 参考 Agent"
```

预期：commit 成功，输出 1 个新 commit SHA。

- [ ] **Step 4: 校对 commit**

```bash
cd /d/dev/hunter-platform && git log -1 --stat | head -20
cd /d/dev/hunter-platform && git log -1 --format='%H%n%n%s%n%n%b' | head -30
```

预期：commit message 与上面一致；stat 列表与 Step 2 的 diff 一致。

失败处理：`git reset --soft HEAD~1` + `git restore --staged .` 回退。

---

## Task 8: 打 annotated tag v1.4.1

**Files:** 无文件修改，仅 tag。

- [ ] **Step 1: 打 tag**

```bash
cd /d/dev/hunter-platform && git tag -a v1.4.1 -m "v1.4.1 — 跨度合并 v1.1~v1.4+1.4.1

详见 docs/CHANGELOG.md v1.4.1 条目与 release notes/2026-06-20-v1.4.1.md。

Test: 391/391 / Typecheck: 0 / OpenAPI check: OK / Build: OK"
```

- [ ] **Step 2: 校对 tag**

```bash
cd /d/dev/hunter-platform && git show v1.4.1 --stat | head -20
cd /d/dev/hunter-platform && git tag -l v1.4.1 --format='%(objecttype) %(taggername) %(taggerdate:short)'
```

预期：
- `git show` 输出 commit 信息 + 文件 stat
- `tag -l` 输出 `tag ZCode 2026-06-20`（annotated tag，tagger 自动取自 `git config user.name`）

如果 tagger 不是 `ZCode` 或你想用别的名字（如 `dev`），用 `-c user.name=zcode -c user.email=zcode@local` 前缀到 `git tag` 命令上。

---

## Task 9: push 到 origin

**Files:** 无文件修改，仅 push。

- [ ] **Step 1: 看本地相对 origin 的领先**

```bash
cd /d/dev/hunter-platform && git log origin/main..main --oneline
```

预期：1 个 commit（v1.4.1 release commit）。

- [ ] **Step 2: push main**

```bash
cd /d/dev/hunter-platform && git push origin main
```

预期：推送 1 个 commit 成功。

失败处理：如果 origin 拒绝了 fast-forward（说明 origin 领先本地），停下来告诉用户，需要先 `git pull --rebase origin main` 解决冲突。

- [ ] **Step 3: push tag**

```bash
cd /d/dev/hunter-platform && git push origin v1.4.1
```

预期：推送 1 个 tag 成功。

- [ ] **Step 4: 校对远端**

```bash
cd /d/dev/hunter-platform && git ls-remote --tags origin v1.4.1
```

预期：1 行，SHA 与本地 `git rev-parse v1.4.1` 一致。

---

## Task 10: 创建 GitHub Release

**Files:** 无文件修改，仅 GitHub API。

- [ ] **Step 1: 检查 gh CLI 登录**

```bash
cd /d/dev/hunter-platform && gh auth status 2>&1 | head -10
```

预期：已登录 qing3a 账号。

如果未登录：`gh auth login`（交互式），停下来告诉用户需要手动操作。

- [ ] **Step 2: 创建 release**

```bash
cd /d/dev/hunter-platform && gh release create v1.4.1 \
  --title "v1.4.1 — 跨度合并 v1.1~v1.4+1.4.1" \
  --notes-file docs/superpowers/release-notes/2026-06-20-v1.4.1.md
```

预期：返回 release URL（如 `https://github.com/qing3a/Hunter-Platform/releases/tag/v1.4.1`）。

- [ ] **Step 3: 校对 release**

```bash
cd /d/dev/hunter-platform && gh release view v1.4.1
```

预期：输出 release 元信息（title / tag / commit / notes 摘要）。

---

## 验证总门

完成 Task 1-10 后，**所有 6 道门都应通过**：

| 门 | 通过条件 | 校对命令 |
|----|---------|----------|
| Test | 391/391（与 CHANGELOG 一致） | `pnpm test 2>&1 | tail -5` |
| Typecheck | 0 errors | `pnpm typecheck 2>&1 | tail -3` |
| OpenAPI check | 一致 | `pnpm openapi:check 2>&1 | tail -3` |
| Build | 成功 + 产物存在 | `pnpm build && ls -la out/main/index.js` |
| Git | commit + annotated tag 都在 | `git log -1 --format=%s && git show v1.4.1 --stat | head -3` |
| Push + Release | 远端 tag + GitHub Release 都存在 | `git ls-remote --tags origin v1.4.1 && gh release view v1.4.1` |

---

## 风险与回滚

| 阶段 | 失败回滚 |
|------|----------|
| Task 1（验证）失败 | 无副作用，停下即可 |
| Task 2-5（文件编辑）失败 | `git restore <file>` + `rm docs/CHANGELOG.md.bak-v1.4.1-pre`（如有） |
| Task 6（校对）发现不对 | 停下，不进入 Task 7 |
| Task 7（commit）失败 | `git reset --soft HEAD~1` + `git restore --staged .` |
| Task 8（tag 本地）失败 | `git tag -d v1.4.1` |
| Task 9（push）后想撤回 | `git push origin :v1.4.1`（删远端 tag）+ `git revert HEAD` + `git push origin main` |
| Task 10（Release）后想撤回 | `gh release delete v1.4.1 --yes`（仅删 release，不删 tag） |

**不可逆点**：`git push origin v1.4.1` 一旦执行，远端就保留 tag 引用。删除远端 tag 后虽然不再可被 `git clone` 自动 fetch，但 GitHub Events、API consumer 缓存、第三方 watch 仍可能持有引用。`gh release create` 同理。
