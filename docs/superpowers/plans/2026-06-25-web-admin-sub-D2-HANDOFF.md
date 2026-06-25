# Hunter Platform — Sub-D2 执行提示词（给其他 AI Agent）

> **用法：** 复制下方代码块（``` 之间的全部内容），粘贴给另一个 AI agent，让它按计划执行 Sub-D2。

---

## 任务背景

你在 `D:/dev/hunter-platform` 工作目录。这是一个 Node.js + TypeScript + node:sqlite + Express 的猎头平台 monorepo，含 1 个 admin-web 子项目（React 18 + Vite）。

**Sub-D2 目标**：给 admin-web 加 4 个 per-entity timeline 页面（user / candidate / job / recommendation），共享 filter bar + list 组件，列表页加「时间轴」按钮作为入口。

**已完成：** spec 和 2 个 plan 已 commit 到 main：

```
f1c84de  docs(spec): Web Admin Sub-D2 design — Per-Entity Timeline
74f7c59  docs(plan): Web Admin Sub-D2 Plan 1 — Backend Timeline Endpoint
1ae8040  docs(plan): Web Admin Sub-D2 Plan 2 — Frontend Timeline Pages
```

**现有基础（已 merge 的 Sub-A/B/C/D1 + Sub-C）：**
- 后端：admin-web 已有 26 个 admin endpoint，包括 admin-log（带 pagination + details_json）
- admin-web 6 个主页面 + 11 个共享组件（含 TimelineList/FiterBar 要复用的 Skeleton/AuditJsonDrawer/Pagination）
- 测试基础设施：vitest + jsdom + RTL

---

## 执行清单

### 第 1 步：阅读 3 个文档

按顺序读：

1. **Spec**：`docs/superpowers/specs/2026-06-25-web-admin-sub-D2-design.md`（848 行）
   - 重点看 §3（backend UNION SQL）、§4（frontend）、§5（数据流）、§6（测试）
2. **Plan 1**：`docs/superpowers/plans/2026-06-25-web-admin-sub-D2-plan-1-backend.md`（834 行，9 task）
   - 读"File Structure"和"现有代码上下文"段
   - 然后按 Task 1-9 顺序执行
3. **Plan 2**：`docs/superpowers/plans/2026-06-25-web-admin-sub-D2-plan-2-frontend.md`（1349 行，13 task）
   - **必须 Plan 1 全部 task commit + 合并到 main 后才能开始**
   - 然后按 Task 1-13 顺序执行

### 第 2 步：执行 Plan 1（9 个 task）

每个 task 5 步走（写测试 → 跑失败 → 写实现 → 跑通过 → commit）：

```
Task 1: TimelineItemSchema + ListTimelineResponseSchema
Task 2: 创建 timeline handler（UNION 4 个 type 模板 + ACTOR_COLS 映射）
Task 3: GET /v1/admin/timeline/:type/:id route
Task 4: admin.get_timeline capability + skill.md
Task 5-8: 集成测试（4 个 type × filter × 边界 = 15 tests）
Task 9: 全验证 + CHANGELOG v2.2.0
```

**Plan 1 完成后必须做：**
- 全跑 `npm run test`（后端）
- 全跑 `npx tsc --noEmit -p tsconfig.node.json`
- 9 个 commit message 都用 plan 中给的文案
- 更新 `CHANGELOG.md` 加 v2.2.0 条目

### 第 3 步：合并 Plan 1 到 main

Plan 1 完成后 merge 整个 feature branch 到 main（如团队用 PR 流程则开 PR）。

**重要：** Plan 2 是依赖 backend endpoint 的前端消费 — Plan 1 必须先在 main 上线。

### 第 4 步：执行 Plan 2（13 个 task）

**前提：** Plan 1 已在 main 上。

```
Task 1: API wrapper timeline.ts + 5 test
Task 2: TimelineFilterBar 组件 + 3 test
Task 3: TimelineList 组件 + 4 test
Task 4-7: 4 个 timeline page（每页 4 test）
Task 8: App.tsx 路由注册
Task 9-12: 4 个列表页加「时间轴」Link（每页 1 test）
Task 13: 全验证 + CHANGELOG
```

**Plan 2 完成后必须做：**
- 全跑测试 + typecheck（同 Plan 1）
- 13 个 commit message 都用 plan 中给的文案
- **手测 8 步**（Plan 1 spec §8）— 不能跳过
- 更新 `CHANGELOG.md` v2.2.0 条目（前端部分）

### 第 5 步：交付

- Plan 2 完成后 merge 到 main
- 给用户汇报：所有 task 都完成、所有测试绿、CHANGELOG 更新好

---

## 关键约束（违反会破坏部署）

1. **Plan 1 必须在 Plan 2 之前合并。** Plan 2 的 4 个 timeline page 调 `getTimeline()`，需要 backend endpoint 已上线。
2. **每个 task 的代码块必须严格使用 plan 中给的版本。** 不要自由发挥改类型名/函数名。
3. **每次 commit message 用 plan 中给的文案。** 不要自由发挥。
4. **不引入新依赖。** Plan 已覆盖所有需要的包。
5. **测试覆盖率：每个新 UI 组件/页面/api 都要有对应测试文件。**
6. **数据库 0 改动。** 所有改动用现有表 + 现有字段。

---

## 关键设计要点（必读）

### 1. UNION 3 表的列名映射

3 个 audit 表的 actor 列名不同：
- `admin_action_log` 用 `admin_user_id`
- `action_history` 用 `user_id`
- `unlock_audit_log` 用 `actor_user_id`

handler 维护 `ACTOR_COLS` 映射表，用字符串占位符 `__ACTOR_COL__` 在 SQL 拼装时替换为对应列名。**actor 值仍用 parameterized query 防 SQL injection**。

### 2. Candidate 反查 subquery

`type=candidate` 需要从 `candidates_private` 反查 `candidate_user_id`：

```sql
SELECT ... FROM admin_action_log a
WHERE a.target_type = 'user'
  AND a.target_id = (SELECT candidate_user_id FROM candidates_private WHERE anonymized_id = ?)
