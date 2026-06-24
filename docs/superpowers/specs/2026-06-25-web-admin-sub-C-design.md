# Web Admin Sub-C — Mutation + Jobs/Referrals 概览 Design

> **For agentic workers:** 这是 design spec，配套 implementation plan 在 `docs/superpowers/plans/2026-06-25-web-admin-sub-C-plan.md`（待 writing-plans skill 输出）。
>
> 续接 Sub-D1（v1.5+，merge `9e441b5`）。本 spec 是 **Sub-project C：mutation 入口 + Jobs/Referrals 数据概览**。Sub-D2 之后做 per-entity 时间轴，Sub-E 做配置类变更（webhook / rate-limit / placements 列表）。

## ⚠️ 与现有 spec 的关系

| Sub-project | 已交付 | 内容 |
|---|---|---|
| Sub-A | ✅ merged (`ad62db3`) | 基础设施：login / dashboard 占位 / profile |
| Sub-B | ✅ merged | Dashboard 升级 + Users 列表 + Candidates 列表（只读） |
| Sub-D1 | ✅ merged | Audit 总表 UI（admin actions / user actions / login events） |
| **Sub-C（本 spec）** | 设计中 | **手动调整配额 + Jobs/Referrals 列表 + Dashboard 概览增量** |

**Sub-C 范围由用户定义**：解决"admin-web 比较简陋"的体感差距，补 ops 日常 4 类诉求：

1. 用户列表 → 已有
2. 候选人/职位/推荐数据概览 → **新增**（Jobs/Refs 列表 + Dashboard 卡片）
3. 手动调整配额 → **新增**（修复现有 audit 缺口）
4. 审计日志 → 已有
5. 简单统计 → Dashboard 增量

---

## 1. 背景与动机

### 1.1 现状（Sub-D1 后）

| 项 | 现状 |
|----|------|
| 后端 admin 端点 | 26 个已存在 |
| `admin_action_log` 表 | 写入了 suspend/unsuspend/cancel_placement 等 admin 动作 |
| `POST /v1/admin/users/:id/adjust-quota` | **存在但不写 audit log**（bug：handler 不接 `adminUserId`、不接 `reason`、不调 `adminLog.insert`） |
| `GET /v1/admin/jobs` | ❌ **不存在**（只有 `/v1/market/jobs` 公开端点 + `/v1/employer/jobs` 雇主私有 + `/v1/headhunter/jobs` 猎头私有） |
| `GET /v1/admin/recommendations` | ❌ **不存在**（只有 `/v1/headhunter/recommendations` 猎头私有） |
| Dashboard stats 字段 | 9 个：total_users/total_candidates/total_jobs/open_jobs/active_placements/daily_quota_used/webhook_dead_letters/today_new_users/trend_30d。**无 recommendations 任何字段、无 jobs_paused/closed/filled、无 today_new_recommendations** |
| admin-web 页面 | 6 个：Login / Dashboard / Users / Candidates / Audit / Profile |
| UsersPage 「调配额」按钮 | ❌ 无（只显示 `quota_used/quota_per_day`，不可改） |

### 1.2 真实需求

| 需求 | 痛点 |
|---|---|
| **ops 调配额** | 客户加单 → admin 要能给该 user 临时提到 quota_per_day=50，目前只能改 DB，运维成本高 |
| **审计完整性** | "谁动了谁的配额？为什么？" 现在查不到（audit log 缺失），违反 ops 责任可追溯 |
| **Jobs 概览** | admin 想看"今天新创建多少职位/哪些开放/哪些已招到"，Dashboard 没有，需列表页 |
| **Refs 概览** | admin 想看"猎头今天提交了多少推荐/哪些 pending/哪些 unlocked"，目前无任何 UI |
| **详情查看** | 列表点一行能看到完整 JSON（运维场景：客户问"我的配额被谁改了"，能跳详情核对 audit） |
| **数据导出** | 列表能导出 CSV 给运营做月度报告 |

### 1.3 非目标（明确不做）

- ❌ Sub-D2 的 per-entity 时间轴（点击 user/candidate/job 看到自己的时间线）
- ❌ Sub-D3 的 webhook 发送日志 UI
- ❌ Sub-E 的 webhooks/rate-limit/config UI（已有 endpoint，本轮不接 UI）
- ❌ Placements 列表/详情（已有 `/v1/admin/placements`，本轮不接 UI）
- ❌ 乐观更新（先 UI 后端，audit log 完整性优先）
- ❌ 批量调整配额（一次改多 user）
- ❌ 撤销配额变更
- ❌ 调整后给 user 推送通知
- ❌ WebSocket / SSE 实时刷新
- ❌ 暗色模式 / 移动端响应式
- ❌ i18n 接入（Sub-A 的 i18n spec 未触发，本次同样不动）
- ❌ 键盘快捷键 / 命令面板
- ❌ Storybook / 视觉回归测试

---

## 2. 架构总览

### 2.1 模块改动图

```
hunter-platform/
├── src/main/
│   ├── routes/admin.ts                          # 改: dashboard flatten + adjust-quota 透传 reason/adminUserId
│   │                                           # 增: GET /jobs, GET /recommendations
│   ├── schemas/admin.ts                         # 增: ListJobsResponseSchema + ListRecommendationsResponseSchema
│   │                                           #     + AdjustQuotaResponseSchema 扩字段
│   ├── modules/admin/handlers/
│   │   ├── users.ts                             # 改: adjustQuota 接 adminUserId + reason + 写 audit
│   │   ├── dashboard.ts                         # 不改（dashboard IPC shape 保留）; today_new_recommendations 在 routes inline 算
│   │   └── jobs.ts (NEW)                        # 新增 list()
│   │   └── recommendations.ts (NEW)             # 新增 list()
│   ├── db/repositories/
│   │   ├── jobs.ts (existing)                   # 复用: 不直接调; handler 内部 SQL
│   │   └── recommendations.ts (existing)        # 复用: 不直接调
│   └── capabilities/admin.ts                    # 增: admin.list_jobs + admin.list_recommendations
│
└── admin-web/src/
    ├── App.tsx                                  # 改: 加 /jobs + /recommendations 路由
    ├── pages/
    │   ├── DashboardPage.tsx                    # 改: +4 Jobs 卡片 +3 Refs 卡片 +1 sparkline（recommendations_trend_30d）
    │   ├── UsersPage.tsx                        # 改: 行末「调配额」按钮 + QuotaModal
    │   ├── AuditPage.tsx                        # 改: Admin Actions tab 加「详情」列 + AuditJsonDrawer 联动
    │   └── JobsPage.tsx (NEW)                   # 新增
    │   └── RecommendationsPage.tsx (NEW)        # 新增
    ├── components/
    │   ├── Layout.tsx                           # 改: nav 加「职位」「推荐」
    │   ├── Modal.tsx (NEW)                      # 通用 dialog
    │   ├── QuotaModal.tsx (NEW)                 # 调配额表单
    │   ├── DetailDrawer.tsx (NEW)               # 通用详情侧滑
    │   ├── Skeleton.tsx (NEW)                   # 加载占位
    │   ├── CsvButton.tsx (NEW)                  # CSV 导出
    │   └── Toast.tsx (NEW)                      # 全局 toast 通知
    ├── api/
    │   ├── users.ts                             # 改: 加 adjustQuota()
    │   ├── dashboard.ts                         # 改: DashboardStats 类型 +7 字段
    │   ├── jobs.ts (NEW)                        # listJobs()
    │   └── recommendations.ts (NEW)             # listRecommendations()
    ├── lib/
    │   └── toast.tsx (NEW)                      # Toast context + useToast() hook
    └── tests/                                   # 增 ~18 个测试文件（见 §6）
```

