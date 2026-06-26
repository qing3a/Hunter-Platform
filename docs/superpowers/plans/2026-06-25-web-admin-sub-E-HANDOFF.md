# Hunter Platform — Sub-E 执行提示词（给其他 AI Agent）

> **用法：** 复制下方代码块（``` 之间的全部内容），粘贴给另一个 AI agent，让它按计划执行 Sub-E。

---

## 任务背景

你在 `D:/dev/hunter-platform` 工作目录。这是一个 Node.js + TypeScript + node:sqlite + Express 的猎头平台 monorepo，含 1 个 admin-web 子项目（React 18 + Vite）。

**Sub-E 目标**：在 admin-web 加 SettingsPage（3 tabs：Config / Rate-Limit / Webhooks），让 ops 团队能 self-service 配置 webhook subscriptions、调整 config 业务参数、查看 rate-limit 设置。

**已完成**：spec 和 2 个 plan 已 commit 到 main：

```
c35b239  docs(spec): Web Admin Sub-E design
89ce32d  docs(plan): Web Admin Sub-E Plan 1 — Backend
191b224  docs(plan): Web Admin Sub-E Plan 2 — Frontend
```

**现有基础**：Sub-C/D2/D3/D4/D5/D6 + Small Fixes 已交付。11 个 admin-web page + 13 个共享组件（含 ConfirmModal、useUrlParam、useTimelineFilters 等）。

---

## 执行清单

### 第 1 步：阅读 3 个文档

按顺序读：

1. **Spec**：`docs/superpowers/specs/2026-06-25-web-admin-sub-E-design.md`（490 行）
   - 重点看 §3（backend）、§4（frontend）、§5（数据流）
2. **Plan 1**：`docs/superpowers/plans/2026-06-25-web-admin-sub-E-plan-1-backend.md`（726 行，6 task）
3. **Plan 2**：`docs/superpowers/plans/2026-06-25-web-admin-sub-E-plan-2-frontend.md`（823 行，5 task）

### 第 2 步：执行 Plan 1（6 task）

每个 task 5 步走（写测试 → 跑失败 → 写实现 → 跑通过 → commit）：

```
Task 1: migration v024_webhook_subscriptions（1 个 SQL 文件）
Task 2: schemas + repository（4 个 schema + 1 个 repo）
Task 3: handler + 4 routes（1 个 handler + 1 个 route 改造）
Task 4: capabilities + skill.md（4 个 capability + skill.md）
Task 5: 集成测试 — webhook subscriptions（10 cases）
Task 6: 全验证 + CHANGELOG v2.7.0
```

### 第 3 步：合并 Plan 1 到 main

Plan 1 完成后 merge（如用 PR 流程就开 PR）。

### 第 4 步：执行 Plan 2（5 task）

**前提**：Plan 1 已在 main 上。

```
Task 1: 3 个 API wrappers（config / rate-limit / webhook-subscriptions）+ 2 个 test
Task 2: SettingsPage（3 tabs 1 page）+ commit
Task 3: Layout + App.tsx 路由注册
Task 4: SettingsPage 测试（5 cases）
Task 5: 全验证 + CHANGELOG v2.7.0 完整
```

### 第 5 步：交付

- Plan 2 merge 到 main
- 手测 5 步（Plan 1 spec §8）确认功能
- 给用户汇报

---

## 关键约束

1. **Plan 1 必须先合并**（Plan 2 消费 4 个新 webhook subscription endpoint）
2. **每个 task 的代码块严格使用 plan 中给的版本**
3. **每次 commit message 用 plan 中给的文案**
4. **不引入新依赖**
5. **测试覆盖率：每个新 UI/api 都要有对应测试**
6. **数据库改动只有 1 个 migration**（v024_webhook_subscriptions），其他 0 改动
7. **worker 端 0 改动**（新表只是 metadata，Sub-F 才会接入实际投递）

---

## 关键设计要点

### 1. Webhook subscriptions 是 metadata only

新表 `webhook_subscriptions` 只是管理 UI 的存储，**webhook 投递 worker 不读它**。这避免触碰 worker 端（Sub-F 范围）。

如未来需要接入：
1. Worker 启动时 SELECT * FROM webhook_subscriptions WHERE enabled=1
2. 投递时按 event_type 过滤
3. 选对应 subscription 的 target_url

### 2. Rate-Limit 用 Config 表存

不新增 schema。Rate-Limit tab 从 `listConfig()` 读 `rate_limit.*` keys，写走 Config tab（updateConfig）。Worker 端如需读，自己做 `getConfig('rate_limit.tier.<tier>.limit_per_minute')`。

### 3. Config 编辑必填 reason

每改一个 config key 都要求 reason ≥3 字符（Sub-D5 加的 ConfirmModal requireReason 已支持）。handler 必校验。

### 4. capability count test 同步

Plan 1 加 4 个 capability（list/create/update/delete webhook subscription）。`tests/unit/scripts/generate-skill-md-scenarios.test.ts` 的 `expectedCount` 从 63 → 67（虽然我们之前 estimate 59，加 4 后是 63，但 plan 写的是 63，需要执行时核对实际数）。

如实际加的数量不符 plan 预估，update expectedCount 公式即可。

---

## 停止条件

- plan typecheck 命令报错，错误不在 plan 范围内
- 与现有代码冲突，无法合并
- webhook_subscriptions migration 与现有表冲突
- 测试达不到 plan 给的 case 数
- 想引入新依赖

---

## 执行时间预估

- Plan 1：~4-5 小时（migration + 4 endpoint + 10 测试）
- Plan 2：~5-6 小时（1 page 3 tabs + 3 API wrapper + 11 测试）
- 总计：~2 个工作日

---

## 工作目录

`D:/dev/hunter-platform`（Windows，cmd.exe shell）

git 当前 branch：main

---

## 开始

确认读完 3 个文档后，从 Plan 1 Task 1 开始执行。每个 task 完成后勾选 plan 文件中的 `- [ ] Step N` 复选框。任何偏离 plan 的决定都先停下来问用户。

祝顺利。