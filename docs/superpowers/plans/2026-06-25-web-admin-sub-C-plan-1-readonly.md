# Web Admin Sub-C Plan 1: Read-Only Data (Jobs + Recommendations + Dashboard)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Scope:** 本 plan 仅交付 Sub-C 的 **只读数据层**。Mutation 入口（adjustQuota 修复 + QuotaModal + UsersPage/AuditPage 改）放在独立的 `2026-06-25-web-admin-sub-C-plan-2-mutation.md`，必须等本 plan 合并后再执行。

**Goal:** 在 admin-web 暴露 Jobs 列表、Recommendations 列表、Dashboard 增量（7 字段）+ 顺带修 Sub-B 留下的 SearchBar filter 透传 bug。后端 3 处新增/改动 + 前端 4 个新页面/组件 + 1 个 Sub-B 修复。

**Architecture:**
- **后端**：2 个新 handler（jobs.ts / recommendations.ts）+ 1 处 dashboard 扩字段 + 2 个新 capability。零 migration
- **前端**：3 个新公共组件（DetailDrawer / Skeleton / CsvButton）+ 2 个新页面（JobsPage / RecommendationsPage）+ DashboardPage 改 + Layout/App.tsx 改 + Sub-B SearchBar 顺手修
- **测试**：后端 ~6 handler 测 + 4 route 集成测；前端 ~10 组件测 + 2 页面测 + 2 api 测 + 2 Sub-B 修复测

**Tech Stack (existing):** Express 4.21, better-sqlite3, zod, vitest, supertest（后端）；React 18, Vite, react-router-dom, vanilla CSS, vitest+jsdom+RTL（前端）

**Spec:** [docs/superpowers/specs/2026-06-25-web-admin-sub-C-design.md](../specs/2026-06-25-web-admin-sub-C-design.md) — §2.3、§3.2、§3.3、§3.4、§3.6、§4.2、§4.3、§4.5、§4.7、§4.10

**Sub-C 拆分说明：**
- **Plan 1（本文件）**：Read-Only 数据层 —— 可独立 merge、部署；后端只新增 GET endpoint（无数据变更）
- **Plan 2（独立文件）**：Mutation 层 —— adjustQuota breaking 修复 + Modal/Toast/QuotaModal + UsersPage/AuditPage，必须等 Plan 1 合并后再做

---

## 0. Reviewer decisions（plan-only，来自 spec review）

| 反馈点 | 决策 |
|--------|------|
| Plan 拆分 | **拆 2 份**（本文件 Plan 1 只读；Plan 2 mutation 独立）—— adjustQuota 是 breaking API 变更（reason 从无到必填），不能和 read-only 混在同 PR |
| Sub-B SearchBar 修复 | **纳入 Plan 1**（顺手修；改动 ~10 行 + 2 个新测试） |
| Sub-B 已有页面测试 | 会被改 `(kw) => load(1, kw)` 为 `(kw, f) => load(1, kw, f)`，测试断言需要更新（Task 14 内同步改） |
| Dashboard 字段顺序 | 保持现有 9 字段顺序不变，新 7 字段附加末尾（避免 schema 字段顺序变化破坏已有 strict 校验） |

---

## 现有代码上下文（开始 Task 1 前必读）

实施前应熟悉的文件：

- `src/main/schemas/admin.ts` — zod schema 集合（`DashboardStatsSchema` line 109, `AdjustQuotaResultSchema` line 13, 已有 `PaginationSchema` 来自 Sub-B）
- `src/main/modules/admin/handlers/users.ts` — `adjustQuota()` 是 Plan 2 范围（**本 plan 不动**）
- `src/main/modules/admin/handlers/candidates.ts` — Sub-B 加了 offset+keyword+envelope；本 plan 仿照同样模式写 jobs/refs
- `src/main/modules/admin/handlers/dashboard.ts` — `getStats()` 返回 nested IPC shape（line 22+）
- `src/main/routes/admin.ts` — admin router（dashboard flatten 在 line 62-87，sub-B 后是 9 字段）
- `src/main/capabilities/admin.ts` — capability registry
- `docs/superpowers/skill.md` — capability 公开文档
- `admin-web/src/api/raw.ts` — `apiFetchRaw<T>()` wrapper（Sub-B 加的，返回完整 envelope）
- `admin-web/src/api/users.ts` — `listUsers()` 范本（仿照写 listJobs / listRecommendations）
- `admin-web/src/api/dashboard.ts` — `getDashboardStats()` + `DashboardStats` 类型
- `admin-web/src/components/Table.tsx` — 通用 Table
- `admin-web/src/components/SearchBar.tsx` — 搜索 + 筛选（**已知 bug：filterValues 未透传，Sub-B 留下**）
- `admin-web/src/components/StatusBadge.tsx` — 状态 pill
- `admin-web/src/components/Sparkline.tsx` — sparkline 图
- `admin-web/src/components/AuditJsonDrawer.tsx` — 通用详情侧滑模式（Sub-D1，DetailDrawer 仿照写）
- `admin-web/src/pages/CandidatesPage.tsx` — SearchBar+Table 范本（**filterValues 丢弃，Sub-B bug**）
- `admin-web/src/pages/UsersPage.tsx` — 同上（**filterValues 丢弃，Sub-B bug**）
- `admin-web/src/components/Layout.tsx` — Sub-D1 nav（**加 2 个 Link**）

**不动文件：**
- `src/main/modules/admin/handlers/users.ts` — Plan 2 改
- `src/main/modules/admin/handlers/dashboard.ts` — 不动（dashboard IPC shape 保留）；新字段在 routes/admin.ts flatten 处加
- `admin-web/src/api/client.ts` — Sub-A `apiFetch` 不动
- `admin-web/src/pages/LoginPage.tsx` — 不动
- `admin-web/src/pages/ProfilePage.tsx` — 不动
- `admin-web/src/components/PrivateRoute.tsx` — 不动

---

## File Structure（实施前 map）

### 后端新增/修改

| File | Change |
|------|--------|
| `src/main/modules/admin/handlers/jobs.ts` | **Create** — `list()` 方法 |
| `src/main/modules/admin/handlers/recommendations.ts` | **Create** — `list()` 方法 |
| `src/main/routes/admin.ts` | **Modify** — 加 GET /jobs + GET /recommendations；dashboard flatten 处 +7 字段 |
| `src/main/schemas/admin.ts` | **Modify** — 加 `JobRowSchema` + `ListJobsResponseSchema` + `RecommendationRowSchema` + `ListRecommendationsResponseSchema`；`DashboardStatsSchema` 扩 7 字段 |
| `src/main/capabilities/admin.ts` | **Modify** — 加 `admin.list_jobs` + `admin.list_recommendations` |
| `docs/superpowers/skill.md` | **Modify** — capability 表加 2 行 |
| `tests/integration/admin-list-pagination.test.ts` | **Modify** — 加 jobs + recommendations + dashboard 7 字段测试 |
| `tests/integration/skill-md-conformance/admin-coverage.test.ts` | **Modify** — 加 2 个 capability 覆盖断言（如文件存在） |

### 前端新增

| File | Change |
|------|--------|
| `admin-web/src/api/jobs.ts` | **Create** — `listJobs()` + `JobRow` 类型 |
| `admin-web/src/api/recommendations.ts` | **Create** — `listRecommendations()` + `RecommendationRow` 类型 |
| `admin-web/src/api/dashboard.ts` | **Modify** — `DashboardStats` 类型 +7 字段 |
| `admin-web/src/components/DetailDrawer.tsx` | **Create** — 通用详情侧滑 |
| `admin-web/src/components/Skeleton.tsx` | **Create** — 4 变体加载占位 |
| `admin-web/src/components/CsvButton.tsx` | **Create** — CSV 导出 |
| `admin-web/src/pages/JobsPage.tsx` | **Create** — 列表 + 详情 + 导出 |
| `admin-web/src/pages/RecommendationsPage.tsx` | **Create** — 列表 + 时间范围 + 详情 + 导出 |
| `admin-web/src/pages/DashboardPage.tsx` | **Modify** — 加 4 Jobs 卡片 + 3 Refs 卡片 + 1 sparkline |
| `admin-web/src/components/Layout.tsx` | **Modify** — nav 加「职位」「推荐」 |
| `admin-web/src/App.tsx` | **Modify** — 加 `/jobs` + `/recommendations` 路由 |
| `admin-web/src/pages/UsersPage.tsx` | **Modify** — Sub-B fix：`onSearch` 接 `filterValues` 透传 status |
| `admin-web/src/pages/CandidatesPage.tsx` | **Modify** — Sub-B fix：`onSearch` 接 `filterValues` 透传 unlock_status |

### 前端测试新增

| File | Test cases |
|------|------------|
| `admin-web/tests/api/jobs.test.ts` | 3 cases |
| `admin-web/tests/api/recommendations.test.ts` | 3 cases |
| `admin-web/tests/api/dashboard.test.ts` | 1 case（新 schema 形状） |
| `admin-web/tests/components/DetailDrawer.test.tsx` | 3 cases |
| `admin-web/tests/components/Skeleton.test.tsx` | 2 cases |
| `admin-web/tests/components/CsvButton.test.tsx` | 3 cases |
| `admin-web/tests/pages/JobsPage.test.tsx` | 6 cases |
| `admin-web/tests/pages/RecommendationsPage.test.tsx` | 6 cases |
| `admin-web/tests/pages/DashboardPage.test.tsx` | 2 cases（更新已有 Sub-B 测试） |
| `admin-web/tests/pages/UsersPage.test.tsx` | 1 case（新增 filter 透传断言） |
| `admin-web/tests/pages/CandidatesList.test.tsx` | 1 case（新增 filter 透传断言） |

---

## Task 1: Backend — Jobs list endpoint

**Files:**
- Modify: `src/main/schemas/admin.ts`
- Create: `src/main/modules/admin/handlers/jobs.ts`
- Modify: `src/main/routes/admin.ts`

### Step 1.1: 加 schema 到 schemas/admin.ts

打开 `src/main/schemas/admin.ts`，在 `DashboardStatsSchema` 之前追加：

