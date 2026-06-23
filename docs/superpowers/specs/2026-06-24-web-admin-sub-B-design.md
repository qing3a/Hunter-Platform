# Web Admin Sub-B — Dashboard + Lists Design

> **For agentic workers**: 这是 design spec，配套 implementation plan 在 `docs/superpowers/plans/2026-06-24-web-admin-sub-B-plan.md`（待 writing-plans skill 输出）。
>
> 续接 Sub-A（v1.5+，merge `ad62db3`）。本 spec 是 **Sub-project B：监控仪表盘 + 列表只读页**。Sub-C 之后做 mutations，Sub-D 做审计，Sub-E 做配置。

**Goal:** 在已有 admin-web/（React 18 + Vite + TS + vanilla CSS）上加 3 个只读页面：
1. **DashboardPage** — 升级现有占位 → 真实 4 卡片 + 7/30 天趋势
2. **CandidatesPage** — 候选人列表（分页 + 搜索 + 状态筛选）
3. **UsersPage** — 用户列表（分页 + 搜索 + 角色筛选）

**Architecture:**
- **前端**：复用 Sub-A 的 api/client.ts + PrivateRoute + Layout；新增 5 个共用组件（Table/SearchBar/Pagination/StatusBadge/MetricCard）+ 1 个 SVG sparkline；3 个页面（替换 1 个 + 新增 2 个）
- **后端（轻补丁，4 处）**：扩展 list 端点支持 `offset`+`keyword`；Dashboard 加 `today_new` + `trend_30d`；Candidates JOIN users 暴露姓名/邮箱（admin 本就可见 PII via suspend endpoint）
- **测试**：admin-web/ 加 vitest + jsdom + @testing-library/react；**只测** apiFetch wrapper + 纯 helpers（不写组件渲染测，价值密度低）

**Tech Stack（沿用 Sub-A）:** React 18, Vite, TypeScript, react-router-dom, vanilla CSS, native fetch, zod（前端可选）
**新增依赖：** vitest, jsdom, @testing-library/react（admin-web/ 测试）
**生产 URL：** https://qing3.top/admin/ （Sub-A 已部署）

---

## 1. 背景与动机

### 1.1 现状（Sub-A 后）

| 项 | 现状 |
|----|------|
| 后端 admin 端点 | 20 个全部跑通，Sub-A 鉴权改 per-admin api_key |
| Dashboard 数据 | `GET /v1/admin/dashboard/stats` 返回 7 字段（total_users/total_candidates/total_jobs/open_jobs/active_placements/daily_quota_used/webhook_dead_letters），无日增、无趋势 |
| Users list | `GET /v1/admin/users?user_type=&status=&limit=` — 仅 filter，无 offset/keyword |
| Candidates list | `GET /v1/admin/candidates?in_pool=&unlock_status=&limit=` — 响应只 8 字段（**无姓名/手机号**，因 candidates_anonymized 不存 PII） |
| 前端 admin-web/ | 3 页：LoginPage / DashboardPage（占位）/ ProfilePage。**无 vitest 等测试框架** |
| 部署 | nginx `/admin/` SPA + API 同域 |

### 1.2 真实需求

- **监控仪表盘**：dashboard 需要"今日新增" + 趋势图，让 ops 一眼看出增长/异常
- **列表只读视图**：候选人/用户列表需要支持分页（100+ 行时一页放不下）+ 关键词搜索（找特定人）+ 筛选（按角色/状态）
- **PII 暴露策略**：admin 已经能 suspend user（看到姓名+联系方式）；Candidates list 也应暴露候选人姓名/邮箱给 admin（candidates_anonymized 是匿名化版本，但 candidates_private 仍存真名；JOIN users 表即可）

### 1.3 非目标（明确不做）

