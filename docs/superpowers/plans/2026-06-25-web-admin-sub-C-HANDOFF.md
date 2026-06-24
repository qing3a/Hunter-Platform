# Hunter Platform — Sub-C 执行提示词（给其他 AI Agent）

> **用法：** 复制下方代码块（``` 之间的全部内容），粘贴给另一个 AI agent，让它按计划执行 Sub-C。

---

## 任务背景

你在 `D:/dev/hunter-platform` 工作目录。这是一个 Node.js + TypeScript + better-sqlite3 + Express 的猎头平台 monorepo，含 1 个 admin-web 子项目（React 18 + Vite）。

**Sub-C 目标：** 给 admin-web 加 4 类 ops 日常功能（Jobs/Referrals 概览 + 手动调整配额 + Dashboard 增量 + 审计联动）。

**已完成：** spec 和 2 个 plan 已 commit 到 main：

```
0675269  docs(spec): Web Admin Sub-C design — Mutation + Jobs/Referrals 概览
0c3f359  docs(plan): Web Admin Sub-C Plan 1 — Read-Only Data
fc741b1  docs(plan): Web Admin Sub-C Plan 2 — Mutation + Audit
```

**现有基础（已 merge 的 Sub-A/B/D1）：** admin-web 已有 Login/Dashboard/Users/Candidates/Audit/Profile 6 个页面、Table/SearchBar/Pagination/StatusBadge/MetricCard/Sparkline/AuditJsonDrawer 7 个组件、vitest+RTL 测试基础设施。后端已有 26 个 admin endpoint 含 Sub-D1 登录事件记录。

---

## 执行清单

### 第 1 步：加载技能

按 superpowers 工作流，开局加载：

```
/superpowers:using-superpowers
```

随后按本任务特性加载：

```
/superpowers:writing-plans    (你已经在 plan 阶段, 不再需要)
/superpowers:subagent-driven-development   (执行时使用)
```

如不在 superpowers 环境，跳过 skill 加载，直接按 plan 文件执行。

### 第 2 步：阅读三个文档

按顺序读：

1. **Spec**：`docs/superpowers/specs/2026-06-25-web-admin-sub-C-design.md`（1137 行，约 30 分钟）
   - 重点看 §2（架构总览）、§3（后端设计）、§4（前端设计）、§5（数据流）、§6（测试）
   - 自审章节在 commit `0675269` 之前已修过 9 处不一致

2. **Plan 1**：`docs/superpowers/plans/2026-06-25-web-admin-sub-C-plan-1-readonly.md`（2221 行，16 个 task）
   - 读"File Structure"和"现有代码上下文"段（plan 头部）
   - 然后按 Task 1-16 顺序执行

3. **Plan 2**：`docs/superpowers/plans/2026-06-25-web-admin-sub-C-plan-2-mutation.md`（1587 行，17 个 task）
   - **必须 Plan 1 全部 task commit + 合并到 main 后才能开始**
   - 读"File Structure"和"现有代码上下文"段（plan 头部）
   - 然后按 Task 1-17 顺序执行

### 第 3 步：执行 Plan 1（16 个 task）

每个 task 5 个标准步骤：

1. **Write the failing test** — 严格按 plan 中的代码块
2. **Run it to verify it fails** — 用 plan 中给的命令
3. **Write minimal implementation** — 严格按 plan 中的代码块
4. **Run test to verify it passes**
5. **Commit** — 用 plan 中给的 commit message

**Plan 1 任务清单：**

```
Task 1: Backend — Jobs list endpoint
Task 2: Backend — Recommendations list endpoint
Task 3: Backend — Dashboard stats +7 fields
Task 4: Backend — Capability sync + skill.md
Task 5: Backend — Integration tests for jobs + recommendations + dashboard
Task 6: Frontend — api wrappers (jobs + recommendations + dashboard)
Task 7: Frontend — api wrapper tests
Task 8: Frontend — DetailDrawer 组件
Task 9: Frontend — Skeleton 组件
Task 10: Frontend — CsvButton 组件
Task 11: Frontend — JobsPage
Task 12: Frontend — RecommendationsPage
Task 13: Frontend — DashboardPage update (4 jobs + 3 refs cards)
Task 14: Sub-B fix — SearchBar filter 透传 (CandidatesPage + UsersPage)
Task 15: Frontend — Layout + App.tsx (加 Jobs + Refs 导航)
Task 16: 全量验证 + CHANGELOG v2.1.0
```

**Plan 1 完成后必须做：**
- 全跑 `npm run test`（后端）+ `cd admin-web && npm run test`（前端）
- 全跑 `npm run typecheck`（后端 + 前端）
- 16 个 commit message 都用 plan 中给的文案
- 更新 `CHANGELOG.md` 加 v2.1.0 条目

### 第 4 步：合并 Plan 1 到 main

Plan 1 完成后，merge 整个 feature branch 到 main（如团队用 PR 流程则开 PR）。

**重要：** Plan 2 是 breaking change（adjustQuota reason 必填）。Plan 1 必须先在 main 上线，否则 Plan 2 一合并就会让旧 admin-web 客户端调用 adjustQuota 全部 400。

### 第 5 步：执行 Plan 2（17 个 task）

**前提：** Plan 1 已在 main 上。

```
Task 1: Backend — 扩 AdjustQuotaResultSchema
Task 2: Backend — 修复 users.adjustQuota audit 缺口
Task 3: Backend — 改 routes/admin.ts adjust-quota route
Task 4: Backend — adjustQuota 集成测试
Task 5: Frontend — lib/toast.tsx (Toast provider + hook)
Task 6: Frontend — Toast 组件
Task 7: Frontend — Toast 测试
Task 8: Frontend — Modal 组件
Task 9: Frontend — Modal 测试
Task 10: Frontend — QuotaModal 组件
Task 11: Frontend — QuotaModal 测试
Task 12: Frontend — App.tsx 包 ToastProvider
Task 13: Frontend — api/users.ts adjustQuota
Task 14: Frontend — adjustQuota api wrapper 测试
Task 15: Frontend — UsersPage 加「调配额」按钮
Task 16: Frontend — AuditPage Admin Actions tab 加「详情」列
Task 17: 全量验证 + CHANGELOG v2.1.1
```

**Plan 2 完成后必须做：**
- 全跑测试 + typecheck（同 Plan 1）
- 17 个 commit message 都用 plan 中给的文案
- **手测端到端 8 步**（Task 17.4）— 不能跳过
- 更新 `CHANGELOG.md` 加 v2.1.1 条目

### 第 6 步：交付

- Plan 2 完成后 merge 到 main
- 给用户汇报：所有 task 都完成、所有测试绿、CHANGELOG 更新好
- 列出 Plan 2 已知的限制：AuditPage「详情」按钮暂时只显示 reason（不显示 details_json），需要扩展后端 `/v1/admin/admin-log` endpoint — 这留 Sub-D2 范围

---

## 关键约束（违反会破坏部署）

1. **Plan 1 必须在 Plan 2 之前合并。** 否则旧 admin-web 客户端调用 adjustQuota 全部 400。
2. **每个 task 的代码块必须严格使用 plan 中给的版本。** 不要自由发挥改类型名/函数名 — 这样后续 task 才能 typecheck 通过。
3. **每次 commit message 用 plan 中给的文案。** 不要自由发挥，避免 grep 历史困难。
4. **不引入新依赖。** Plan 已经覆盖所有需要的包；如有需要先暂停并问用户。
5. **测试覆盖率：每个新 UI 组件/页面/api 都要有对应测试文件。** 这是用户在 brainstorming 阶段明确要求的"全量"标准。
6. **数据库 0 改动。** 所有改动用现有表 + 现有字段。

---

## 停止条件（任何一条触发就停下来问用户）

- Plan 中给的 typecheck 命令报错，且错误不在 plan 范围内（说明 plan 有 bug，需要回头修）
- 某个 task 的代码块与现有代码冲突，且无法在不破坏 plan 后续 task 的情况下合并
- 测试覆盖率达不到 plan 中给的 case 数（说明 plan 中代码有错）
- 手测 dev 模式（Plan 2 Task 17.4）任何一步失败
- 想引入 plan 中没列的新依赖

---

## 执行时间预估

- Plan 1：约 4-6 小时（含环境调试）
- Plan 2：约 4-6 小时（含 breaking change 联调）
- 总计：1 个工作日

---

## 工作目录

`D:/dev/hunter-platform`（Windows，cmd.exe shell，已装 node + pnpm/npm）

git 当前 branch：main（无 worktree，按 superpowers:using-git-worktrees 决定是否需要新建 worktree；本任务直接在 main 上执行也可以，因为 plan 给出明确 commit 节奏）

---

## 开始

确认读完 3 个文档后，从 Plan 1 Task 1 开始执行。每个 task 完成后勾选 plan 文件中的 `- [ ] Step N` 复选框（保持进度可见）。任何偏离 plan 的决定都先停下来问用户。

祝顺利。