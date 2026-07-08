# Missing UIs Portfolio — Headhunter + PM + Employer

> **For agentic workers:** 这是 3 个独立子计划的**索引文档**。每个子计划可由不同的 AI agent 独立执行。完成后按 PR 合并。

## 背景

hunter-platform 当前的 UI 覆盖:

| 角色 | UI | 状态 |
|------|----|------|
| Admin (平台运营) | `/admin/*` (React SPA) | ✅ 已有 |
| Candidate (C 端) | `/candidate/*` (React SPA) | ✅ Phase 1 已完成 |
| **Headhunter (猎头)** | **无** | ❌ 待做 |
| **PM (项目经理)** | **无** | ❌ 待做 |
| **Employer (雇主)** | **无** | ❌ 待做 |
| AI Agent | API + skill.md + openapi.json | ✅ 已有 |

ow-recruit-saas 原型提供 3 个角色的 UI 模板 (hunter-1~6 / PM S1~9 / 雇主),需要分别移植。

## 3 份子计划 (可独立执行)

| # | 子计划 | 文件 | 任务数 | 预计工时 | 优先级 |
|---|--------|------|--------|----------|--------|
| 1 | **Headhunter 工作台** | `2026-07-09-headhunter-workspace-plan.md` | 16 | ~32h | 🔴 P0 |
| 2 | **PM 工作台** (含 4 建模能力) | `2026-07-09-pm-workbench-plan.md` | 22 | ~50h | 🟡 P1 |
| 3 | **Employer 招聘面板** | `2026-07-09-employer-panel-plan.md` | 12 | ~22h | 🟢 P2 |

**总规模**: 50 任务 / ~104h (~13 工作日单人, 多人并行 ~5 天)

## 共享技术决策 (3 份计划共用)

| 维度 | 决策 |
|------|------|
| 前端栈 | React 18 + TypeScript strict + React Query (与 candidate-portal 一致) |
| 后端 | Express + Zod + node:sqlite (现有架构) |
| 认证 | 复用现有 `hp_live_` bearer token + `authMiddleware` |
| 设计令牌 | 复用 `admin-web/src/styles/tokens.css` (已含 ow-recruit 颜色) |
| 路由 | admin-web 内新增路由组: `/hunter/*` `/pm/*` `/employer/*` |
| 移动优先 | 是,响应式 ≤768px 移动布局,≥1024px 桌面布局 |
| 状态管理 | React Query 缓存 + 共享 `getSession` (扩展支持 headhunter/pm/employer) |
| 权限路由 | `<RequireRole role="headhunter">` 守卫 |

## 共享代码模式 (从 candidate-portal 复用)

每个子计划都可复用以下现有代码:

- `src/main/lib/matching.ts` — Jaccard 评分 (Plan 2 扩展)
- `src/main/lib/otp.ts` — OTP 生成/校验
- `src/main/modules/candidate-portal/auth.ts` — 认证模式 (Plan 1/2/3 复用)
- `src/main/modules/candidate-portal/jobs.ts` — 工作浏览 (Plan 3 复用)
- `src/main/modules/candidate-portal/applications.ts` — 申请模式 (Plan 1 扩展)
- `admin-web/src/lib/candidate-session.ts` — 会话存储 (扩展 role 字段)
- `admin-web/src/api/candidate-portal.ts` — API 客户端模式 (新建 3 个对应文件)
- `admin-web/src/components/candidate-portal/*` — UI 组件模式 (MobileLayout, EmptyState, JobCard, MatchScore, RadarChart, FunnelCard, MessageBubble, OtpInput, RequireAuth)
- `tests/helpers/test-app.ts` — 测试 helper (已存在,扩展即可)

## 阶段顺序

**Phase 2**: PM 工作台 (Plan 2) → Headhunter (Plan 1) (在原 candidate-portal-plan 调整)
**Phase 3**: Employer 面板 (Plan 3)

但 3 份 plan 互相独立,可由不同 agent 并行执行。合并时按以下顺序:
1. Plan 1 (Headhunter) + Plan 2 (PM) 并行
2. Plan 3 (Employer) 最后

## 数据模型总览

**新增表** (3 个 plan 合并后):

```
projects                 — PM 项目 (Plan 2)
project_positions        — 项目岗位分解 (Plan 2)
staffing_plans           — 编制计划 (Plan 2)
position_decompositions  — 岗位分解 (Plan 2)
pipeline_candidates      — PM 沙盒候选人 (Plan 2)
matches                  — 候选人-岗位匹配 (Plan 2)
hunter_tasks             — 猎头任务 (Plan 1)
kanban_cards             — 看板卡片 (Plan 1)
employer_jobs_view       — 雇主视图 (Plan 3, 可选)
```

**修改表**:
- `users` — 新增 `display_name`, `last_seen_at`
- `recommendations` — 新增 `pipeline_stage`, `kanban_position`
- `placements` — 新增 `employer_notes`

## 迁移计划

3 个 plan 都需要数据库迁移:
- v027 — Headhunter workspace (plan 1)
- v028 — PM workbench (plan 2)
- v029 — Employer panel (plan 3)

## 验收标准 (3 个 plan 合并)

- [ ] Headhunter 可以登录 → 看到工作台 → 管理候选人 → 看看板 → 处理任务
- [ ] PM 可以登录 → 创建项目 → 分解岗位 → 对比计划 → 查看沙盒 → 匹配候选人
- [ ] Employer 可以登录 → 浏览候选人 → 表达兴趣 → 管理职位 → 查看成交
- [ ] 移动端响应式 OK
- [ ] 暗色模式可用
- [ ] 完整测试覆盖 ≥80%
- [ ] Typecheck 0 errors
- [ ] 与 candidate-portal 共享 session/auth 机制

## 执行约定

每个子计划由独立 agent 执行时:
1. 先读 `2026-07-09-missing-uis-portfolio.md` (本文件) 获取上下文
2. 读对应子计划
3. 在新的 git worktree 中工作 (分支命名 `feature/<plan-name>`)
4. 完成后 PR 合并到 main
5. 后续 plan 复用前置 plan 的代码 (按文件结构)

## 风险与依赖

| 风险 | 缓解 |
|------|------|
| 3 个 plan 共享 `users` 表 schema 修改冲突 | 集中在一个 plan 中做 (Plan 1) |
| `recommendations` 表扩展冲突 | Plan 1 做,Plan 2/3 引用 |
| API client 文件冲突 | 3 个独立文件 (portal/hunter/pm/employer) |
| 测试 helper 共享状态 | 测试 helper 已支持扩展,按需 import |

## 后续

完成 3 个 plan 后,平台拥有 4 个角色 UI:
- `/admin` (运营) + `/candidate` (C 端) + `/hunter` (猎头) + `/pm` (PM) + `/employer` (雇主)

hunter-platform 从 API-only 平台演变为**全栈 SaaS** (人 + Agent 都能用)。