```typescript
const JobRowSchema = z.object({
  id: IdString,
  employer_id: IdString,
  employer_name: z.string(),
  title: z.string(),
  status: z.enum(['open', 'claimed', 'paused', 'closed', 'filled']),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});

const RecommendationRowSchema = z.object({
  id: IdString,
  job_id: IdString,
  job_title: z.string(),
  anonymized_candidate_id: IdString,
  headhunter_id: IdString,
  headhunter_name: z.string(),
  status: z.enum([
    'pending', 'employer_interested', 'candidate_approved', 'unlocked',
    'rejected_employer', 'rejected_candidate', 'withdrawn', 'placed',
  ]),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});

const ListJobsResponseSchema = z.object({
  data: z.array(JobRowSchema),
  pagination: PaginationSchema,
});

const ListRecommendationsResponseSchema = z.object({
  data: z.array(RecommendationRowSchema),
  pagination: PaginationSchema,
});
```

找到 export 块（文件末尾），追加：

```typescript
export {
  JobRowSchema, RecommendationRowSchema,
  ListJobsResponseSchema, ListRecommendationsResponseSchema,
};
```

### Step 1.2: 创建 admin/jobs.ts handler

Create `src/main/modules/admin/handlers/jobs.ts`:

```typescript
import type { DB } from '../../../db/connection.js';

export type JobRow = {
  id: string;
  employer_id: string;
  employer_name: string;
  title: string;
  status: 'open' | 'claimed' | 'paused' | 'closed' | 'filled';
  created_at: string;
  updated_at: string;
};

export function createAdminJobsHandler(db: DB) {
  return {
    list(filter: {
      status?: JobRow['status'];
      keyword?: string;
      limit?: number;
      offset?: number;
    }): { rows: JobRow[]; total: number } {
      const where: string[] = ['1=1'];
      const params: any[] = [];
      if (filter.status) {
        where.push('j.status = ?');
        params.push(filter.status);
      }
      if (filter.keyword) {
        where.push('(j.title LIKE ? OR u.name LIKE ?)');
        params.push(`%${filter.keyword}%`, `%${filter.keyword}%`);
      }
      const total = (db.prepare(`
        SELECT COUNT(*) AS cnt
        FROM jobs j
        LEFT JOIN users u ON u.id = j.employer_id
        WHERE ${where.join(' AND ')}
      `).get(...params) as { cnt: number }).cnt;

      const rows = db.prepare(`
        SELECT j.id, j.employer_id, u.name AS employer_name,
               j.title, j.status, j.created_at, j.updated_at
        FROM jobs j
        LEFT JOIN users u ON u.id = j.employer_id
        WHERE ${where.join(' AND ')}
        ORDER BY j.created_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, filter.limit ?? 20, filter.offset ?? 0) as JobRow[];

      return { rows, total };
    },
  };
}
```

### Step 1.3: 在 routes/admin.ts 注册

打开 `src/main/routes/admin.ts`：

1. import 块加：

```typescript
import { createAdminJobsHandler } from '../modules/admin/handlers/jobs.js';
import {
  // ...已有...
  ListJobsResponseSchema,
  // ...已有...
} from '../schemas/admin.js';
```

2. router 创建函数内，加 handler 实例化：

```typescript
const jobs = createAdminJobsHandler(db);
```

3. 在 router `// Placements` 区块之前，加新路由：

```typescript
  // Jobs
  router.get('/jobs', (req, res, next) => {
    try {
      const filter: { status?: 'open' | 'claimed' | 'paused' | 'closed' | 'filled'; keyword?: string; limit?: number; offset?: number } = {};
      const validStatuses = ['open', 'claimed', 'paused', 'closed', 'filled'] as const;
      if (typeof req.query.status === 'string') {
        if (!(validStatuses as readonly string[]).includes(req.query.status)) {
          throw Errors.invalidParams('status must be open/claimed/paused/closed/filled');
        }
        filter.status = req.query.status as typeof validStatuses[number];
      }
      if (typeof req.query.keyword === 'string' && req.query.keyword.length > 0) {
        filter.keyword = req.query.keyword;
      }
      const page = req.query.page ? Number(req.query.page) : 1;
      const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 20;
      if (!Number.isFinite(page) || page < 1) throw Errors.invalidParams('page must be a positive integer');
      if (!Number.isFinite(pageSize) || pageSize < 1 || pageSize > 100) {
        throw Errors.invalidParams('pageSize must be 1-100');
      }
      filter.limit = pageSize;
      filter.offset = (page - 1) * pageSize;
      const { rows, total } = jobs.list(filter);
      respond(res, ListJobsResponseSchema, {
        ok: true,
        data: rows,
        pagination: { total, page, pageSize, has_more: page * pageSize < total },
      }, { strict: true });
    } catch (e) { next(e); }
  });
```

### Step 1.4: Typecheck

Run: `cd D:/dev/hunter-platform && npx tsc --noEmit 2>&1 | tail -10`
Expected: no errors（如果是路径相关错误，确认 cwd）。

如果失败，按错误修：通常是 schema export 缺失或 import 路径错。

### Step 1.5: Commit

```bash
git -C D:/dev/hunter-platform add src/main/schemas/admin.ts src/main/modules/admin/handlers/jobs.ts src/main/routes/admin.ts
git -C D:/dev/hunter-platform commit -m "feat(admin): GET /v1/admin/jobs — list with status/keyword filter"
```

---

## Task 2: Backend — Recommendations list endpoint

**Files:**
- Create: `src/main/modules/admin/handlers/recommendations.ts`
- Modify: `src/main/routes/admin.ts`

### Step 2.1: 创建 admin/recommendations.ts handler

Create `src/main/modules/admin/handlers/recommendations.ts`:

```typescript
import type { DB } from '../../../db/connection.js';

export type RecommendationStatus =
  | 'pending' | 'employer_interested' | 'candidate_approved' | 'unlocked'
  | 'rejected_employer' | 'rejected_candidate' | 'withdrawn' | 'placed';

export type RecommendationRow = {
  id: string;
  job_id: string;
  job_title: string;
  anonymized_candidate_id: string;
  headhunter_id: string;
  headhunter_name: string;
  status: RecommendationStatus;
  created_at: string;
  updated_at: string;
};

export function createAdminRecommendationsHandler(db: DB) {
  return {
    list(filter: {
      status?: RecommendationStatus;
      keyword?: string;
      from?: string;
      until?: string;
      limit?: number;
      offset?: number;
    }): { rows: RecommendationRow[]; total: number } {
      const where: string[] = ['1=1'];
      const params: any[] = [];
      if (filter.status) {
        where.push('r.status = ?');
        params.push(filter.status);
      }
      if (filter.keyword) {
        where.push('(j.title LIKE ? OR u.name LIKE ?)');
        params.push(`%${filter.keyword}%`, `%${filter.keyword}%`);
      }
      if (filter.from) {
        if (!Number.isFinite(Date.parse(filter.from))) {
          throw new Error('INVALID_PARAMS: from must be ISO timestamp');
        }
        where.push('r.created_at >= ?');
        params.push(filter.from);
      }
      if (filter.until) {
        if (!Number.isFinite(Date.parse(filter.until))) {
          throw new Error('INVALID_PARAMS: until must be ISO timestamp');
        }
        where.push('r.created_at < ?');
        params.push(filter.until);
      }
      const total = (db.prepare(`
        SELECT COUNT(*) AS cnt
        FROM recommendations r
        LEFT JOIN jobs j ON j.id = r.job_id
        LEFT JOIN users u ON u.id = r.headhunter_id
        WHERE ${where.join(' AND ')}
      `).get(...params) as { cnt: number }).cnt;

      const rows = db.prepare(`
        SELECT r.id, r.job_id, j.title AS job_title,
               r.anonymized_candidate_id, r.headhunter_id,
               u.name AS headhunter_name, r.status,
               r.created_at, r.updated_at
        FROM recommendations r
        LEFT JOIN jobs j ON j.id = r.job_id
        LEFT JOIN users u ON u.id = r.headhunter_id
        WHERE ${where.join(' AND ')}
        ORDER BY r.created_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, filter.limit ?? 20, filter.offset ?? 0) as RecommendationRow[];

      return { rows, total };
    },
  };
}
```

### Step 2.2: 在 routes/admin.ts 注册

打开 `src/main/routes/admin.ts`：

1. import 块加：

```typescript
import { createAdminRecommendationsHandler } from '../modules/admin/handlers/recommendations.js';
import {
  // ...已有...
  ListRecommendationsResponseSchema,
  // ...已有...
} from '../schemas/admin.js';
```

2. router 创建函数内，加 handler 实例化：

```typescript
const recommendations = createAdminRecommendationsHandler(db);
```

3. 在 GET `/jobs` route 之后，加新路由：

```typescript
  // Recommendations
  router.get('/recommendations', (req, res, next) => {
    try {
      const validStatuses = [
        'pending', 'employer_interested', 'candidate_approved', 'unlocked',
        'rejected_employer', 'rejected_candidate', 'withdrawn', 'placed',
      ] as const;
      const filter: { status?: typeof validStatuses[number]; keyword?: string; from?: string; until?: string; limit?: number; offset?: number } = {};
      if (typeof req.query.status === 'string') {
        if (!(validStatuses as readonly string[]).includes(req.query.status)) {
          throw Errors.invalidParams('status must be one of: ' + validStatuses.join(','));
        }
        filter.status = req.query.status as typeof validStatuses[number];
      }
      if (typeof req.query.keyword === 'string' && req.query.keyword.length > 0) {
        filter.keyword = req.query.keyword;
      }
      if (typeof req.query.from === 'string') filter.from = req.query.from;
      if (typeof req.query.until === 'string') filter.until = req.query.until;
      const page = req.query.page ? Number(req.query.page) : 1;
      const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 20;
      if (!Number.isFinite(page) || page < 1) throw Errors.invalidParams('page must be a positive integer');
      if (!Number.isFinite(pageSize) || pageSize < 1 || pageSize > 100) {
        throw Errors.invalidParams('pageSize must be 1-100');
      }
      filter.limit = pageSize;
      filter.offset = (page - 1) * pageSize;
      const { rows, total } = recommendations.list(filter);
      respond(res, ListRecommendationsResponseSchema, {
        ok: true,
        data: rows,
        pagination: { total, page, pageSize, has_more: page * pageSize < total },
      }, { strict: true });
    } catch (e) { next(e); }
  });
