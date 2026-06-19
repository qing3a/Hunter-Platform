# v1.4.1 Changelog Wrap-up — Design

**日期**: 2026-06-20
**项目**: Hunter Platform (猎头中介 API 平台)
**仓库**: `d:/dev/hunter-platform`
**状态**: Approved (brainstorming complete)
**作者**: ZCode (主 agent) + 用户

---

## 1. 背景

`d:/dev/hunter-platform` 在 2026-06-20 收尾 v1.4.1 时的工作区状态异常：

- git tag 列表停在 `v1.0.2`（2026-06-18），`v1.0.2` 之后**没有任何 tag**。
- HEAD commit `0b85012 docs(changelog): v0.3.1 misc fixes`（2026-06-19 11:22）之后的 86 个 commit **全部在工作区未提交**。
- `docs/CHANGELOG.md` 在工作区里已被"事后追写"，顶部已包含 v1.1 / v1.2 / v1.3 / v1.3.1 / v1.4 五个版本的完整条目。
- `package.json` 的 `version` 仍是 `0.1.0`，`docs/superpowers/openapi.json` 的 `info.version` 仍是 `1.0.0`，与 CHANGELOG 严重脱节。
- 工作区里有 57 个 modified、15 个 deleted、15 个 untracked 文件。

这意味着 v1.4.1 不是"v1.4 之后的下一个常规补丁"，而是**项目首次正式发布"跨度合并"形式的工作累积**。

---

## 2. 目标

把工作区里 v1.1~v1.4+1.4.1 的全部工作，**作为 1 个 git commit + 1 个 annotated tag v1.4.1 收口**，并在发版前跑通四件套验证、推送 GitHub、创建 Release。

**不包含**：

- 把 v1.1~v1.4 拆成 5 个独立 commit 各自打 tag（用户已选择"跨度合并"）。
- 重写项目架构或新增 v1.4.1 之外的任何新功能。
- 拆分 monorepo、引入 CI、添加 admin tools（这些在 `release-notes/2026-06-19-v1.0.md` 的 "What's Next" 里是 v1.x 后续工作）。

---

## 3. 范围

### 3.1 v1.4.1 CHANGELOG 主条目覆盖内容（7 大类新功能）

按用户确认的"全部进 v1.4.1"原则：

1. **鉴权/账户**：`POST /v1/auth/rotate-key`（24h grace）、`POST /v1/candidate/delete-my-data`（GDPR 软删）、`GET /v1/users/{id}/history`（支持 `?limit=` `?since=` `?offset=`）。
2. **公开端点**：`GET /v1/market/jobs`（v1.3 引入）、`GET /v1/market/leaderboard`（optional auth）、`GET /v1/config/{industries,title_levels,salary_bands}`（optional auth）、`GET /v1/headhunter/candidates`（optional auth）。
3. **限流重设计**：sliding-window-counter 算法、IETF `RateLimit-*` 头、软警告 < 20%、`RATE_LIMIT_ENABLED=false` / `X-RateLimit-Skip: 1` 旁路。
4. **action_history 审计中间件**：路由级审计 + action_type 枚举映射 + last-segment fallback + 5 步 PII 隔离。
5. **一次性 token 视图层**：`POST /v1/views/audit/{user_id}`、`POST /v1/views/recommendation/{rec_id}`，区分 24h 过期 vs 单次使用。
6. **landing v2 + 公共 /dashboard**：landing 页面 v2 + public `GET /dashboard` 端点。
7. **参考 Agent**：`examples/reference-agent/`，自动验证 27 个端点。

### 3.2 Bug 修复（7 条）

| # | 症状 | 修复 |
|---|------|------|
| 1 | 未匹配 `/v1/*` 路由返 Express 默认 HTML 404 | 全局 404 JSON 兜底中间件（`src/main/server.ts`） |
| 2 | `/v1/config/*`、`/v1/market/leaderboard` 无 Bearer 返 401（与 skill.md §5.6 矛盾） | `optionalAuthMiddleware` |
| 3 | 同一 `contact` 跨 `user_type` 注册返 `DUPLICATE_REQUEST` | 错误码改 `CONTACT_TAKEN`；schema 不变 |
| 4 | `action_history.action_type` 是 raw path | 枚举映射表 + last-segment fallback |
| 5 | `POST /v1/candidate/delete-my-data` 抛 500 `NOT NULL constraint failed: users.name` | `v008_gdpr_nullable.sql` |
| 6 | `/v1/auth/rotate-key` 没被审计 | `AUDITED_PREFIXES` 前缀化 |
| 7 | 严格 UTF-8 请求体未验收（之前仅看 Content-Type） | 新 `utf8-only` 中间件 |

### 3.3 Breaking Changes（7 条）

