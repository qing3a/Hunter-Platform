# Web Admin Sub-D2 — Per-Entity Timeline Design

> **For agentic workers:** 这是 design spec，配套 implementation plan 在 `docs/superpowers/plans/2026-06-25-web-admin-sub-D2-plan.md`（待 writing-plans skill 输出）。
>
> 续接 Sub-C（v2.1，merge `6d042b7`）+ bf0c8f3 (details_json) + 11322e2 (admin-log pagination)。本 spec 是 **Sub-project D2：per-entity timeline**。Sub-D3 之后做 webhook 发送日志 + placements 列表，Sub-E 做 webhooks/rate-limit/config 写入类 UI。

## ⚠️ 与已有 Sub-project 的关系

| Sub-project | 已交付 | 内容 |
|---|---|---|
| Sub-A | ✅ | 基础设施 + login + profile |
| Sub-B | ✅ | Dashboard 升级 + Users/Candidates 列表 |
| Sub-D1 | ✅ | Audit 总表 UI（admin actions / user actions / login events） |
| Sub-C | ✅ | Jobs/Recommendations 列表 + Dashboard 概览 + 配额调整 + Audit 详情列 |
| Sub-C follow-up | ✅ | details_json + admin-log pagination bug 修复 |
| **Sub-D2（本 spec）** | 设计中 | **点击 user/candidate/job/recommendation → 看该 entity 的合并时间轴** |

**Sub-D2 解决的问题**：ops 想看"这个 user/candidate/job/rec 历史上被谁改过、什么时候改、为什么改"，目前必须跨 3 个 audit 表手动拼接，效率低且容易漏。

---

## 1. 背景与动机

### 1.1 现状（Sub-C follow-up 后）

| 项 | 现状 |
|----|------|
| 后端 admin endpoint | 26+ 个（Sub-A/B/C/D1 + admin-log pagination fix） |
| 3 个 audit 表 | `admin_action_log` (v003) / `action_history` (v001) / `unlock_audit_log` (v002) |
| 3 个 audit endpoint | `/v1/admin/admin-log` / `/v1/admin/action-history` / `/v1/admin/audit` |
| 现有 audit endpoint 过滤 | admin-log 按 `admin_id` / `target_type` / `target_id`；action-history 按 `user_id` / `capability_name`；unlock-audit 按 `actor_user_id` / `recommendation_id` |
| AuditPage | Admin Actions / User Actions / Login Events 3 tabs，全表视图，**无 per-entity drill-down** |
| 痛点 | 看「这个 user 的所有历史」必须人工 3 次查询 3 个 endpoint 再合并 |

### 1.2 真实需求

| 需求 | 痛点 |
|---|---|
| **ops 调查用户投诉** | 「为什么我的配额变了？」— 客户问过来，要查 adjust_user_quota record。Sub-D1 + Sub-C fix 后能看到 audit，但要先知道 user_id 再去翻 |
| **调查解锁链** | 「这个 candidate 是谁解锁的？按什么时间线？」— 现在必须看 unlock_audit_log，没和 candidate 详情串起来 |
| **调查 job 状态变化** | 「这个 job 是谁推荐的？解锁过几次？」— 现在只能去 recommendations 表查 |
| **跨源时间线** | 「昨天这个 user 都发生了什么？」— 现在必须看 3 张表 |

### 1.3 非目标（明确不做）

- ❌ Sub-D3 的 webhook 发送日志 UI
- ❌ Sub-E 的 webhooks/rate-limit/config 写入 UI
- ❌ Realtime / SSE / WebSocket 推送新事件
- ❌ 跨 entity 联动（点 timeline 里的某条事件跳到 entity 详情）
- ❌ URL 持久化 filter（searchParams 同步）— 简化实现，后续如需再补
- ❌ CSV 导出 timeline
- ❌ 暗黑模式 / 移动端响应式
- ❌ Timeline 事件的编辑/撤回
- ❌ 全局 timeline 视图（跨 entity 聚合）— per-entity drill-down 是 Sub-D2 重点

---

## 2. 架构总览

### 2.1 模块改动图