- ❌ Sub-C 的 mutation（suspend/unsuspend/adjust-quota/remove-from-pool 的按钮逻辑）— UI 只占位
- ❌ 列表的 inline edit — 单独 sub-project
- ❌ 实时刷新（WebSocket/SSE）— ops 手动 reload
- ❌ 复杂图表库（Recharts/Chart.js）— SVG sparkline 够用
- ❌ Admin 用户 CRUD UI — Sub-E
- ❌ Audit / action history 视图 — Sub-D
- ❌ 国际化 / 深色模式 — 后续

---

## 2. UI 架构

### 2.1 路由更新

| Path | Component | 鉴权 | 备注 |
|------|-----------|------|------|
| `/admin/login` | LoginPage | 公开 | 已有 |
| `/admin/` | DashboardPage | bearer | **升级** Sub-A 占位 |
| `/admin/users` | UsersPage | bearer | **新增** |
| `/admin/candidates` | CandidatesPage | bearer | **新增** |
| `/admin/profile` | ProfilePage | bearer | 已有 |

未匹配 → redirect `/admin/`。

### 2.2 共享组件

| 组件 | 文件 | 说明 |
|------|------|------|
| `Layout` | `components/Layout.tsx` | **改**：nav 加 "Users" / "Candidates" 链接 |
| `Table` | `components/Table.tsx` | 通用表头/行渲染 + colspan/empty/loading 状态 |
| `SearchBar` | `components/SearchBar.tsx` | input + 可选下拉筛选（status/role） |
| `Pagination` | `components/Pagination.tsx` | 上/下页 + 页码 + total/pageSize 显示 |
| `StatusBadge` | `components/StatusBadge.tsx` | 彩色 pill：active=绿/suspended=红/pending=黄 |
| `MetricCard` | `components/MetricCard.tsx` | 大数字 + 标签 + 可选 delta |
| `Sparkline` | `components/Sparkline.tsx` | 内联 SVG，<30 行代码，无需依赖 |

### 2.3 页面草图

#### DashboardPage

```
┌──────────────────────────────────────────────────────────┐
│ Hunter Admin  [Users] [Candidates] [Dashboard] [Profile] │
├──────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ 142      │ │ 1,847    │ │ +23 today│ │ 12 open  │    │
│  │ Users    │ │Candidate │ │ Today    │ │ Placements│   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘    │
│                                                           │
│  Users growth (30 days)                                  │
│  ┌────────────────────────────────────────────────────┐ │
│  │      ╱╲      ╱╲                                     │ │
│  │   ╱─╯  ╲___╱  ╲___╱╲___                            │ │
│  │ ╱                    ╲___                          │ │
│  └────────────────────────────────────────────────────┘ │
│                                                           │
│  Recent activity (placeholder for Sub-D)                  │
└──────────────────────────────────────────────────────────┘
```

#### CandidatesPage

```
┌──────────────────────────────────────────────────────────┐
│ Hunter Admin  [Users] [Candidates] [Dashboard] [Profile] │
├──────────────────────────────────────────────────────────┤
│  Candidates                                               │
│  [🔍 Search name/email__________] [Status: all ▾]        │
│                                                            │
│  ┌─────────┬───────────┬──────────┬─────────┬──────────┐ │
│  │ ID      │ Name      │ Source   │ Status  │ Created  │ │
│  ├─────────┼───────────┼──────────┼─────────┼──────────┤ │
│  │ c_a1b   │ Alice     │ h_xyz    │ pending │ 2 days   │ │
│  │ c_c3d   │ Bob       │ h_abc    │ unlocked│ 3 days   │ │
│  └─────────┴───────────┴──────────┴─────────┴──────────┘ │
│                                                            │
│  Showing 1-20 of 47    [← Prev]  Page 1/3  [Next →]      │
└──────────────────────────────────────────────────────────┘
```

#### UsersPage

类似 CandidatesPage,列：ID / Name / Email / Role / Status / Created

---

## 3. 后端补丁（4 处，零 migration）

### 3.1 Patch 1: Users list — offset + keyword