```

### Step 2.3: Typecheck

Run: `cd D:/dev/hunter-platform && npx tsc --noEmit 2>&1 | tail -10`
Expected: no errors.

### Step 2.4: Commit

```bash
git -C D:/dev/hunter-platform add src/main/modules/admin/handlers/recommendations.ts src/main/routes/admin.ts
git -C D:/dev/hunter-platform commit -m "feat(admin): GET /v1/admin/recommendations — list with status/keyword/from/until"
```

---

## Task 3: Backend — Dashboard stats +7 fields

**Files:**
- Modify: `src/main/schemas/admin.ts`
- Modify: `src/main/routes/admin.ts`

### Step 3.1: 扩 DashboardStatsSchema

打开 `src/main/schemas/admin.ts`，替换 `DashboardStatsSchema`：

```typescript
const DashboardStatsSchema = z.object({
  total_users: z.number().int(),
  total_candidates: z.number().int(),
  total_jobs: z.number().int(),
  open_jobs: z.number().int(),
  active_placements: z.number().int(),
  daily_quota_used: z.number().int(),
  webhook_dead_letters: z.number().int(),
  // Sub-B additions: today new users + 30-day daily-new trend (oldest → newest)
  today_new_users: z.number().int(),
  trend_30d: z.array(z.number().int()).length(30),
  // Sub-C additions: jobs status detail + recommendations overview
  total_recommendations: z.number().int(),
  today_new_recommendations: z.number().int(),
  recommendations_pending: z.number().int(),
  recommendations_unlocked: z.number().int(),
  jobs_paused: z.number().int(),
  jobs_closed: z.number().int(),
  jobs_filled: z.number().int(),
});
```

**关键：原 9 字段顺序保持不变；新 7 字段附加末尾。** 注释说明这是 Sub-C 增量。

### Step 3.2: 改 routes/admin.ts dashboard route

打开 `src/main/routes/admin.ts`，找到 GET `/dashboard/stats`，替换整个 route handler：

```typescript
  router.get('/dashboard/stats', (_req, res, next) => {
    try {
      const s = dashboard.getStats();
      // Flatten the IPC nested shape to the schema fields. dashboardIpc +
      // e2e-m3-admin.test.ts depend on the nested shape, so we keep handler
      // unchanged and flatten here. Inline SELECTs cover scalars not in getStats().
      const candidateCount = (db.prepare('SELECT COUNT(*) AS c FROM candidates_anonymized').get() as { c: number }).c;
      const activePlacementCount = (db.prepare("SELECT COUNT(*) AS c FROM placements WHERE status IN ('pending_payment','paid')").get() as { c: number }).c;
      const dailyQuotaUsed = (db.prepare('SELECT COALESCE(SUM(quota_used), 0) AS s FROM users').get() as { s: number }).s;
      // Sub-C: today_new_recommendations inline (getStats() doesn't compute this)
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const todayNewRecommendations = (db.prepare(
        'SELECT COUNT(*) AS c FROM recommendations WHERE created_at >= ?'
      ).get(todayStart.toISOString()) as { c: number }).c;
      respond(res, DashboardStatsResponseSchema, {
        ok: true,
        data: {
          // Original 9 fields (Sub-A/B)
          total_users: s.users.total,
          total_candidates: candidateCount,
          total_jobs: s.jobs.total,
          open_jobs: s.jobs.open,
          active_placements: activePlacementCount,
          daily_quota_used: dailyQuotaUsed,
          webhook_dead_letters: s.webhooks.dead_letter,
          today_new_users: todayNewUsers,
          trend_30d: trend_30d,
          // Sub-C: 7 new fields (all from existing getStats() except today_new_recommendations)
          total_recommendations: s.recommendations.total,
          today_new_recommendations: todayNewRecommendations,
          recommendations_pending: s.recommendations.pending,
          recommendations_unlocked: s.recommendations.unlocked,
          jobs_paused: s.jobs.paused,
          jobs_closed: s.jobs.closed,
          jobs_filled: s.jobs.filled,
        },
      }, { strict: true });
    } catch (e) { next(e); }
  });
```

注意：`todayNewUsers` 和 `trend_30d` 这两个变量名已在 Sub-B dashboard handler 中定义（见 dashboard.ts），在 routes/admin.ts 原代码里用过。**直接复用即可**——本 task 不改 dashboard handler。

### Step 3.3: Typecheck

Run: `cd D:/dev/hunter-platform && npx tsc --noEmit 2>&1 | tail -10`
Expected: no errors.

如果失败，最常见错误是 `s.jobs.paused` / `s.jobs.closed` 类型缺失。检查 `dashboard.ts` 的 `DashboardStats` interface 是否真的包含 `paused/closed`（应已包含，本 plan 不动 dashboard handler）。

### Step 3.4: Commit

```bash
git -C D:/dev/hunter-platform add src/main/schemas/admin.ts src/main/routes/admin.ts
git -C D:/dev/hunter-platform commit -m "feat(admin): dashboard stats — add 7 fields (recommendations overview + jobs status detail)"
```

---

## Task 4: Backend — Capability sync + skill.md

**Files:**
- Modify: `src/main/capabilities/admin.ts`
- Modify: `docs/superpowers/skill.md`

### Step 4.1: 加 admin.list_jobs capability

打开 `src/main/capabilities/admin.ts`，找到现有 admin capabilities 数组末尾，在最后一个 capability 后追加：

```typescript
    {
      name: 'admin.list_jobs',
      description: '列出所有 jobs（含 employer_name），支持 status 筛选 + 关键词搜索。',
      method: 'GET', path: '/v1/admin/jobs',
      response_schema: ListJobsResponseSchema,
      quota_cost: 0,
      preconditions: [],
    },
    {
      name: 'admin.list_recommendations',
      description: '列出所有 recommendations（含 job_title + headhunter_name），支持 status 筛选 + 关键词 + 时间范围。',
      method: 'GET', path: '/v1/admin/recommendations',
      response_schema: ListRecommendationsResponseSchema,
      quota_cost: 0,
      preconditions: [],
    },
```

（具体语法按文件现有格式对齐——可能是 `export const AdminCapabilities = [...]` 或类似。打开文件确认现有 capability 块结构后插入。）

确认 import 块已包含 `ListJobsResponseSchema, ListRecommendationsResponseSchema`（如未，加）。

### Step 4.2: 更新 skill.md

打开 `docs/superpowers/skill.md`，找到 admin capability 表（应在文件某处有一份表格或列表），追加 2 行：

```
| admin.list_jobs | GET /v1/admin/jobs | 列出 jobs（status 筛选 + 关键词搜索） |
| admin.list_recommendations | GET /v1/admin/recommendations | 列出 recommendations（status + 关键词 + 时间范围） |
```

格式按文件中已有表格样式（可能是 markdown table / bullet list）。

### Step 3: 跑 capability conformance 测试

Run: `cd D:/dev/hunter-platform && npx vitest run tests/integration/skill-md-conformance/ 2>&1 | tail -20`
Expected: 通过。如失败，最常见是 skill.md 行格式问题，按错误修。

### Step 4.4: Commit

```bash
git -C D:/dev/hunter-platform add src/main/capabilities/admin.ts docs/superpowers/skill.md
git -C D:/dev/hunter-platform commit -m "feat(admin): register admin.list_jobs + admin.list_recommendations capabilities"
```

---

## Task 5: Backend — Integration tests for jobs + recommendations + dashboard

**Files:**
- Modify: `tests/integration/admin-list-pagination.test.ts`

（沿用 Sub-B 的 admin-list-pagination.test.ts 模式：seed admin + 25 user + 多个 jobs + recommendations，测分页 + 筛选 + dashboard 新字段。）

### Step 5.1: 在文件末尾追加 3 个 describe 块

打开 `tests/integration/admin-list-pagination.test.ts`，在 `afterAll` 之后追加（注：afterAll 是顶级 beforeAll/afterAll，应放在 `describe` 内或文件末尾。本 task 的测试放在同一 describe 内、afterAll 前——如果原 afterAll 在 describe 内，则追加在它之前）。

**先打开文件确认 afterAll 位置和现有结构。** 然后在合适位置追加 3 个 describe：

```typescript
  // ---- Jobs pagination + filter (Sub-C Plan 1) ----
  describe('GET /v1/admin/jobs', () => {
    // ... (见下)
  });

  // ---- Recommendations pagination + filter + date range (Sub-C Plan 1) ----
  describe('GET /v1/admin/recommendations', () => {
    // ... (见下)
  });

  // ---- Dashboard stats + 7 new fields (Sub-C Plan 1) ----
  describe('Dashboard stats 7 new fields', () => {
    // ... (见下)
  });
```

**Jobs 测试（4 个 case）：**

```typescript
    // Seed 8 jobs (5 distinct statuses)
    beforeAll(() => {
      const now = new Date('2026-06-24T12:00:00Z').getTime();
      const jobs = [
        ['job_a', 'open'],
        ['job_b', 'claimed'],
        ['job_c', 'paused'],
        ['job_d', 'closed'],
        ['job_e', 'filled'],
        ['job_f', 'open'],
        ['job_g', 'open'],
        ['job_h', 'open'],
      ];
      for (const [id, status] of jobs) {
        db.prepare(`INSERT INTO jobs (id, employer_id, title, status, created_at, updated_at)
          VALUES (?, 'u_1', ?, ?, ?, ?)`).run(
          id, `Title ${id}`, status,
          new Date(now - 86400000).toISOString(),
          new Date(now - 86400000).toISOString()
        );
      }
    });

    it('1. returns paginated envelope', async () => {
      const r = await request(app).get('/v1/admin/jobs').set('Authorization', adminAuth);
      expect(r.status).toBe(200);
      expect(r.body.pagination).toMatchObject({ total: 8, page: 1, pageSize: 20, has_more: false });
      expect(r.body.data).toHaveLength(8);
    });

    it('2. filters by status=open', async () => {
      const r = await request(app).get('/v1/admin/jobs?status=open').set('Authorization', adminAuth);
      expect(r.status).toBe(200);
      expect(r.body.pagination.total).toBe(5);  // job_a, f, g, h
      expect(r.body.data.every((j: any) => j.status === 'open')).toBe(true);
    });

    it('3. filters by keyword (matches title)', async () => {
      const r = await request(app).get('/v1/admin/jobs?keyword=Title%20job_c').set('Authorization', adminAuth);
      expect(r.status).toBe(200);
      expect(r.body.pagination.total).toBe(1);
      expect(r.body.data[0].id).toBe('job_c');
    });

    it('4. rejects invalid status with 400', async () => {
      const r = await request(app).get('/v1/admin/jobs?status=invalid').set('Authorization', adminAuth);
      expect(r.status).toBe(400);
    });