```
hunter-platform/
├── src/main/
│   ├── routes/admin.ts                       # +1 route: GET /v1/admin/timeline/:type/:id
│   ├── schemas/admin.ts                      # +TimelineItemSchema + ListTimelineResponseSchema
│   ├── modules/admin/handlers/
│   │   └── timeline.ts (NEW)                 # createAdminTimelineHandler: UNION 3 tables
│   ├── capabilities/admin.ts                  # +admin.get_timeline
│   └── docs/superpowers/skill.md             # +1 capability row
│
└── admin-web/src/
    ├── pages/
    │   ├── UserTimelinePage.tsx (NEW)
    │   ├── CandidateTimelinePage.tsx (NEW)
    │   ├── JobTimelinePage.tsx (NEW)
    │   └── RecommendationTimelinePage.tsx (NEW)
    ├── components/
    │   ├── TimelineFilterBar.tsx (NEW)       # source + time range + actor
    │   └── TimelineList.tsx (NEW)             # flat list + source badges
    ├── api/timeline.ts (NEW)                  # getTimeline(type, id, filters)
    ├── App.tsx                                # +4 routes
    └── pages/UsersPage.tsx                    # +「时间轴」按钮
        /pages/CandidatesPage.tsx              # +按钮
        /pages/JobsPage.tsx                    # +按钮
        /pages/RecommendationsPage.tsx         # +按钮
```

### 2.2 路由表（admin-web）

| Path | 鉴权 | 备注 |
|------|------|------|
| `/admin/login` | 公开 | 已有 |
| `/admin/users/:id/timeline` | bearer | **新增** |
| `/admin/candidates/:id/timeline` | bearer | **新增** |
| `/admin/jobs/:id/timeline` | bearer | **新增** |
| `/admin/recommendations/:id/timeline` | bearer | **新增** |
| 其他已有路由 | bearer | 不变 |

未匹配 → redirect `/admin/`。

### 2.3 后端 endpoint

| Method | Path | 改动 |
|--------|------|------|
| GET | `/v1/admin/timeline/:type/:id` | **新增** — `type` ∈ `user\|candidate\|job\|recommendation`，UNION 3 表返回 paginated timeline |

### 2.4 数据库改动

- ❌ **0 migration**（3 个 audit 表都已存在 + 都有 `created_at` 索引）

### 2.5 Tech Stack

**沿用 Sub-A/B/C/D1：** Express 4.21, node:sqlite, zod, vitest, supertest（后端）；React 18, Vite, react-router-dom, vanilla CSS, vitest+jsdom+RTL（前端）

**无新依赖。**

---

## 3. 后端设计

### 3.1 标准化事件 schema

3 个表 schema 不同，UNION 前需**标准化**为通用字段：

```sql
source      -- 'admin' | 'user' | 'unlock'
event_id    -- 源表 id（bigint 或 int）
action      -- 事件动作名
actor       -- 操作者 id（TEXT 或 NULL）
details     -- JSON 字符串或 NULL
created_at  -- ISO timestamp
```

### 3.2 Per-entity UNION 模板

**`type=user`（2 个分支）**：

```sql
SELECT 'admin' AS source, id, action, admin_user_id AS actor, details_json AS details, created_at
FROM admin_action_log WHERE target_type = 'user' AND target_id = ?
UNION ALL
SELECT 'user' AS source, id, capability_name AS action, user_id AS actor, response_summary_json AS details, created_at
FROM action_history WHERE user_id = ?
ORDER BY created_at DESC LIMIT ? OFFSET ?
```

**`type=candidate`（3 个分支，反查 candidate_user_id）**：

```sql
SELECT 'admin' AS source, a.id, a.action, a.admin_user_id AS actor, a.details_json AS details, a.created_at
FROM admin_action_log a
WHERE a.target_type = 'user' AND a.target_id = (
  SELECT candidate_user_id FROM candidates_private WHERE anonymized_id = ?
)
UNION ALL
SELECT 'user' AS source, ah.id, ah.capability_name AS action, ah.user_id AS actor, ah.response_summary_json AS details, ah.created_at
FROM action_history ah
WHERE ah.user_id = (
  SELECT candidate_user_id FROM candidates_private WHERE anonymized_id = ?
)
UNION ALL
SELECT 'unlock' AS source, u.id, u.action, u.actor_user_id AS actor, NULL AS details, u.created_at
FROM unlock_audit_log u
JOIN recommendations r ON r.id = u.recommendation_id
WHERE r.anonymized_candidate_id = ?
ORDER BY created_at DESC LIMIT ? OFFSET ?
```