**文件：** `src/main/modules/admin/handlers/users.ts`

```typescript
list(filter: {
  user_type?: string;
  status?: string;
  keyword?: string;    // NEW: LIKE name
  limit?: number;
  offset?: number;     // NEW: pagination
}): { rows: Array<...>; total: number } {  // NEW: envelope
  // Build WHERE clause
  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (filter.user_type) { where.push('user_type = ?'); params.push(filter.user_type); }
  if (filter.status) { where.push('status = ?'); params.push(filter.status); }
  if (filter.keyword) { where.push("name LIKE ?"); params.push(`%${filter.keyword}%`); }

  // COUNT for pagination total
  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE ${where.join(' AND ')}`)
    .get(...params) as { cnt: number }).cnt;

  // Rows
  const sql = `
    SELECT id, user_type, name, quota_per_day, quota_used, quota_reset_at,
           reputation, status, created_at
    FROM users WHERE ${where.join(' AND ')}
    ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...params, filter.limit ?? 20, filter.offset ?? 0) as any;
  return { rows, total };
}
```

**路由：** `src/main/routes/admin.ts` GET `/v1/admin/users`
- 解析 query `page` (1-based, default 1) → `offset = (page - 1) * pageSize`
- 解析 query `pageSize` (default 20, max 100) → `limit`
- 解析 query `keyword`
- 响应 schema：新增 `pagination: { total, page, pageSize, has_more }`

**Schema 更新：** `ListUsersResponseSchema` → 改成 `{ ok, data: UserPublicSchema[], pagination: PaginationSchema }`

### 3.2 Patch 2: Candidates list — offset + JOIN users

**文件：** `src/main/modules/admin/handlers/candidates.ts`