```

**Recommendations 测试（4 个 case）：**

```typescript
    // Seed 6 recommendations with varied statuses + dates
    beforeAll(() => {
      const now = Date.now();
      const recs = [
        ['rec_a', 'pending',       now - 86400000],
        ['rec_b', 'unlocked',      now - 2 * 86400000],
        ['rec_c', 'pending',       now - 3 * 86400000],
        ['rec_d', 'placed',        now - 4 * 86400000],
        ['rec_e', 'rejected_employer', now - 5 * 86400000],
        ['rec_f', 'pending',       now - 10 * 86400000],  // outside 7-day window
      ];
      for (const [id, status, ts] of recs) {
        db.prepare(`INSERT INTO recommendations
          (id, headhunter_id, employer_id, anonymized_candidate_id, job_id, status, created_at, updated_at)
          VALUES (?, 'u_2', 'u_1', 'c_1', 'job_a', ?, ?, ?)`).run(
          id, status, new Date(ts).toISOString(), new Date(ts).toISOString()
        );
      }
    });

    it('1. returns paginated envelope', async () => {
      const r = await request(app).get('/v1/admin/recommendations').set('Authorization', adminAuth);
      expect(r.status).toBe(200);
      expect(r.body.pagination.total).toBe(6);
      expect(r.body.data[0].id).toBe('rec_a');  // newest first
    });

    it('2. filters by status=pending', async () => {
      const r = await request(app).get('/v1/admin/recommendations?status=pending').set('Authorization', adminAuth);
      expect(r.status).toBe(200);
      expect(r.body.pagination.total).toBe(3);  // rec_a, c, f
      expect(r.body.data.every((rec: any) => rec.status === 'pending')).toBe(true);
    });

    it('3. filters by date range (last 7 days)', async () => {
      const fromDate = new Date(Date.now() - 7 * 86400000).toISOString();
      const r = await request(app).get(`/v1/admin/recommendations?from=${encodeURIComponent(fromDate)}`).set('Authorization', adminAuth);
      expect(r.status).toBe(200);
      expect(r.body.pagination.total).toBe(5);  // excludes rec_f
    });

    it('4. rejects invalid status with 400', async () => {
      const r = await request(app).get('/v1/admin/recommendations?status=garbage').set('Authorization', adminAuth);
      expect(r.status).toBe(400);
    });
```

**Dashboard 测试（2 个 case）：**

```typescript
    it('1. dashboard stats includes 7 new fields', async () => {
      const r = await request(app).get('/v1/admin/dashboard/stats').set('Authorization', adminAuth);
      expect(r.status).toBe(200);
      expect(r.body.data).toHaveProperty('total_recommendations');
      expect(r.body.data).toHaveProperty('today_new_recommendations');
      expect(r.body.data).toHaveProperty('recommendations_pending');
      expect(r.body.data).toHaveProperty('recommendations_unlocked');
      expect(r.body.data).toHaveProperty('jobs_paused');
      expect(r.body.data).toHaveProperty('jobs_closed');
      expect(r.body.data).toHaveProperty('jobs_filled');
      expect(typeof r.body.data.total_recommendations).toBe('number');
    });

    it('2. dashboard stats counts match seeded data', async () => {
      const r = await request(app).get('/v1/admin/dashboard/stats').set('Authorization', adminAuth);
      // Seeded: 8 jobs (1 paused + 1 closed + 1 filled) → jobs_paused=1, jobs_closed=1, jobs_filled=1
      expect(r.body.data.jobs_paused).toBe(1);
      expect(r.body.data.jobs_closed).toBe(1);
      expect(r.body.data.jobs_filled).toBe(1);
      // Seeded: 6 recommendations (3 pending + 1 unlocked + 1 placed + 1 rejected)
      expect(r.body.data.total_recommendations).toBe(6);
      expect(r.body.data.recommendations_pending).toBe(3);
      expect(r.body.data.recommendations_unlocked).toBe(1);
    });
```

### Step 5.2: 跑测试

Run: `cd D:/dev/hunter-platform && npx vitest run tests/integration/admin-list-pagination.test.ts 2>&1 | tail -15`
Expected: 全绿（Sub-B 已有 ~14 + Sub-C Plan 1 加 10 = 24 个测试通过）。

如失败：检查 schema enum 是否匹配（如 'paused' vs 'paused' 大小写）、foreign key 约束（jobs 表要求 employer_id REFERENCES users(id)，如 seed 用 u_1/u_2/u_3 这种可能不存在）。

### Step 5.3: Commit

```bash
git -C D:/dev/hunter-platform add tests/integration/admin-list-pagination.test.ts
git -C D:/dev/hunter-platform commit -m "test(admin): integration tests for jobs list + recommendations list + dashboard 7 new fields"
```

---

## Task 6: Frontend — api wrappers (jobs + recommendations + dashboard)

**Files:**
- Create: `admin-web/src/api/jobs.ts`
- Create: `admin-web/src/api/recommendations.ts`
- Modify: `admin-web/src/api/dashboard.ts`

### Step 6.1: 创建 admin-web/src/api/jobs.ts

Create `admin-web/src/api/jobs.ts`:

```typescript
import { apiFetchRaw } from './raw';

export type JobStatus = 'open' | 'claimed' | 'paused' | 'closed' | 'filled';

export type JobRow = {
  id: string;
  employer_id: string;
  employer_name: string;
  title: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
};

type Paginated<T> = {
  data: T[];
  pagination: { total: number; page: number; pageSize: number; has_more: boolean };
};

export async function listJobs(opts: {
  page?: number;
  pageSize?: number;
  status?: JobStatus | '';
  keyword?: string;
} = {}): Promise<Paginated<JobRow>> {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts.status) params.set('status', opts.status);
  if (opts.keyword) params.set('keyword', opts.keyword);
  const query = params.toString() ? `?${params}` : '';
  const env = await apiFetchRaw<JobRow[]>('jobs' + query);
  if (!env.ok || !env.data || !env.pagination) {
    throw new Error(env.error?.message ?? 'Failed to fetch jobs');
  }
  return { data: env.data, pagination: env.pagination };
}
```

### Step 6.2: 创建 admin-web/src/api/recommendations.ts

Create `admin-web/src/api/recommendations.ts`:

```typescript
import { apiFetchRaw } from './raw';

export type RecommendationStatus =
  | 'pending' | 'employer_interested' | 'candidate_approved' | 'unlocked'
  | 'rejected_employer' | 'rejected_candidate' | 'withdrawn' | 'placed';

export type RecommendationRow = {
  id: string;
  job_id: string;
  job_title: string;
  anonymized_candidate_id: string;
  headhunter_id: string;
  headhunter_name: string;
  status: RecommendationStatus;
  created_at: string;
  updated_at: string;
};

type Paginated<T> = {
  data: T[];
  pagination: { total: number; page: number; pageSize: number; has_more: boolean };
};

export async function listRecommendations(opts: {
  page?: number;
  pageSize?: number;
  status?: RecommendationStatus | '';
  keyword?: string;
  from?: string;
  until?: string;
} = {}): Promise<Paginated<RecommendationRow>> {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts.status) params.set('status', opts.status);
  if (opts.keyword) params.set('keyword', opts.keyword);
  if (opts.from) params.set('from', opts.from);
  if (opts.until) params.set('until', opts.until);
  const query = params.toString() ? `?${params}` : '';
  const env = await apiFetchRaw<RecommendationRow[]>('recommendations' + query);
  if (!env.ok || !env.data || !env.pagination) {
    throw new Error(env.error?.message ?? 'Failed to fetch recommendations');
  }
  return { data: env.data, pagination: env.pagination };
}
```

### Step 6.3: 改 api/dashboard.ts DashboardStats 类型

打开 `admin-web/src/api/dashboard.ts`，替换 `DashboardStats` 类型：

```typescript
export type DashboardStats = {
  total_users: number;
  total_candidates: number;
  total_jobs: number;
  open_jobs: number;
  active_placements: number;
  daily_quota_used: number;
  webhook_dead_letters: number;
  today_new_users: number;
  trend_30d: number[];
  // Sub-C additions
  total_recommendations: number;
  today_new_recommendations: number;
  recommendations_pending: number;
  recommendations_unlocked: number;
  jobs_paused: number;
  jobs_closed: number;
  jobs_filled: number;
};
```

### Step 6.4: Typecheck admin-web

Run: `cd D:/dev/hunter-platform/admin-web && npx tsc --noEmit 2>&1 | tail -10`
Expected: no errors.

### Step 6.5: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/api/jobs.ts admin-web/src/api/recommendations.ts admin-web/src/api/dashboard.ts
git -C D:/dev/hunter-platform commit -m "feat(admin-web): api wrappers — listJobs + listRecommendations + dashboard +7 fields"
```

---

## Task 7: Frontend — api wrapper tests (jobs + recommendations)

**Files:**
- Create: `admin-web/tests/api/jobs.test.ts`
- Create: `admin-web/tests/api/recommendations.test.ts`

### Step 7.1: 仿照 admin-web/tests/api/users.test.ts 创建 jobs.test.ts