**`type=job`（2 个分支）**：

```sql
SELECT 'admin' AS source, id, action, admin_user_id AS actor, details_json AS details, created_at
FROM admin_action_log WHERE target_type = 'job' AND target_id = ?
UNION ALL
SELECT 'unlock' AS source, u.id, u.action, u.actor_user_id AS actor, NULL AS details, u.created_at
FROM unlock_audit_log u
JOIN recommendations r ON r.id = u.recommendation_id
WHERE r.job_id = ?
ORDER BY created_at DESC LIMIT ? OFFSET ?
```

**`type=recommendation`（1 个分支，最简单）**：

```sql
SELECT 'unlock' AS source, id, action, actor_user_id AS actor, NULL AS details, created_at
FROM unlock_audit_log WHERE recommendation_id = ?
ORDER BY created_at DESC LIMIT ? OFFSET ?
```

### 3.3 时间范围 + actor filter

可选 `from`/`until`/`actor` filter 拼到**每个 UNION 分支**的 WHERE。**关键**：每个分支的 actor 列名不同（`admin_user_id` / `user_id` / `actor_user_id`），所以 handler 必须**逐分支替换列名**。

策略：handler 维护一张 `{ source: actor_column_name }` 映射表，构造 SQL 时把字符串占位符 `__ACTOR_COL__` 替换为正确列名：

```typescript
const ACTOR_COLS = {
  admin: 'admin_user_id',
  user: 'user_id',
  unlock: 'actor_user_id',
} as const;

function buildBranchSql(source: 'admin' | 'user' | 'unlock', entityFilter: string, timeFilter: string): string {
  // ... 选 column list (3 个 source 各自的列)
  // 把 timeFilter 里的 'actor' 字段替换为 ACTOR_COLS[source]
  const actorCol = ACTOR_COLS[source];
  const finalTimeFilter = timeFilter.replace(/\bactor\b/g, actorCol);
  return `SELECT '${source}' AS source, ... WHERE ${entityFilter}${finalTimeFilter}`;
}
```

⚠️ **SQL injection 防护**：actor 值用 parameterized query (`?` + params.push(value))，不在 SQL 字符串里拼接。

### 3.4 Source filter

`source` filter 在 UNION **外层**应用（应用 UNION 结果到 filter）：

```sql
-- 原始 UNION 包成 subquery：
SELECT * FROM (
  <UNION ALL 模板>
) AS combined
WHERE source = ?
ORDER BY created_at DESC LIMIT ? OFFSET ?
```

或前端 SQL 拼装时直接在外层 wrap。

### 3.5 Count 查询

分页总数单独算：

```sql
SELECT COUNT(*) AS c FROM (
  <同 UNION ALL 模板，without ORDER BY/LIMIT>
) AS combined
WHERE [optional source filter]
```

### 3.6 Handler 接口

```typescript
// src/main/modules/admin/handlers/timeline.ts
export function createAdminTimelineHandler(db: DB) {
  return {
    list(filter: {
      type: 'user' | 'candidate' | 'job' | 'recommendation';
      id: string;
      source?: 'admin' | 'user' | 'unlock' | '';
      from?: string;
      until?: string;
      actor?: string;
      limit?: number;
      offset?: number;
    }): { rows: TimelineItem[]; total: number } { ... }
  };
}

export type TimelineItem = {
  id: number;
  source: 'admin' | 'user' | 'unlock';
  action: string;
  actor: string | null;
  details: string | null;  // raw JSON string
  created_at: string;
};
```

### 3.7 Schema

```typescript
// src/main/schemas/admin.ts
const TimelineItemSchema = z.object({
  id: z.number().int(),
  source: z.enum(['admin', 'user', 'unlock']),
  action: z.string(),
  actor: z.string().nullable(),
  details: z.string().nullable(),  // JSON string
  created_at: ISODateTime,
});

const ListTimelineResponseSchema = z.object({
  ok: z.literal(true),
  data: z.array(TimelineItemSchema),
  pagination: PaginationSchema,
});
export { ListTimelineResponseSchema };
```

