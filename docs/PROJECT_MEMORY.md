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

---

## 1b. 生产部署速查（实测 2026-06-23）

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
| MCP 安装路径 | `/root/.npm-global/lib/@qing3a/hunter-platform-mcp/` |
| MCP PAT | `/root/.npmrc` 里有 `_authToken=ghp_xxx` |

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

### 发布 MCP server

```bash
# 本地
cd /d/dev/hunter-platform/mcp-server
export GH_TOKEN=$(ssh -i /d/Downloads/cc.pem root@101.201.110.129 \
  'grep _authToken /root/.npmrc | sed "s/.*=//"')
pnpm publish --no-git-checks

# 生产升级
ssh root@101.201.110.129 'npm install -g @qing3a/hunter-platform-mcp@VERSION'
```

### 已知生产怪异

- `systemd` 启动加 `--experimental-sqlite` 标志（Node 22 内置 sqlite 但要 flag）
- 服务 PID 通常在 350000+（systemd 启动慢）
- 启动后 ~2 秒才响应；smoke 测试前 `sleep 2`
- 当前 Node v22.11.0，可接受 v22+ 任意版本

---

## 3. 当前活跃任务（最近 sprint）

| 优先级 | 任务 | 状态 |
|--------|------|------|
| 🔴 高 | **action_history 中间件落地**（新建 `/v1/admin/action-history`） | ✅ 代码已合 `main`（merge commit `413b6e3`，2026-06-23）；⏳ **待生产部署** |
| 🔴 高 | **要求 current_company 必填**（消除 industry NULL） | ✅ 代码已合 `feature/require-current-company`（6 commits），⏳ 待合并 + 生产部署；MCP server 待发 v0.1.3 |
| 低 | **Web 管理后台**（替代 Electron，多管理员） | ✅ **Sub-A** 基础设施已上线（v1.5+，merge `ad62db3`）；✅ **Sub-B** 监控仪表盘 + 列表只读已完成 + 合 `feature/web-admin-sub-B` (待 review → merge main)。Sub-C/D/E 待开始 |

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

## 6. MCP 集成（外部消费者）

| 项 | 值 |
|----|----|
| 包名 | `@qing3a/hunter-platform-mcp`（私有 registry `npm.pkg.github.com/qing3a`） |
| 最新版本 | v0.1.2 已发布；v0.1.3 在 `feature/require-current-company`（标记 `headhunter_upload_candidate` requires `current_company`） |
| 凭证存储 | 本机 `<user-home>/.hunter-platform-mcp/credentials.json` |
| 凭证格式 | `{ apiKey, apiBaseUrl, userId }`；deploy 模式 = 1 user + 1 base URL |
| 部署方式 | GitHub Packages PAT 写入生产服务器 `~/.npmrc` 后 `npm install @qing3a/hunter-platform-mcp` |
| 已知 bug fix | v0.1.1 修 `auth_register` 不该要求 api_key |

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
| Admin API typed wrappers | `admin-web/src/api/{users,candidates,dashboard,raw}.ts` |
| Admin Web UI | `admin-web/`（React + Vite + TS + vitest+RTL）；build 到 `out/admin/` |
| action_history 中间件 | `src/main/modules/audit/action-history-middleware.ts` |
| action_history repo | `src/main/db/repositories/action-history.ts` |
| capability 映射 | `src/main/capabilities/` + `src/main/modules/audit/route-action-map.ts` |
| 行业映射（待扩展） | `config/desensitization.json` 中 `industry_map`（目前只有 6 家公司） |
| Zod schemas | `src/main/schemas/<domain>.ts` |
| 响应 envelope | `src/main/responses.ts` + `src/main/schemas/common.ts` 的 `EnvelopeSchema` |
| 数据库迁移 | `src/main/db/migrations/v001-v013*.ts` |
| 测试 | `tests/integration/`（HTTP 端到端）+ `tests/unit/`（纯函数） |
| 设计/计划 | `docs/superpowers/specs/` + `docs/superpowers/plans/` |
| 运维/交付 | `docs/OPERATIONS.md` + `docs/DELIVERY.md` |
| Agent skill | `docs/superpowers/skill.md` + `skills/hunter-platform/SKILL.md` |

---

## 8. Agent 调用模式（OpenAPI）

- 鉴权：`Authorization: Bearer <api_key>`（从 MCP 凭证读）
- 响应信封：`{ ok: true, data: <T> }` 或 `{ ok: false, error: { code, message, details? } }`
- 错误码：`UNAUTHORIZED`（401）/ `INVALID_PARAMS`（400）/ `NOT_FOUND`（404）/ `RATE_LIMITED`（429）/ `INTERNAL_ERROR`（500）
- Action 能力名格式：`<user_type>.<verb_noun>` 例：`headhunter.upload_candidate`、`employer.express_interest`、`auth.register`
- 完整能力列表：`docs/superpowers/skill.md` §X