### 2.2 路由表（admin-web）

| Path | Page | 鉴权 | 状态 |
|------|------|------|------|
| `/admin/login` | LoginPage | 公开 | 已有 |
| `/admin/` | DashboardPage | bearer | **改** |
| `/admin/users` | UsersPage | bearer | **改** |
| `/admin/candidates` | CandidatesPage | bearer | 已有 |
| `/admin/audit` | AuditPage | bearer | **改** |
| `/admin/jobs` | JobsPage | bearer | **新增** |
| `/admin/recommendations` | RecommendationsPage | bearer | **新增** |
| `/admin/profile` | ProfilePage | bearer | 已有 |

未匹配 → redirect `/admin/`。

### 2.3 后端 endpoint 增改

| Method | Path | 改动 |
|--------|------|------|
| GET | `/v1/admin/dashboard/stats` | **改** 返回 16 字段（原 9 + 新 7：total_recommendations/today_new_recommendations/recommendations_pending/recommendations_unlocked/jobs_paused/jobs_closed/jobs_filled） |
| POST | `/v1/admin/users/:id/adjust-quota` | **bug 修复**：handler 接 `adminUserId + reason` + 写 `admin_action_log` |
| GET | `/v1/admin/jobs` | **新增**：分页 + status 筛选 + 关键词（title/employer_name）搜索 |
| GET | `/v1/admin/recommendations` | **新增**：分页 + status 筛选 + 时间范围 from/until + 关键词搜索 |

### 2.4 共享组件

| 组件 | 文件 | 说明 |
|------|------|------|
| `Layout` | `components/Layout.tsx` | **改**：nav 加 "职位" / "推荐" |
| `Table` | `components/Table.tsx` | 已有 |
| `SearchBar` | `components/SearchBar.tsx` | 已有；RecommendationsPage 复用，加 date range 子组件 |
| `Pagination` | `components/Pagination.tsx` | 已有 |
| `StatusBadge` | `components/StatusBadge.tsx` | 已有 |
| `MetricCard` | `components/MetricCard.tsx` | 已有 |
| `Sparkline` | `components/Sparkline.tsx` | 已有 |
| `Modal` | `components/Modal.tsx` | **新增** 通用 dialog |
| `QuotaModal` | `components/QuotaModal.tsx` | **新增** 调配额表单（基于 Modal） |
| `DetailDrawer` | `components/DetailDrawer.tsx` | **新增** 通用详情侧滑 |
| `Skeleton` | `components/Skeleton.tsx` | **新增** 4 变体加载占位 |
| `CsvButton` | `components/CsvButton.tsx` | **新增** CSV 导出 |
| `Toast` | `components/Toast.tsx` | **新增** + `lib/toast.tsx` provider/hook |

### 2.5 数据库改动

- ❌ **0 migration**
- ✅ 复用 `admin_action_log` 表（adjust-quota 写入）
- ✅ 复用 `users` / `jobs` / `recommendations` / `candidates_anonymized` 表

### 2.6 Tech Stack

**沿用 Sub-A/B/D1：** React 18, Vite, TypeScript, react-router-dom, vanilla CSS, vitest + jsdom + @testing-library/react（前端）；Express 4.21, better-sqlite3, zod, bcryptjs（后端）。

**无新依赖。**

---

## 3. 后端设计

### 3.1 修复 `adjustQuota` 审计缺口（src/main/modules/admin/handlers/users.ts）

**当前问题：**
```ts
// 现状（src/main/modules/admin/handlers/users.ts:92-99）
adjustQuota(user_id: string, new_quota: number): { user_id: string; new_quota: number } {
  if (new_quota < 0 || new_quota > 100000) throw Errors.invalidParams('quota must be 0-100000');
  const u = users.findById(user_id);
  if (!u) throw Errors.notFound('User not found');
  db.prepare('UPDATE users SET quota_per_day = ?, updated_at = ? WHERE id = ?')
    .run(new_quota, new Date().toISOString(), user_id);
  return { user_id, new_quota };
  // ← 缺：写 admin_action_log；缺：传 adminUserId；缺：reason 校验
}
```

**修复后：**
```ts
adjustQuota(
  adminUserId: string,
  user_id: string,
  new_quota: number,
  reason: string,
): { user_id: string; previous_quota: number; new_quota: number; reason: string } {
  if (!reason || reason.trim().length < 3) {
    throw Errors.invalidParams('reason is required (>= 3 chars)');
  }
  if (reason.length > 500) {
    throw Errors.invalidParams('reason must be <= 500 chars');
  }
  if (new_quota < 0 || new_quota > 100000) {
    throw Errors.invalidParams('quota must be 0-100000');
  }
  const u = users.findById(user_id);
  if (!u) throw Errors.notFound('User not found');
  const previousQuota = u.quota_per_day;
  if (previousQuota === new_quota) {
    // 旧值 == 新值：不写 audit，避免噪声；返回供前端 UX 提示
    return { user_id, previous_quota, new_quota, reason };
  }
  db.prepare('UPDATE users SET quota_per_day = ?, updated_at = ? WHERE id = ?')
    .run(new_quota, new Date().toISOString(), user_id);
  adminLog.insert({
    admin_user_id: adminUserId,
    action: 'adjust_user_quota',
    target_type: 'user',
    target_id: user_id,
    details_json: JSON.stringify({ previous_quota: previousQuota, new_quota, reason }),
  });
  return { user_id, previous_quota: new_quota, reason };
}
```