### 3.8 Route

```typescript
router.get('/timeline/:type/:id', (req, res, next) => {
  try {
    const validTypes = ['user', 'candidate', 'job', 'recommendation'] as const;
    if (!(validTypes as readonly string[]).includes(req.params.type)) {
      throw Errors.invalidParams('type must be user|candidate|job|recommendation');
    }
    const id = req.params.id;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      throw Errors.invalidParams('id has invalid format');
    }
    const page = req.query.page !== undefined ? Number(req.query.page) : 1;
    const pageSize = req.query.pageSize !== undefined ? Number(req.query.pageSize) : 20;
    if (!Number.isFinite(page) || page < 1) throw Errors.invalidParams('page must be a positive integer');
    if (!Number.isFinite(pageSize) || pageSize < 1 || pageSize > 200) {
      throw Errors.invalidParams('pageSize must be 1-200');
    }
    const source = typeof req.query.source === 'string' ? req.query.source : '';
    if (source && !['admin', 'user', 'unlock'].includes(source)) {
      throw Errors.invalidParams('source must be admin|user|unlock');
    }
    const filter: Parameters<ReturnType<typeof createAdminTimelineHandler>['list']>[0] = {
      type: req.params.type as any,
      id,
      source: source as any,
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      until: typeof req.query.until === 'string' ? req.query.until : undefined,
      actor: typeof req.query.actor === 'string' ? req.query.actor : undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    };
    const { rows, total } = timeline.list(filter);
    respond(res, ListTimelineResponseSchema, {
      ok: true, data: rows,
      pagination: { total, page, pageSize, has_more: page * pageSize < total },
    }, { strict: true });
  } catch (e) { next(e); }
});
```

### 3.9 Capability 同步

新增 `admin.get_timeline`：

```typescript
{
  name: 'admin.get_timeline',
  description: '获取 user/candidate/job/recommendation 的合并审计时间轴',
  method: 'GET', path: '/v1/admin/timeline/:type/:id',
  response_schema: ListTimelineResponseSchema,
  quota_cost: 0,
  preconditions: [],
},
```

同步到 `docs/superpowers/skill.md` capability 列表。

### 3.10 错误处理约定

| 场景 | HTTP | code | 触发位置 |
|------|------|------|---------|
| type 非法 | 400 | INVALID_PARAMS | route handler |
| id 格式非法 | 400 | INVALID_PARAMS | route handler |
| page/pageSize 越界 | 400 | INVALID_PARAMS | route handler |
| source 非法 | 400 | INVALID_PARAMS | route handler |
| from/until 非 ISO | 400 | INVALID_PARAMS | route handler（用 Date.parse） |
| entity 不存在（candidate 反查 NULL 等） | 200 | ok=true | handler（防探测） |
| 无 Bearer token | 401 | UNAUTHORIZED | admin auth middleware |

### 3.11 不做

- ❌ 全局 timeline（跨 entity 聚合）— per-entity 优先
- ❌ 实时数据 / SSE
- ❌ 缓存层
- ❌ 任何 schema 变更（0 migration）

---

## 4. 前端设计

### 4.1 新增公共组件

#### `<TimelineFilterBar>` 

```tsx
type TimelineFilterBarProps = {
  source: 'all' | 'admin' | 'user' | 'unlock';
  onSourceChange: (s: 'all' | 'admin' | 'user' | 'unlock') => void;
  from: string; until: string;
  onFromChange: (v: string) => void;
  onUntilChange: (v: string) => void;
  actor: string;
  onActorChange: (v: string) => void;
  onClear: () => void;
};
```

布局：

```
[来源 ▼]  全部 / admin / user / unlock    从 [date] 至 [date]    [actor 搜索]    [清除]
```

#### `<TimelineList>` 

```tsx
type TimelineListProps = {
  items: TimelineItem[];
  loading: boolean;
  empty: string;
};
```

每行布局：

```
┌─ 时间 (relativeTime) ──────────────────────────────┐
│ [🛡️ admin]  adjust_user_quota                     │
│   操作人: adm_default_seed                          │
│   reason: 客户加单                                 │
│   [查看 JSON 详情]                                 │
└────────────────────────────────────────────────────┘
```