```

`candidates_private` 已有 idx on anonymized_id（v006 migration），单次 < 1ms。

⚠️ **如 test 失败找不到 `candidates_private.anonymized_id` 字段**（实际可能在 `candidates_anonymized` 中），按 plan 步骤 5.2 注处理。

### 3. 前端复用 AuditJsonDrawer

timeline 每条事件的「查看 JSON 详情」按钮 → 复用 Sub-D1 已建的 `<AuditJsonDrawer>` 组件。**不要新建 drawer 组件**。

### 4. Filter 不持久化到 URL

4 个 timeline page 的 filter（source/from/until/actor）只在 useState 中，**不写到 URL searchParams**。简化实现，后续 Sub-D3 follow-up 再补。

---

## 停止条件（任何一条触发就停下来问用户）

- Plan 中给的 typecheck 命令报错，且错误不在 plan 范围内
- 某个 task 的代码块与现有代码冲突，无法在不破坏后续 task 的情况下合并
- UNION SQL 实际产出与 plan 设计的字段对不上（如某列在生产 schema 中不存在）
- 测试覆盖率达不到 plan 中给的 case 数
- 手测 dev 模式（Plan 1 spec §8）任何一步失败
- 想引入 plan 中没列的新依赖

---

## 执行时间预估

- Plan 1：~4-6 小时（含 UNION SQL 调试）
- Plan 2：~5-7 小时（4 个 page × ~1.5h + 共享组件 + 测试）
- 总计：~2 个工作日

---

## 工作目录

`D:/dev/hunter-platform`（Windows，cmd.exe shell，已装 node + pnpm/npm）

git 当前 branch：main

---

## 开始

确认读完 3 个文档后，从 Plan 1 Task 1 开始执行。每个 task 完成后勾选 plan 文件中的 `- [ ] Step N` 复选框（保持进度可见）。任何偏离 plan 的决定都先停下来问用户。

祝顺利。