Create `admin-web/tests/api/jobs.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listJobs } from '../../src/api/jobs';

vi.mock('../../src/api/raw', () => ({
  apiFetchRaw: vi.fn(),
}));

import { apiFetchRaw } from '../../src/api/raw';

describe('listJobs (Sub-C)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. fetches /v1/admin/jobs with no params', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } });
    await listJobs();
    expect(apiFetchRaw).toHaveBeenCalledWith('jobs');
  });

  it('2. includes status + keyword + page params in query string', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } });
    await listJobs({ page: 2, pageSize: 50, status: 'open', keyword: 'engineer' });
    expect(apiFetchRaw).toHaveBeenCalledWith(expect.stringContaining('page=2'));
    expect(apiFetchRaw).toHaveBeenCalledWith(expect.stringContaining('pageSize=50'));
    expect(apiFetchRaw).toHaveBeenCalledWith(expect.stringContaining('status=open'));
    expect(apiFetchRaw).toHaveBeenCalledWith(expect.stringContaining('keyword=engineer'));
  });

  it('3. throws Error when response is not ok', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: false, error: { code: 'INVALID_PARAMS', message: 'bad status' } });
    await expect(listJobs()).rejects.toThrow('bad status');
  });
});
```

### Step 7.2: 创建 recommendations.test.ts

Create `admin-web/tests/api/recommendations.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listRecommendations } from '../../src/api/recommendations';

vi.mock('../../src/api/raw', () => ({
  apiFetchRaw: vi.fn(),
}));

import { apiFetchRaw } from '../../src/api/raw';

describe('listRecommendations (Sub-C)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. fetches /v1/admin/recommendations with no params', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } });
    await listRecommendations();
    expect(apiFetchRaw).toHaveBeenCalledWith('recommendations');
  });

  it('2. includes status + keyword + from + until + page params', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } });
    await listRecommendations({
      page: 1,
      status: 'pending',
      keyword: 'eng',
      from: '2026-06-01T00:00:00Z',
      until: '2026-06-30T23:59:59Z',
    });
    const call = (apiFetchRaw as any).mock.calls[0][0];
    expect(call).toContain('status=pending');
    expect(call).toContain('keyword=eng');
    expect(call).toContain('from=2026-06-01T00');
    expect(call).toContain('until=2026-06-30T23');
  });

  it('3. throws Error when response is not ok', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: false, error: { code: 'INVALID_PARAMS', message: 'bad from' } });
    await expect(listRecommendations()).rejects.toThrow('bad from');
  });
});
```

### Step 7.3: 跑测试

Run: `cd D:/dev/hunter-platform/admin-web && npm run test -- tests/api/jobs.test.ts tests/api/recommendations.test.ts 2>&1 | tail -15`
Expected: 6 通过。

### Step 7.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/tests/api/jobs.test.ts admin-web/tests/api/recommendations.test.ts
git -C D:/dev/hunter-platform commit -m "test(admin-web): api wrapper tests for listJobs + listRecommendations"
```

---

## Task 8: Frontend — DetailDrawer 组件

**Files:**
- Create: `admin-web/src/components/DetailDrawer.tsx`
- Create: `admin-web/tests/components/DetailDrawer.test.tsx`

### Step 8.1: 创建 DetailDrawer.tsx

Create `admin-web/src/components/DetailDrawer.tsx`:

```tsx
import { useEffect } from 'react';

type DetailDrawerProps = {
  open: boolean;
  title: string;
  data: unknown;
  onClose: () => void;
};

export default function DetailDrawer({ open, title, data, onClose }: DetailDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const body = data === null || data === undefined
    ? '暂无数据'
    : typeof data === 'string'
      ? data
      : JSON.stringify(data, null, 2);

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          zIndex: 100,
        }}
      />
      <aside
        role="dialog"
        aria-label={title}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 480, background: 'white', padding: 24,
          boxShadow: '-4px 0 16px rgba(0,0,0,0.1)',
          zIndex: 101, overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button onClick={onClose} aria-label="关闭" style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer' }}>×</button>
        </div>
        <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {body}
        </pre>
      </aside>
    </>
  );
}
```

### Step 8.2: 创建 DetailDrawer.test.tsx

Create `admin-web/tests/components/DetailDrawer.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DetailDrawer from '../../src/components/DetailDrawer';