- 每条上方有彩色 source badge：admin=蓝、user=绿、unlock=橙
- 「查看 JSON 详情」按钮 → 复用现有 `<AuditJsonDrawer>`（Sub-D1 已建）
- loading 态用 `<Skeleton>` 复用 Sub-C
- 空状态显示 `empty` 文案

### 4.2 API wrapper

```tsx
// admin-web/src/api/timeline.ts
export type TimelineSource = 'admin' | 'user' | 'unlock';
export type TimelineType = 'user' | 'candidate' | 'job' | 'recommendation';

export type TimelineItem = {
  id: number;
  source: TimelineSource;
  action: string;
  actor: string | null;
  details: string | null;
  created_at: string;
};

export async function getTimeline(
  type: TimelineType,
  id: string,
  opts: {
    page?: number;
    pageSize?: number;
    source?: TimelineSource | 'all';
    from?: string;
    until?: string;
    actor?: string;
  } = {},
): Promise<Paginated<TimelineItem>> { ... }
```

### 4.3 4 个 Timeline 页面

每个 page 文件 ~150 行，结构几乎相同：

```tsx
// 例：UserTimelinePage.tsx
export default function UserTimelinePage() {
  const { id } = useParams<{ id: string }>();
  const [source, setSource] = useState<'all'|'admin'|'user'|'unlock'>('all');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [actor, setActor] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<TimelineItem[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 20, has_more: false });
  const [loading, setLoading] = useState(true);

  const load = useCallback((p: number, src: string, f: string, u: string, a: string) => {
    setLoading(true);
    getTimeline('user', id!, { page: p, pageSize: 20, source: src as any, from: f || undefined, until: u || undefined, actor: a || undefined })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(page, source, from, until, actor); }, [load, page, source, from, until, actor]);

  return (
    <Layout adminName="Admin">
      <h1>用户时间轴 — {id}</h1>
      <TimelineFilterBar
        source={source} onSourceChange={setSource}
        from={from} onFromChange={setFrom}
        until={until} onUntilChange={setUntil}
        actor={actor} onActorChange={setActor}
        onClear={() => { setSource('all'); setFrom(''); setUntil(''); setActor(''); setPage(1); }}
      />
      {loading ? <Skeleton variant="row" count={5} /> : <TimelineList items={rows} loading={false} empty="暂无事件" />}
      <Pagination page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} onPageChange={setPage} />
    </Layout>
  );
}
```

其他 3 个 page（Candidate/Job/Recommendation）结构相同，只 type 参数不同。

### 4.4 列表页加「时间轴」按钮（4 处）

每个现有列表（UsersPage / CandidatesPage / JobsPage / RecommendationsPage）行末加：

```tsx
<Link to={`/${entityType}s/${row.id}/timeline`} className="btn btn-sm">时间轴</Link>
```

实体类型与路由前缀映射：
- `users` → entityType=`user`，URL=`/users/{id}/timeline`
- `candidates` → entityType=`candidate`
- `jobs` → entityType=`job`
- `recommendations` → entityType=`recommendation`

注：列表页 row id 字段名不同（`row.id` for users/jobs，`row.anonymized_id` for candidates，`row.id` for recommendations）— 各自按当前 row 字段。

### 4.5 路由注册

`admin-web/src/App.tsx` 加 4 个 route：

```tsx
<Route path="/users/:id/timeline" element={<PrivateRoute><UserTimelinePage /></PrivateRoute>} />
<Route path="/candidates/:id/timeline" element={<PrivateRoute><CandidateTimelinePage /></PrivateRoute>} />
<Route path="/jobs/:id/timeline" element={<PrivateRoute><JobTimelinePage /></PrivateRoute>} />
<Route path="/recommendations/:id/timeline" element={<PrivateRoute><RecommendationTimelinePage /></PrivateRoute>} />
```

### 4.6 Layout 变化

Layout 侧边栏 nav **不变**（timeline 是 detail 页，不是常驻入口）。

### 4.7 错误处理约定

