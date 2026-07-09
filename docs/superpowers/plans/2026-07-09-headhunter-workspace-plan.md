# Headhunter Workspace Implementation Plan (Phase 3a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 面向猎头的 React SPA 工作台 (`/hunter/*`),让猎头可以在浏览器中管理候选人、看待认领、看看板、完成任务。复用现有 `/v1/headhunter/*` API 与 candidate-portal 视觉/技术栈。

**Architecture:**
- 前端: 扩展 admin-web,新增 `/hunter/*` 路由组,9 个页面 (从 ow-recruit hunter-1~6 扩展)
- 后端: 复用现有 `/v1/headhunter/*` 端点 + 新增看板/任务/统计端点 (~3 新表)
- 认证: 复用现有 `hp_live_` bearer token (用户类型 `headhunter`)
- 状态: 复用 candidate-portal 的 React Query + session pattern

**Tech Stack:**
- 后端: TypeScript strict + Express + Zod + node:sqlite + bcryptjs
- 前端: React 18 + TypeScript + React Router 6 + React Query + 现有 plain CSS + 设计令牌
- 借鉴: `C:\Users\Administrator\Desktop\ow-recruit-saas\prototype.html` (hunter 模式 6 屏)

**Spec:** `docs/superpowers/specs/2026-07-09-headhunter-workspace-design.md` (待创建)
**Portfolio:** `docs/superpowers/plans/2026-07-09-missing-uis-portfolio.md`

---

## 优先级总结

| 优先级 | 屏幕 | 组件 | 工时 |
|--------|------|------|------|
| P0.1 | Hunter Login (复用 candidate OTP) | - | 1h |
| P0.2 | Hunter Workspace (hunter-1) — 仪表板 | HunterDashboard | 4h |
| P0.3 | Pending Pickup 队列 (待认领) | PickupQueuePage | 3h |
| P1.4 | Candidate List (hunter-2) — 候选人列表 | CandidateListPage | 3h |
| P1.5 | Pipeline Kanban (hunter-3) — 看板 | KanbanBoard + KanbanColumn + KanbanCard | 6h |
| P1.6 | Candidate Detail (hunter-4) | CandidateDetailPage | 3h |
| P2.7 | Comparison (hunter-5) — 对比视图 | ComparisonPage | 2h |
| P2.8 | Tasks (hunter-6) — 我的任务 | TasksPage | 2h |
| P2.9 | Statistics (扩展 hunter-1) | StatisticsPanel | 2h |
| P2.10 | Settings (hunter profile) | HunterSettingsPage | 1h |

**后端新增** (~7h):
- 新表 `hunter_tasks` + `kanban_columns` (P1.5)
- 端点: `GET/PUT /v1/headhunter/tasks`, `GET/PUT /v1/headhunter/kanban`, `GET /v1/headhunter/stats`
- 端点: `POST /v1/headhunter/candidates/:id/pickup` (待认领) — 已有

**总规模**: 16 任务, ~32h (~4 工作日)

---

## File Structure

### 后端新增

```
src/main/db/migrations/v027_hunter_workspace.sql   (新表 + 索引)
src/main/db/repositories/hunter-tasks.ts          (CRUD)
src/main/db/repositories/hunter-kanban.ts         (CRUD)
src/main/db/repositories/hunter-stats.ts          (聚合查询)
src/main/lib/hunter-pipeline.ts                   (5 阶段状态机扩展)
src/main/modules/headhunter/tasks.ts              (handler)
src/main/modules/headhunter/kanban.ts             (handler)
src/main/modules/headhunter/stats.ts              (handler)
src/main/modules/headhunter/dashboard.ts          (handler, 聚合)
src/main/routes/headhunter-workspace.ts           (新路由组)
src/main/schemas/headhunter-workspace.ts          (Zod)
src/main/capabilities/headhunter-workspace.ts     (capability 声明)
```

### 后端修改

```
src/main/db/migrations.ts                          (注册 v027)
src/main/capabilities/headhunter.ts                (扩展 capability)
src/main/env.ts                                    (无变化)
src/main/server.ts                                 (挂载新路由)
src/main/db/repositories/users.ts                  (display_name 字段)
```

### 前端新增

