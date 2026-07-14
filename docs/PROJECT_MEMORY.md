# Hunter Platform — 项目记忆

> **新会话开场**: 读本文件 + `git log --oneline -20` 即可恢复项目上下文。
> **记忆来源**: 本文件 (项目级知识) + git history (代码变更) + `docs/superpowers/specs|plans/` (设计与实施) + `OPERATIONS.md` (运维) + `DELIVERY.md` (交付)。

---

## 1. 生产环境

| 项 | 值 |
|----|----|
| 域名 | `html_qing3.top` / `api.hunter-platform.com` |
| 服务器 | Linux + 宝塔面板（路径前缀 `/www/server/panel/`） |
| Node API 路径 | `/www/wwwroot/hunter-platform-api/` |
| Nginx 配置 | `/www/server/panel/vhost/nginx/html_qing3.top.conf` |
| Node 监听 | `127.0.0.1:3000`（behind nginx） |
| Node 版本 | v22.11.0（v24 也兼容） |
| 包管理器 | pnpm |
| 数据库 | better-sqlite3（文件 DB） |
| 部署流程 | `git pull → pnpm build → 重启 pm2/systemd`（具体重启命令不在本仓库） |

---

## 2. 架构关键决策

| 决策 | 内容 | 时间 |
|------|------|------|
| 弃用 Electron | Admin 走 HTTP API，不再有桌面客户端 | v1.0 |
| API-only 模式 | Express + better-sqlite3 + zod，无 IPC 层 | v1.0 |
| action_history 中间件 | 每条业务请求都写审计（v1.4 起挂载） | v1.4 |
| capability_name 标准化 | v013 迁移：30 个能力名 | v1.4 |
| bcrypt cost-10 admin password | 生产 `.env` 用 `$2a$10$` 哈希 | v1.0 |
| current_company 必填 | 新上传候选人 industry 永不为 NULL | 2026-06-23 |
| Sub-E Config DB-backed | `config` 表（key / value_json / audit）；admin 通过 `PUT /v1/admin/config/:key` + reason 必填 | 2026-06-26 |
| Sub-F Worker reads Config | rate-limit middleware + industry_map loader 真正读 `config` 表（in-memory cache + 10s TTL + fail-soft）| 2026-06-26 |
| Sub-G Public rate-limit + TTL 0 | 公开 `GET /v1/config/rate-limits` 端点 + commission 接入 Config + cache TTL 0s（admin 改后立即生效）| 2026-06-26 |

---

## 1b. 生产部署速查（实测 2026-06-23，2026-06-26 三次验证）

### 2026-06-26 三次验证（Sub-G v2.9.0 部署）