```typescript
list(filter: {
  in_pool?: boolean;
  unlock_status?: string;
  keyword?: string;    // NEW: LIKE users.name OR users.contact
  limit?: number;
  offset?: number;     // NEW
}): { rows: Array<...>; total: number } {
  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (filter.in_pool !== undefined) { where.push('ca.is_public_pool = ?'); params.push(filter.in_pool ? 1 : 0); }
  if (filter.unlock_status) { where.push('ca.unlock_status = ?'); params.push(filter.unlock_status); }
  if (filter.keyword) { where.push('(u.name LIKE ? OR u.contact LIKE ?)'); params.push(`%${filter.keyword}%`, `%${filter.keyword}%`); }

  const total = (db.prepare(`
    SELECT COUNT(*) as cnt FROM candidates_anonymized ca
    JOIN candidates_private cp ON cp.id = ca.source_private_id
    JOIN users u ON u.id = cp.candidate_user_id
    WHERE ${where.join(' AND ')}`).get(...params) as { cnt: number }).cnt;

  const sql = `
    SELECT ca.id AS anonymized_id, cp.candidate_user_id, u.name, u.contact AS email,
           ca.source_headhunter_id AS headhunter_id,
           ca.industry, ca.title_level, ca.is_public_pool, ca.unlock_status, ca.created_at
    FROM candidates_anonymized ca
    JOIN candidates_private cp ON cp.id = ca.source_private_id
    JOIN users u ON u.id = cp.candidate_user_id
    WHERE ${where.join(' AND ')}
    ORDER BY ca.created_at DESC LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...params, filter.limit ?? 20, filter.offset ?? 0) as any;
  return { rows, total };
}
```

**Schema 更新：** `AdminCandidateSchema` 加 `name: z.string()` + `email: z.string()`
**路由：** 同 Patch 1 的 page/pageSize 解析

### 3.3 Patch 3: Dashboard stats — today_new + trend_30d

**文件：** `src/main/modules/admin/handlers/dashboard.ts`

```typescript
getStats(): DashboardStats {
  // ... 现有 7 字段计算 ...

  // NEW: today_new (users created today, UTC)
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  const todayNew = (db.prepare(
    `SELECT COUNT(*) as cnt FROM users WHERE created_at >= ?`
  ).get(todayStart.toISOString()) as { cnt: number }).cnt;

  // NEW: trend_30d (array of 30 ints, [day -29, day -28, ..., day 0])
  const trend: number[] = [];
  for (let i = 29; i >= 0; i--) {
    const dayStart = new Date(todayStart);
    dayStart.setUTCDate(dayStart.getUTCDate() - i);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    const cnt = (db.prepare(
      `SELECT COUNT(*) as cnt FROM users WHERE created_at >= ? AND created_at < ?`
    ).get(dayStart.toISOString(), dayEnd.toISOString()) as { cnt: number }).cnt;
    trend.push(cnt);
  }

  return {
    ...现有字段,
    activity: { placements_today: placementsToday, today_new_users: todayNew, trend_30d: trend },
  };
}
```

**路由：** `src/main/routes/admin.ts` GET `/v1/admin/dashboard/stats`
- 当前响应手动 flatten `{total_users, total_candidates, ...}`，新版加 `today_new_users: number` + `trend_30d: number[]`

**Schema 更新：** `DashboardStatsSchema` 加 2 字段

### 3.4 Patch 4: 测试更新

- `tests/integration/admin-endpoints.test.ts` — 更新 /users /candidates 期望新 envelope
- `tests/integration/admin-strict-mode.test.ts` — 同步更新
- 新增 `tests/integration/admin-list-pagination.test.ts` — 测分页 + keyword + total

---

## 4. 前端实现

### 4.1 测试基础设施（admin-web/）

**新增 devDependencies:**
```json
{
  "vitest": "^2.1.0",
  "jsdom": "^25.0.0",
  "@testing-library/react": "^16.0.0",
  "@testing-library/jest-dom": "^6.4.0"
}
```

**新增 `admin-web/vitest.config.ts`：**
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

**新增 `admin-web/src/test-setup.ts`：**
```typescript
import '@testing-library/jest-dom';
```

**package.json scripts 加：** `"test": "vitest run"` + `"test:watch": "vitest"`

### 4.2 测什么（不测什么）

**测（高价值，低成本）：**
- `src/api/client.ts` — `apiFetch` wrapper
  - 注入 Bearer header（5 tests: 401 redirect/error envelope/success/custom headers/auth from token）
- `src/lib/format.ts` — 纯 helpers
  - `formatDate(iso)` — UTC → 本地短格式（3 tests）
  - `statusColor(status)` — 颜色映射（4 tests）

**不测（低价值/重 setup）：**
- ❌ Table/SearchBar/Pagination 等组件渲染测 — jsdom 不能验证视觉，RTL setup 重
- ❌ Page-level integration — 太多 fetch mock，价值不如手测浏览器

### 4.3 API client 模块（typed wrappers）

**新增 `src/api/users.ts`：**
```typescript
import { apiFetch } from './client';
export type UserRow = {
  id: string; user_type: 'candidate' | 'headhunter' | 'employer';
  name: string; status: 'active' | 'suspended' | 'deleted';
  quota_per_day: number; quota_used: number; quota_reset_at: string;
  reputation: number; created_at: string;
};
export type Paginated<T> = { data: T[]; pagination: { total: number; page: number; pageSize: number; has_more: boolean } };