| 场景 | UI 表现 |
|------|---------|
| id 格式错（400） | Toast「id 格式错误」 + console.error（用户从列表来，id 一般合法） |
| entity 不存在 | TimelineList 空状态「暂无事件」（200 + empty data） |
| 网络断开 | Toast「网络错误」 |
| API 401 | 清 token + 跳 login（client.ts 处理） |

### 4.8 不做

- ❌ Page-level 缓存（每次 filter 变都重新 fetch）
- ❌ URL 持久化 filter（searchParams 同步）
- ❌ Realtime / SSE
- ❌ CSV 导出

---

## 5. 数据流与 Audit 链路

### 5.1 Timeline 加载端到端

```
[1] UsersPage/CandidatesPage/JobsPage/RecommendationsPage
    点行末「时间轴」按钮 → <Link to="/users/:id/timeline">
    → React Router 导航到 UserTimelinePage

[2] UserTimelinePage mount
    → useParams 拿 id
    → useEffect 调 getTimeline('user', id, { page: 1 })

[3] getTimeline() (admin-web/src/api/timeline.ts)
    → apiFetchRaw<TimelineItem[]>('timeline/user/' + id + buildQuery(opts))
    → 用 Bearer api_key 调 /v1/admin/timeline/user/usr_xxx
    → 返回 envelope { ok, data, pagination }

[4] Backend admin auth middleware
    → 验 Bearer → req.admin.id

[5] routes/admin.ts GET /timeline/:type/:id
    → 校验 type 在白名单
    → 校验 id 格式
    → 解析 page/pageSize/source/from/until/actor
    → 调 timeline.list({ ...filter })

[6] createAdminTimelineHandler.list()
    → 根据 type 选 UNION 模板
    → 拼 from/until/actor/source filter
    → SQL: UNION ALL ... ORDER BY created_at DESC LIMIT ? OFFSET ?
    → COUNT(*) 同 UNION subquery
    → return { rows, total }

[7] 响应回前端
    → setRows + setPagination
    → TimelineList 渲染：每条带 source badge
    → 「查看 JSON 详情」按钮 → AuditJsonDrawer 复用 Sub-D1
```

### 5.2 性能特征

- UNION 3 表 + LIMIT/OFFSET：~10ms（每个表都有 `created_at` 索引）
- COUNT(*) UNION subquery：~15ms（无索引加速但 admin 单次访问）
- Total latency：~50-80ms end-to-end

### 5.3 失败链路

**Type 不合法**：路由 400 → API wrapper throw → Page catch → Toast「参数错误」

**Entity id 不存在**：handler 返回 `{ rows: [], total: 0 }`（candidate 的反查 subquery 返回 NULL）→ 前端显示空状态

**网络断开**：apiFetchRaw catch → Toast「网络错误」

**API 401**：client.ts 自动清 token + 跳 login

### 5.4 状态管理矩阵

| 状态 | 存储 | 持久化 |
|------|------|--------|
| filter 值 | useState（page 内） | 否 |
| page | useState | 否 |
| rows + pagination | useState | 否 |
| loading | useState | 否 |
| drawer 状态 | useState | 否 |

URL 不持久化 filter（保持简单）。

### 5.5 风险与缓解

| 风险 | 缓解 |
|------|------|
| UNION 不同 schema（admin_action_log 的 details_json vs unlock_audit_log 无 details） | 用 NULL 填充缺失字段，前端按 source 判断显示 |
| candidate 反查 subquery 性能 | candidates_private 已有 idx on anonymized_id（v006 migration），单次 < 1ms |
| 时间范围 from/until 与 created_at 类型不一致（TEXT ISO） | 全部存为 ISO TEXT，string comparison = chronological（ISO 格式保证） |
| actor filter 跨不同列名（admin_user_id / user_id / actor_user_id） | handler 维护 ACTOR_COLS 映射表 + 字符串占位符替换；actor 值用 parameterized query 防 SQL injection |
| 数据量大时 UNION 慢 | LIMIT 20 + page=1 起步，后续可加 created_at 复合索引 |

---

## 6. 测试策略

### 6.1 覆盖目标