**路由（src/main/routes/admin.ts:126-132）同步修改：**
```ts
router.post('/users/:id/adjust-quota', (req, res, next) => {
  try {
    const adminUserId = (req as any).user?.id;
    if (!adminUserId) throw Errors.unauthorized();
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const new_quota = Number(req.body?.new_quota);
    if (!Number.isFinite(new_quota)) {
      throw Errors.invalidParams('new_quota must be a number');
    }
    respond(res, AdjustQuotaResponseSchema, {
      ok: true,
      data: users.adjustQuota(adminUserId, req.params.id, new_quota, reason),
    });
  } catch (e) { next(e); }
});
```

**Schema（src/main/schemas/admin.ts）— 扩字段：**
```ts
const AdjustQuotaResponseSchema = z.object({
  user_id: z.string(),
  previous_quota: z.number(),
  new_quota: z.number(),
  reason: z.string(),
});
```

**注意：** handler 入参从 2 个变 4 个（adminUserId, user_id, new_quota, reason），是破坏性变更。但 admin handler 是 internal，仅 admin-web 调用，本次同步更新前端即可，无向后兼容需求。

### 3.2 新增 `GET /v1/admin/jobs`（src/main/modules/admin/handlers/jobs.ts — 新文件）

```ts
import type { DB } from '../../../db/connection.js';
import { Errors } from '../../../errors.js';

export function createAdminJobsHandler(db: DB) {
  return {
    list(filter: {
      status?: 'open' | 'claimed' | 'paused' | 'closed' | 'filled';
      keyword?: string;
      limit?: number;
      offset?: number;
    }): { rows: Array<{
      id: string; employer_id: string; employer_name: string;
      title: string; status: 'open' | 'claimed' | 'paused' | 'closed' | 'filled';
      created_at: string; updated_at: string;
    }>; total: number } {
      const where: string[] = ['1=1'];
      const params: any[] = [];
      if (filter.status) { where.push('j.status = ?'); params.push(filter.status); }
      if (filter.keyword) {
        where.push('(j.title LIKE ? OR u.name LIKE ?)');
        params.push(`%${filter.keyword}%`, `%${filter.keyword}%`);
      }
      const total = (db.prepare(`
        SELECT COUNT(*) as cnt FROM jobs j
        LEFT JOIN users u ON u.id = j.employer_id
        WHERE ${where.join(' AND ')}`).get(...params) as { cnt: number }).cnt;
      const rows = db.prepare(`
        SELECT j.id, j.employer_id, u.name AS employer_name,
               j.title, j.status, j.created_at, j.updated_at
        FROM jobs j
        LEFT JOIN users u ON u.id = j.employer_id
        WHERE ${where.join(' AND ')}
        ORDER BY j.created_at DESC LIMIT ? OFFSET ?`)
        .all(...params, filter.limit ?? 20, filter.offset ?? 0);
      return { rows: rows as any, total };
    },
  };
}
```

**路由：**
```ts
router.get('/jobs', (req, res, next) => {
  try {
    const filter: Parameters<ReturnType<typeof createAdminJobsHandler>['list']>[0] = {};
    if (typeof req.query.status === 'string') {
      if (!['open', 'claimed', 'paused', 'closed', 'filled'].includes(req.query.status)) {
        throw Errors.invalidParams('status must be open/claimed/paused/closed/filled');
      }
      filter.status = req.query.status as any;
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
    respond(res, ListJobsEnvelopeSchema, {
      ok: true,
      data: rows,
      pagination: { total, page, pageSize, has_more: page * pageSize < total },
    }, { strict: true });
  } catch (e) { next(e); }
});
```

### 3.3 新增 `GET /v1/admin/recommendations`（src/main/modules/admin/handlers/recommendations.ts — 新文件）

```ts
export function createAdminRecommendationsHandler(db: DB) {
  return {
    list(filter: {
      status?: 'pending' | 'employer_interested' | 'candidate_approved' | 'unlocked'
            | 'rejected_employer' | 'rejected_candidate' | 'withdrawn' | 'placed';
      keyword?: string;
      from?: string;  // ISO timestamp
      until?: string; // ISO timestamp
      limit?: number;
      offset?: number;
    }): { rows: Array<{
      id: string; job_id: string; job_title: string;
      anonymized_candidate_id: string; headhunter_id: string; headhunter_name: string;
      status: 'pending' | 'employer_interested' | 'candidate_approved' | 'unlocked'
            | 'rejected_employer' | 'rejected_candidate' | 'withdrawn' | 'placed';
      created_at: string; updated_at: string;
    }>; total: number } {
      const where: string[] = ['1=1'];
      const params: any[] = [];
      if (filter.status) { where.push('r.status = ?'); params.push(filter.status); }
      if (filter.keyword) {
        where.push('(j.title LIKE ? OR u.name LIKE ?)');
        params.push(`%${filter.keyword}%`, `%${filter.keyword}%`);
      }
      if (filter.from) { where.push('r.created_at >= ?'); params.push(filter.from); }
      if (filter.until) { where.push('r.created_at < ?'); params.push(filter.until); }
      const total = (db.prepare(`
        SELECT COUNT(*) as cnt FROM recommendations r
        LEFT JOIN jobs j ON j.id = r.job_id
        LEFT JOIN users u ON u.id = r.headhunter_id
        WHERE ${where.join(' AND ')}`).get(...params) as { cnt: number }).cnt;
      const rows = db.prepare(`
        SELECT r.id, r.job_id, j.title AS job_title,
               r.anonymized_candidate_id, r.headhunter_id,
               u.name AS headhunter_name, r.status, r.created_at, r.updated_at
        FROM recommendations r
        LEFT JOIN jobs j ON j.id = r.job_id
        LEFT JOIN users u ON u.id = r.headhunter_id
        WHERE ${where.join(' AND ')}
        ORDER BY r.created_at DESC LIMIT ? OFFSET ?`)
        .all(...params, filter.limit ?? 20, filter.offset ?? 0);
      return { rows: rows as any, total };
    },
  };
}
```

