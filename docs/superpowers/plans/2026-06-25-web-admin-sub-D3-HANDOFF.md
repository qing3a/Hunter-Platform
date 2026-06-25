# Hunter Platform — Sub-D3 执行提示词（给其他 AI Agent）

> **用法：** 复制下方代码块（``` 之间的全部内容），粘贴给另一个 AI agent，让它按计划执行 Sub-D3。

---

## 任务背景

你在 `D:/dev/hunter-platform` 工作目录。这是一个 Node.js + TypeScript + node:sqlite + Express 的猎头平台 monorepo，含 1 个 admin-web 子项目（React 18 + Vite）。

**Sub-D3 目标**：给 admin-web 加 2 个新 page（Webhook 死信 + Placements 列表）+ 共享 ConfirmModal 组件。后端 endpoint 改 paginated envelope。

**已完成：** spec 和 2 个 plan 已 commit 到 main：

```
010752f  docs(spec): Web Admin Sub-D3 design
c5ea60f  docs(plan): Web Admin Sub-D3 Plan 1 — Backend
b4df381  docs(plan): Web Admin Sub-D3 Plan 2 — Frontend
```

**现有基础（已 merge 的 Sub-A/B/C/D1/D2）：**
- 后端 admin endpoints 26+ 个（含 timeline + admin-log 已支持 paginated envelope）
- admin-web 7 个主页面 + 11 个组件（含 ConfirmModal 要复用的 Sub-C Modal）
- 测试基础设施：vitest + jsdom + RTL

---

## 执行清单

### 第 1 步：阅读 3 个文档

按顺序读：

1. **Spec**：`docs/superpowers/specs/2026-06-25-web-admin-sub-D3-design.md`（796 行）
   - 重点看 §3（backend 改造）、§4（frontend 页面 + ConfirmModal）、§5（数据流）
2. **Plan 1**：`docs/superpowers/plans/2026-06-25-web-admin-sub-D3-plan-1-backend.md`（866 行，8 task）
   - 读"File Structure"和"现有代码上下文"段
   - 然后按 Task 1-8 顺序执行
3. **Plan 2**：`docs/superpowers/plans/2026-06-25-web-admin-sub-D3-plan-2-frontend.md`（1078 行，8 task）
   - **必须 Plan 1 全部 task commit + 合并到 main 后才能开始**
   - 然后按 Task 1-8 顺序执行

### 第 2 步：执行 Plan 1（8 个 task）

每个 task 5 步走（写测试 → 跑失败 → 写实现 → 跑通过 → commit）：

```
Task 1: Schema（DeadLetterRow + PlacementRow + 2 envelopes）
Task 2: webhooks.listDeadLetter handler 改造
Task 3: placements.list handler 改造
Task 4: 2 个 GET route 改造（加 pagination + filter）
Task 5: 2 个 capability + skill.md 同步
Task 6: 集成测试 — webhook dead-letter（6 cases）
Task 7: 集成测试 — placements（7 cases）
Task 8: 全验证 + CHANGELOG v2.3.0
```

**Plan 1 完成后必须做：**
- 全跑 `npm run test`（后端）
- 全跑 `npx tsc --noEmit -p tsconfig.node.json`
- 8 个 commit message 都用 plan 中给的文案
- 更新 `CHANGELOG.md` 加 v2.3.0 条目

### 第 3 步：合并 Plan 1 到 main

Plan 1 完成后 merge 整个 feature branch 到 main（如团队用 PR 流程则开 PR）。

**重要：** Plan 2 是依赖 backend endpoint 的前端消费 — Plan 1 必须先在 main 上线。注意 Plan 2 的 frontend 之前可能用 mock data（早期版本），现在依赖 Plan 1 的真实 endpoint。

### 第 4 步：执行 Plan 2（8 个 task）

**前提：** Plan 1 已在 main 上。

```
Task 1: api/webhooks.ts + 4 test
Task 2: api/placements.ts + 5 test
Task 3: ConfirmModal 组件 + 5 test
Task 4: WebhookDeadLetterPage + 4 test
Task 5: PlacementsPage + 5 test
Task 6: Layout + App.tsx 路由注册
Task 7: DashboardPage 「Webhook 死信」卡片加 Link
Task 8: 全验证 + CHANGELOG v2.3.0 完整
```

**Plan 2 完成后必须做：**
- 全跑测试 + typecheck（同 Plan 1）
- 8 个 commit message 都用 plan 中给的文案
- **手测 7 步**（Plan 1 spec §8）— 不能跳过
- 更新 `CHANGELOG.md` v2.3.0 完整条目

### 第 5 步：交付

- Plan 2 完成后 merge 到 main
- 给用户汇报：所有 task 都完成、所有测试绿、CHANGELOG 更新好

---

## 关键约束（违反会破坏部署）

1. **Plan 1 必须在 Plan 2 之前合并。** Plan 2 的 2 个 page 调 listDeadLetter/listPlacements，需要 backend endpoint 已上线。
2. **每个 task 的代码块必须严格使用 plan 中给的版本。** 不要自由发挥改类型名/函数名。
3. **每次 commit message 用 plan 中给的文案。** 不要自由发挥。
4. **不引入新依赖。** Plan 已覆盖所有需要的包。
5. **测试覆盖率：每个新 UI 组件/页面/api 都要有对应测试文件。**
6. **数据库 0 改动。** 所有改动用现有表 + 现有字段。
7. **breaking change 注意：** Plan 1 把 2 个 GET endpoint 从 flat array 改成 paginated envelope（`{ ok, data, pagination }`）。**只有 admin-web 调用**，所以同时上 Plan 1+Plan 2 安全。但如未来有外部脚本调这 2 个 endpoint，需要更新。

---

## 关键设计要点（必读）

### 1. handler return shape 变了

```typescript
// 之前
listDeadLetter(limit: number): DeadLetterRow[]
list({ status }): PlacementRow[]