- 删除 Electron 桌面客户端（`src/preload/` + `src/renderer/` 整目录）
- 严格 UTF-8 请求体验收（GBK 返 400 `INVALID_CHARSET`）
- `/v1/candidate/access_log` → `/v1/candidate/access-log`（连字符）
- `delete-my-data` 路径连字符化
- `contact` 跨 role 允许（用 `CONTACT_TAKEN` 区分信息）
- Job 对象的 `requirements` 字段从 API 表面删除
- 限流算法 fixed-window → sliding-window-counter，1h 阈值 1.5x

### 3.4 新增配置

- `RATE_LIMIT_ENABLED=false`（开发旁路，默认 true）
- `X-RateLimit-Skip: 1`（单请求旁路）
- `DATABASE_PATH` env（API-first 重定位后 DB 路径 env 化）

### 3.5 数据库变更

- `v006_api_key_grace_period.sql`：API key 24h grace slot
- `v007_grace_period_slot.sql`：补全
- `v008_gdpr_nullable.sql`：`users.name`、`users.contact`、`candidates_private.{name_enc, phone_enc, email_enc}` 改 nullable

### 3.6 文档

- `docs/superpowers/skill.md`：完整重写（业务模型 + 端点 + 决策启发 + §14 Agent 决策手册）
- `docs/superpowers/openapi.json`：18 → 29 路径
- `docs/OPERATIONS.md`：新建（运维指南，~150 行）
- `docs/CHANGELOG.md`：本文件（覆盖重写 v1.4.1 主条目，吸掉 v1.1~v1.4 旧条目）
- `docs/FIX_PLAN*.md`：6 个历史执行计划入库
- `examples/reference-agent/`：参考 Agent 实现
- `scripts/generate-openapi.ts`：OpenAPI 自动生成脚本
- `tests/scripts/openapi-coverage.test.ts`：4 个覆盖测试

### 3.7 验证

- `pnpm test`：391 / 391 PASS
- `pnpm typecheck`：0 errors
- `pnpm openapi:check`：与手写 openapi.json 一致
- `pnpm build`：tsc 产 `out/`

---

## 4. 关键决策（用户已确认）

| # | 决策 | 选项 |
|---|------|------|
| 1 | v1.4.1 内容范围 | 完整 v1.4.1：v1.4 之外未文档化的新功能（全部 7 类） |
| 2 | 7 类新功能归宿 | 全部进 v1.4.1 |
| 3 | commit / tag 策略 | 跨度合并：v1.1~v1.4+1.4.1 一个大 commit + 1 个 tag |
| 4 | 发版前验证 | 四件套全跑：test + typecheck + openapi:check + build |
| 5 | 版本号同步 | package.json + openapi.json bump 到 1.4.1；新建 release notes 文件 |
| 6 | untracked 文件归宿 | 全部 15 个进 v1.4.1 commit（含 6 个 FIX_PLAN_*.md） |
| 7 | commit + tag 后动作 | 本地 commit + tag + push + GitHub Release（全部发布） |
| 8 | CHANGELOG v1.4.1 写法 | 覆盖重写：v1.4.1 一条主条目吸掉 v1.1~v1.4 |

---

## 5. 工作流（11 步）

| # | 动作 | 失败处理 |
|---|------|----------|
| 1 | 跑 `pnpm test` | 不通过则停，标记需修的测试 → 用户决定是否先修再继续 |
| 2 | 跑 `pnpm typecheck` | 不通过则停 |
| 3 | 跑 `pnpm openapi:check` | 不通过则停（需重生成 openapi.json 或修脚本） |
| 4 | 跑 `pnpm build` | 不通过则停 |
| 5 | 改写 `docs/CHANGELOG.md` 顶部为 v1.4.1 主条目（覆盖现有 v1.1~v1.4 5 个条目） | — |
| 6 | 改 `package.json` `version: 0.1.0 → 1.4.1` | — |
| 7 | 改 `docs/superpowers/openapi.json` `info.version: 1.0.0 → 1.4.1` | — |
| 8 | 新建 `docs/superpowers/release-notes/2026-06-20-v1.4.1.md`（参照 `2026-06-19-v1.0.md` 模板） | — |
| 9 | `git add -A` 一次加入 15 个 untracked + 57 modified + 15 deleted | 重新跑 `git status` 校对清单 |
| 10 | `git commit -m "release: v1.4.1 — 跨度合并 v1.1~v1.4+1.4.1"` | 写完后 `git log -1 --stat` 校对 |
| 11a | `git tag -a v1.4.1 -m "..."` | `git show v1.4.1 --stat` 校对 |
| 11b | `git push origin main` | 推送前 `git log origin/main..main` 校对领先 |
| 11c | `git push origin v1.4.1` | 推送后 `git ls-remote --tags origin v1.4.1` 校对 |
| 11d | `gh release create v1.4.1 --title ... --notes-file ...` | 完成后 `gh release view v1.4.1` 校对 |