**路由模式同 jobs：** status 校验、keyword/from/until 透传、page/pageSize 解析、envelope 响应。Status 白名单：`pending / employer_interested / candidate_approved / unlocked / rejected_employer / rejected_candidate / withdrawn / placed`。

### 3.4 Dashboard stats 扩字段（src/main/routes/admin.ts:62-87）

```ts
router.get('/dashboard/stats', (_req, res, next) => {
  try {
    const s = dashboard.getStats();
    // ... 原有 3 个 inline SELECT
    const candidateCount = ...;
    const activePlacementCount = ...;
    const dailyQuotaUsed = ...;
    // 新增 1 个 inline SELECT：今日新增推荐
    const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
    const todayNewRecs = (db.prepare(
      'SELECT COUNT(*) AS c FROM recommendations WHERE created_at >= ?'
    ).get(todayStart.toISOString()) as { c: number }).c;

    respond(res, DashboardStatsResponseSchema, {
      ok: true,
      data: {
        // 原 9 字段不变
        total_users: s.users.total,
        total_candidates: candidateCount,
        total_jobs: s.jobs.total,
        open_jobs: s.jobs.open,
        active_placements: activePlacementCount,
        daily_quota_used: dailyQuotaUsed,
        webhook_dead_letters: s.webhooks.dead_letter,
        today_new_users: todayNewUsers,
        trend_30d: trend_30d,
        // 新增 7 字段（jobs_paused/closed/filled 都已在 getStats() 返回，本次只是没 flatten 出去；
        //              recommendations_* 同理；today_new_recommendations 是新增 inline SQL）
        total_recommendations: s.recommendations.total,
        today_new_recommendations: todayNewRecs,
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

### 3.5 Schema 增项（src/main/schemas/admin.ts）

```ts
// jobs list
const JobRowSchema = z.object({
  id: z.string(),
  employer_id: z.string(),
  employer_name: z.string(),
  title: z.string(),
  status: z.enum(['open', 'claimed', 'paused', 'closed', 'filled']),
  created_at: z.string(),
  updated_at: z.string(),
});
const ListJobsResponseSchema = z.object({
  data: z.array(JobRowSchema),
  pagination: PaginationSchema,
});
const ListJobsEnvelopeSchema = EnvelopeSchema(ListJobsResponseSchema);

// recommendations list
const RecommendationRowSchema = z.object({
  id: z.string(),
  job_id: z.string(),
  job_title: z.string(),
  anonymized_candidate_id: z.string(),
  headhunter_id: z.string(),
  headhunter_name: z.string(),
  status: z.enum([
    'pending', 'employer_interested', 'candidate_approved', 'unlocked',
    'rejected_employer', 'rejected_candidate', 'withdrawn', 'placed',
  ]),
  created_at: z.string(),
  updated_at: z.string(),
});
const ListRecommendationsResponseSchema = z.object({
  data: z.array(RecommendationRowSchema),
  pagination: PaginationSchema,
});
const ListRecommendationsEnvelopeSchema = EnvelopeSchema(ListRecommendationsResponseSchema);

// DashboardStats 扩字段（zod 加 7 行）
const DashboardStatsResponseSchema = z.object({
  total_users: z.number(),
  total_candidates: z.number(),
  total_jobs: z.number(),
  open_jobs: z.number(),
  active_placements: z.number(),
  daily_quota_used: z.number(),
  webhook_dead_letters: z.number(),
  today_new_users: z.number(),
  trend_30d: z.array(z.number()),
  // 新增 7 字段
  total_recommendations: z.number(),
  today_new_recommendations: z.number(),
  recommendations_pending: z.number(),
  recommendations_unlocked: z.number(),
  jobs_paused: z.number(),
  jobs_closed: z.number(),
  jobs_filled: z.number(),
});
```

### 3.6 Capability 同步（src/main/capabilities/admin.ts）

新增 2 个：
- `admin.list_jobs` → `GET /v1/admin/jobs`（quota_cost: 0）
- `admin.list_recommendations` → `GET /v1/admin/recommendations`（quota_cost: 0）

同步到 `docs/superpowers/skill.md`（已有 capability 列表）。

### 3.7 错误处理约定

| 场景 | HTTP | code | 触发位置 |
|------|------|------|---------|
| reason 缺失 | 400 | INVALID_PARAMS | route handler |
| reason < 3 字符 | 400 | INVALID_PARAMS | route handler + handler 双校验 |
| reason > 500 字符 | 400 | INVALID_PARAMS | route handler + handler 双校验 |
| new_quota 非数字 | 400 | INVALID_PARAMS | route handler |
| new_quota 越界（< 0 或 > 100000） | 400 | INVALID_PARAMS | route handler + handler 双校验 |
| user 不存在 | 404 | NOT_FOUND | handler |
| 旧值 == 新值 | 200 | ok=true | handler（直接返回，不写 audit） |
| jobs/refs status 非法 | 400 | INVALID_PARAMS | route handler |
| jobs/refs pageSize 越界 | 400 | INVALID_PARAMS | route handler |
| from/until 非 ISO | 400 | INVALID_PARAMS | route handler（用 `Date.parse` 校验） |
| 无 Bearer token | 401 | UNAUTHORIZED | admin auth middleware |

### 3.8 不做

- ❌ 不写新 migration
- ❌ 不改 `adjustQuota` 入参名（仍用 `new_quota`，body 兼容旧字段名）
- ❌ 不改 dashboard IPC handler（保持 IPC nested shape，只动 routes/admin.ts 的 flatten 层）
- ❌ 不加 rate-limit 给 admin endpoint（admin 内部信任）

---

## 4. 前端设计

### 4.1 新增公共组件

#### `<Modal>`（admin-web/src/components/Modal.tsx）

```tsx
type ModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number; // 默认 480
};
```

实现要点：
- 用 `createPortal` 渲染到 `document.body`
- 遮罩：黑色半透明（`rgba(0,0,0,0.4)`），点击关闭
- ESC 键监听 → onClose
- 打开时 focus 到 Modal 内首个 focusable 元素
- Tab 键 focus trap（在 Modal 内循环）
- 打开时锁 body scroll（`document.body.style.overflow = 'hidden'`）
- 关闭时还原 focus 到打开它的按钮 + 解锁 body scroll
- 约 90 行

#### `<QuotaModal>`（components/QuotaModal.tsx）

```tsx
type QuotaModalProps = {
  open: boolean;
  user: { id: string; name: string; current_quota: number } | null;
  onClose: () => void;
  onSubmit: (params: { new_quota: number; reason: string }) => Promise<void>;
};
```

表单：
- `<input type="number" min={0} max={100000} required>` 默认填 current_quota
- `<textarea minLength={3} maxLength={500} required>` 必填 reason
- 底部：取消 + 确认调整 按钮
- 提交中：按钮 disabled，文案"调整中..."
- 错误信息内联显示（红字）
- 提交成功后 onSubmit 完成 → 父组件关闭 Modal + Toast

#### `<DetailDrawer>`（components/DetailDrawer.tsx）

```tsx
type DetailDrawerProps = {
  open: boolean;
  title: string;
  data: unknown;
  onClose: () => void;
};
```

- 复用 Sub-D1 AuditJsonDrawer 的"右侧滑入 + 半透明遮罩 + ESC 关闭"模式
- `data` 自动 JSON.stringify（2 空格缩进）后 `<pre>` 渲染
- `data === null` → 显示"暂无数据"

#### `<Skeleton>`（components/Skeleton.tsx）

```tsx
type SkeletonVariant = 'card' | 'row' | 'block' | 'text';
type SkeletonProps = { variant: SkeletonVariant; count?: number; width?: number | string; height?: number | string };
```

- CSS `@keyframes pulse`（透明度 0.6 → 1 → 0.6 循环 1.5s）
- 替换现有 Table 的"加载中..."纯文字

#### `<CsvButton>`（components/CsvButton.tsx）

```tsx
type CsvButtonProps = {
  filename: string;  // 不含扩展名
  rows: Record<string, unknown>[];
  columns: { key: string; header: string }[];
};
```

- 按 columns 顺序 + rows 数据拼 CSV 字符串
- 字段值自动转义：含 `,` / `"` / 换行 → 用 `"..."` 包裹，内部 `"` → `""`
- 用 Blob + `URL.createObjectURL` + `<a download>` 触发下载

#### `<Toast>` + `lib/toast.tsx`

```tsx
// lib/toast.tsx
type ToastItem = { id: string; type: 'success' | 'error' | 'info'; message: string; expiresAt: number };
const ToastContext = createContext<{
  toasts: ToastItem[];
  push: (item: Omit<ToastItem, 'id' | 'expiresAt'>) => void;
  dismiss: (id: string) => void;
}>(...);
export function ToastProvider({ children }: { children: React.ReactNode }) { ... }
export function useToast() { return useContext(ToastContext); }