// 现在
listDeadLetter(filter: ListDeadLetterFilter): { rows: DeadLetterRow[]; total: number }
list(filter: ListPlacementsFilter): { rows: PlacementRow[]; total: number }
```

调用方（admin-web）需要按 envelope 格式解构 `{ rows, total }`。Plan 2 的 api wrapper 已经处理。

### 2. ConfirmModal pattern

- variant='primary'（蓝按钮）：mark-paid
- variant='danger'（红按钮）：cancel
- onConfirm 抛错 → 错误内联显示 + modal 保持打开（不会自动关闭）
- 加载中：两个按钮都 disabled，按钮文案变「处理中...」

### 3. Status badge 颜色

`paid` = 绿、`cancelled` = 红、`pending_payment` = 黄/橙。复用 Sub-C 已有 `<StatusBadge>` 组件。

### 4. Capability count 测试

每次加新 capability 都要更新 `tests/unit/scripts/generate-skill-md-scenarios.test.ts` 的 `expectedCount`。Plan 1 Task 5 已包含这次更新（从 54 → 56），但**如果执行中又加了 capability**，要再次更新。

---

## 停止条件（任何一条触发就停下来问用户）

- Plan 中给的 typecheck 命令报错，且错误不在 plan 范围内
- 某个 task 的代码块与现有代码冲突，无法在不破坏后续 task 的情况下合并
- webhook_delivery_queue 或 placements 表实际列名/约束与 plan 不同
- 测试覆盖率达不到 plan 中给的 case 数
- 手测 dev 模式（Plan 1 spec §8）任何一步失败
- 想引入 plan 中没列的新依赖

---

## 执行时间预估

- Plan 1：~4-5 小时（含 schema/handler/route + 13 测试）
- Plan 2：~5-6 小时（含 2 page + ConfirmModal + 19 测试）
- 总计：~2 个工作日

---

## 工作目录

`D:/dev/hunter-platform`（Windows，cmd.exe shell，已装 node + pnpm/npm）

git 当前 branch：main

---

## 开始

确认读完 3 个文档后，从 Plan 1 Task 1 开始执行。每个 task 完成后勾选 plan 文件中的 `- [ ] Step N` 复选框（保持进度可见）。任何偏离 plan 的决定都先停下来问用户。

祝顺利。