部署 Sub-G 走相同流程，所有验证通过：
- 本地 build → scp out/* → systemd restart → smoke test 200
- `GET /v1/config/rate-limits` 返 3 tier × 3 window（candidate 10/50/300、headhunter 20/100/750、employer 30/200/1200）
- 生产 `config` 表写入 `commission.platform_rate = 0.1`（Sub-G 启动 migrate seed 写入）
- `PUT /v1/admin/config/commission.platform_rate` 无 auth 返 401（鉴权正常）
- `/v1/health` healthy

### 2026-06-26 二次验证（Sub-F v2.8.0 部署）

部署 Sub-F 走相同流程，所有验证通过：
- 本地 build → scp out/* → systemd restart → smoke test 200
- 生产 `config` 表写入 `industry_map` key（3079 bytes，Sub-F 启动 migrate 从 `config/industry_map.json` seed 进 DB）
- `/v1/config/industries` 返 12 categories（互联网22、金融23、半导体12…）— 证明 industry_map loader **从 DB 读**，不是从文件
- `GET /v1/candidate/opportunities` 返 `RateLimit-Limit: 10, 50, 300` — 异步 rate-limit middleware 工作正常，config-cache miss → fallback 到 `RATE_LIMIT_BURSTS` 常量

### 2026-06-23 实测首次

| 项 | 实际值 |
|----|--------|
| 服务器 IP | `101.201.110.129`（已在 `~/.ssh/known_hosts`） |
| SSH 用户 | `root` |
| SSH 私钥 | `D:\Downloads\cc.pem`（Windows 路径）/ `/d/Downloads/cc.pem`（bash） |
| **API 实际路径** | **`/opt/hunter-platform/`**（不是 PROJECT_MEMORY.md 之前的 `/www/wwwroot/...`） |
| 服务管理 | `systemd: hunter-platform.service` |
| 重启命令 | `systemctl restart hunter-platform` |
| 启动命令 | `node --experimental-sqlite --env-file=/opt/hunter-platform/.env /opt/hunter-platform/out/main/index.js` |
| **生产无 git**（scp 同步即可） | 本地 build → scp `out/*` → restart |
| Admin 密码路径 | `/opt/hunter-platform/.admin-password`（不在 `.env` 里） |

### 标准部署流程

```bash
# 1. 本地 build
cd /d/dev/hunter-platform && pnpm build

# 2. scp out/ 到生产（无 rsync）
scp -r -i "/d/Downloads/cc.pem" out/* root@101.201.110.129:/opt/hunter-platform/out/

# 3. 重启服务
ssh -i "/d/Downloads/cc.pem" root@101.201.110.129 \
  'systemctl restart hunter-platform'

# 4. 验证（注意生产无 api.hunter-platform.com 的外网 DNS，从生产 localhost 测）
ssh -i "/d/Downloads/cc.pem" root@101.201.110.129 \
  'curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/v1/admin/ping'
# Expected: 401 (auth required)
```

### 已知生产怪异

- `systemd` 启动加 `--experimental-sqlite` 标志（Node 22 内置 sqlite 但要 flag）
- 服务 PID 通常在 350000+（systemd 启动慢）
- 启动后 ~2 秒才响应；smoke 测试前 `sleep 2`
- 当前 Node v22.11.0，可接受 v22+ 任意版本

---

## 3. 当前活跃任务（2026-06-26 sprint 全部完成 + 生产部署）

| 优先级 | 任务 | 状态 |
|--------|------|------|
| ✅ 高 | action_history 中间件落地 | 已合 main + 已生产部署（Sub-E 部署含此） |
| ✅ 高 | current_company 必填 | 已合 main（`72704b4`）+ 已生产部署 |
| ✅ Sub-F | Worker reads Config | 已合 main + 已生产部署（v2.8.0 在 101.201.110.129 跑）|
| ✅ Sub-G | Public rate-limit + Commission + TTL 0 | 已合 main + 已生产部署（v2.9.0 在 101.201.110.129 跑）|
| ✅ Sub-A→G | Web 管理后台 | Sub-A (login) + Sub-B (lists) + Sub-C (mutation) + Sub-D1-D6 (audit/timeline/webhooks/placements/suspend/filter) + Sub-E (config DB-backed) + Sub-F (worker reads config) + Sub-G (public rate-limit + commission) 全部完成 |

### 后续候选

- **Sub-H**（commission hunter/referrer 比例拆分 / 公开 GET /v1/config/commission）
- **In-site notifications**（已 spec 但没全实现 — `2026-06-24-in-site-notifications-design.md` 看到部分 commit 如 `feature/in-site-notifications` 已 merge）
- **Maintenance**：6 个月一次的 dependency update / security audit

> 详细 plan 见 `docs/superpowers/plans/`，design 见 `docs/superpowers/specs/`。

---

## 4. 已知坑点 / 注意事项

### 代码层面

- **`exactOptionalPropertyTypes: true`** — tsconfig 严格模式。Pass `{ key: undefined }` 给可选字段会报错，必须**条件性加入**：
  ```typescript
  const filter: { x?: string } = {};
  if (cond) filter.x = val;  // ✅
  // filter.x = val ?? undefined; // ❌ 报错
  ```
- **`EnvelopeSchema` vs 自定义 envelope** — 标准 `{ ok, data: X }` 用 `EnvelopeSchema(X)`；若需要 sibling 字段（如 `pagination`），必须用 `z.object({ ok, data, pagination })`，否则严格 schema 校验拒收。
- **action_history schema 演进**：v001 创建 → v011 加 `trace_id` → v013 重命名 `action_type` → `capability_name`（30 个能力名）。新代码引用 capability_name，不要用 action_type。
- **两个 action_history schema**：
  - `ActionHistoryItemSchema`（user 端，14 字段，不含 `response_summary_json` 和 `trace_id`）
  - `AdminActionHistoryItemSchema`（admin 端，12 字段，**多** `response_summary_json` 和 `trace_id`）
  - 不要混用。
- **Sub-F `lookupIndustry` 是同步函数**（`src/main/modules/desensitize/mapping.ts`）：industry_map cache 一次性启动读（`loadIndustryMap(db)`），**不 10s TTL 刷新**。要让 TTL 刷新必须把所有 caller 改 async（超出 Sub-F 范围）。
- **Sub-F `__resetIndustryCacheForTests()`**（`mapping.ts`）：test-only helper，模块级 `_cache` 跨测试会污染。在每个相关 `beforeEach` 调用。
- **Sub-F `config-cache` TTL 10s**：`createConfigCache(db, ttlMs = 10_000)` lazy expiration。admin 改 Config 后**最多 10s** 生效（不主动 invalidate）。TTL 可注入用于测试加速。
- **Sub-F rate-limit middleware 是 async**（`src/main/modules/rate-limit/middleware.ts`）：签名 `createRateLimitMiddleware(db, cache)`，**第二个参数是 cache**。5 个 routes 改了 caller。改旧测试时 `it` 要 `async` + `await mw(...)`。
- **Sub-G `createPlacement` 改 async**（`src/main/modules/commission/handler.ts`）：原本 sync（`withSpanSync` 包裹）。改 async 后 `withSpanSync` 仍然接受 sync 回调（`await` 在外）。所有 caller（`routes/employer.ts:64`）加 `await`。改 commission 测试时 `it` 改 `async` + `expect(() => fn()).toThrow()` 改 `await expect(fn()).rejects.toThrow()`。
- **Sub-G `commission.platform_rate` 默认值 0.1**（migrate seed）：原 calculator DEFAULT_RATES 硬编码 0.2。Sub-G 接入 Config 后真实 rate 来自 cache fallback 0.1。改了 5 个 test 文件 11 处断言（200_000 → 100_000, 140_000 → 70_000 等）。
- **Sub-G Zod 校验 commission 0-1** 在 route 层（`routes/admin.ts`）：`PUT /v1/admin/config/:key` 路由检查 `req.params.key === 'commission.platform_rate'`，用 `z.number().min(0).max(1)` 校验 body。其他 key 保持 `unknown`（无 type 校验）。
- **Sub-G `migrateConfigFromFilesToDB` 写 number 而非 object**：`commission.json` 缺失时 INSERT OR IGNORE `JSON.stringify(0.1)`（数字），不是 `JSON.stringify({platform_rate: 0.1})`（object）。handler 读后直接是 number，type 一致。如果发现 mismatch（缓存值是 object `.platform_rate`），handler 需要 `.platform_rate ?? value` 兼容。

### 工具层面

- **`pnpm conformance:check` 有预存在 bug** — `scripts/check-conformance-coverage.ts:16` 用 `__dirname` 在 ESM 模式下未定义。在 main 上同样失败，**与新代码无关**。
- **`pnpm openapi:generate` 是 no-op** — v1.4 中 openapi.json 是手动维护的。检查用 `pnpm openapi:check`，新增端点需手动编辑 `docs/superpowers/openapi.json`。
- **`pnpm test` 大约 45 秒** — 144 files, ~790 tests。跑全量回归时预期时长。

### 环境层面

- 本机 shell 是 **Git Bash on Windows** — `taskkill`、`netstat` 等 Windows 命令不可用。要杀进程用 Node 工具（`process.kill(pid)`）或直接重启终端。
- **当前环境无 general-purpose 实现子代理** — `Agent` 工具只支持 `Explore`（只读）。所有实现工作由 controller inline 执行。
- ZCode 本地执行日志：`~/.zcode/cli/exec/sess_<id>/*-stdout.log`

---

## 5. 仓库 / 工作流

| 项 | 值 |
|----|----|
| 仓库 | `D:\dev\hunter-platform` |
| 远程 | `https://github.com/qing3a/Hunter-Platform.git`（部分网络环境拉取失败，可在本地直接 merge） |
| 分支模型 | `main` + feature 分支；单人开发直接 merge 到 main（本地侧无 PR 流程） |
| 新功能流程 | `brainstorm → design spec → implementation plan → TDD → merge to main` |
| branch 命名 | `feature/<kebab-case-name>` |
| commit 习惯 | 任务内 amend、跨任务保留独立 commit；规范消息 `<type>(<scope>): <subject>` |
| 工作流 skill | `superpowers:brainstorming` → `superpowers:writing-plans` → `superpowers:executing-plans` 或 `subagent-driven-development` → `superpowers:finishing-a-development-branch` |
| 已知未提交变更 | 主分支可能有 `2026-06-23-v2-self-upload-and-pitch-design.md` 等 v2 格式 spec，与 v1.x 无关，**不要 merge 进 v1.x feature 分支** |

---

## 7. 重要文件位置速查

| 类别 | 路径 |
|------|------|
| HTTP 路由 | `src/main/routes/*.ts`（admin.ts, users.ts, etc.） |
| Admin 鉴权 | `src/main/modules/admin/auth.ts`（per-admin api_key 查 admin_users 表） |
| admin_users 表 | `src/main/db/repositories/admin-users.ts` |
| admin auth handler | `src/main/modules/admin/handlers/auth.ts`（login/rotate-key/me） |
| admin seed | `src/main/seed/admin.ts`（读 SEED_ADMIN_PASSWORD env） |
| Admin Web UI 列表页 | `admin-web/src/pages/{Users,Candidates,Dashboard}Page.tsx` |
| Admin Web UI Audit (Sub-D1) | `admin-web/src/pages/AuditPage.tsx`（3 tab: Admin/User/Login） |
| Admin Web UI Settings (Sub-E) | `admin-web/src/pages/SettingsPage.tsx`（Config tab） + `src/components/ConfigEditModal.tsx` |
| config-cache 模块 (Sub-F) | `src/main/modules/config-cache.ts`（in-memory cache + 10s TTL + fail-soft） |
| rate-limit middleware (Sub-F) | `src/main/modules/rate-limit/middleware.ts`（async；`createRateLimitMiddleware(db, cache)`）|
| industry_map loader (Sub-F) | `src/main/modules/desensitize/mapping.ts`（`loadIndustryMap(db?)` + `lookupIndustry(name, db?)`）|
| commission handler (Sub-G) | `src/main/modules/commission/handler.ts`（`createPlacement` async；读 `commission.platform_rate` configCache）|
| Public rate-limit endpoint (Sub-G) | `src/main/routes/config.ts`（`/v1/config/rate-limits`）+ `src/main/schemas/admin.ts`（`ListRateLimitsResponseSchema`）|
| Admin config handler (Sub-E + Sub-G) | `src/main/modules/admin/handlers/config.ts`（`set/list` + reason 必填 + audit + `getRateLimits()` Sub-G）|
| Admin API typed wrappers | `admin-web/src/api/{users,candidates,dashboard,raw,audit}.ts` |
| Admin Web UI | `admin-web/`（React + Vite + TS + vitest+RTL）；build 到 `out/admin/` |
| action_history 中间件 | `src/main/modules/audit/action-history-middleware.ts` |
| action_history repo | `src/main/db/repositories/action-history.ts` |
| capability 映射 | `src/main/capabilities/` + `src/main/modules/audit/route-action-map.ts` |
| 行业映射（已扩展） | `config/industry_map.json` 12 categories / 100+ companies；启动时 seed 到 `config` 表的 `industry_map` key，loader 从 DB 读（Sub-F）|
| Zod schemas | `src/main/schemas/<domain>.ts` |
| 响应 envelope | `src/main/responses.ts` + `src/main/schemas/common.ts` 的 `EnvelopeSchema` |
| 数据库迁移 | `src/main/db/migrations/v001-v013*.ts` |
| 测试 | `tests/integration/`（HTTP 端到端）+ `tests/unit/`（纯函数） |
| 设计/计划 | `docs/superpowers/specs/` + `docs/superpowers/plans/` |
| 运维/交付 | `docs/OPERATIONS.md` + `docs/DELIVERY.md` |
| Agent skill | `docs/superpowers/skill.md` + `skills/hunter-platform/SKILL.md` |

---

## 8. Agent 调用模式（OpenAPI）

- 鉴权：`Authorization: Bearer <api_key>`（调用方持有的 apikey 或 `sess_*` session token，详见 skill.md §1）
- 响应信封：`{ ok: true, data: <T> }` 或 `{ ok: false, error: { code, message, details? } }`
- 错误码：`UNAUTHORIZED`（401）/ `INVALID_PARAMS`（400）/ `NOT_FOUND`（404）/ `RATE_LIMITED`（429）/ `INTERNAL_ERROR`（500）
- Action 能力名格式：`<user_type>.<verb_noun>` 例：`headhunter.upload_candidate`、`employer.express_interest`、`auth.register`
- 完整能力列表：`docs/superpowers/skill.md` §X

### Config 运行时配置（Sub-E + Sub-F + Sub-G）

- `GET /v1/admin/config` — list all config keys
- `PUT /v1/admin/config/:key` body `{ value, reason }` — upsert（reason ≥ 3 字符必填）
- **`PUT /v1/admin/config/commission.platform_rate`** — Zod 校验 `value: number 0-1`（Sub-G）
- **`GET /v1/config/rate-limits`** — 公开端点（optional auth）返 3 tier × 3 window 当前阈值（Sub-G）。agent 预读避开撞击。
- **Key 命名约定**（4 层 dot path）：
  - `rate_limit.tier.<candidate|headhunter|employer>.limit_per_<second|minute|hour>` — 9 keys
  - `industry_map` — 完整 industry map JSON
  - `commission.platform_rate` — 数字 0-1（commission rate，Sub-G）
- **生效延迟**：admin 改后**立即**生效（Sub-G TTL=0，每次 get 重读 DB）
- **Fallback**：DB miss 或抛错 → 返 hardcoded 常量（rate-limit 用 `RATE_LIMIT_BURSTS`，industry_map 用 `readFileSync`，commission 用 0.1）
- **公开端点** `/v1/config/*` 列表：`/industries`（industry_map）/ `/title_levels` / `/salary_bands` / **`/rate-limits`**（Sub-G）— 不需要 auth

---

## 2b. R1 era 关键决策（2026-07-08 ~ 2026-07-15）

| 决策 | 内容 | 关联 commit |
|------|------|------|
| **R1.C2 双轨认证** | `Bearer hp_live_*`（api_key, indefinite）+ `Bearer sess_*`（session, 168h sliding TTL）。`X-Active-Role: pm|hr|candidate` header 切换活跃角色。`authMiddleware` 按 token 前缀 dispatch。 | `4c6b037` (initial T4), `d3ebbd1` (R1.C2 register) |
| **多角色 grantAll** | 每个新用户自动获得全部 3 个 role（`user_role` 表 + `grantAll` 一次性写入）。`active_role` 由 apikey 的 user_type 决定，或 session 创建时显式指定，或后续 `X-Active-Role` 切换。 | `d3ebbd1` |
| **role enum rename** | `headhunter → hr`，`employer → pm`。所有 CHECK 约束、字段、文档同步更新。`remapLegacyUserType()` 兼容旧 DB（defense-in-depth）。 | `4c6b037`, `792f899` (T10 close + v029 cleanup) |
| **R1.C3 webhook inbox dedup** | 新表 `webhook_inbox_deliveries` (v032)，UNIQUE(endpoint, body_hash) 约束。`POST /v1/webhooks/qing3` 走 INSERT OR IGNORE + lookup。`deduped: true|false` 返回标志。HMAC sha256 签名，±300s 重放窗口。 | `25e6d23` |
| **R1.C4 capability aliases** | `Capability.aliases?: readonly string[]` 字段 + `findCapabilityByAlias(name)` lookup。aliases 是私有 routing 元数据，**不在** `/v1/capabilities` 公开。3 个 ow-recruit skill 映射：advance_candidate/send_message/sync_project_to_erp。 | `47b8f76` |
| **T10 roleGate** | 4 个 role-restricted router 都挂 `router.use(roleGate(role))` 在 `authMiddleware` 之后：`/v1/pm` (pm) + `/v1/employer` (pm) + `/v1/employer-panel` (pm) + `/v1/headhunter` (hr) + `/v1/headhunter-workspace` (hr) + `/v1/candidate` (candidate)。 | `4c6b037` (pm), `792f899` (other 3) |
| **vitest worker crash fix** | singleFork + Windows MINGW64 环境下未捕获 promise rejection 会让 tinypool IPC 关闭 → silent skip 后续测试。`tests/global-setup.ts` 在 test-runtime 下 swallow `unhandledRejection` + `uncaughtException`（log 到 stderr 但不 re-throw）。生产代码不受影响。 | `9856efd` |
| **OpenAPI forward coverage** | 修了 scanner 假阳：MOUNT_PREFIXES 之前对 candidate-portal / headhunter-workspace / pm / employer-panel 设 null，注释声称 "uses full paths" 但实际用相对路径。改成真 prefix 后 scanner 暴露 75 个真实 forward gap。`scripts/apply-forward-gaps.py` 一键补齐 minimal entries（summary + 4 个标准 response code）。 | `2e85ce5` |
| **conformance: 33 missing** | `tests/integration/skill-md-conformance/capability-coverage-extra.test.ts`：33 个之前无 scenario 的 capability（admin list_jobs, candidate_portal full surface, pm workbench endpoints）加最小 smoke test。Reuse 1 个 hr/candidate/pm api_key 避免 IP rate limit。 | `239997e` |
| **admin-web RateLimitPage** (R2.5) | 新增 `/admin/rate-limit` 页面，调用 `GET /v1/config/rate-limits` + `POST /v1/admin/rate-limit/users/:id/clear`。admin-web 独立 React SPA。 | `8756607` |
| **mcp-server removal** | R1 之前有个 mcp-server 包，发布到 GitHub Packages v0.1.3。R1.C2 时 `pm`/`hr` rename 让 mcp-server 的 Zod schema 校验失败（unfixable without breaking v0.1.3 callers）。删除 mcp-server/ + GitHub Packages。`mcp-server` 路径已废弃。 | `57ee486` |

---

## 3b. R1 era 已知坑点（部署 / 运维）

| 坑 | 症状 | 修复 / workaround |
|----|------|------|
| **legacy headhunter/employer 在 v029 之前** | 旧 DB 有 8 个 headhunter + 2 个 employer 用户。v029 的 table-rebuild 失败（CHECK 拒绝 legacy enum）。 | 必须先在 prod 外部用 SQLite rebuild 技巧去掉 CHECK + rename legacy 值，然后再起新代码。详见 `OPERATIONS.md §3.3`。 |
| **v031 自身的 UPDATE 是 no-op** | v031 的 `UPDATE users SET user_type='hr' WHERE user_type='hr'` 是 no-op（rename 时 search-and-replace 把 `headhunter` 改成了 `hr`）。需要在 v031 之前手动 rename 旧值。 | 已通过部署前的手动 rename 解决。 |
| **.tsbuildinfo 缓存** | 第一次 build 之后 `out/main/telemetry.js` 缺失（tinypool override 解决后又出现）。 | build 前 `rm -rf out tsconfig.node.tsbuildinfo`。已在 OPERATIONS.md §3.2 第 1 步强调。 |
| **scripts/copy-migrations.mjs 漏 .css** | 第一次 deploy R1.C3 时 `landing.css` 缺失导致 service crash。 | 已扩展为也 copy 所有 .css 资产（不只是 migrations）。`492889`。 |
| **scripts/generate-openapi.ts 假阳** | MOUNT_PREFIXES 把 candidate-portal 等设 null 但路由用相对路径。 | 改成真 prefix。前向 75 个 gap 暴露后用 apply-forward-gaps.py 一键补齐。`2e85ce5` |
| **brittle migration tests** | `tests/integration/migrations-v00{2,3,20}.test.ts` 硬编码 `expect(migs).toEqual([1..24])`。C3 加 v025 后这些测试 fail。 | 改为 `Array.from({length: migs.length}, (_, i) => i + 1)` + `migs.length >= 24`。`9856efd` |
| **tinypool override 错配** | 之前 session 误加 `pnpm.overrides.tinypool: "^2.0.0"`，但 vitest 3.x 用 tinypool 1.x。IPC 消息格式不兼容，worker 死。 | 移除 override。vitest 3.x 自动用其原生 tinypool 1.1.1。`4c6b037` |
| **isolate:false 漏 cache** | 之前 `vitest.config.ts` 设 `isolate: false`，导致 `industry_map` 模块缓存泄漏——`tests/integration/industry-map-config.test.ts` 写入的 `'TestCategory'` 值污染后续 desensitize/lookupIndustry 测试。 | 移除 `isolate: false`（默认 `true`，每个 test file 独立模块）。`4c6b037` |
| **gather-landing-data flake** | `tests/unit/gather-landing-data.test.ts > returns zeros and empty arrays` 用 `process.uptime()` 计算 `uptimePercent`，跑 60s+ 后返回 99.9 而非 100。 | 注入 `uptimeSec` 参数（`gather-landing-data.ts` 加 `GatherLandingDataOptions`），测试传 0 走 cold-start 路径。`feea755` |
| **tinypool/Windows IPC race** | 单 fork 模式下未捕获 promise rejection 让 worker 进程死掉，tinypool IPC 关闭，后续测试 silent skip。`process.on('unhandledRejection')` swallow（test-runtime only）。 | `9856efd` |

---

## 4. 跨文档导航

| 想知道 | 看哪 |
|---|---|
| 平台能做什么（**单一总览**）| `docs/FEATURES.md`（141 routes, 86 capabilities, 25 migrations, R1 era） |
| Agent 怎么调 | `docs/superpowers/skill.md`（frontmatter 已更新到 141 endpoints）|
| 怎么部署到生产 | `docs/OPERATIONS.md`（R1 schema-rebuild + C3 deploy 步骤）|
| 怎么定位和恢复 | `docs/PROJECT_MEMORY.md`（本文）|
| 历史设计 | `docs/archive/2026-q1/`（v1.0~v1.4.1 release notes + plans）|
| 当前 specs | `docs/superpowers/specs/`（47 个 spec）|

---

## 5. R1 era 部署记录（按 commit 时间倒序）

```
9856efd  fix(tests): vitest worker crash resolved + brittle migration tests
8756607  feat(admin-web): R2.5 rate-limit & quota dashboard page
239997e  test(conformance): scenario tests for the 33 previously-uncovered capabilities
2e85ce5  feat(openapi): full forward coverage (76 missing routes added)
792f899  fix: T10 roleGate on 3 routers + v029 CHECK constraint cleanup
47b8f76  feat(capabilities): alias support for ow-recruit skill naming (R1.C4, R1 P1)
25e6d23  feat(ingest): POST /v1/webhooks/qing3 with body-hash dedup (R1.C3, R1 P0)
7316b96  fix(build): copy-migrations also copies .css assets
a1cb6e5  Merge feature/vitest-worker-crash-fix into main
feea755  fix(tests): make gather-landing-data uptime deterministic via DI
d3ebbd1  feat(auth): auto-grant 3 roles on register + return available_roles (R1.C2)
5e1f64c  feat(auth): POST /v1/auth/login + refresh + logout endpoints (R1.C2)
4e1b389  test(auth): verify rotate-key accepts session bearer (R1.C2)
61f72ab  test(R1.C2): fix role-gate assertions broken by employer→pm merge (T12)
55309e6  test(R1.C2): rename headhunter/employer user_types to hr/pm in tests
16f4414  Merge feature/session-multirole into main (R1.C2)
57ee486  chore: remove mcp-server (deprecated, broken against R1.C2 enum)
```

每个 commit 的 why / what 详见 `git log -p <sha>` 或 commit message。

最后更新 2026-07-15。