// components/Toast.tsx
export default function Toast() {
  // 渲染右上角浮层列表；每条 3 秒后自动消失
}
```

- 在 `App.tsx` 顶层包 `<ToastProvider>` + `<Toast />`
- 任何页面用 `useToast().push({ type: 'success', message: '...' })` 触发

### 4.2 新增页面

#### `/jobs` JobsPage

```
顶部布局：
  ┌─ SearchBar ──────────────────────────────────────┐
  │ 关键词输入：[title/employer_name]           [搜索]  │
  │ Status 筛选：[全部 ▼] / open/claimed/paused/closed/filled │
  └─────────────────────────────────────────────────┘
右上角：[📥 导出 CSV]（CsvButton）

中部 Table：
  ┌──────────┬──────────┬───────────────┬────────┬──────────────┬────────┐
  │ ID       │ Employer │ Title         │ Status │ 创建时间      │ 操作   │
  ├──────────┼──────────┼───────────────┼────────┼──────────────┼────────┤
  │ job_xxx  │ 张三     │ Senior Eng    │ open   │ 2 小时前      │ [详情] │
  └──────────┴──────────┴───────────────┴────────┴──────────────┴────────┘
  点击「详情」→ DetailDrawer 打开，显示完整 JSON（包括 jobs 表所有字段）

底部：Pagination
```

#### `/recommendations` RecommendationsPage

```
顶部布局：
  ┌─ SearchBar ──────────────────────────────────────────────────┐
  │ 关键词：[job_title/headhunter_name]                  [搜索]    │
  │ Status：[全部 ▼] / pending / employer_interested /              │
  │             candidate_approved / unlocked /                    │
  │             rejected_employer / rejected_candidate /            │
  │             withdrawn / placed                                  │
  │ 时间范围：[from] 至 [until]（两个 date input + 「清除」）      │
  └────────────────────────────────────────────────────────────────┘
右上角：[📥 导出 CSV]

中部 Table：
  ┌──────────┬─────────────────┬──────────────┬────────────┬────────┬──────────┬────────┐
  │ ID       │ Job Title       │ Candidate ID │ Headhunter │ Status │ 创建时间  │ 操作   │
  └──────────┴─────────────────┴──────────────┴────────────┴────────┴──────────┴────────┘

底部：Pagination
```

**注意（Sub-B 已有 bug 顺手修）：** SearchBar 组件的 `onSearch` 签名是 `(keyword: string, filterValues: Record<string, string>) => void`，但 Sub-B 的 CandidatesPage / UsersPage 当前的实现 `onSearch={(kw) => ...}` 只用了第 1 个参数，filter 值被丢弃（**Sub-B 留下的 bug**：用户选了 status filter 但请求不带）。本轮 JobsPage / RecommendationsPage 会正确使用 `filterValues`。**顺带（独立小 task）**：把 CandidatesPage / UsersPage 的 `onSearch` 改为 `(kw, filters) => load(1, kw, filters)`，把 status / unlock_status filter 真正透传到 API。改动 ~10 行，可能需要更新 Sub-B 已有的页面测试（断言调用的参数）。

### 4.3 改：DashboardPage

```
原 8 卡片 + 1 sparkline（不动）

▼ 职位状态分布（4 卡片）
┌──────────┬──────────┬──────────┬──────────┐
│ 开放     │ 暂停     │ 已关闭   │ 已招到   │
│ open_jobs│ paused   │ closed   │ filled   │
└──────────┴──────────┴──────────┴──────────┘
（数据源：4 个状态计数已在 dashboard handler 的 `getStats()` 内 SQL 算出（`s.jobs.open/paused/closed/filled`），本次只需在 routes/admin.ts 的 dashboard flatten 处把它们暴露出去，**不需新增 SQL**。`claimed` 是过渡态，本次不单独展示卡片，只在 JobsPage 列表的 status 筛选中可选项）