| 层 | 范围 | 数量 |
|----|------|------|
| 后端 handler | 4 个 type × 多条件（带 from/until/actor/source filter） | ~8 |
| 后端 route | GET /timeline/:type/:id + 400/401 边界 | ~4 |
| 前端 API wrapper | getTimeline 4 个 type + query 拼装 | ~5 |
| 前端组件 | TimelineFilterBar + TimelineList | ~6 |
| 前端页面 | 4 个 page（mount + filter + 空 + 错误） | ~16 |
| 列表页按钮跳转 | 4 处 + 各加 1 case | ~4 |
| **新增总计** | | **~43** |

回归目标：现存 1005 + 新增 43 ≈ **1048 测试**。

### 6.2 后端测试

#### `timeline-handler.test.ts`
```
✓ 1. type=user — admin_action_log + action_history merged, sorted DESC
✓ 2. type=candidate — admin + user + unlock (via recommendations JOIN) merged
✓ 3. type=job — admin + unlock (via recommendations JOIN) merged
✓ 4. type=recommendation — only unlock_audit_log
✓ 5. source filter — filter to only 'admin' rows
✓ 6. from/until filter — restrict by created_at range
✓ 7. actor filter — match admin_user_id / user_id / actor_user_id by column
✓ 8. pagination — total count + has_more correct
```

#### `timeline-route.test.ts`
```
✓ 1. GET /v1/admin/timeline/user/usr_xxx → 200 with paginated envelope
✓ 2. type invalid (e.g. 'foo') → 400
✓ 3. id invalid format → 400
✓ 4. pageSize > 200 → 400
✓ 5. no auth → 401
```

### 6.3 前端测试

#### `api/timeline.test.ts`
```
✓ 1. getTimeline('user', id) calls correct endpoint
✓ 2. getTimeline('candidate', id, { source: 'admin' }) includes source param
✓ 3. getTimeline('job', id, { from, until }) includes time params
✓ 4. getTimeline('recommendation', id, { actor }) includes actor param
✓ 5. throws on non-ok response
```

#### `components/TimelineFilterBar.test.tsx`
```
✓ 1. renders 3 filter controls (source select, from/until date, actor input)
✓ 2. clearing calls onClear
✓ 3. changing source calls onSourceChange
```

#### `components/TimelineList.test.tsx`
```
✓ 1. renders items with source badge
✓ 2. clicking 详情 opens drawer
✓ 3. shows empty state when items empty
```

#### 4 个 page test（每个 ~4 case）
```
✓ 1. mount calls getTimeline with correct type + id
✓ 2. changing source triggers refetch
✓ 3. changing time range triggers refetch
✓ 4. shows empty state on empty data
```

#### 列表页按钮跳转（4 处各 1 case）
```
✓ clicking 时间轴 on UsersPage navigates to /users/:id/timeline
（其他 3 个类似）
```

### 6.4 测试基础设施

- 沿用 vitest + supertest（后端）+ vitest + jsdom + RTL（前端）
- 复用已有 helper：`src/test/admin/helpers/setup-admin.ts`、`admin-web/tests/helpers/render-with-router.tsx`
- Mock 策略：API 用 `vi.mock('../api/raw')`，DB 用 node:sqlite in-memory

### 6.5 不做

- ❌ E2E（Playwright）— Sub-E 整体加
- ❌ 视觉回归
- ❌ 性能测试（k6）— admin 流量低
- ❌ Mutation testing — 价值密度低

---

## 7. 验收标准（DoD）

Sub-D2 完成时必须满足：

1. ✅ 后端 `GET /v1/admin/timeline/:type/:id` 返回 3 表 UNION paginated envelope
2. ✅ 后端 ~12 个新集成测试通过
3. ✅ 4 个 timeline 页面渲染、filter、详情都工作
4. ✅ 4 个列表页行末「时间轴」按钮跳转
5. ✅ 复用 `<AuditJsonDrawer>` 显示 details JSON
6. ✅ 前端 ~31 个新测试通过 + 现有测试不退
7. ✅ Capability：`admin.get_timeline` 注册到 skill.md
8. ✅ 全 typecheck 绿（后端 + 前端）
9. ✅ 手测 8 步全通过（见 §8）
10. ✅ CHANGELOG.md 加 v2.2.0 条目
11. ✅ Spec + Plan 同步 git

---

## 8. 手测 8 步（dev 模式）

```bash
# Terminal 1
cd D:/dev/hunter-platform && npm run dev

# Terminal 2
cd D:/dev/hunter-platform/admin-web && npm run dev
```