export async function listUsers(opts: { page?: number; pageSize?: number; keyword?: string; user_type?: string; status?: string } = {}): Promise<Paginated<UserRow>> {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts.keyword) params.set('keyword', opts.keyword);
  if (opts.user_type) params.set('user_type', opts.user_type);
  if (opts.status) params.set('status', opts.status);
  const query = params.toString() ? `?${params}` : '';
  return apiFetch(`users${query}`);
}
```

类似 `candidates.ts`, `dashboard.ts`。

**重要：** `apiFetch<T>` 当前返回 `T` 但新响应有 `{ data, pagination }` 嵌套。需要扩展 api/client.ts 让其支持 envelope 解包。两种选择：
- A: 让 apiFetch 接受 `{ envelope?: 'data' | 'paginated' }` 选项
- B: 改 apiFetch 总是返回 `{ data, pagination? }`，让调用者按需取

**选 B（更简单）：** 改 `apiFetch` 始终返回整个 envelope `{ ok, data, pagination? }`；调用方用 `result.data` + `result.pagination`。

但这会破坏现有 LoginPage/DashboardPage/ProfilePage 的调用。改造范围：
- LoginPage：`apiFetch<LoginResp>('auth/login', ...)` → `const r = await apiFetch('auth/login', ...); const data = r.data as LoginResp;`
- ProfilePage：同
- DashboardPage：当前用的是占位，无实际 fetch。但新版要 fetch `/dashboard/stats`，所以一并改

### 4.4 组件实现要点

**Table.tsx** —— 接受 `columns: Column<T>[]` + `rows: T[]` + `loading` + `empty`：
```typescript
export type Column<T> = { key: string; header: string; render: (row: T) => React.ReactNode };
export default function Table<T>({ columns, rows, loading, empty }: {...}) { ... }
```

**Pagination.tsx** —— `{ page, pageSize, total, onPageChange }`，计算 `hasMore = page * pageSize < total`

**Sparkline.tsx** —— 接收 `data: number[]` + `width=200` + `height=40`，绘制 SVG `<polyline>`:
```typescript
export default function Sparkline({ data, width = 200, height = 40 }: {...}) {
  const max = Math.max(1, ...data);
  const points = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - (v / max) * (height - 4) - 2}`).join(' ');
  return <svg width={width} height={height}><polyline points={points} fill="none" stroke="#0066cc" strokeWidth="1.5" /></svg>;
}
```

**DashboardPage** — 调 `getDashboardStats()` → 4 MetricCard + Sparkline
**CandidatesPage / UsersPage** — 调 list API + Table + SearchBar + Pagination

### 4.5 路由 + Layout 更新

**App.tsx：** 加 `<Route path="/users" element={<PrivateRoute><UsersPage /></PrivateRoute>} />` + candidates
**Layout.tsx：** nav 加两个 Link（`/admin/users`, `/admin/candidates`）
**Active link 状态：** 用 `NavLink` 而非 `Link`，自动 active class

---

## 5. 验收清单

- [ ] 3 个页面可访问（login 后）
- [ ] Dashboard 显示 4 卡片 + 30 天趋势 SVG
- [ ] Candidates 列表分页工作（page 1/2/3）
- [ ] Candidates 搜索 "alice" 过滤结果
- [ ] Users 列表分页 + 搜索工作
- [ ] Status/role 筛选工作
- [ ] admin-web/ build 成功（`pnpm build` 无错）
- [ ] admin-web/ 跑 `pnpm test` 8+ tests 通过
- [ ] `pnpm typecheck` 干净
- [ ] `pnpm test`（后端）814 + 新增 9 = 823 全过
- [ ] `pnpm openapi:check` 干净
- [ ] Production 部署后 https://qing3.top/admin/users 200 + 显示列表

---

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Candidates JOIN users 性能差（无 name 索引） | 中 | 低 | LIKE 模式加 `%keyword%` 性能一般；用户量小（< 10k），可接受 |
| Dashboard trend_30d 30 次查询 N+1 | 中 | 低 | 30 次 SELECT on indexed `created_at`，单次 < 1ms，总 < 30ms |
| 前端分页 cursor 跳变（list 期间数据变化） | 低 | 低 | MVP 用 page-based，不用 cursor；后续 Sub-C 加 mutation 后考虑 keyset |
| apiFetch envelope 改 breaking | 低 | 中 | 同步更新现有 2 个调用方（LoginPage + ProfilePage + DashboardPage） |

---

## 7. 测试策略

### 后端（vitest，integration）