▼ 推荐数据（3 卡片）
┌──────────────┬──────────────────┬──────────────────┐
│ 推荐总数     │ 今日新增推荐     │ 待处理 / 已解锁  │
│ total_recs   │ today_new_recs   │ pending/unlocked │
└──────────────┴──────────────────┴──────────────────┘

▼ 推荐趋势 — 最近 30 天（sparkline）
参照 trend_30d 模式，新增 recommendations_trend_30d（30 个数字）
```

注：Dashboard handler 的 `getStats()` **不**返回 `jobs.paused` 和 `jobs.closed`，需要扩展 dashboard handler（加 SQL）或在 routes/admin.ts 端 inline 加 2 个 SELECT。**选择后者**（routes inline），与现有 dashboard flatten 模式一致。

### 4.4 改：UsersPage

每行加「调配额」按钮（仅 `status === 'active'` 显示）：
```
按钮位置：行末「操作」列
按钮文案："调配额"
按钮样式：主色（蓝），小尺寸
点击 → QuotaModal 打开（传入 user 信息）
提交成功 → Toast "已调整 ${user.name} 配额至 ${new_quota}" + 关闭 Modal + load(currentPage)
提交失败 → Modal 内显示错误，输入保留
```

### 4.5 改：Layout 侧边栏

```tsx
<NavLink to="/" end style={linkStyle}>仪表盘</NavLink>
<NavLink to="/users" style={linkStyle}>用户</NavLink>
<NavLink to="/candidates" style={linkStyle}>候选人</NavLink>
<NavLink to="/jobs" style={linkStyle}>职位</NavLink>          {/* 新增 */}
<NavLink to="/recommendations" style={linkStyle}>推荐</NavLink>  {/* 新增 */}
<NavLink to="/audit" style={linkStyle}>审计</NavLink>
<NavLink to="/profile" style={linkStyle}>我的</NavLink>
```

### 4.6 改：AuditPage（Admin Actions tab）

原表格列：时间 / 操作人 / 操作 / 目标 / 原因
新增 2 列：
- 「对象」列：`target_type:target_id` 合并显示（已有数据，调整渲染）
- 「详情」列：`<button>` 点击 → AuditJsonDrawer 显示 `details_json`（含 previous_quota/new_quota/reason）

注：Sub-D1 已有 AuditJsonDrawer 组件，复用不新建。

### 4.7 API 模块

```ts
// api/users.ts — 加 adjustQuota
export async function adjustQuota(userId: string, new_quota: number, reason: string): Promise<AdjustQuotaResponse> {
  const env = await apiFetchRaw<AdjustQuotaResponse>(`users/${userId}/adjust-quota`, {
    method: 'POST',
    body: JSON.stringify({ new_quota, reason }),
  });
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to adjust quota');
  return env.data;
}

// api/jobs.ts — 新文件
export type JobRow = {
  id: string; employer_id: string; employer_name: string;
  title: string; status: 'open' | 'claimed' | 'paused' | 'closed' | 'filled';
  created_at: string; updated_at: string;
};
export async function listJobs(opts: {
  page?: number; pageSize?: number;
  status?: JobRow['status'] | '';
  keyword?: string;
} = {}): Promise<Paginated<JobRow>> { ... }

// api/recommendations.ts — 新文件
export type RecommendationRow = {
  id: string; job_id: string; job_title: string;
  anonymized_candidate_id: string; headhunter_id: string; headhunter_name: string;
  status: 'pending' | 'employer_interested' | 'candidate_approved' | 'unlocked'
        | 'rejected_employer' | 'rejected_candidate' | 'withdrawn' | 'placed';
  created_at: string; updated_at: string;
};
export async function listRecommendations(opts: {
  page?: number; pageSize?: number;
  status?: RecommendationRow['status'] | '';
  keyword?: string;
  from?: string; until?: string;
} = {}): Promise<Paginated<RecommendationRow>> { ... }

// api/dashboard.ts — DashboardStats 类型 +7 字段
export type DashboardStats = {
  // ... 原 9 字段
  total_recommendations: number;
  today_new_recommendations: number;
  recommendations_pending: number;
  recommendations_unlocked: number;
  jobs_paused: number;
  jobs_closed: number;
  jobs_filled: number;
};
```

### 4.8 状态管理

**沿用现有模式：** useState + useEffect + 手动 setState。**不引** zustand / redux / SWR / react-query。

URL 分页 / 筛选：JobsPage / RecommendationsPage 沿用 Sub-D1 AuditPage 模式（searchParams）。这样浏览器刷新保留状态、可分享链接。

### 4.9 错误处理约定

| 场景 | UI 表现 |
|------|---------|
| API 401 | 清 token + 跳 `/admin/login`（现有 client.ts 行为） |
| API 400 (INVALID_PARAMS) | Modal/Page 内显示后端 `error.message` |
| API 404 (NOT_FOUND) | Toast「用户不存在」+ 关闭 Modal + 刷新列表 |
| 网络断开 | Toast「网络错误，请检查连接」 |
| 5xx | Toast「服务异常，请稍后重试」 |
| 客户端校验失败 | 内联红字（不调 API） |

### 4.10 不做

- ❌ 键盘快捷键
- ❌ 主题切换 / 暗色模式
- ❌ 响应式（admin 假定 desktop ≥ 1280px）
- ❌ 实时刷新
- ❌ WebSocket / SSE

---

## 5. 数据流与审计链路

### 5.1 配额调整端到端

```
[1] UsersPage 行末「调配额」点击
    → setState({ quotaModal: { open: true, user } })
    → <QuotaModal> 渲染

[2] 用户填 new_quota + reason，点「确认调整」
    → 客户端校验（new_quota 范围 + reason ≥3 字符）
    → 失败：内联错误
    → 成功 → 调 props.onSubmit({ new_quota, reason })

[3] UsersPage.onSubmit 回调
    → adjustQuota(userId, new_quota, reason)（api/users.ts）
    → apiFetchRaw POST /v1/admin/users/:id/adjust-quota
    → Bearer api_key header 附加

[4] 后端 admin auth middleware
    → 验 token → req.user.id = 'adm_xxx'

[5] routes/admin.ts handler
    → 校验 reason 长度、new_quota finite
    → 失败 → 400 INVALID_PARAMS

[6] users.adjustQuota(adminUserId, user_id, new_quota, reason)
    → DB: findById → 拿 previous_quota
    → 旧值 == 新值 → return（不写 audit）
    → DB: UPDATE users SET quota_per_day = ?
    → DB: adminLog.insert({ admin_user_id, action, target_type, target_id, details_json })