```
admin-web/src/api/hunter-portal.ts                            (类型化客户端)
admin-web/src/lib/session.ts                                   (扩展 role 字段, 或复用 candidate-session)
admin-web/src/components/hunter-portal/                        (新目录)
  HunterMobileLayout.tsx
  HunterSidebar.tsx
  PipelineStageBadge.tsx
  KanbanCard.tsx
  KanbanColumn.tsx
  KanbanBoard.tsx
  HunterStatsCard.tsx
  RequireHunterAuth.tsx
admin-web/src/pages/hunter-portal/                            (新目录)
  HunterLoginPage.tsx                                         (复用 candidate OTP)
  HunterWorkspacePage.tsx                                     (仪表板)
  PickupQueuePage.tsx                                         (待认领)
  CandidateListPage.tsx
  KanbanPage.tsx
  CandidateDetailPage.tsx
  ComparisonPage.tsx
  TasksPage.tsx
  HunterSettingsPage.tsx
admin-web/src/components/hunter-portal/__tests__/              (单元测试)
  KanbanCard.test.tsx
  KanbanColumn.test.tsx
  PipelineStageBadge.test.tsx
```

### 前端修改

```
admin-web/src/App.tsx                                          (注册 /hunter/* 路由)
admin-web/src/styles.css                                       (新组件 CSS)
```

### 测试新增

```
tests/unit/hunter-portal/pipeline-state.test.ts               (5 阶段状态机)
tests/integration/hunter-portal/tasks.test.ts                  (CRUD + 状态)
tests/integration/hunter-portal/kanban.test.ts                 (看板移动)
tests/integration/hunter-portal/stats.test.ts                  (聚合查询)
tests/integration/hunter-portal/dashboard.test.ts              (端到端仪表板)
```

---

## Task 1: 数据库迁移 v027 (hunter_tasks + kanban_columns)

**Files:**
- Create: `src/main/db/migrations/v027_hunter_workspace.sql`
- Modify: `src/main/db/migrations.ts`

```sql
-- v027: Hunter workspace (Phase 3a)
-- Adds: hunter_tasks (个人待办), kanban_columns (看板)

CREATE TABLE hunter_tasks (
  id              TEXT PRIMARY KEY,
  hunter_user_id  TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  related_recommendation_id  TEXT,
  related_candidate_user_id TEXT,
  due_at          INTEGER,
  completed_at    INTEGER,
  priority        TEXT NOT NULL DEFAULT 'normal',  -- low|normal|high|urgent
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (hunter_user_id) REFERENCES users(id),
  FOREIGN KEY (related_recommendation_id) REFERENCES recommendations(id)
);
CREATE INDEX idx_hunter_tasks_hunter ON hunter_tasks(hunter_user_id, completed_at);
CREATE INDEX idx_hunter_tasks_due ON hunter_tasks(hunter_user_id, due_at) WHERE completed_at IS NULL;

CREATE TABLE kanban_columns (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  hunter_user_id  TEXT NOT NULL,
  name            TEXT NOT NULL,         -- '投递' / '简历过' / '面试' / 'offer' / '到岗'
  position        INTEGER NOT NULL,      -- 列顺序
  pipeline_stage  TEXT NOT NULL,         -- 与 recommendations.pipeline_stage 对应
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (hunter_user_id) REFERENCES users(id),
  UNIQUE(hunter_user_id, name)
);
CREATE INDEX idx_kanban_columns_hunter ON kanban_columns(hunter_user_id, position);

-- ALTER: recommendations 增加 pipeline_stage + position (用于看板)
ALTER TABLE recommendations ADD COLUMN pipeline_stage TEXT NOT NULL DEFAULT 'submitted';
  -- submitted|screen_passed|interview|offer|onboarded|rejected
ALTER TABLE recommendations ADD COLUMN kanban_position INTEGER;
  -- 列内排序, NULL = 默认末尾

-- 默认 5 列 (插入默认行,每个猎头 onboarding 时)
-- (在 handler 层 onboarding 时插入,不在 migration 中)
```

注册 v027 = version 20:
```typescript
{ version: 20, description: 'Hunter workspace (tasks + kanban)', file: 'migrations/v027_hunter_workspace.sql' },
```

## Task 2: 5 阶段状态机 (hunter-pipeline.ts)

**Files:**
- Create: `src/main/lib/hunter-pipeline.ts`
- Test: `tests/unit/hunter-portal/pipeline-state.test.ts`

