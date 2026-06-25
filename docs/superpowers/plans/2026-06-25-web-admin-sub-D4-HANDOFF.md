# Hunter Platform — Sub-D4 执行提示词（给其他 AI Agent）

> **用法：** 复制下方代码块（``` 之间的全部内容），粘贴给另一个 AI agent，让它按计划执行 Sub-D4。

---

## 任务背景

你在 `D:/dev/hunter-platform` 工作目录。这是一个 Node.js + TypeScript + node:sqlite + Express 的猎头平台 monorepo，含 1 个 admin-web 子项目（React 18 + Vite）。

**Sub-D4 目标**：webhook retry 写 audit log（Sub-D3 known limitation fix）+ 4 个 per-entity 详情页（user / candidate / job / recommendation）。

**已完成：** spec 和 2 个 plan 已 commit 到 main：

```
8e5cfcd  docs(spec): Web Admin Sub-D4 design
ff94d24  docs(plan): Web Admin Sub-D4 Plan 1 — Backend
7d6a5f4  docs(plan): Web Admin Sub-D4 Plan 2 — Frontend
```

**现有基础（已 merge 的 Sub-A/B/C/D1/D2/D3）：**
- 后端 admin endpoints 26+ 个（含 timeline / admin-log / webhooks-dead-letter / placements 都已支持 paginated envelope）
- admin-web 9 个主页面 + 11 个组件（含 toast 已 memoize、ConfirmModal 复用 Sub-C Modal）
- 测试基础设施：vitest + jsdom + RTL

---

## 执行清单

### 第 1 步：阅读 3 个文档

按顺序读：

1. **Spec**：`docs/superpowers/specs/2026-06-25-web-admin-sub-D4-design.md`（504 行）
2. **Plan 1**：`docs/superpowers/plans/2026-06-25-web-admin-sub-D4-plan-1-backend.md`（576 行，7 task）
3. **Plan 2**：`docs/superpowers/plans/2026-06-25-web-admin-sub-D4-plan-2-frontend.md`（1083 行，11 task）

### 第 2 步：执行 Plan 1（7 task）

每个 task 5 步走：

```
Task 1: webhooks.retry 加 adminUserId + 写 audit
Task 2: retry route 透传 adminUserId
Task 3: 4 个 handler 加 get(id)
Task 4: 4 个 GET :id routes + 4 个 envelope schema
Task 5: 集成测试 — webhook retry 写 audit (1 case)
Task 6: 集成测试 — 4 个 GET :id (8 cases)
Task 7: 全验证 + CHANGELOG v2.4.0
```

### 第 3 步：合并 Plan 1 到 main

Plan 1 完成后 merge（如用 PR 流程就开 PR）。

### 第 4 步：执行 Plan 2（11 task）

```
Task 1: 4 个 API wrapper (getUser / getJob / getCandidate / getRecommendation) + 5 test
Task 2: UserDetailPage + 4 test
Task 3: CandidateDetailPage + 4 test
Task 4: JobDetailPage + 4 test
Task 5: RecommendationDetailPage + 4 test
Task 6: App.tsx 路由注册
Task 7-10: 4 个列表页加「详情」按钮（各 1 test）
Task 11: 全验证 + CHANGELOG v2.4.0 完整
```

### 第 5 步：交付

- Plan 2 merge 到 main
- 手测 5 步（Plan 1 spec §8）确认功能
- 给用户汇报

---

## 关键约束

1. **Plan 1 必须先合并**（Plan 2 消费新 GET :id endpoint）
2. **每个 task 的代码块严格使用 plan 中给的版本**
3. **每次 commit message 用 plan 中给的文案**
4. **不引入新依赖**
5. **测试覆盖率：每个新 UI/api 都要有对应测试**
6. **数据库 0 改动**
7. **breaking change：`webhooks.retry()` 加 `adminUserId` 参数** — 唯一调用方是 admin-web，Plan 2 同步改

---

## 关键设计要点

### 1. webhook retry audit（best-effort）

```typescript
try {
  adminLog.insert({ /* ... */ });
} catch (e) {
  console.error('[webhooks.retry] audit log insert failed:', e);
  // 不回滚 retry
}
```

audit log 写失败不阻塞 retry。已在 spec §3.4 决策点。

### 2. 4 个 GET :id endpoint

```typescript
const getById = (handler, schema) => (req, res, next) => {
  try {
    const id = req.params.id;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw Errors.invalidParams('id has invalid format');
    const row = handler(id);
    if (!row) throw Errors.notFound('Not found');
    respond(res, schema, { ok: true, data: row }, { strict: true });
  } catch (e) { next(e); }
};

router.get('/users/:id', getById(users.get, GetUserResponseSchema));
// ... 3 more
```

注：candidates 用 `anonymized_id` 作为查询 key，不是 `candidates_private.id`。

### 3. 4 个详情页结构（统一模式）

```tsx
type DataState<T> = { loading: true } | { loading: false; data: T } | { loading: false; error: string };

// 1. 并发调 N 个 API (getX + 1-2 个 listX)
// 2. 错误处理：主 entity 失败 → 整页错误；关联失败 → 部分错误
// 3. 渲染：header (基本信息) + 关联数据表 + 「查看时间轴」链接
```

### 4. 路由顺序

`/users/:id` 必须在 `/users/:id/timeline` 之前注册，避免 catch-all 拦截。同样适用于 candidate / job / recommendation。

### 5. Capability count test

每加新 capability 都要更新 `tests/unit/scripts/generate-skill-md-scenarios.test.ts` 的 `expectedCount`。Plan 1 加 4 个新 capability（user.get / job.get / candidate.get / recommendation.get 或类似 — 实际是否有新 capability 取决于是否注册为 admin.* capability）。

**如果 Plan 1 没加新 capability**：expectedCount 不变（仍 55）。
**如果加了 N 个**：expectedCount += N。

### 6. 复用 Sub-C StatusBadge

详情页用 `<StatusBadge status={u.status} />` 显示彩色 pill。

### 7. URL 持久化

详情页不做（避免 scope 膨胀）。Sub-D5 follow-up 再做。

---

## 停止条件（任一触发即停）

- plan typecheck 命令报错，错误不在 plan 范围内
- 与现有代码冲突，无法合并
- 测试达不到 plan 给的 case 数
- 手测 5 步任一失败
- 想引入新依赖

---

## 执行时间预估

- Plan 1：~3-4 小时（5 endpoint + audit fix + 9 测试）
- Plan 2：~5-6 小时（4 page + 4 wrapper + 4 列表按钮 + 24 测试）
- 总计：~2 个工作日

---

## 工作目录

`D:/dev/hunter-platform`（Windows，cmd.exe shell）

git 当前 branch：main

---

## 开始

确认读完 3 个文档后，从 Plan 1 Task 1 开始执行。每个 task 完成后勾选 plan 文件中的 `- [ ] Step N` 复选框。任何偏离 plan 的决定都先停下来问用户。

祝顺利。