describe('DetailDrawer (Sub-C)', () => {
  it('1. does not render when open=false', () => {
    render(<DetailDrawer open={false} title="X" data={{ a: 1 }} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('2. renders title and JSON-stringified data when open', () => {
    render(<DetailDrawer open={true} title="Job Detail" data={{ id: 'job_1', status: 'open' }} onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Job Detail');
    expect(screen.getByText(/"id": "job_1"/)).toBeTruthy();
    expect(screen.getByText(/"status": "open"/)).toBeTruthy();
  });

  it('3. ESC key calls onClose', () => {
    const onClose = vi.fn();
    render(<DetailDrawer open={true} title="X" data={null} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

### Step 8.3: 跑测试

Run: `cd D:/dev/hunter-platform/admin-web && npm run test -- tests/components/DetailDrawer.test.tsx 2>&1 | tail -10`
Expected: 3 通过。

### Step 8.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/components/DetailDrawer.tsx admin-web/tests/components/DetailDrawer.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): DetailDrawer — generic side drawer for JSON/object display"
```

---

## Task 9: Frontend — Skeleton 组件

**Files:**
- Create: `admin-web/src/components/Skeleton.tsx`
- Create: `admin-web/tests/components/Skeleton.test.tsx`

### Step 9.1: 创建 Skeleton.tsx

Create `admin-web/src/components/Skeleton.tsx`:

```tsx
type SkeletonVariant = 'card' | 'row' | 'block' | 'text';

type SkeletonProps = {
  variant: SkeletonVariant;
  count?: number;
  width?: number | string;
  height?: number | string;
};

const variants: Record<SkeletonVariant, { defaultWidth: number | string; defaultHeight: number | string }> = {
  card: { defaultWidth: '100%', defaultHeight: 80 },
  row:  { defaultWidth: '100%', defaultHeight: 24 },
  block: { defaultWidth: '100%', defaultHeight: 120 },
  text: { defaultWidth: '60%', defaultHeight: 16 },
};

export default function Skeleton({ variant, count = 1, width, height }: SkeletonProps) {
  const dims = variants[variant];
  const w = width ?? dims.defaultWidth;
  const h = height ?? dims.defaultHeight;
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          role="status"
          aria-label="加载中"
          style={{
            width: w, height: h, margin: '8px 0',
            background: '#e8e8e8', borderRadius: 4,
            animation: 'skeleton-pulse 1.5s ease-in-out infinite',
          }}
        />
      ))}
      <style>{`@keyframes skeleton-pulse { 0%,100% { opacity: 0.6 } 50% { opacity: 1 } }`}</style>
    </>
  );
}
```

### Step 9.2: 创建 Skeleton.test.tsx

Create `admin-web/tests/components/Skeleton.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Skeleton from '../../src/components/Skeleton';

describe('Skeleton (Sub-C)', () => {
  it('1. renders count elements with role=status', () => {
    render(<Skeleton variant="row" count={3} />);
    expect(screen.getAllByRole('status')).toHaveLength(3);
  });

  it('2. respects explicit width and height', () => {
    const { container } = render(<Skeleton variant="block" width={300} height={150} count={1} />);
    const div = container.querySelector('[role="status"]') as HTMLElement;
    expect(div.style.width).toBe('300px');
    expect(div.style.height).toBe('150px');
  });
});
```

### Step 9.3: 跑测试

Run: `cd D:/dev/hunter-platform/admin-web && npm run test -- tests/components/Skeleton.test.tsx 2>&1 | tail -10`
Expected: 2 通过。

### Step 9.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/components/Skeleton.tsx admin-web/tests/components/Skeleton.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): Skeleton — 4-variant loading placeholder (card/row/block/text)"
```

---

## Task 10: Frontend — CsvButton 组件

**Files:**
- Create: `admin-web/src/components/CsvButton.tsx`
- Create: `admin-web/tests/components/CsvButton.test.tsx`

### Step 10.1: 创建 CsvButton.tsx

Create `admin-web/src/components/CsvButton.tsx`:

```tsx
type CsvButtonProps = {
  filename: string;
  rows: Record<string, unknown>[];
  columns: { key: string; header: string }[];
};

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  // Quote fields that contain comma, double quote, or newline
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export default function CsvButton({ filename, rows, columns }: CsvButtonProps) {
  const handleClick = () => {
    const headerRow = columns.map(c => escapeCsvField(c.header)).join(',');
    const dataRows = rows.map(row =>
      columns.map(c => escapeCsvField(row[c.key])).join(',')
    );
    const csv = [headerRow, ...dataRows].join('\n');

    // BOM for Excel UTF-8 compatibility
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <button onClick={handleClick} className="btn" disabled={rows.length === 0}>
      📥 导出 CSV
    </button>
  );
}
```

### Step 10.2: 创建 CsvButton.test.tsx

Create `admin-web/tests/components/CsvButton.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CsvButton from '../../src/components/CsvButton';

// jsdom doesn't implement URL.createObjectURL or HTMLAnchorElement.click by default
beforeEach(() => {
  global.URL.createObjectURL = vi.fn(() => 'blob:mock');
  global.URL.revokeObjectURL = vi.fn();
});

describe('CsvButton (Sub-C)', () => {
  it('1. renders button with label', () => {
    render(<CsvButton filename="jobs" rows={[]} columns={[]} />);
    expect(screen.getByText(/导出 CSV/)).toBeTruthy();
  });

  it('2. disabled when rows is empty', () => {
    render(<CsvButton filename="x" rows={[]} columns={[]} />);
    expect(screen.getByText(/导出 CSV/)).toBeDisabled();
  });

  it('3. click triggers Blob download with correct content', () => {
    const clickSpy = vi.fn();
    const origCreate = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') el.click = clickSpy;
      return el;
    });

    const rows = [
      { id: 'job_1', title: 'Engineer, Senior' },  // comma triggers quoting
      { id: 'job_2', title: 'PM "Lead"' },          // quote triggers escape
    ];
    const columns = [{ key: 'id', header: 'ID' }, { key: 'title', header: 'Title' }];
    render(<CsvButton filename="jobs" rows={rows} columns={columns} />);

    const blobSpy = vi.spyOn(global, 'Blob');
    fireEvent.click(screen.getByText(/导出 CSV/));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(blobSpy).toHaveBeenCalled();
    const blobArgs = blobSpy.mock.calls[0];
    expect(String(blobArgs[0])).toContain('"ID","Title"');
    expect(String(blobArgs[0])).toContain('"job_1","Engineer, Senior"');
    expect(String(blobArgs[0])).toContain('"job_2","PM ""Lead"""');

    blobSpy.mockRestore();
    createElementSpy.mockRestore();
  });
});
```

### Step 10.3: 跑测试

Run: `cd D:/dev/hunter-platform/admin-web && npm run test -- tests/components/CsvButton.test.tsx 2>&1 | tail -10`
Expected: 3 通过。

### Step 10.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/components/CsvButton.tsx admin-web/tests/components/CsvButton.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): CsvButton — client-side CSV export with proper escaping"
```

---

## Task 11: Frontend — JobsPage

**Files:**
- Create: `admin-web/src/pages/JobsPage.tsx`
- Create: `admin-web/tests/pages/JobsPage.test.tsx`

### Step 11.1: 创建 JobsPage.tsx

Create `admin-web/src/pages/JobsPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import Table, { type Column } from '../components/Table';
import Pagination from '../components/Pagination';
import SearchBar, { type Filter } from '../components/SearchBar';
import StatusBadge from '../components/StatusBadge';
import DetailDrawer from '../components/DetailDrawer';
import CsvButton from '../components/CsvButton';
import Skeleton from '../components/Skeleton';
import { relativeTime } from '../lib/format';
import { listJobs, type JobRow, type JobStatus } from '../api/jobs';

const statusFilters: Filter[] = [
  { label: '状态', value: 'status', options: [
    { label: '开放', value: 'open' },
    { label: '已认领', value: 'claimed' },
    { label: '暂停', value: 'paused' },
    { label: '已关闭', value: 'closed' },
    { label: '已招到', value: 'filled' },
  ] },
];

export default function JobsPage() {
  const [rows, setRows] = useState<JobRow[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 20, has_more: false });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<JobStatus | ''>('');
  const [detail, setDetail] = useState<{ open: boolean; data: unknown; title: string }>({
    open: false, data: null, title: '',
  });

  const load = (p: number, kw: string, status: JobStatus | '') => {
    setLoading(true);
    listJobs({ page: p, pageSize: 20, keyword: kw || undefined, status: status || undefined })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(page, keyword, statusFilter); }, [page, keyword, statusFilter]);

  const columns: Column<JobRow>[] = [
    { key: 'id', header: 'ID', render: r => <code>{r.id}</code> },
    { key: 'employer', header: '雇主', render: r => r.employer_name },
    { key: 'title', header: '职位', render: r => r.title },
    { key: 'status', header: '状态', render: r => <StatusBadge status={r.status} /> },
    { key: 'created', header: '创建时间', render: r => relativeTime(r.created_at) },
    { key: 'actions', header: '操作', render: r => (
      <button onClick={() => setDetail({ open: true, data: r, title: `Job ${r.id}` })} className="btn btn-sm">
        详情
      </button>
    ) },
  ];

  return (
    <Layout adminName="Admin">
      <h1>职位</h1>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <SearchBar
          placeholder="搜索职位标题/雇主..."
          filters={statusFilters}
          onSearch={(kw, filters) => {
            setPage(1);
            setKeyword(kw);
            setStatusFilter((filters.status as JobStatus) || '');
          }}
        />
        <CsvButton
          filename={`jobs-${new Date().toISOString().slice(0, 10)}`}
          rows={rows}
          columns={[
            { key: 'id', header: 'ID' },
            { key: 'employer_name', header: '雇主' },
            { key: 'title', header: '职位' },
            { key: 'status', header: '状态' },
            { key: 'created_at', header: '创建时间' },
          ]}
        />
      </div>
      {loading ? (
        <Skeleton variant="row" count={5} />
      ) : (
        <Table<JobRow> columns={columns} rows={rows} loading={false} empty="未找到职位" />
      )}
      <Pagination
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={pagination.total}
        onPageChange={setPage}
      />
      <DetailDrawer
        open={detail.open}
        title={detail.title}
        data={detail.data}
        onClose={() => setDetail({ open: false, data: null, title: '' })}
      />
    </Layout>
  );
}
```

### Step 11.2: 创建 JobsPage.test.tsx

Create `admin-web/tests/pages/JobsPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import JobsPage from '../../src/pages/JobsPage';

vi.mock('../../src/api/jobs', () => ({
  listJobs: vi.fn(),
}));

import { listJobs } from '../../src/api/jobs';

const renderPage = () => render(<MemoryRouter><JobsPage /></MemoryRouter>);

describe('JobsPage (Sub-C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listJobs as any).mockResolvedValue({
      data: [
        { id: 'job_1', employer_id: 'u_1', employer_name: 'Acme', title: 'Engineer', status: 'open', created_at: '2026-06-24T00:00:00Z', updated_at: '2026-06-24T00:00:00Z' },
      ],
      pagination: { total: 1, page: 1, pageSize: 20, has_more: false },
    });
  });

  it('1. mount calls listJobs and renders rows', async () => {
    renderPage();
    await waitFor(() => expect(listJobs).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.getByText('Engineer')).toBeTruthy();
  });

  it('2. SearchBar search passes keyword + status to listJobs', async () => {
    renderPage();
    await waitFor(() => expect(listJobs).toHaveBeenCalledTimes(1));
    const input = screen.getByPlaceholderText(/搜索职位/);
    fireEvent.change(input, { target: { value: 'engineer' } });
    fireEvent.click(screen.getByText('搜索'));
    await waitFor(() => expect(listJobs).toHaveBeenCalledWith(expect.objectContaining({ keyword: 'engineer' })));
  });

  it('3. pagination click triggers new fetch', async () => {
    (listJobs as any).mockResolvedValueOnce({
      data: [{ id: 'job_1', employer_id: 'u_1', employer_name: 'A', title: 'T', status: 'open', created_at: '', updated_at: '' }],
      pagination: { total: 100, page: 1, pageSize: 20, has_more: true },
    });
    renderPage();
    await waitFor(() => screen.getByText('下一页'));
    fireEvent.click(screen.getByText('下一页'));
    await waitFor(() => expect(listJobs).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
  });

  it('4. clicking 详情 opens DetailDrawer', async () => {
    renderPage();
    await waitFor(() => screen.getByText('详情'));
    fireEvent.click(screen.getByText('详情'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  });

  it('5. CSV button renders', async () => {
    renderPage();
    await waitFor(() => screen.getByText(/导出 CSV/));
  });

  it('6. empty state shown when no data', async () => {
    (listJobs as any).mockResolvedValue({ data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } });
    renderPage();
    await waitFor(() => expect(screen.getByText('未找到职位')).toBeTruthy());
  });
});
```

### Step 11.3: 跑测试

Run: `cd D:/dev/hunter-platform/admin-web && npm run test -- tests/pages/JobsPage.test.tsx 2>&1 | tail -10`
Expected: 6 通过。

### Step 11.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/JobsPage.tsx admin-web/tests/pages/JobsPage.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): JobsPage — list, filter, search, detail drawer, CSV export"
```

---

## Task 12: Frontend — RecommendationsPage

**Files:**
- Create: `admin-web/src/pages/RecommendationsPage.tsx`
- Create: `admin-web/tests/pages/RecommendationsPage.test.tsx`

### Step 12.1: 创建 RecommendationsPage.tsx

Create `admin-web/src/pages/RecommendationsPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import Table, { type Column } from '../components/Table';
import Pagination from '../components/Pagination';
import SearchBar, { type Filter } from '../components/SearchBar';
import StatusBadge from '../components/StatusBadge';
import DetailDrawer from '../components/DetailDrawer';
import CsvButton from '../components/CsvButton';
import Skeleton from '../components/Skeleton';
import { relativeTime } from '../lib/format';
import { listRecommendations, type RecommendationRow, type RecommendationStatus } from '../api/recommendations';

const statusFilters: Filter[] = [
  { label: '状态', value: 'status', options: [
    { label: '待处理', value: 'pending' },
    { label: '雇主感兴趣', value: 'employer_interested' },
    { label: '候选人同意', value: 'candidate_approved' },
    { label: '已解锁', value: 'unlocked' },
    { label: '雇主拒绝', value: 'rejected_employer' },
    { label: '候选人拒绝', value: 'rejected_candidate' },
    { label: '已撤回', value: 'withdrawn' },
    { label: '已入职', value: 'placed' },
  ] },
];

export default function RecommendationsPage() {
  const [rows, setRows] = useState<RecommendationRow[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 20, has_more: false });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<RecommendationStatus | ''>('');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [detail, setDetail] = useState<{ open: boolean; data: unknown; title: string }>({
    open: false, data: null, title: '',
  });

  const load = (p: number, kw: string, status: RecommendationStatus | '', f: string, u: string) => {
    setLoading(true);
    listRecommendations({
      page: p, pageSize: 20,
      keyword: kw || undefined,
      status: status || undefined,
      from: f || undefined,
      until: u || undefined,
    })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(page, keyword, statusFilter, from, until); }, [page, keyword, statusFilter, from, until]);

  const columns: Column<RecommendationRow>[] = [
    { key: 'id', header: 'ID', render: r => <code>{r.id}</code> },
    { key: 'job', header: '职位', render: r => r.job_title },
    { key: 'candidate', header: '候选人 ID', render: r => <code>{r.anonymized_candidate_id}</code> },
    { key: 'headhunter', header: '猎头', render: r => r.headhunter_name },
    { key: 'status', header: '状态', render: r => <StatusBadge status={r.status} /> },
    { key: 'created', header: '创建时间', render: r => relativeTime(r.created_at) },
    { key: 'actions', header: '操作', render: r => (
      <button onClick={() => setDetail({ open: true, data: r, title: `Recommendation ${r.id}` })} className="btn btn-sm">
        详情
      </button>
    ) },
  ];

  return (
    <Layout adminName="Admin">
      <h1>推荐</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <SearchBar
            placeholder="搜索职位/猎头..."
            filters={statusFilters}
            onSearch={(kw, filters) => {
              setPage(1);
              setKeyword(kw);
              setStatusFilter((filters.status as RecommendationStatus) || '');
            }}
          />
          <CsvButton
            filename={`recommendations-${new Date().toISOString().slice(0, 10)}`}
            rows={rows}
            columns={[
              { key: 'id', header: 'ID' },
              { key: 'job_title', header: '职位' },
              { key: 'anonymized_candidate_id', header: '候选人ID' },
              { key: 'headhunter_name', header: '猎头' },
              { key: 'status', header: '状态' },
              { key: 'created_at', header: '创建时间' },
            ]}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label>从 <input type="date" value={from.slice(0, 10)} onChange={e => setFrom(e.target.value ? e.target.value + 'T00:00:00Z' : '')} style={{ padding: 4 }} /></label>
          <label>至 <input type="date" value={until.slice(0, 10)} onChange={e => setUntil(e.target.value ? e.target.value + 'T23:59:59Z' : '')} style={{ padding: 4 }} /></label>
          {(from || until) && (
            <button onClick={() => { setFrom(''); setUntil(''); }} className="btn btn-sm">清除</button>
          )}
        </div>
      </div>
      {loading ? (
        <Skeleton variant="row" count={5} />
      ) : (
        <Table<RecommendationRow> columns={columns} rows={rows} loading={false} empty="未找到推荐" />
      )}
      <Pagination
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={pagination.total}
        onPageChange={setPage}
      />
      <DetailDrawer
        open={detail.open}
        title={detail.title}
        data={detail.data}
        onClose={() => setDetail({ open: false, data: null, title: '' })}
      />
    </Layout>
  );
}
```