---

## 6. 验证门

| 门 | 通过条件 | 失败动作 |
|----|---------|----------|
| Test 门 | `pnpm test` 末行 `Test Files X passed (X)` + `Tests X passed (X)`，**没有 failed** | 列失败清单，等用户决定 |
| Typecheck 门 | `pnpm typecheck` 末行 `0 errors` | 列错误位置，等用户决定 |
| OpenAPI check 门 | `pnpm openapi:check` 末行 `✓ openapi.json is up to date` | 跑 `pnpm openapi:generate` 重生成并校对 |
| Build 门 | `pnpm build` 末行无 error，`out/main/index.js` 存在 | 看 tsconfig 报错，等用户决定 |
| Git 门 | `git log -1 --format=%s` 显示预期 commit message；`git show v1.4.1` 显示 annotated tag | `git reset --soft HEAD~1` 回退重做 |
| Push 门 | `git ls-remote --tags origin v1.4.1` 返回 1 行 SHA；`gh release view v1.4.1` 显示预期 notes | 删除远端 tag + 本地重做 |

---

## 7. 风险与回滚

### 7.1 风险

- **验证 4 件套可能不过**：v1.4 CHANGELOG 声称 391/391 PASS，但实际工作区里没跑过。如发现不过，需要先修代码再继续。
- **untracked FIX_PLAN 文件入仓**：6 个 FIX_PLAN_*.md 是历史计划笔记，入仓后会被永久记录。
- **远端 push 不可逆**：tag v1.4.1 推送后会被 GitHub 永久索引。如要重做，需先在远端删 tag + revert commit。
- **GitHub Release 公开可见**：release 一旦创建，所有访问者都能看到 release notes。

### 7.2 回滚预案

| 阶段 | 回滚方式 |
|------|----------|
| 步骤 1-4（验证）失败 | 无副作用，停下即可 |
| 步骤 5-8（改文件）失败 | `git restore` 文件 + `git clean` 删新建的 release notes |
| 步骤 9-10（commit）失败 | `git reset --soft HEAD~1` + `git restore --staged .` |
| 步骤 11a（tag）失败 | `git tag -d v1.4.1`（仅本地时） |
| 步骤 11b-11c（push）后想撤回 | `git push origin :v1.4.1`（删远端 tag）+ `git revert HEAD` + `git push origin main` |
| 步骤 11d（Release）后想撤回 | `gh release delete v1.4.1 --yes`（仅删除 release，不删 tag） |

### 7.3 不可逆点

**`git push origin v1.4.1` 一旦执行远端就保留 tag 引用**。删除远端 tag 后虽然不再可被 `git clone` 自动 fetch，但 GitHub Events、API consumer 缓存、第三方 watch 仍可能持有引用。`gh release create` 同理。

---

## 8. 关联文件

- 调研来源：`docs/superpowers/specs/2026-06-18-reposition-to-api-first-design.md`
- 视图层来源：`docs/superpowers/specs/2026-06-18-render-layer-design.md`
- landing 来源：`docs/superpowers/specs/2026-06-18-landing-v2.md`、`docs/superpowers/specs/2026-06-18-marketplace-landing.md`
- public dashboard 来源：`docs/superpowers/specs/2026-06-18-public-dashboard.md`
- action_history 来源：`docs/superpowers/specs/2026-06-18-action-history-and-industry-map-design.md`
- 端点补全来源：`docs/superpowers/specs/2026-06-18-missing-readonly-endpoints.md`
- 参考 Agent 来源：`docs/superpowers/specs/2026-06-18-reference-agent.md`
- 字段命名来源：`docs/superpowers/specs/2026-06-18-api-field-naming-convention.md`

---

## 9. 不在本设计范围

- 把 v1.1~v1.4 拆为多个独立 commit / 多个 tag（已拒绝，用户选跨度合并）
- 重写项目架构、引入 monorepo、CI、admin tools、i18n
- 解决 GitHub Actions、真实参考 agent SDK 等 v1.x 后续工作
- 处理 `package.json` 字段命名历史遗留（如 `package.json` 还在的 `electron-vite` 等 dev deps 痕迹，CHANGELOG v1.1 已说删，需要在 commit 前再校对 `package.json` 不含 electron 相关）

---

## 10. 实施计划入口

本文档审批通过后，下一步是调用 `writing-plans` skill，把上述 11 步工作流拆为可逐步执行、可验证的实施计划（含每个步骤的精确命令、预期输出、失败处理）。

实施计划文件预期位置：`docs/superpowers/plans/2026-06-20-v141-changelog-wrapup-plan.md`