[7] 响应回前端
    → 成功 → 关闭 Modal + Toast「已调整 ${name} 配额至 ${new_quota}」
            → load(currentPage) 重拉列表
    → 失败 → Modal 内显示 error.message，输入保留

[8] 用户事后访问 /admin/audit
    → Admin Actions tab 显示这条 adjust_user_quota 记录
    → 点击「详情」 → AuditJsonDrawer 弹出 JSON：
       { "previous_quota": 10, "new_quota": 50, "reason": "客户紧急加单" }
```

### 5.2 列表查询流（read-only）

```
User mounts JobsPage
  → useEffect → listJobs({ page: 1 })
  → GET /v1/admin/jobs?page=1&pageSize=20
  → 后端：jobs.list({ limit:20, offset:0 })
  → 2 SQL：1 SELECT COUNT + 1 SELECT data（LEFT JOIN users）
  → respond envelope { data, pagination }
前端 setState → Table 渲染

用户改 status 筛选或输入关键词
  → setState({ status / keyword }) → 重置 page=1 → 重新 listJobs
```

### 5.3 Dashboard 数据流

```
DashboardPage mount
  → 并发 2 个 API：
     1. apiFetch<Me>('me') → 头部 admin 名称
     2. getDashboardStats() → 所有卡片 + 2 条 sparkline（16 字段）
  → 单次 endpoint 返回，handler 内 11 个并行 SQL（4 inline + 7 in getStats）
  → setState → 渲染 8 + 4 + 3 = 15 卡片 + 2 sparkline
```

性能：单 endpoint ~10ms（11 个 SQL 都是 index lookup + COUNT）。

### 5.4 状态管理矩阵

| 状态 | 存储位置 | 持久化 |
|------|---------|--------|
| admin api_key | localStorage `admin_token` | 是 |
| me | useState（DashboardPage） | 否 |
| list 缓存（users/jobs/refs） | useState（各 Page） | 否 |
| URL 分页/筛选 | searchParams | 是 |
| Modal 开/关 | useState（Page 局部） | 否 |
| Toast 队列 | ToastContext（全局） | 否（3s 自动消失） |

---

## 6. 测试策略

### 6.1 覆盖目标

| 层 | 范围 | 数量 |
|----|------|------|
| 后端 handler | users.adjustQuota / jobs.list / recommendations.list / dashboard 扩字段 | 6 |
| 后端 route | POST adjust-quota / GET jobs / GET recommendations / GET dashboard | 4 |
| 后端 audit 验证 | adjust-quota 写入 admin_action_log 正确性 | 2 |
| 前端 api wrapper | adjustQuota / listJobs / listRecommendations / dashboard 类型 | 4 |
| 前端组件 | Modal / QuotaModal / DetailDrawer / Skeleton / CsvButton / Toast | 6 |
| 前端页面 | JobsPage / RecommendationsPage / DashboardPage / UsersPage（QuotaModal + filter 修复）/ AuditPage | 5 |
| Sub-B SearchBar 顺手修 | CandidatesPage / UsersPage filter 透传 + 测试更新 | 3 |
| **新增总计** | | **30** |

回归目标：现存 880+ + 新增 30 ≈ **910 测试** 全绿。

### 6.2 后端测试

**`users-adjust-quota.test.ts`（handler）**
```
✓ 成功调整 → 返回 previous_quota/new_quota/reason
✓ 写入 admin_action_log，含 adminUserId + previous/new/reason
✓ 旧值 == 新值 → 不写 audit
✓ reason 缺失 → throw invalidParams
✓ reason < 3 字符 → throw invalidParams
✓ new_quota 非数字 → throw invalidParams
✓ new_quota 越界 → throw invalidParams
✓ user 不存在 → throw notFound
```

**`jobs-list.test.ts`（handler）**
```
✓ 默认（无 filter）→ 按 created_at DESC
✓ status 筛选
✓ keyword 匹配 title
✓ keyword 匹配 employer_name
✓ 分页 limit/offset 正确
✓ total 计数正确
```

**`recommendations-list.test.ts`（handler）**
```
✓ 默认 → 按 created_at DESC
✓ status 筛选
✓ from/until 时间范围
✓ 关键词
✓ JOIN 拿到 job_title + headhunter_name
✓ 分页 + total
```

**`admin-routes-sub-c.test.ts`（route 集成）**
```
✓ POST /users/:id/adjust-quota 200（成功路径 + audit 写入）
✓ POST /users/:id/adjust-quota 400（缺 reason / new_quota 非数）
✓ POST /users/:id/adjust-quota 401（无 token）
✓ POST /users/:id/adjust-quota 404（用户不存在）
✓ GET /jobs 200（含分页参数）
✓ GET /jobs 400（非法 status）
✓ GET /jobs 401
✓ GET /recommendations 200（含 status + from + until + keyword）
✓ GET /recommendations 401
✓ GET /dashboard/stats 200（含 7 个新字段）
```

### 6.3 前端测试

**组件测试（admin-web/tests/components/）**

`Modal.test.tsx`：
```
✓ open=true 渲染遮罩 + 内容；open=false 不渲染
✓ ESC 键 → onClose
✓ 点击遮罩 → onClose；点击 Modal 内 → 不调用
✓ footer slot 渲染
✓ 打开时 focus 首个 focusable 元素
✓ 关闭时还原 focus
```

`QuotaModal.test.tsx`：
```
✓ 显示当前 quota
✓ 提交有效值 → onSubmit 调用 + 关闭（父组件负责）
✓ new_quota 缺 → 不调 onSubmit，显示错误
✓ reason < 3 → 不调 onSubmit，显示错误
✓ onSubmit 抛错 → Modal 内显示错误，输入保留
✓ 提交中按钮 disabled
```

`DetailDrawer.test.tsx` / `Skeleton.test.tsx` / `CsvButton.test.tsx` / `Toast.test.tsx`：参照已有 AuditJsonDrawer 测试模式（Sub-D1）。

**页面测试（admin-web/tests/pages/）**

`JobsPage.test.tsx`：
```
✓ mount → 调 listJobs，渲染表格
✓ 搜索输入 → 重调 listJobs(keyword)
✓ status 筛选变化 → 重调 listJobs(status)
✓ 分页点击 → 重调 listJobs(page)
✓ 「详情」按钮 → DetailDrawer 打开
✓ CsvButton → 触发下载
✓ 加载中 → Skeleton
✓ 空数据 → "未找到职位"
✓ API 错误 → 错误提示
```

`RecommendationsPage.test.tsx` / `DashboardPage.test.tsx`（更新）/ `UsersPage.test.tsx`（更新）/ `AuditPage.test.tsx`（更新）：参照已有 Sub-B/D1 测试模式。

**API wrapper 测试（admin-web/tests/api/）**

`users-adjust-quota.test.ts` / `jobs-list.test.ts` / `recommendations-list.test.ts`：参照已有 users.test.ts（Sub-B）。

### 6.4 测试基础设施

- 沿用 vitest + supertest（后端）+ vitest + jsdom + @testing-library/react（前端）
- 复用已有 helper：
  - `src/test/admin/helpers/setup-admin.ts`（Sub-D1 创建）
  - `admin-web/tests/helpers/render-with-router.tsx`（Sub-D1 创建）
- Mock 策略：API 用 `vi.mock('../api/raw')`，DB 用 `createTestDb()` in-memory sqlite

### 6.5 不做

- ❌ E2E（Playwright）— Sub-E 整体上 e2e 时再加
- ❌ 视觉回归（chromatic / Percy）— 内部工具，UI 变化频繁
- ❌ 性能测试（k6）— admin 流量低
- ❌ Mutation testing — 价值密度低
- ❌ Storybook

### 6.6 CI 集成

`.github/workflows/test.yml` 加一步：
```yaml
- name: Admin-Web tests
  run: cd admin-web && npm run test