```typescript
export type PipelineStage = 'submitted' | 'screen_passed' | 'interview' | 'offer' | 'onboarded' | 'rejected';

export const PIPELINE_STAGES: PipelineStage[] = ['submitted', 'screen_passed', 'interview', 'offer', 'onboarded'];

export const STAGE_LABELS: Record<PipelineStage, string> = {
  submitted: '投递',
  screen_passed: '简历过',
  interview: '面试',
  offer: 'Offer',
  onboarded: '到岗',
  rejected: '已拒绝',
};

export const STAGE_COLORS: Record<PipelineStage, string> = {
  submitted: '#3b82f6',
  screen_passed: '#8b5cf6',
  interview: '#ec4899',
  offer: '#f59e0b',
  onboarded: '#10b981',
  rejected: '#6b7280',
};

const TRANSITIONS: Record<PipelineStage, PipelineStage[]> = {
  submitted: ['screen_passed', 'rejected'],
  screen_passed: ['interview', 'rejected'],
  interview: ['offer', 'rejected'],
  offer: ['onboarded', 'rejected'],
  onboarded: [],  // 终态
  rejected: [],   // 终态
};

export function canTransition(from: PipelineStage, to: PipelineStage): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStages(from: PipelineStage): PipelineStage[] {
  return TRANSITIONS[from] ?? [];
}

export function isTerminal(stage: PipelineStage): boolean {
  return ['onboarded', 'rejected'].includes(stage);
}
```

## Task 3: Hunter Tasks Repository + Handler (TDD)

**Files:**
- Create: `src/main/db/repositories/hunter-tasks.ts`
- Create: `src/main/modules/headhunter/tasks.ts`
- Test: `tests/integration/hunter-portal/tasks.test.ts`

(TDD pattern: 写测试 → 失败 → 实现 → 通过 → 提交)

CRUD:
- `list(userId, {status: 'pending'|'completed'|'all', limit, offset})`
- `create(userId, {title, description?, due_at?, priority, related_*})`
- `update(taskId, userId, {title?, description?, due_at?, priority?, completed_at?})`
- `complete(taskId, userId)`
- `delete(taskId, userId)`

测试覆盖: create/list/update/complete/delete + auth 校验 (用户只能改自己的 task) + 状态过滤。

## Task 4: Kanban Repository + Handler (TDD)

**Files:**
- Create: `src/main/db/repositories/hunter-kanban.ts`
- Create: `src/main/modules/headhunter/kanban.ts`
- Test: `tests/integration/hunter-portal/kanban.test.ts`

CRUD:
- `getBoard(userId)` → `{columns: [{id, name, position, cards: [{recommendation_id, candidate_name, position, ...}]}]}`
- `moveCard(userId, recId, {to_column, to_position})` → 触发 pipeline_stage 状态机
- `addCard(userId, recId, {to_column})` (把 rec 添加到看板)
- `removeCard(userId, recId)`

测试覆盖: 初始化默认 5 列 (onboarding) + 移动卡片触发状态机 + 拒绝非法状态转换。

## Task 5: Hunter Stats Handler (聚合查询)

**Files:**
- Create: `src/main/db/repositories/hunter-stats.ts`
- Create: `src/main/modules/headhunter/stats.ts`
- Test: `tests/integration/hunter-portal/stats.test.ts`

聚合查询:
- `getOverview(userId)` → `{active_recommendations, placements_count, onboards_this_month, pending_pickup_count, conversion_rate, ...}`
- `getFunnel(userId, {from, to})` → 5 阶段数量 + 转化率

## Task 6: Hunter Dashboard Handler (聚合)

**Files:**
- Create: `src/main/modules/headhunter/dashboard.ts`
- Test: `tests/integration/hunter-portal/dashboard.test.ts`

聚合: workspace 数据 = stats + recent tasks + active kanban + recent recommendations

## Task 7: Zod Schemas + Router 挂载

**Files:**
- Create: `src/main/schemas/headhunter-workspace.ts`
- Create: `src/main/routes/headhunter-workspace.ts`
- Modify: `src/main/server.ts`

API 端点 (8 新端点):
- `GET /v1/headhunter-workspace/dashboard`
- `GET /v1/headhunter-workspace/tasks?status=&limit=&offset=`
- `POST /v1/headhunter-workspace/tasks`
- `PUT /v1/headhunter-workspace/tasks/:id`
- `DELETE /v1/headhunter-workspace/tasks/:id`
- `GET /v1/headhunter-workspace/kanban`
- `POST /v1/headhunter-workspace/kanban/move`
- `GET /v1/headhunter-workspace/stats?from=&to=`

(挂载到 `/v1/headhunter-workspace` 前缀,避免与 `/v1/headhunter/*` 冲突)

## Task 8: 前端 API 客户端 + Session 扩展

**Files:**
- Create: `admin-web/src/api/hunter-portal.ts`
- Create: `admin-web/src/lib/session.ts` (扩展 candidate-session, 或新建)

API 客户端导出 5 个对象:
- `dashboard` (getDashboard)
- `tasks` (list/create/update/delete/complete)
- `kanban` (getBoard/moveCard)
- `stats` (getOverview/getFunnel)
- `candidates` (复用 candidate-portal 客户端)

Session 扩展: 在 `CandidateSession` 增加可选 `role: 'headhunter' | 'pm' | 'employer'`, 复用 `hp_live_` api_key。