| # | 操作 | 期望 |
|---|------|------|
| 1 | http://localhost:5174/admin/login | 登录页 |
| 2 | 登录进 admin | dashboard 正常 |
| 3 | 进「用户」→ 找一个 user → 点「时间轴」 | 进入 user timeline，看到 admin 改配额记录 + user 自己的操作 |
| 4 | 改 source filter 为「admin」 | 只显示 admin 事件 |
| 5 | 改时间范围到最近 7 天 | 列表刷新，结果正确 |
| 6 | 点某条 admin 操作的「详情」 | drawer 显示完整 JSON（previous_quota/new_quota/reason） |
| 7 | 进「候选人」→ 找 candidate → 点「时间轴」 | 看到 unlock 流水 + user 操作 |
| 8 | 进「职位」→ 找 job → 点「时间轴」 | 看到 admin 操作 + 推荐相关的 unlock 事件 |

任一步失败，按错误排查。

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

## 10. 工作量预估

| 阶段 | 估时 |
|------|------|
| 后端 handler + route + schema + capability | 3-4 小时 |
| 后端测试 ~12 | 1-2 小时 |
| 前端 4 page + 2 共享组件 | 5-6 小时 |
| 前端测试 ~26 | 2-3 小时 |
| 手测 + 修小问题 | 1 小时 |
| **总计** | **1 个工作日** |

---

## 11. 后续（明确不在 Sub-D2 范围）

| Sub-project | 内容 | 预计 |
|---|---|---|
| Sub-D3 | Webhook 发送日志 UI + Placements 列表 | v2.3 |
| Sub-E | webhooks / rate-limit / config 写入类变更 UI | v2.4 |
| Sub-D3 follow-up | Timeline URL 持久化 filter（searchParams 同步） | v2.3.1 |
| E2E | Playwright 整体冒烟 | v2.5 |

---

## 附录 A：UI 草图（ASCII）

### UserTimelinePage
```
┌────────────────────────────────────────────────────────────────────────┐
│ 猎头管理后台                          Admin                            │
├──────────────┬─────────────────────────────────────────────────────────┤
│              │ 用户时间轴 — user_e07f9a60-283                         │
│ 仪表盘       │ ┌──────────────────────────────────────────────────────┐ │
│ 用户 ◀       │ │ [来源 ▼全部]   从 [____] 至 [____]   [____] [清除]   │ │
│ 候选人       │ └──────────────────────────────────────────────────────┘ │
│ 职位         │ ┌──────────────────────────────────────────────────────┐ │
│ 推荐         │ │ 2 小时前                                          │ │
│ 审计         │ │ [🛡️ admin] adjust_user_quota                       │ │
│ 我的         │ │ 操作人: adm_default_seed                              │ │
│              │ │ reason: 客户紧急加单                                 │ │
│              │ │ [查看 JSON 详情]                                    │ │
│              │ └──────────────────────────────────────────────────────┘ │
│ 退出登录     │ ┌──────────────────────────────────────────────────────┐ │
│              │ │ 1 天前                                              │ │
│              │ │ [🐝 user] candidate.upload_resume                    │ │
│              │ │ 操作人: user_e07f9a60-283                            │ │
│              │ │ [查看 JSON 详情]                                    │ │
│              │ └──────────────────────────────────────────────────────┘ │
│              │              < 1 2 3 ... >                              │
└──────────────┴─────────────────────────────────────────────────────────┘
```

### TimelineList 单条
```
┌────────────────────────────────────────────────────┐
│ 2026-06-24 14:32:15 UTC  (2 小时前)              │
│ ┌──────┐                                          │
│ │ admin│  adjust_user_quota                       │
│ └──────┘                                          │
│ actor: adm_default_seed                            │
│ reason: 客户紧急加单                               │
│                                                    │
│ ┌──────────────────────────────────┐              │
│ │ 查看 JSON 详情                    │              │
│ └──────────────────────────────────┘              │
└────────────────────────────────────────────────────┘
```

---

**Spec 结束。** 配套 implementation plan 见 `docs/superpowers/plans/2026-06-25-web-admin-sub-D2-plan.md`（待 writing-plans skill 输出）。