```
（Sub-B/D1 已有，确认仍在）

---

## 7. 验收标准（Definition of Done）

Sub-C 完成时必须满足：

1. ✅ 后端 `npm run test` 全绿（含 12 个新后端测）
2. ✅ 前端 `cd admin-web && npm run test` 全绿（含 18 个新前端测，含 Sub-B SearchBar 修复）
3. ✅ `npm run typecheck` 全绿
4. ✅ 手测脚本（dev 模式）：登录 → 调配额 → 看到 audit → 看 Jobs/Refs → 看 Dashboard 新卡片
5. ✅ `nginx` 配置无变化（admin-web 仍 build 到 `out/admin/`）
6. ✅ `docs/superpowers/skill.md` 同步：加 `admin.list_jobs` + `admin.list_recommendations` capability
7. ✅ `CHANGELOG.md` 加 v2.1.0 条目
8. ✅ Spec 文档（本文）+ Plan 文档 同步 git

---

## 8. 风险与权衡

| 风险 | 缓解 |
|------|------|
| `adjustQuota` 入参变更（破坏性） | 同步更新前端；admin-web 唯一调用方，无向后兼容负担 |
| Dashboard 11 个 SQL 并行（性能） | 全部是 indexed COUNT / indexed SELECT，单次 ~10ms；流量低不优化 |
| `recommendations` 表可能很大（无 keyword 索引） | 本轮不加索引；如未来 ops 抱怨慢，Sub-D3 加 `CREATE INDEX idx_recs_created_at` |
| 前端无 i18n | 沿用现有中文硬编码；Sub-A i18n spec 未触发不接 |
| ToastProvider 全局状态 | Context 极轻量；不引 zustand 等 |
| Modal 焦点管理手写（不引 focus-trap-react） | 90 行内可控；后续如出现 3+ 处 Modal 再抽 |

---

## 9. 部署与回滚

### 部署顺序

1. 后端代码 + 测试 → `npm run test` → merge → 自动部署（沿用现有 CI）
2. 前端代码 + 测试 → `npm run test` → `npm run build` → build 产物推到 `out/admin/`
3. nginx reload

### 回滚

- 后端：revert commit，重新部署
- 前端：revert commit，重新 build
- 数据库：0 改动，无迁移回滚需求

---

## 10. 后续（明确不在 Sub-C 范围）

| Sub-project | 内容 | 预计时间 |
|---|---|---|
| Sub-D2 | Per-entity 时间轴（点 user/candidate/job 看到自己的 audit / action history / 配额变更流水） | v2.2 |
| Sub-D3 | Webhook 发送日志 UI + Placements 列表 UI | v2.3 |
| Sub-E | webhooks / rate-limit / config 写入类变更 UI | v2.4 |
| E2E | Playwright 整体冒烟 | v2.5 |
| Admin i18n | 接入 i18next + 英文翻译 | 后续 |

---

## 附录 A：UI mockups（ASCII）

### JobsPage
```
┌────────────────────────────────────────────────────────────────────────┐
│ 猎头管理后台                          Admin                            │
├──────────────┬─────────────────────────────────────────────────────────┤
│              │ 职位                                                    │
│ 仪表盘       │ ┌──────────────────────────────────────────────────────┐ │
│ 用户         │ │ [搜索 title/employer...] [全部 ▼] [搜索]    [📥 CSV] │ │
│ 候选人       │ └──────────────────────────────────────────────────────┘ │
│ 职位 ◀       │ ┌─────────┬─────────┬──────────┬────────┬────────┬────┐ │
│ 推荐         │ │ ID      │Employer │ Title    │ Status │ 创建   │操作│ │
│ 审计         │ ├─────────┼─────────┼──────────┼────────┼────────┼────┤ │
│ 我的         │ │ job_001 │ 张三    │ Sr Eng   │ open   │ 2h 前 │详情│ │
│              │ │ job_002 │ 李四    │ PM       │ closed │ 1d 前 │详情│ │
│              │ └─────────┴─────────┴──────────┴────────┴────────┴────┘ │
│              │              < 1 2 3 ... >                              │
│ 退出登录     │                                                         │
└──────────────┴─────────────────────────────────────────────────────────┘
```

### QuotaModal（在 UsersPage 行末点击触发）
```
┌─────────────────────────────────────────┐
│ 调配额 — 张三                       [×] │
├─────────────────────────────────────────┤
│ 当前配额：10 / 每天                     │
│                                         │
│ 新配额 *     [____50____] (0-100000)     │
│ 原因 *       [____________________]     │
│              [____________________]     │
│              [____________________]     │
│              (≥3 字符)                  │
│                                         │
├─────────────────────────────────────────┤
│              [取消]    [确认调整]       │
└─────────────────────────────────────────┘
```

---

**Spec 结束。** 配套 implementation plan 见 `docs/superpowers/plans/2026-06-25-web-admin-sub-C-plan.md`（待 writing-plans skill 输出）。