## Task 9: 共享组件 (MobileLayout + Sidebar + PipelineStageBadge)

**Files:**
- Create: `admin-web/src/components/hunter-portal/HunterMobileLayout.tsx`
- Create: `admin-web/src/components/hunter-portal/HunterSidebar.tsx`
- Create: `admin-web/src/components/hunter-portal/PipelineStageBadge.tsx`
- Test: `admin-web/src/components/hunter-portal/__tests__/PipelineStageBadge.test.tsx`

`HunterMobileLayout`: 复用 candidate-portal 的 `MobileLayout` 模式,顶部栏 + 底部 tab (工作台/候选/看板/任务/我的)
`HunterSidebar`: 桌面端侧边栏 (隐藏 tab, 展开)
`PipelineStageBadge`: 显示阶段 + 颜色 (用 STAGE_COLORS)

## Task 10: RequireHunterAuth HOC

**Files:**
- Create: `admin-web/src/components/hunter-portal/RequireHunterAuth.tsx`

复用 candidate-portal 的 RequireAuth 模式,额外校验 `session.user_type === 'headhunter'` (基于 api_key 的 prefix 推断,或读 `/v1/capabilities/me`)。

## Task 11: HunterLoginPage (复用 OTP)

**Files:**
- Create: `admin-web/src/pages/hunter-portal/HunterLoginPage.tsx`

复用 candidate-portal LoginPage 全部代码,只是登录后跳转 `/hunter/workspace` 而非 `/candidate/home`。

## Task 12: HunterWorkspacePage (仪表板)

**Files:**
- Create: `admin-web/src/pages/hunter-portal/HunterWorkspacePage.tsx`

页面:
- 顶部 KPI 卡片 (本月到岗 / 成交金额 / 转化率)
- 待办任务 (Top 5)
- 看板缩略 (5 阶段计数)
- 最近推荐 (Top 5)

## Task 13: PickupQueuePage (待认领)

**Files:**
- Create: `admin-web/src/pages/hunter-portal/PickupQueuePage.tsx`

页面:
- 表格列出所有 pending_pickup 申请 (复用现有 `/v1/headhunter/recommendations/pending-pickup` API)
- 行内"认领"按钮 → 调用 `/v1/headhunter/recommendations/:id/pickup`
- 过滤: 行业/技能/紧急度

## Task 14: CandidateListPage (候选人列表)

**Files:**
- Create: `admin-web/src/pages/hunter-portal/CandidateListPage.tsx`

页面:
- 表格列出我推荐的候选人 (复用 `/v1/headhunter/recommendations` 已有 API)
- 列: 姓名(脱敏) / 当前阶段 / 工作 / 最近活动时间 / 操作
- 过滤: 阶段 / 工作 / 关键词
- 跳转到详情页

## Task 15: KanbanPage (看板)

**Files:**
- Create: `admin-web/src/pages/hunter-portal/KanbanPage.tsx`

页面:
- 5 列看板 (投递/简历过/面试/offer/到岗)
- 卡片显示候选人缩略 + 工作 + 缩略评分
- 拖拽移动 (HTML5 drag & drop)
- 状态机校验合法移动

复用 `KanbanColumn` + `KanbanCard` 组件 (在 Task 9 中创建)。

## Task 16: CandidateDetailPage + ComparisonPage + TasksPage + SettingsPage

**Files:**
- Create: 4 个页面文件

`CandidateDetailPage`: 复用 candidate-portal 详情页,增加猎头视角 (看阶段/编辑/移动到下一阶段)
`ComparisonPage`: 选择 2-3 个候选人,横向对比 (雷达图 + 评分)
`TasksPage`: 任务列表 + 创建/编辑/完成/删除
`SettingsPage`: 头像/显示名/通知偏好/看板列名自定义

## Self-Review

完成后验证:
- `pnpm typecheck` 0 errors
- `pnpm test tests/integration/hunter-portal/ tests/unit/hunter-portal/` 全部通过
- 端到端冒烟: 登录 → 看待认领 → 认领 → 看看板 → 移动卡片到下一阶段

## Report Format

每任务报告:
- Status: DONE | DONE_WITH_CONCERNS | BLOCKED
- Files changed
- Test results
- Schema/状态机适应
- 风险

## 注意事项

- **复用优先**: 大部分代码可从 candidate-portal 复用,不要重写
- **状态机优先**: 5 阶段状态机是核心,所有移动/转换必须经 canTransition 校验
- **响应式**: 看板在 ≤768px 切换为垂直列表
- **拖拽**: HTML5 native drag & drop,无需第三方库
- **暗色模式**: 复用 tokens.css 现有变量