新增 `tests/integration/admin-list-pagination.test.ts`：
1. `GET /v1/admin/users?page=1&pageSize=2` 返回 2 行 + pagination total=N
2. `GET /v1/admin/users?keyword=ali` 过滤 name LIKE '%ali%'
3. `GET /v1/admin/users?status=suspended` 仅返回 suspended
4. `GET /v1/admin/candidates?page=2&pageSize=10` 返回 offset=10 的 10 行
5. `GET /v1/admin/candidates?keyword=ali` JOIN users 过滤 name/contact
6. `GET /v1/admin/dashboard/stats` 响应含 `today_new_users: number` + `trend_30d: number[30]`
7. `trend_30d` 长度 === 30
8. `GET /v1/admin/users?pageSize=200` (over max 100) → 400 或 clamp 到 100
9. keyword empty string 不应过滤

更新 `tests/integration/admin-endpoints.test.ts`：
- 期望 `/users` 返回 `{ data, pagination }` envelope（不再是裸 array）

### 前端（vitest + jsdom + RTL）

`tests/api/client.test.ts` —— 5 tests
`tests/lib/format.test.ts` —— 7 tests
合计 12 tests。

---

## 8. 部署

### Build & ship

```bash
# 本地
cd /d/dev/hunter-platform
pnpm build                  # 后端 → out/main/
cd admin-web
pnpm test && pnpm build     # 前端 → ../out/admin/

# SCP
scp -r -i /d/Downloads/cc.pem out/main/* root@101.201.110.129:/opt/hunter-platform/out/main/
scp -r -i /d/Downloads/cc.pem out/admin/* root@101.201.110.129:/opt/hunter-platform/out/admin/

# 重启
ssh -i /d/Downloads/cc.pem root@101.201.110.129 'systemctl restart hunter-platform'

# 冒烟
ssh -i /d/Downloads/cc.pem root@101.201.110.129 'curl -s https://qing3.top/v1/admin/dashboard/stats -H "Authorization: Bearer $KEY" | jq .data.today_new_users'
```

### Nginx 无需变更（静态 SPA 路径不变）

---

## 9. 不在范围（YAGNI）

- ❌ 组件库（shadcn / Radix）— vanilla CSS 够用
- ❌ 图表库（recharts）— 自写 SVG sparkline
- ❌ i18n / 暗色模式
- ❌ 数据导出 CSV / 打印
- ❌ 高级筛选（日期范围、多选）
- ❌ 实时刷新 / SSE / WebSocket
- ❌ Inline 编辑（Sub-C 范围）
- ❌ Admin 用户 CRUD（Sub-E 范围）
- ❌ Audit log UI（Sub-D 范围）

---

## 10. 后续 Sub-projects（不在本 spec）

- **Sub-C**：操作面板（mutations: suspend/unsuspend/adjust-quota/remove-from-pool/mark-paid/cancel/retry）
- **Sub-D**：审计（audit + action-history + admin-log + webhooks/dead-letter）
- **Sub-E**：配置（config get/put + rate-limit buckets/clear + admin user CRUD）

---

## 参考

- [2026-06-23-web-admin-sub-A-design.md](2026-06-23-web-admin-sub-A-design.md) — Sub-A spec
- [2026-06-23-web-admin-sub-A-plan.md](../plans/2026-06-23-web-admin-sub-A-plan.md) — Sub-A plan（已执行）
- [2026-06-23-admin-action-history-endpoint-design.md](2026-06-23-admin-action-history-endpoint-design.md) — 同样的 envelope 模式参考
- `src/main/modules/admin/handlers/{users,candidates,dashboard}.ts` — 现有 handler
- `src/main/schemas/admin.ts` — zod schema 风格
- `admin-web/src/api/client.ts` — Sub-A apiFetch wrapper（将被扩展）
- `admin-web/src/components/Layout.tsx` — Sub-A nav（将加 2 个 Link）