### Step 12.2: 创建 RecommendationsPage.test.tsx

Create `admin-web/tests/pages/RecommendationsPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RecommendationsPage from '../../src/pages/RecommendationsPage';

vi.mock('../../src/api/recommendations', () => ({
  listRecommendations: vi.fn(),
}));

import { listRecommendations } from '../../src/api/recommendations';

const renderPage = () => render(<MemoryRouter><RecommendationsPage /></MemoryRouter>);

describe('RecommendationsPage (Sub-C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listRecommendations as any).mockResolvedValue({
      data: [
        { id: 'rec_1', job_id: 'job_1', job_title: 'Eng', anonymized_candidate_id: 'c_1', headhunter_id: 'u_2', headhunter_name: 'Bob', status: 'pending', created_at: '2026-06-24T00:00:00Z', updated_at: '2026-06-24T00:00:00Z' },
      ],
      pagination: { total: 1, page: 1, pageSize: 20, has_more: false },
    });
  });

  it('1. mount calls listRecommendations and renders row', async () => {
    renderPage();
    await waitFor(() => expect(listRecommendations).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Eng')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
  });

  it('2. search passes keyword + status', async () => {
    renderPage();
    await waitFor(() => expect(listRecommendations).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByPlaceholderText(/搜索/), { target: { value: 'eng' } });
    fireEvent.click(screen.getByText('搜索'));
    await waitFor(() => expect(listRecommendations).toHaveBeenCalledWith(expect.objectContaining({ keyword: 'eng' })));
  });

  it('3. date from changes triggers refetch with from param', async () => {
    renderPage();
    await waitFor(() => expect(listRecommendations).toHaveBeenCalledTimes(1));
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-06-01' } });
    await waitFor(() => expect(listRecommendations).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-06-01T00:00:00Z' })));
  });

  it('4. 详情 opens DetailDrawer', async () => {
    renderPage();
    await waitFor(() => screen.getByText('详情'));
    fireEvent.click(screen.getByText('详情'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('5. CSV button visible', async () => {
    renderPage();
    await waitFor(() => screen.getByText(/导出 CSV/));
  });

  it('6. empty state shown', async () => {
    (listRecommendations as any).mockResolvedValue({ data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } });
    renderPage();
    await waitFor(() => expect(screen.getByText('未找到推荐')).toBeTruthy());
  });
});
```

### Step 12.3: 跑测试

Run: `cd D:/dev/hunter-platform/admin-web && npm run test -- tests/pages/RecommendationsPage.test.tsx 2>&1 | tail -10`
Expected: 6 通过。

### Step 12.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/RecommendationsPage.tsx admin-web/tests/pages/RecommendationsPage.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): RecommendationsPage — list, filter, date range, detail drawer, CSV export"
```

---

## Task 13: Frontend — DashboardPage update (4 jobs + 3 refs cards + 1 sparkline)

**Files:**
- Modify: `admin-web/src/pages/DashboardPage.tsx`
- Modify: `admin-web/tests/pages/DashboardPage.test.tsx`（如存在）或 `tests/components/UsersList.test.tsx`（实际 Sub-B 测试文件，按文件实际结构调整）

### Step 13.1: 检查现有 DashboardPage 测试位置

Run: `ls D:/dev/hunter-platform/admin-web/tests/pages/`
找到现有 DashboardPage 测试文件（如 `DashboardPage.test.tsx`），本 task 末尾会更新它。如无此文件，跳过 Step 13.5（写测试），但 Step 13.2-13.4 仍需做。

### Step 13.2: 改 DashboardPage.tsx

打开 `admin-web/src/pages/DashboardPage.tsx`，替换为：

```tsx
import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import MetricCard from '../components/MetricCard';
import Sparkline from '../components/Sparkline';
import { getDashboardStats, type DashboardStats } from '../api/dashboard';
import { apiFetch } from '../api/client';

type Me = { id: string; name: string; email: string; role: string; status: string; last_login_at: string | null; created_at: string };

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Me>('me').then(setMe).catch(() => {});
    getDashboardStats().then(setStats).catch(err => setError(err.message));
  }, []);

  if (error) return <Layout adminName="..."><div className="error">{error}</div></Layout>;
  if (!stats) return <Layout adminName="..."><p>加载中...</p></Layout>;

  return (
    <Layout adminName={me?.name ?? 'Admin'}>
      <h1>仪表盘</h1>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <MetricCard label="用户总数" value={stats.total_users} />
        <MetricCard label="候选人总数" value={stats.total_candidates} />
        <MetricCard label="今日新增用户" value={stats.today_new_users} hint="下方趋势图显示每日对比" />
        <MetricCard label="进行中的合作" value={stats.active_placements} />
      </div>

      <h2 style={{ marginTop: 32 }}>用户增长 — 最近 30 天</h2>
      <div className="card">
        <Sparkline data={stats.trend_30d} width={600} height={80} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#999', marginTop: 8 }}>
          <span>30 天前</span>
          <span>今天</span>
        </div>
      </div>

      <h2 style={{ marginTop: 32 }}>职位状态分布</h2>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <MetricCard label="开放" value={stats.open_jobs} />
        <MetricCard label="暂停" value={stats.jobs_paused} />
        <MetricCard label="已关闭" value={stats.jobs_closed} />
        <MetricCard label="已招到" value={stats.jobs_filled} />
      </div>

      <h2 style={{ marginTop: 32 }}>推荐数据</h2>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <MetricCard label="推荐总数" value={stats.total_recommendations} />
        <MetricCard label="今日新增推荐" value={stats.today_new_recommendations} />
        <MetricCard label="待处理 / 已解锁" value={`${stats.recommendations_pending} / ${stats.recommendations_unlocked}`} />
      </div>

      <h2 style={{ marginTop: 32 }}>更多统计</h2>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <MetricCard label="职位总数" value={stats.total_jobs} />
        <MetricCard label="今日已用配额" value={stats.daily_quota_used} />
        <MetricCard label="Webhook 死信" value={stats.webhook_dead_letters} />
      </div>
    </Layout>
  );
}
```

**注：** spec §4.3 提到"1 条推荐趋势 sparkline"（recommendations_trend_30d），但后端 dashboard handler **未返回**这个字段（只有 trend_30d 是用户增长）。本 plan **省略**这条 sparkline——避免为了 UI 而改 dashboard handler 加 SQL。如未来 ops 需要，再加。

### Step 13.3: 跑 typecheck

Run: `cd D:/dev/hunter-platform/admin-web && npx tsc --noEmit 2>&1 | tail -10`
Expected: no errors。如失败检查 `DashboardStats` 类型是否包含 `jobs_paused/closed/filled`（Task 6 已加）。

### Step 13.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/DashboardPage.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): DashboardPage — add jobs status + recommendations overview cards"
```

### Step 13.5: 跑现有 DashboardPage 测试（如有）

如 Step 13.1 找到 DashboardPage.test.tsx，先看现有断言是否还匹配。

Sub-B 的 DashboardPage.test.tsx 可能断言某些 MetricCard label 存在。Sub-C 新增卡片应不破坏，但需确认：

Run: `cd D:/dev/hunter-platform/admin-web && npm run test -- tests/pages/DashboardPage 2>&1 | tail -10`
Expected: 全绿。如失败，按错误修。

如无 DashboardPage.test.tsx，跳过此 step。

---

## Task 14: Sub-B fix — SearchBar filter 透传（CandidatesPage + UsersPage）

**Files:**
- Modify: `admin-web/src/pages/CandidatesPage.tsx`
- Modify: `admin-web/src/pages/UsersPage.tsx`
- Modify: `admin-web/tests/pages/CandidatesList.test.tsx`
- Modify: `admin-web/tests/pages/UsersList.test.tsx`（或 `UsersPage.test.tsx`，按实际文件名）

### Step 14.1: 改 CandidatesPage.tsx

打开 `admin-web/src/pages/CandidatesPage.tsx`，找到：

```tsx
  const load = (p: number, keyword?: string) => {
    setLoading(true);
    listCandidates({ page: p, pageSize: 20, keyword })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(page); }, [page]);
```

替换为：

```tsx
  const [statusFilter, setStatusFilter] = useState<string>('');

  const load = (p: number, keyword?: string, unlock_status?: string) => {
    setLoading(true);
    listCandidates({
      page: p, pageSize: 20,
      keyword: keyword || undefined,
      unlock_status: unlock_status || undefined,
    })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(page, undefined, statusFilter); }, [page, statusFilter]);
```

并替换 SearchBar 的 onSearch：

```tsx
      <SearchBar
        placeholder="搜索姓名/邮箱..."
        filters={filters}
        onSearch={(kw, f) => { setPage(1); setStatusFilter(f.unlock_status || ''); load(1, kw, f.unlock_status); }}
      />
```

并在文件顶部加 import（如果还没有）：

```tsx
import { useState } from 'react';
```

### Step 14.2: 改 UsersPage.tsx

打开 `admin-web/src/pages/UsersPage.tsx`，做类似改动：

```tsx
  const [userTypeFilter, setUserTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const load = (p: number, keyword?: string, user_type?: string, status?: string) => {
    setLoading(true);
    listUsers({
      page: p, pageSize: 20,
      keyword: keyword || undefined,
      user_type: user_type || undefined,
      status: status || undefined,
    })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(page, undefined, userTypeFilter, statusFilter); }, [page, userTypeFilter, statusFilter]);
```

替换 SearchBar：

```tsx
      <SearchBar
        placeholder="搜索姓名..."
        filters={filters}
        onSearch={(kw, f) => {
          setPage(1);
          setUserTypeFilter(f.user_type || '');
          setStatusFilter(f.status || '');
          load(1, kw, f.user_type, f.status);
        }}
      />
```

并加 `import { useState } from 'react';`（如果还没）。

### Step 14.3: 更新 CandidatesList.test.tsx

打开 `admin-web/tests/pages/CandidatesList.test.tsx`（如存在），找到断言 `listCandidates` 调用的测试。

如 Sub-B 已有测试断言 `listCandidates` 只接收 `{ page, pageSize, keyword }`，需要更新断言——加 `unlock_status` 参数。

具体修改（按文件实际内容调整）：

```tsx
// 修改前可能：
expect(listCandidates).toHaveBeenCalledWith({ page: 1, pageSize: 20, keyword: undefined });

// 修改后：
expect(listCandidates).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }));
```

并加一个新测试 case：

```tsx
  it('7. unlock_status filter passed to listCandidates', async () => {
    renderPage();
    await waitFor(() => screen.getByText('搜索'));
    fireEvent.change(screen.getByDisplayValue(/待处理|已解锁|已锁定/), { target: { value: 'unlocked' } });
    fireEvent.click(screen.getByText('搜索'));
    await waitFor(() => expect(listCandidates).toHaveBeenCalledWith(expect.objectContaining({ unlock_status: 'unlocked' })));
  });
```

### Step 14.4: 更新 UsersList.test.tsx

类似 Step 14.3。在 `admin-web/tests/pages/UsersList.test.tsx`（或 `UsersPage.test.tsx`）加新测试：

```tsx
  it('8. user_type filter passed to listUsers', async () => {
    renderPage();
    await waitFor(() => screen.getByText('搜索'));
    fireEvent.change(screen.getByDisplayValue(/候选|猎头|雇主/), { target: { value: 'headhunter' } });
    fireEvent.click(screen.getByText('搜索'));
    await waitFor(() => expect(listUsers).toHaveBeenCalledWith(expect.objectContaining({ user_type: 'headhunter' })));
  });
```

### Step 14.5: 跑 Sub-B 已有测试 + 新增测试

Run: `cd D:/dev/hunter-platform/admin-web && npm run test -- tests/pages/ 2>&1 | tail -15`
Expected: 全绿（包括 Sub-B 已有 + Sub-C 新增 2 个 case）。

如失败：检查 onSearch 的 `(kw, f)` 解构是否拿到 filterValues（SearchBar 实际签名是 `(keyword, filterValues)`）。

### Step 14.6: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/CandidatesPage.tsx admin-web/src/pages/UsersPage.tsx admin-web/tests/pages/CandidatesList.test.tsx admin-web/tests/pages/UsersList.test.tsx
git -C D:/dev/hunter-platform commit -m "fix(admin-web): Sub-B SearchBar — pass filterValues through onSearch (was silently dropped)"
```

---

## Task 15: Frontend — Layout + App.tsx (加 Jobs + Refs 导航)

**Files:**
- Modify: `admin-web/src/components/Layout.tsx`
- Modify: `admin-web/src/App.tsx`

### Step 15.1: 改 Layout.tsx

打开 `admin-web/src/components/Layout.tsx`，在 nav 内追加 2 个 NavLink：

找到现有：

```tsx
        <nav className="sidebar__nav">
          <NavLink to="/" end style={linkStyle}>仪表盘</NavLink>
          <NavLink to="/users" style={linkStyle}>用户</NavLink>
          <NavLink to="/candidates" style={linkStyle}>候选人</NavLink>
          <NavLink to="/audit" style={linkStyle}>审计</NavLink>
          <NavLink to="/profile" style={linkStyle}>我的</NavLink>
        </nav>
```

替换为：

```tsx
        <nav className="sidebar__nav">
          <NavLink to="/" end style={linkStyle}>仪表盘</NavLink>
          <NavLink to="/users" style={linkStyle}>用户</NavLink>
          <NavLink to="/candidates" style={linkStyle}>候选人</NavLink>
          <NavLink to="/jobs" style={linkStyle}>职位</NavLink>
          <NavLink to="/recommendations" style={linkStyle}>推荐</NavLink>
          <NavLink to="/audit" style={linkStyle}>审计</NavLink>
          <NavLink to="/profile" style={linkStyle}>我的</NavLink>
        </nav>
```

### Step 15.2: 改 App.tsx

打开 `admin-web/src/App.tsx`，加 2 个 import + 2 个 Route：

```tsx
import JobsPage from './pages/JobsPage';
import RecommendationsPage from './pages/RecommendationsPage';
```

```tsx
        <Route path="/jobs" element={<PrivateRoute><JobsPage /></PrivateRoute>} />
        <Route path="/recommendations" element={<PrivateRoute><RecommendationsPage /></PrivateRoute>} />
```

### Step 15.3: Typecheck

Run: `cd D:/dev/hunter-platform/admin-web && npx tsc --noEmit 2>&1 | tail -10`
Expected: no errors。

### Step 15.4: 跑 admin-web 全部测试

Run: `cd D:/dev/hunter-platform/admin-web && npm run test 2>&1 | tail -10`
Expected: 全绿（Sub-C Plan 1 新增 ~28 个 + Sub-B 已有 ~10 + Sub-D1 已有 ~5）。

### Step 15.5: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/components/Layout.tsx admin-web/src/App.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): Layout + App routes — add Jobs + Recommendations navigation"
```

---

## Task 16: 全量验证 + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`（如存在）

### Step 16.1: 跑全部后端测试

Run: `cd D:/dev/hunter-platform && npx vitest run 2>&1 | tail -10`
Expected: 全绿。Sub-C Plan 1 后端新增 10 个测试（Task 5 内）。

### Step 16.2: 跑全部前端测试

Run: `cd D:/dev/hunter-platform/admin-web && npm run test 2>&1 | tail -10`
Expected: 全绿。Sub-C Plan 1 前端新增 ~28 个测试。

### Step 16.3: 跑全 typecheck

Run: `cd D:/dev/hunter-platform && npx tsc --noEmit 2>&1 | tail -5 && cd admin-web && npx tsc --noEmit 2>&1 | tail -5`
Expected: 无错误。

### Step 16.4: 加 CHANGELOG 条目

打开 `CHANGELOG.md`，在最新版本（如 v2.0.0）下方加：

```markdown
## v2.1.0 (Sub-C Plan 1 — Read-Only Data) — 2026-06-25

### 新增功能
- **Jobs 列表页**：admin-web `/jobs`，含 status 筛选 + 关键词搜索 + 分页 + 详情侧滑 + CSV 导出
- **Recommendations 列表页**：`/recommendations`，含 8 种 status 筛选 + 关键词 + 时间范围 + 详情 + 导出
- **Dashboard 增量**：4 张职位状态卡片（开放/暂停/已关闭/已招到）+ 3 张推荐卡片（总数/今日新增/待处理 vs 已解锁）
- **后端新 endpoint**：`GET /v1/admin/jobs` + `GET /v1/admin/recommendations`
- **Dashboard stats +7 字段**：total_recommendations / today_new_recommendations / recommendations_pending / recommendations_unlocked / jobs_paused / jobs_closed / jobs_filled
- **新 capability**：`admin.list_jobs` + `admin.list_recommendations`

### Bug 修复
- **Sub-B SearchBar filter 透传**：CandidatesPage / UsersPage 的 status 筛选现在真正传到 API（之前被 silently 丢弃）

### 测试
- 后端 +10 个集成测试
- 前端 +28 个组件/页面测试

### 后续
- **Plan 2**（独立）：adjustQuota 审计修复 + QuotaModal + UsersPage 调配额按钮 + AuditPage 详情列
```

### Step 16.5: 提交

```bash
git -C D:/dev/hunter-platform add CHANGELOG.md
git -C D:/dev/hunter-platform commit -m "docs(changelog): v2.1.0 — Sub-C Plan 1 (Read-Only Data)"
```

### Step 16.6: 最终 sanity check

```bash
git -C D:/dev/hunter-platform log --oneline -20
```

确认本 plan 所有 16 个 task 都已 commit。

---

## Done criteria（Plan 1 完成）

- [ ] 后端：`GET /jobs` + `GET /recommendations` 可访问，返回 paginated envelope
- [ ] 后端：Dashboard stats 含 7 个新字段
- [ ] 后端：~10 个新集成测试通过
- [ ] 前端：`/jobs` + `/recommendations` 页面渲染、搜索、筛选、详情、导出都工作
- [ ] 前端：Dashboard 显示 4 jobs + 3 refs 卡片
- [ ] 前端：Sub-B CandidatesPage / UsersPage 筛选透传修复
- [ ] 前端：~28 个新测试通过 + 现有测试不退
- [ ] Capability：`admin.list_jobs` + `admin.list_recommendations` 注册到 skill.md
- [ ] CHANGELOG 条目加好
- [ ] 16 个 task 都 commit

**Plan 1 merge 后，Plan 2 可以开始：adjustQuota breaking fix + QuotaModal + UsersPage 调配额 + AuditPage 详情列。**