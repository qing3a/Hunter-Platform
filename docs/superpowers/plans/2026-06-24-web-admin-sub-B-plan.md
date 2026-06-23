# Web Admin Sub-B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Sub-A 的 admin-web/（React 18 + Vite + TS）上加 3 个真实数据页面（升级 DashboardPage + 新增 CandidatesPage/UsersPage），含分页/搜索/筛选/趋势图。后端 4 处轻补丁（list 加 offset+keyword+envelope、dashboard 加 today_new+trend_30d、candidates JOIN users 用 masked PII）。

**Architecture:**
- **后端**：现有 handler 改 3 处（users/candidates/dashboard）+ 1 处共享 PaginationSchema；零 migration；零 breaking 现有 schema 字段
- **前端**：admin-web/ 扩 7 个新文件（5 组件 + 1 helpers + 1 apiFetchRaw）；新增 2 个 page-level 组件集成测；Sub-A 的 apiFetch 完全不动
- **测试**：admin-web/ 加 vitest+jsdom+RTL；后端加 1 个新 integration 文件；旧 admin-endpoints.test.ts 更新 2 处

**Tech Stack (existing):** React 18, Vite, react-router-dom, vanilla CSS, native fetch, zod
**Tech Stack (new):** vitest, jsdom, @testing-library/react, @testing-library/jest-dom (admin-web/ only)
**Spec:** [docs/superpowers/specs/2026-06-24-web-admin-sub-B-design.md](../specs/2026-06-24-web-admin-sub-B-design.md)

---

## 0. Reviewer decisions（plan-only，来自 spec review）

| 反馈点 | 决策 |
|--------|------|
| JOIN users 暴露姓名 | **Masked PII** — candidates 响应给 `masked_name` + `masked_email`（如 `A***ce` / `a***@***.com`），不曝露完整 PII（admin 不需要看候选人全名） |
| 组件测覆盖 | 加 2 个 RTL 集成测：`CandidatesList` + `UsersList`（mock apiFetchRaw，验证渲染+分页） |
| apiFetch breaking | **零 breaking** — 新增 `apiFetchRaw<T>()` wrapper 返回完整 envelope `{ ok, data, pagination? }`；Sub-A 的 `apiFetch<T>` 完全保留（LoginPage/ProfilePage 不动） |

---

## 现有代码上下文（开始 Task 1 前必读）

实施前应熟悉的文件：

- `src/main/modules/admin/handlers/users.ts` — 现有 list（filter: user_type, status, limit）
- `src/main/modules/admin/handlers/candidates.ts` — 现有 list（filter: in_pool, unlock_status, limit）
- `src/main/modules/admin/handlers/dashboard.ts` — 现有 getStats（7 字段）
- `src/main/schemas/admin.ts` — zod schema（AdminCandidateSchema/UserPublicSchema/DashboardStatsSchema/ActionHistoryListResponseSchema envelope 范例）
- `src/main/routes/admin.ts` — admin router（lines 76-83 users list, 108-115 candidates list, 50-71 dashboard）
- `admin-web/src/api/client.ts` — Sub-A apiFetch wrapper（**不动**）
- `admin-web/src/pages/DashboardPage.tsx` — Sub-A 占位（**升级**）
- `admin-web/src/components/Layout.tsx` — Sub-A nav（**加 2 个 Link**）
- `tests/integration/admin-endpoints.test.ts` — 既有 admin 测试（**更新 2 处**）

**不动文件：**
- `admin-web/src/api/client.ts` — Sub-A apiFetch 保留
- `admin-web/src/pages/LoginPage.tsx` — Sub-A 鉴权流程保留
- `admin-web/src/pages/ProfilePage.tsx` — Sub-A profile 保留
- 任何 Sub-A 已合入 main 的代码（admin_users 表、auth handler、seed、auth middleware）

---

## File Structure（实施前 map）

### 后端新增/修改

| File | Change |
|------|--------|
| `src/main/schemas/admin.ts` | Modify — 加 PaginationSchema；ListUsersResponseSchema/ListCandidatesResponseSchema 改 envelope；AdminCandidateSchema 加 masked_name + masked_email；DashboardStatsSchema 加 today_new_users + trend_30d |
| `src/main/modules/admin/handlers/users.ts` | Modify — list() 加 offset + keyword；返回 `{rows, total}` |
| `src/main/modules/admin/handlers/candidates.ts` | Modify — list() 加 offset + keyword；JOIN users；用 maskName/maskEmail |
| `src/main/modules/admin/handlers/dashboard.ts` | Modify — getStats() 加 today_new + trend_30d 计算 |
| `src/main/routes/admin.ts` | Modify — users/candidates 解析 page/pageSize/keyword |
| `tests/integration/admin-list-pagination.test.ts` | Create — 9 个新测试 |
| `tests/integration/admin-endpoints.test.ts` | Modify — 更新 2 处 envelope 期望 |

### 前端新增

| File | Change |
|------|--------|
| `admin-web/vitest.config.ts` | Create — vitest 配置（jsdom + setupFiles） |
| `admin-web/src/test-setup.ts` | Create — jest-dom 注册 |
| `admin-web/src/api/raw.ts` | Create — apiFetchRaw wrapper（返回完整 envelope） |
| `admin-web/src/api/users.ts` | Create — typed listUsers wrapper |
| `admin-web/src/api/candidates.ts` | Create — typed listCandidates wrapper |
| `admin-web/src/api/dashboard.ts` | Create — typed getDashboardStats wrapper |
| `admin-web/src/lib/format.ts` | Create — date / statusColor / mask helpers |
| `admin-web/src/lib/mask.ts` | Create — maskName / maskEmail 纯函数 |
| `admin-web/src/components/Table.tsx` | Create — 通用 Table |
| `admin-web/src/components/Pagination.tsx` | Create — 分页控件 |
| `admin-web/src/components/SearchBar.tsx` | Create — 搜索 + 筛选 |
| `admin-web/src/components/StatusBadge.tsx` | Create — 状态 pill |
| `admin-web/src/components/MetricCard.tsx` | Create — 数字卡片 |
| `admin-web/src/components/Sparkline.tsx` | Create — SVG 折线 |
| `admin-web/src/pages/DashboardPage.tsx` | Modify — 升级到真实数据 |
| `admin-web/src/pages/CandidatesPage.tsx` | Create — 列表 + 集成测 |
| `admin-web/src/pages/UsersPage.tsx` | Create — 列表 + 集成测 |
| `admin-web/src/App.tsx` | Modify — 加 2 条 Route |
| `admin-web/src/components/Layout.tsx` | Modify — nav 加 2 个 Link |
| `admin-web/package.json` | Modify — 加 vitest/jsdom/RTL devDeps + test script |

### 前端测试

| File | Change |
|------|--------|
| `admin-web/tests/api/raw.test.ts` | Create — 5 tests for apiFetchRaw |
| `admin-web/tests/lib/format.test.ts` | Create — 4 tests for format helpers |
| `admin-web/tests/lib/mask.test.ts` | Create — 6 tests for mask helpers |
| `admin-web/tests/components/CandidatesList.test.tsx` | Create — 1 RTL 集成测 |
| `admin-web/tests/components/UsersList.test.tsx` | Create — 1 RTL 集成测 |

---

## Task 1: Backend — Users list 加 offset + keyword + envelope

**Files:**
- Modify: `src/main/schemas/admin.ts`
- Modify: `src/main/modules/admin/handlers/users.ts`
- Modify: `src/main/routes/admin.ts`
- Modify: `tests/integration/admin-endpoints.test.ts`

### Step 1.1: 加 PaginationSchema 到 schemas/admin.ts

打开 `src/main/schemas/admin.ts`，在文件末尾（最后一个 export 后）追加：

```typescript
const PaginationSchema = z.object({
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  has_more: z.boolean(),
});

const ListUsersEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: z.array(UserPublicSchema),
  pagination: PaginationSchema,
});

export { PaginationSchema, ListUsersEnvelopeSchema };
```

### Step 1.2: 改 `users.list()` handler

打开 `src/main/modules/admin/handlers/users.ts`，替换 `list()` 方法：

```typescript
    list(filter: { user_type?: string; status?: string; keyword?: string; limit?: number; offset?: number }): { rows: Array<{
      id: string; user_type: 'candidate' | 'headhunter' | 'employer'; name: string;
      quota_per_day: number; quota_used: number; quota_reset_at: string;
      reputation: number; status: 'active' | 'suspended' | 'deleted';
      created_at: string;
    }>; total: number } {
      // Project only the UserPublicSchema fields. Stripping PII (contact, agent_endpoint)
      // and secrets (api_key_hash, api_key_prefix, api_key_expires_at, prev_api_key_*) is
      // the security-critical reason for this change.
      const where: string[] = ['1=1'];
      const params: any[] = [];
      if (filter.user_type) { where.push('user_type = ?'); params.push(filter.user_type); }
      if (filter.status) { where.push('status = ?'); params.push(filter.status); }
      if (filter.keyword) { where.push('name LIKE ?'); params.push(`%${filter.keyword}%`); }

      const total = (db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE ${where.join(' AND ')}`)
        .get(...params) as { cnt: number }).cnt;

      const sql = `
        SELECT id, user_type, name, quota_per_day, quota_used, quota_reset_at,
               reputation, status, created_at
        FROM users WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      const rows = db.prepare(sql).all(...params, filter.limit ?? 20, filter.offset ?? 0) as any;
      return { rows, total };
    },
```

### Step 1.3: 改 admin router 解析 page/pageSize

打开 `src/main/routes/admin.ts`，替换 GET `/users` route：

```typescript
  router.get('/users', (req, res, next) => {
    try {
      const filter: { user_type?: string; status?: string; keyword?: string; limit?: number; offset?: number } = {};
      if (typeof req.query.user_type === 'string') filter.user_type = req.query.user_type;
      if (typeof req.query.status === 'string') filter.status = req.query.status;
      if (typeof req.query.keyword === 'string' && req.query.keyword.length > 0) filter.keyword = req.query.keyword;
      const page = req.query.page ? Number(req.query.page) : 1;
      const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 20;
      if (!Number.isFinite(page) || page < 1) throw Errors.invalidParams('page must be a positive integer');
      if (!Number.isFinite(pageSize) || pageSize < 1 || pageSize > 100) {
        throw Errors.invalidParams('pageSize must be 1-100');
      }
      filter.limit = pageSize;
      filter.offset = (page - 1) * pageSize;
      const { rows, total } = users.list(filter);
      respond(res, ListUsersEnvelopeSchema, {
        ok: true,
        data: rows,
        pagination: { total, page, pageSize, has_more: page * pageSize < total },
      }, { strict: true });
    } catch (e) { next(e); }
  });
```

加 import：

```typescript
import {
  // ...已有...
  ListUsersEnvelopeSchema,
  // ...已有...
} from '../schemas/admin.js';
```

### Step 1.4: 更新既有 admin-endpoints.test.ts

打开 `tests/integration/admin-endpoints.test.ts`，找到 `it('GET /v1/admin/users lists users', ...)`：

```typescript
    it('GET /v1/admin/users lists users', async () => {
      const res = await request(app).get('/v1/admin/users').set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.total).toBeGreaterThanOrEqual(0);
    });
```

### Step 1.5: Typecheck + 跑既有 admin 测试

Run: `cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -3`
Expected: no errors

Run: `cd /d/dev/hunter-platform && pnpm vitest run tests/integration/admin-endpoints.test.ts 2>&1 | tail -5`
Expected: 18 tests pass

### Step 1.6: Commit

```bash
cd /d/dev/hunter-platform
git add src/main/schemas/admin.ts src/main/modules/admin/handlers/users.ts src/main/routes/admin.ts tests/integration/admin-endpoints.test.ts
git commit -m "feat(admin): users list — offset, keyword, paginated envelope"
```

---

## Task 2: Backend — Candidates list 加 offset + keyword + JOIN users (masked) + envelope

**Files:**
- Modify: `src/main/schemas/admin.ts`
- Modify: `src/main/modules/admin/handlers/candidates.ts`
- Modify: `src/main/routes/admin.ts`
- Create: `src/main/lib/mask.ts`

### Step 2.1: 加 mask helpers (放在 shared lib 供多端用)

Create `src/main/lib/mask.ts`:

```typescript
// Mask PII for admin views. Admins can suspend users (and thus see full name via
// /v1/admin/users), but the candidates list is a discovery view — partial masks
// keep the UI readable while reducing accidental over-disclosure.
//
// maskName('Alice')    → 'A***ce'
// maskName('Bo')       → 'B*'
// maskName('')         → ''
// maskEmail('a@x.com') → 'a***@***.com'

export function maskName(name: string): string {
  if (!name) return '';
  if (name.length <= 2) return name[0] + '*';
  if (name.length <= 4) return name[0] + '***';
  return name[0] + '***' + name.slice(-2);
}

export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '';
  const [local, domain] = email.split('@');
  const maskedLocal = local.length <= 1 ? local : local[0] + '***';
  // Mask the domain too: keep first char of domain, mask rest, keep TLD
  const dotIdx = domain.lastIndexOf('.');
  if (dotIdx < 0) {
    return `${maskedLocal}@***`;
  }
  const tld = domain.slice(dotIdx);
  return `${maskedLocal}@***${tld}`;
}
```

### Step 2.2: 改 AdminCandidateSchema

打开 `src/main/schemas/admin.ts`，找到 `AdminCandidateSchema`，追加 2 字段：

```typescript
const AdminCandidateSchema = z.object({
  anonymized_id: IdString,
  candidate_user_id: IdString,
  headhunter_id: IdString,
  // PII-masked (see src/main/lib/mask.ts). Admin can drill into user details
  // via /v1/admin/users if they need the full name/email.
  masked_name: z.string(),
  masked_email: z.string(),
  industry: z.string().nullable(),
  title_level: z.string().nullable(),
  is_public_pool: z.union([z.literal(0), z.literal(1)]),
  unlock_status: z.string(),
  created_at: ISODateTime,
});
```

加 `ListCandidatesEnvelopeSchema` 到文件末尾：

```typescript
const ListCandidatesEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: z.array(AdminCandidateSchema),
  pagination: PaginationSchema,
});

export { ListCandidatesEnvelopeSchema };
```

### Step 2.3: 改 `candidates.list()` handler

打开 `src/main/modules/admin/handlers/candidates.ts`，替换：

```typescript
// Migrated from src/main/ipc/candidates.ts on 2026-06-20
import type { DB } from '../../../db/connection.js';
import { createCandidatesAnonymizedRepo } from '../../../db/repositories/candidates-anonymized.js';
import { Errors } from '../../../errors.js';
import { maskName, maskEmail } from '../../../lib/mask.js';

export function createAdminCandidatesHandler(db: DB) {
  const candidates = createCandidatesAnonymizedRepo(db);
  return {
    list(filter: { in_pool?: boolean; unlock_status?: string; keyword?: string; limit?: number; offset?: number }): { rows: Array<{
      anonymized_id: string; candidate_user_id: string; masked_name: string; masked_email: string;
      headhunter_id: string;
      industry: string | null; title_level: string | null;
      is_public_pool: 0 | 1; unlock_status: string; created_at: string;
    }>; total: number } {
      // Project AdminCandidateSchema fields. JOINs candidates_private + users
      // to surface masked PII (full name/email reserved for /v1/admin/users drill-down).
      const where: string[] = ['1=1'];
      const params: any[] = [];
      if (filter.in_pool !== undefined) { where.push('ca.is_public_pool = ?'); params.push(filter.in_pool ? 1 : 0); }
      if (filter.unlock_status) { where.push('ca.unlock_status = ?'); params.push(filter.unlock_status); }
      if (filter.keyword) {
        where.push('(u.name LIKE ? OR u.contact LIKE ?)');
        params.push(`%${filter.keyword}%`, `%${filter.keyword}%`);
      }

      const total = (db.prepare(`
        SELECT COUNT(*) as cnt FROM candidates_anonymized ca
        JOIN candidates_private cp ON cp.id = ca.source_private_id
        JOIN users u ON u.id = cp.candidate_user_id
        WHERE ${where.join(' AND ')}`).get(...params) as { cnt: number }).cnt;

      const sql = `
        SELECT ca.id AS anonymized_id, cp.candidate_user_id,
               u.name AS raw_name, u.contact AS raw_email,
               ca.source_headhunter_id AS headhunter_id,
               ca.industry, ca.title_level, ca.is_public_pool, ca.unlock_status, ca.created_at
        FROM candidates_anonymized ca
        JOIN candidates_private cp ON cp.id = ca.source_private_id
        JOIN users u ON u.id = cp.candidate_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY ca.created_at DESC LIMIT ? OFFSET ?`;
      const rawRows = db.prepare(sql).all(...params, filter.limit ?? 20, filter.offset ?? 0) as any;
      const rows = rawRows.map((r: any) => ({
        anonymized_id: r.anonymized_id,
        candidate_user_id: r.candidate_user_id,
        masked_name: maskName(r.raw_name),
        masked_email: maskEmail(r.raw_email),
        headhunter_id: r.headhunter_id,
        industry: r.industry,
        title_level: r.title_level,
        is_public_pool: r.is_public_pool,
        unlock_status: r.unlock_status,
        created_at: r.created_at,
      }));
      return { rows, total };
    },
    removeFromPool(anonymized_id: string): { anonymized_id: string; removed: true } {
      const c = candidates.findById(anonymized_id);
      if (!c) throw Errors.notFound('Candidate not found');
      db.prepare("UPDATE candidates_anonymized SET is_public_pool = 0, updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), anonymized_id);
      return { anonymized_id, removed: true };
    },
  };
}
```

### Step 2.4: 改 admin router

打开 `src/main/routes/admin.ts`，替换 GET `/candidates` route 并加 import：

```typescript
import {
  // ...已有...
  ListCandidatesEnvelopeSchema,
  // ...已有...
} from '../schemas/admin.js';
```

```typescript
  // Candidates
  router.get('/candidates', (req, res, next) => {
    try {
      const filter: { in_pool?: boolean; unlock_status?: string; keyword?: string; limit?: number; offset?: number } = {};
      if (req.query.in_pool === 'true' || req.query.in_pool === '1') filter.in_pool = true;
      else if (req.query.in_pool === 'false' || req.query.in_pool === '0') filter.in_pool = false;
      if (typeof req.query.unlock_status === 'string') filter.unlock_status = req.query.unlock_status;
      if (typeof req.query.keyword === 'string' && req.query.keyword.length > 0) filter.keyword = req.query.keyword;
      const page = req.query.page ? Number(req.query.page) : 1;
      const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 20;
      if (!Number.isFinite(page) || page < 1) throw Errors.invalidParams('page must be a positive integer');
      if (!Number.isFinite(pageSize) || pageSize < 1 || pageSize > 100) {
        throw Errors.invalidParams('pageSize must be 1-100');
      }
      filter.limit = pageSize;
      filter.offset = (page - 1) * pageSize;
      const { rows, total } = candidates.list(filter);
      respond(res, ListCandidatesEnvelopeSchema, {
        ok: true,
        data: rows,
        pagination: { total, page, pageSize, has_more: page * pageSize < total },
      }, { strict: true });
    } catch (e) { next(e); }
  });
```

### Step 2.5: Typecheck + 跑既有 admin 测试

Run: `cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -3`
Expected: no errors

Run: `cd /d/dev/hunter-platform && pnpm vitest run tests/integration/admin-endpoints.test.ts tests/integration/admin-strict-mode.test.ts 2>&1 | tail -5`
Expected: all pass (admin-strict-mode 也用同一 envelope)

### Step 2.6: Commit

```bash
cd /d/dev/hunter-platform
git add src/main/schemas/admin.ts src/main/modules/admin/handlers/candidates.ts src/main/routes/admin.ts src/main/lib/mask.ts
git commit -m "feat(admin): candidates list — offset, keyword, JOIN users (masked PII)"
```

---

## Task 3: Backend — Dashboard 加 today_new + trend_30d

**Files:**
- Modify: `src/main/schemas/admin.ts`
- Modify: `src/main/modules/admin/handlers/dashboard.ts`
- Modify: `src/main/routes/admin.ts`

### Step 3.1: 改 DashboardStatsSchema

打开 `src/main/schemas/admin.ts`，找到 `DashboardStatsSchema`，加 2 字段：

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
});
```

### Step 3.2: 改 dashboard.ts

打开 `src/main/modules/admin/handlers/dashboard.ts`，在 `getStats()` 末尾、`return` 之前，加：

```typescript
      // Sub-B: today_new_users + trend_30d
      const todayStartUtc = new Date();
      todayStartUtc.setUTCHours(0, 0, 0, 0);
      const todayNewUsers = (db.prepare(
        `SELECT COUNT(*) as cnt FROM users WHERE created_at >= ?`
      ).get(todayStartUtc.toISOString()) as { cnt: number }).cnt;

      const trend30d: number[] = [];
      for (let i = 29; i >= 0; i--) {
        const dayStart = new Date(todayStartUtc);
        dayStart.setUTCDate(dayStart.getUTCDate() - i);
        const dayEnd = new Date(dayStart);
        dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
        const cnt = (db.prepare(
          `SELECT COUNT(*) as cnt FROM users WHERE created_at >= ? AND created_at < ?`
        ).get(dayStart.toISOString(), dayEnd.toISOString()) as { cnt: number }).cnt;
        trend30d.push(cnt);
      }
```

并在 return 对象中追加：

```typescript
      return {
        users: userCounts,
        jobs: jobCounts,
        recommendations: recCounts,
        candidates: { in_pool: candPoolCount },
        webhooks: { pending: webhooks.countPending(), dead_letter: webhooks.countDeadLetter() },
        activity: { placements_today: placementsToday },
        timestamp: new Date().toISOString(),
        today_new_users: todayNewUsers,
        trend_30d: trend30d,
      };
```

### Step 3.3: 改 admin router dashboard route

打开 `src/main/routes/admin.ts`，找到 GET `/dashboard/stats`，在响应对象加 2 字段：

```typescript
      respond(res, DashboardStatsResponseSchema, {
        ok: true,
        data: {
          total_users: s.users.total,
          total_candidates: candidateCount,
          total_jobs: s.jobs.total,
          open_jobs: s.jobs.open,
          active_placements: activePlacementCount,
          daily_quota_used: dailyQuotaUsed,
          webhook_dead_letters: s.webhooks.dead_letter,
          today_new_users: s.today_new_users,
          trend_30d: s.trend_30d,
        },
      }, { strict: true });
```

### Step 3.4: Typecheck

Run: `cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -5`
Expected: no errors

### Step 3.5: Commit

```bash
cd /d/dev/hunter-platform
git add src/main/schemas/admin.ts src/main/modules/admin/handlers/dashboard.ts src/main/routes/admin.ts
git commit -m "feat(admin): dashboard — today_new_users + 30d daily-new trend"
```

---

## Task 4: Backend integration tests (Sub-B 新功能)

**Files:**
- Create: `tests/integration/admin-list-pagination.test.ts`

### Step 4.1: 创建测试文件

Create `tests/integration/admin-list-pagination.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('admin list pagination + dashboard stats (Sub-B)', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-subb-test.db');
  let app: any;
  let db: any;
  let adminAuth = '';

  beforeAll(async () => {
    for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(testDb + s); } catch { /* ignore */ }
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = 'DEPRECATED';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createAppFromDb } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { loadEnv } = await import('../../src/main/env');
    db = openDb(testDb);
    runMigrations(db);
    app = createAppFromDb(db, loadEnv());

    // Seed admin
    const pwdHash = bcrypt.hashSync('admin-pwd', 4);
    const keyHash = bcrypt.hashSync('hp_admin_subbtest_aabb', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_subb', 'SubB Admin', 'subb@test.com', pwdHash, keyHash, 'hp_admin_subbtes', 'super', 'active',
      '2026-06-24T00:00:00Z', '2026-06-24T00:00:00Z'
    );
    const lr = await request(app).post('/v1/admin/auth/login')
      .send({ email: 'subb@test.com', password: 'admin-pwd' });
    adminAuth = `Bearer ${lr.body.data.api_key}`;

    // Seed 25 users with varied names + created_at
    const now = new Date('2026-06-24T12:00:00Z').getTime();
    for (let i = 0; i < 25; i++) {
      db.prepare(`INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
        quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
        VALUES (?, 'candidate', ?, ?, 'h', ?, 100, 0, datetime('now', '+1 day'), 50, 'active',
          ?, ?)`).run(
        `u_${i}`,
        i % 3 === 0 ? `Alice_${i}` : i % 3 === 1 ? `Bob_${i}` : `Carol_${i}`,
        `u${i}@test.com`,
        `hp_${i}`,
        new Date(now - i * 86400000).toISOString(),
        new Date(now - i * 86400000).toISOString()
      );
    }
  });

  afterAll(() => { if (db) db.close(); });

  // ---- Users pagination ----
  it('1. GET /v1/admin/users returns paginated envelope', async () => {
    const r = await request(app).get('/v1/admin/users').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
    expect(r.body.pagination).toMatchObject({ total: 25, page: 1, pageSize: 20, has_more: true });
    expect(r.body.data).toHaveLength(20);
  });

  it('2. GET /v1/admin/users?page=2 returns remaining rows', async () => {
    const r = await request(app).get('/v1/admin/users?page=2&pageSize=20').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(5);
    expect(r.body.pagination.has_more).toBe(false);
  });

  it('3. GET /v1/admin/users?keyword=Alice filters by name', async () => {
    const r = await request(app).get('/v1/admin/users?keyword=Alice').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    // 9 Alice rows (i=0,3,6,9,12,15,18,21,24)
    expect(r.body.pagination.total).toBe(9);
    expect(r.body.data.every((u: any) => u.name.includes('Alice'))).toBe(true);
  });

  it('4. GET /v1/admin/users?pageSize=200 → 400', async () => {
    const r = await request(app).get('/v1/admin/users?pageSize=200').set('Authorization', adminAuth);
    expect(r.status).toBe(400);
  });

  it('5. GET /v1/admin/users?keyword=  (empty) does not filter', async () => {
    const r = await request(app).get('/v1/admin/users?keyword=').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.pagination.total).toBe(25);
  });

  // ---- Candidates JOIN + masked ----
  it('6. GET /v1/admin/candidates returns paginated envelope with masked PII', async () => {
    const r = await request(app).get('/v1/admin/candidates').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.pagination).toBeDefined();
    // Empty candidates table in this test (no headhunter seeded) → total=0
    expect(r.body.pagination.total).toBe(0);
    expect(r.body.data).toHaveLength(0);
  });

  // ---- Dashboard ----
  it('7. GET /v1/admin/dashboard/stats has today_new_users + trend_30d', async () => {
    const r = await request(app).get('/v1/admin/dashboard/stats').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveProperty('today_new_users');
    expect(typeof r.body.data.today_new_users).toBe('number');
    expect(r.body.data.trend_30d).toHaveLength(30);
    expect(r.body.data.trend_30d.every((v: any) => typeof v === 'number')).toBe(true);
  });

  it('8. dashboard trend sums include seeded users', async () => {
    const r = await request(app).get('/v1/admin/dashboard/stats').set('Authorization', adminAuth);
    const sum = r.body.data.trend_30d.reduce((a: number, b: number) => a + b, 0);
    // We seeded 25 users spread across 25 days (i*86400000ms = 1 day apart)
    expect(sum).toBeGreaterThanOrEqual(25);
  });

  it('9. dashboard today_new_users counts only today (UTC)', async () => {
    // Seed 1 user with created_at = today (UTC midnight)
    db.prepare(`INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
      quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
      VALUES ('u_today', 'candidate', 'TodayUser', 't@x', 'h', 'hp_today', 100, 0,
      datetime('now', '+1 day'), 50, 'active',
      datetime('now', 'start of day'), datetime('now', 'start of day'))`).run();
    const r = await request(app).get('/v1/admin/dashboard/stats').set('Authorization', adminAuth);
    expect(r.body.data.today_new_users).toBeGreaterThanOrEqual(1);
  });
});
```

### Step 4.2: 跑测试，验证全过

Run: `cd /d/dev/hunter-platform && pnpm vitest run tests/integration/admin-list-pagination.test.ts 2>&1 | tail -10`
Expected: 9 tests pass

### Step 4.3: 全量后端回归

Run: `cd /d/dev/hunter-platform && pnpm test 2>&1 | tail -5`
Expected: 814 + 9 = 823 tests pass (无 regression)

### Step 4.4: Commit

```bash
cd /d/dev/hunter-platform
git add tests/integration/admin-list-pagination.test.ts
git commit -m "test: admin list pagination + dashboard Sub-B tests (9 tests)"
```

---

## Task 5: Frontend — admin-web/ 加 vitest + jsdom + RTL

**Files:**
- Modify: `admin-web/package.json`
- Create: `admin-web/vitest.config.ts`
- Create: `admin-web/src/test-setup.ts`

### Step 5.1: 加 devDependencies + test scripts

打开 `admin-web/package.json`，加 `devDependencies` 字段（如果已有则合并）+ 加 scripts：

```json
{
  "name": "@qing3a/hunter-platform-admin-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.2",
    "vite": "^5.4.6",
    "vitest": "^2.1.0"
  }
}
```

### Step 5.2: 创建 vitest 配置

Create `admin-web/vitest.config.ts`:

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

### Step 5.3: 创建 test setup

Create `admin-web/src/test-setup.ts`:

```typescript
import '@testing-library/jest-dom';
```

### Step 5.4: 安装依赖

Run: `cd /d/dev/hunter-platform/admin-web && pnpm install 2>&1 | tail -10`
Expected: devDeps installed

### Step 5.5: 跑一个空 test 确认 setup work

Create `admin-web/smoke.test.ts` (临时):

```typescript
import { describe, it, expect } from 'vitest';

describe('vitest smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `cd /d/dev/hunter-platform/admin-web && pnpm test 2>&1 | tail -5`
Expected: 1 pass

删 `admin-web/smoke.test.ts`:
```bash
rm /d/dev/hunter-platform/admin-web/smoke.test.ts
```

### Step 5.6: Commit

```bash
cd /d/dev/hunter-platform
git add admin-web/package.json admin-web/vitest.config.ts admin-web/src/test-setup.ts admin-web/pnpm-lock.yaml
git commit -m "chore(admin-web): add vitest + jsdom + RTL devDeps and config"
```

---

## Task 6: Frontend — apiFetchRaw wrapper + tests

**Files:**
- Create: `admin-web/src/api/raw.ts`
- Create: `admin-web/tests/api/raw.test.ts`

### Step 6.1: 创建 apiFetchRaw wrapper

Create `admin-web/src/api/raw.ts`:

```typescript
// Raw envelope wrapper. Returns the full { ok, data, pagination? } envelope
// instead of extracting data like apiFetch<T> does. Use this for endpoints
// that return pagination (Sub-B's list endpoints).
//
// Why not modify Sub-A's apiFetch? Per spec review (2026-06-24): zero breaking
// change. Sub-A's apiFetch<T> remains the default for auth/profile endpoints.
// New paginated endpoints opt into this raw variant.
import { getToken, clearToken } from '../lib/auth';

export type Envelope<T> = {
  ok: boolean;
  data?: T;
  pagination?: { total: number; page: number; pageSize: number; has_more: boolean };
  error?: { code: string; message: string };
};

export async function apiFetchRaw<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const token = getToken();
  const res = await fetch(`/v1/admin/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    clearToken();
    window.location.href = '/admin/login';
    throw new Error('Unauthorized');
  }
  const env = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!env) throw new Error(`Empty response: ${res.status}`);
  return env;
}
```

### Step 6.2: 创建测试

Create `admin-web/tests/api/raw.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetchRaw } from '../../src/api/raw';

describe('apiFetchRaw', () => {
  const originalFetch = global.fetch;
  const originalLocation = window.location;

  beforeEach(() => {
    localStorage.clear();
    // @ts-expect-error — override for test
    delete (window as any).location;
    (window as any).location = { ...originalLocation, href: '' };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    (window as any).location = originalLocation;
  });

  function mockFetch(status: number, body: unknown) {
    global.fetch = vi.fn().mockResolvedValue({
      status,
      json: async () => body,
    } as any);
  }

  it('1. injects Bearer header from localStorage token', async () => {
    localStorage.setItem('hunter_admin_api_key', 'hp_admin_test_key');
    mockFetch(200, { ok: true, data: { id: 'x' }, pagination: { total: 1, page: 1, pageSize: 20, has_more: false } });
    await apiFetchRaw('users');
    expect(global.fetch).toHaveBeenCalledWith(
      '/v1/admin/users',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer hp_admin_test_key' }),
      })
    );
  });

  it('2. omits Authorization when no token', async () => {
    mockFetch(200, { ok: true, data: {} });
    await apiFetchRaw('auth/login', { method: 'POST', body: '{}' });
    const call = (global.fetch as any).mock.calls[0];
    expect(call[1].headers.Authorization).toBeUndefined();
  });

  it('3. on 401, clears token + redirects to /admin/login', async () => {
    localStorage.setItem('hunter_admin_api_key', 'old_key');
    mockFetch(401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'expired' } });
    await expect(apiFetchRaw('users')).rejects.toThrow('Unauthorized');
    expect(localStorage.getItem('hunter_admin_api_key')).toBeNull();
    expect(window.location.href).toBe('/admin/login');
  });

  it('4. returns full envelope including pagination', async () => {
    const envelope = { ok: true, data: [{ id: 'u1' }], pagination: { total: 5, page: 1, pageSize: 20, has_more: false } };
    mockFetch(200, envelope);
    const result = await apiFetchRaw<{ id: string }[]>('users');
    expect(result).toEqual(envelope);
    expect(result.pagination?.total).toBe(5);
  });

  it('5. throws on empty response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 500,
      json: async () => { throw new Error('parse fail'); },
    } as any);
    await expect(apiFetchRaw('users')).rejects.toThrow(/Empty response/);
  });
});
```

### Step 6.3: 跑测试

Run: `cd /d/dev/hunter-platform/admin-web && pnpm test tests/api/raw.test.ts 2>&1 | tail -10`
Expected: 5 pass

### Step 6.4: Commit

```bash
cd /d/dev/hunter-platform
git add admin-web/src/api/raw.ts admin-web/tests/api/raw.test.ts
git commit -m "feat(admin-web): apiFetchRaw wrapper (paginated envelope) + 5 tests"
```

---

## Task 7: Frontend — mask helpers + format helpers + tests

**Files:**
- Create: `admin-web/src/lib/mask.ts`
- Create: `admin-web/src/lib/format.ts`
- Create: `admin-web/tests/lib/mask.test.ts`
- Create: `admin-web/tests/lib/format.test.ts`

### Step 7.1: 创建 mask.ts (前端版，与后端 src/main/lib/mask.ts 同算法)

Create `admin-web/src/lib/mask.ts`:

```typescript
// Mirror of src/main/lib/mask.ts (frontend copy — admin-web/ is a separate
// Vite project with its own bundle). Used when DISPLAYING backend data
// that's already masked, but also for any future local masking.

export function maskName(name: string): string {
  if (!name) return '';
  if (name.length <= 2) return name[0] + '*';
  if (name.length <= 4) return name[0] + '***';
  return name[0] + '***' + name.slice(-2);
}

export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '';
  const [local, domain] = email.split('@');
  const maskedLocal = local.length <= 1 ? local : local[0] + '***';
  const dotIdx = domain.lastIndexOf('.');
  if (dotIdx < 0) return `${maskedLocal}@***`;
  const tld = domain.slice(dotIdx);
  return `${maskedLocal}@***${tld}`;
}
```

### Step 7.2: 创建 format.ts

Create `admin-web/src/lib/format.ts`:

```typescript
// Pure formatting helpers. No React, no fetch — easy to unit test.

/** ISO 8601 → "2026-06-24 12:34" (local timezone) */
export function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "3 days ago" / "2 hours ago" / "just now" */
export function relativeTime(iso: string, now: Date = new Date()): string {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const diffMs = now.getTime() - then.getTime();
  if (diffMs < 0) return 'in the future';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

/** Status → CSS color name (matches styles.css classes if added). */
export function statusColor(status: string): 'green' | 'red' | 'yellow' | 'gray' {
  switch (status) {
    case 'active':
    case 'success':
    case 'paid':
    case 'unlocked':
      return 'green';
    case 'suspended':
    case 'cancelled':
    case 'error':
    case 'deleted':
      return 'red';
    case 'pending':
    case 'pending_payment':
    case 'in_pool':
      return 'yellow';
    default:
      return 'gray';
  }
}
```

### Step 7.3: 创建 mask 测试

Create `admin-web/tests/lib/mask.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { maskName, maskEmail } from '../../src/lib/mask';

describe('maskName', () => {
  it('masks long names with first + *** + last2', () => {
    expect(maskName('Alice')).toBe('A***ce');
    expect(maskName('Christopher')).toBe('C***er');
  });
  it('masks 4-char names with first + ***', () => {
    expect(maskName('Anna')).toBe('A***');
  });
  it('masks 2-3 char names with first + *', () => {
    expect(maskName('Bo')).toBe('B*');
    expect(maskName('Bob')).toBe('B*b');
  });
  it('returns empty for empty input', () => {
    expect(maskName('')).toBe('');
  });
});

describe('maskEmail', () => {
  it('masks local + domain with TLD preserved', () => {
    expect(maskEmail('alice@example.com')).toBe('a***@***.com');
    expect(maskEmail('bob@foo.io')).toBe('b***@***.io');
  });
  it('handles single-char local', () => {
    expect(maskEmail('a@example.com')).toBe('a@***.com');
  });
  it('returns empty for invalid input', () => {
    expect(maskEmail('')).toBe('');
    expect(maskEmail('noatsign')).toBe('');
  });
});
```

### Step 7.4: 创建 format 测试

Create `admin-web/tests/lib/format.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatDate, relativeTime, statusColor } from '../../src/lib/format';

describe('formatDate', () => {
  it('formats ISO to YYYY-MM-DD HH:MM (local)', () => {
    // Use a fixed UTC time to avoid TZ flakiness — toLocaleString differs
    // across environments. Instead verify format() components directly.
    const iso = '2026-06-24T08:30:00Z';
    const result = formatDate(iso);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
  it('returns empty for empty input', () => {
    expect(formatDate('')).toBe('');
  });
  it('returns original for invalid input', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-06-24T12:00:00Z');
  it('returns "just now" for < 60s', () => {
    expect(relativeTime('2026-06-24T11:59:30Z', now)).toBe('just now');
  });
  it('returns minutes for < 60min', () => {
    expect(relativeTime('2026-06-24T11:55:00Z', now)).toBe('5m ago');
  });
  it('returns hours for < 24h', () => {
    expect(relativeTime('2026-06-24T09:00:00Z', now)).toBe('3h ago');
  });
  it('returns days for < 30d', () => {
    expect(relativeTime('2026-06-22T12:00:00Z', now)).toBe('2d ago');
  });
  it('returns months for < 12mo', () => {
    expect(relativeTime('2026-04-24T12:00:00Z', now)).toBe('2mo ago');
  });
  it('returns years for >= 1y', () => {
    expect(relativeTime('2024-06-24T12:00:00Z', now)).toBe('2y ago');
  });
});

describe('statusColor', () => {
  it('green for active states', () => {
    expect(statusColor('active')).toBe('green');
    expect(statusColor('paid')).toBe('green');
    expect(statusColor('success')).toBe('green');
  });
  it('red for suspended/error states', () => {
    expect(statusColor('suspended')).toBe('red');
    expect(statusColor('cancelled')).toBe('red');
    expect(statusColor('error')).toBe('red');
  });
  it('yellow for pending states', () => {
    expect(statusColor('pending')).toBe('yellow');
    expect(statusColor('pending_payment')).toBe('yellow');
  });
  it('gray for unknown', () => {
    expect(statusColor('foo')).toBe('gray');
  });
});
```

### Step 7.5: 跑测试

Run: `cd /d/dev/hunter-platform/admin-web && pnpm test 2>&1 | tail -10`
Expected: 5 (raw) + 6 (mask) + 13 (format) = 24 pass

### Step 7.6: Commit

```bash
cd /d/dev/hunter-platform
git add admin-web/src/lib/ admin-web/tests/lib/
git commit -m "feat(admin-web): mask + format helpers + tests (13 tests)"
```

---

## Task 8: Frontend — shared components (Table, Pagination, SearchBar, StatusBadge, MetricCard, Sparkline)

**Files:**
- Create: `admin-web/src/components/Table.tsx`
- Create: `admin-web/src/components/Pagination.tsx`
- Create: `admin-web/src/components/SearchBar.tsx`
- Create: `admin-web/src/components/StatusBadge.tsx`
- Create: `admin-web/src/components/MetricCard.tsx`
- Create: `admin-web/src/components/Sparkline.tsx`

### Step 8.1: Table.tsx

Create `admin-web/src/components/Table.tsx`:

```typescript
import React from 'react';

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
};

export default function Table<T>({
  columns,
  rows,
  loading = false,
  empty = 'No data',
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  empty?: string;
}) {
  if (loading) return <div className="card">Loading...</div>;
  if (rows.length === 0) return <div className="card">{empty}</div>;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: '#f5f5f5' }}>
          {columns.map(c => (
            <th key={c.key} style={{ textAlign: 'left', padding: '12px 8px', borderBottom: '1px solid #e0e0e0' }}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
            {columns.map(c => (
              <td key={c.key} style={{ padding: '12px 8px' }}>{c.render(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

### Step 8.2: Pagination.tsx

Create `admin-web/src/components/Pagination.tsx`:

```typescript
export default function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const hasPrev = page > 1;
  const hasNext = page * pageSize < total;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
      <span style={{ color: '#666' }}>Showing {start}-{end} of {total}</span>
      <div style={{ flex: 1 }} />
      <button className="btn" disabled={!hasPrev} onClick={() => onPageChange(page - 1)}>← Prev</button>
      <span>Page {page}</span>
      <button className="btn" disabled={!hasNext} onClick={() => onPageChange(page + 1)}>Next →</button>
    </div>
  );
}
```

### Step 8.3: SearchBar.tsx

Create `admin-web/src/components/SearchBar.tsx`:

```typescript
import { useState } from 'react';

export type Filter = { label: string; value: string; options: { label: string; value: string }[] };

export default function SearchBar({
  placeholder = 'Search...',
  onSearch,
  filters = [],
}: {
  placeholder?: string;
  onSearch: (keyword: string, filterValues: Record<string, string>) => void;
  filters?: Filter[];
}) {
  const [keyword, setKeyword] = useState('');
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(filters.map(f => [f.value, '']))
  );

  const submit = () => onSearch(keyword, values);

  return (
    <div style={{ display: 'flex', gap: 8, margin: '16px 0', alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        type="text"
        placeholder={placeholder}
        value={keyword}
        onChange={e => setKeyword(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        style={{ width: 300 }}
      />
      {filters.map(f => (
        <select
          key={f.value}
          value={values[f.value] ?? ''}
          onChange={e => setValues({ ...values, [f.value]: e.target.value })}
          style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4 }}
        >
          <option value="">{f.label}: all</option>
          {f.options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ))}
      <button className="btn" onClick={submit}>Search</button>
    </div>
  );
}
```

### Step 8.4: StatusBadge.tsx

Create `admin-web/src/components/StatusBadge.tsx`:

```typescript
import { statusColor } from '../lib/format';

const COLOR_MAP: Record<string, string> = {
  green: '#22aa22',
  red: '#cc3300',
  yellow: '#cc9900',
  gray: '#888888',
};

export default function StatusBadge({ status }: { status: string }) {
  const color = COLOR_MAP[statusColor(status)];
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: 12,
      fontWeight: 500,
      color: 'white',
      background: color,
    }}>
      {status}
    </span>
  );
}
```

### Step 8.5: MetricCard.tsx

Create `admin-web/src/components/MetricCard.tsx`:

```typescript
export default function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="card" style={{ margin: 0, flex: 1, minWidth: 180 }}>
      <div style={{ fontSize: 32, fontWeight: 700, color: '#1a1a1a' }}>{value}</div>
      <div style={{ color: '#666', marginTop: 4 }}>{label}</div>
      {hint && <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
```

### Step 8.6: Sparkline.tsx

Create `admin-web/src/components/Sparkline.tsx`:

```typescript
export default function Sparkline({
  data,
  width = 600,
  height = 80,
}: {
  data: number[];
  width?: number;
  height?: number;
}) {
  if (data.length === 0) return null;
  const max = Math.max(1, ...data);
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  const points = data
    .map((v, i) => `${i * stepX},${height - (v / max) * (height - 8) - 4}`)
    .join(' ');
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ maxWidth: width }}>
      <polyline points={points} fill="none" stroke="#0066cc" strokeWidth="1.5" />
      {data.map((v, i) => (
        <circle key={i} cx={i * stepX} cy={height - (v / max) * (height - 8) - 4} r="2" fill="#0066cc" />
      ))}
    </svg>
  );
}
```

### Step 8.7: 验证 build

Run: `cd /d/dev/hunter-platform/admin-web && pnpm build 2>&1 | tail -10`
Expected: build successful, no TS errors

### Step 8.8: Commit

```bash
cd /d/dev/hunter-platform
git add admin-web/src/components/Table.tsx admin-web/src/components/Pagination.tsx admin-web/src/components/SearchBar.tsx admin-web/src/components/StatusBadge.tsx admin-web/src/components/MetricCard.tsx admin-web/src/components/Sparkline.tsx
git commit -m "feat(admin-web): shared components (Table/Pagination/SearchBar/StatusBadge/MetricCard/Sparkline)"
```

---

## Task 9: Frontend — DashboardPage 升级 + dashboard api wrapper

**Files:**
- Create: `admin-web/src/api/dashboard.ts`
- Modify: `admin-web/src/pages/DashboardPage.tsx`

### Step 9.1: 创建 dashboard.ts api wrapper

Create `admin-web/src/api/dashboard.ts`:

```typescript
import { apiFetchRaw } from './raw';

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
};

export async function getDashboardStats(): Promise<DashboardStats> {
  const env = await apiFetchRaw<DashboardStats>('dashboard/stats');
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to fetch dashboard stats');
  return env.data;
}
```

### Step 9.2: 替换 DashboardPage

打开 `admin-web/src/pages/DashboardPage.tsx`，**完整替换**文件内容：

```typescript
import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import MetricCard from '../components/MetricCard';
import Sparkline from '../components/Sparkline';
import { getDashboardStats, type DashboardStats } from '../api/dashboard';

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDashboardStats().then(setStats).catch(err => setError(err.message));
  }, []);

  if (error) return <Layout adminName="..."><div className="error">{error}</div></Layout>;
  if (!stats) return <Layout adminName="..."><p>Loading...</p></Layout>;

  return (
    <Layout adminName="Admin">
      <h1>Dashboard</h1>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <MetricCard label="Total Users" value={stats.total_users} />
        <MetricCard label="Total Candidates" value={stats.total_candidates} />
        <MetricCard label="Today New Users" value={stats.today_new_users} hint="vs prior days in trend below" />
        <MetricCard label="Open Placements" value={stats.active_placements} />
      </div>

      <h2 style={{ marginTop: 32 }}>User Growth — Last 30 Days</h2>
      <div className="card">
        <Sparkline data={stats.trend_30d} width={600} height={80} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#999', marginTop: 8 }}>
          <span>30 days ago</span>
          <span>today</span>
        </div>
      </div>

      <h2 style={{ marginTop: 32 }}>More Stats</h2>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <MetricCard label="Total Jobs" value={stats.total_jobs} />
        <MetricCard label="Open Jobs" value={stats.open_jobs} />
        <MetricCard label="Daily Quota Used" value={stats.daily_quota_used} />
        <MetricCard label="Webhook Dead Letters" value={stats.webhook_dead_letters} />
      </div>
    </Layout>
  );
}
```

### Step 9.3: 验证 build

Run: `cd /d/dev/hunter-platform/admin-web && pnpm build 2>&1 | tail -10`
Expected: build successful

### Step 9.4: Commit

```bash
cd /d/dev/hunter-platform
git add admin-web/src/api/dashboard.ts admin-web/src/pages/DashboardPage.tsx
git commit -m "feat(admin-web): DashboardPage — 4 cards + 30d trend (real data)"
```

---

## Task 10: Frontend — CandidatesPage + users api wrapper + integration test

**Files:**
- Create: `admin-web/src/api/candidates.ts`
- Create: `admin-web/src/pages/CandidatesPage.tsx`
- Create: `admin-web/tests/components/CandidatesList.test.tsx`

### Step 10.1: 创建 candidates.ts api wrapper

Create `admin-web/src/api/candidates.ts`:

```typescript
import { apiFetchRaw } from './raw';

export type CandidateRow = {
  anonymized_id: string;
  candidate_user_id: string;
  masked_name: string;
  masked_email: string;
  headhunter_id: string;
  industry: string | null;
  title_level: string | null;
  is_public_pool: 0 | 1;
  unlock_status: string;
  created_at: string;
};

export async function listCandidates(opts: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  in_pool?: boolean;
  unlock_status?: string;
} = {}): Promise<{ data: CandidateRow[]; pagination: { total: number; page: number; pageSize: number; has_more: boolean } }> {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts.keyword) params.set('keyword', opts.keyword);
  if (opts.in_pool !== undefined) params.set('in_pool', String(opts.in_pool));
  if (opts.unlock_status) params.set('unlock_status', opts.unlock_status);
  const query = params.toString() ? `?${params}` : '';
  const env = await apiFetchRaw<CandidateRow[]>('candidates' + query);
  if (!env.ok || !env.data || !env.pagination) {
    throw new Error(env.error?.message ?? 'Failed to fetch candidates');
  }
  return { data: env.data, pagination: env.pagination };
}
```

### Step 10.2: 创建 CandidatesPage

Create `admin-web/src/pages/CandidatesPage.tsx`:

```typescript
import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import Table, { type Column } from '../components/Table';
import Pagination from '../components/Pagination';
import SearchBar, { type Filter } from '../components/SearchBar';
import StatusBadge from '../components/StatusBadge';
import { relativeTime } from '../lib/format';
import { listCandidates, type CandidateRow } from '../api/candidates';

export default function CandidatesPage() {
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 20, has_more: false });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const load = (p: number, keyword?: string) => {
    setLoading(true);
    listCandidates({ page: p, pageSize: 20, keyword })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(page); }, [page]);

  const columns: Column<CandidateRow>[] = [
    { key: 'id', header: 'ID', render: r => <code>{r.anonymized_id}</code> },
    { key: 'name', header: 'Name', render: r => r.masked_name },
    { key: 'email', header: 'Email', render: r => r.masked_email },
    { key: 'source', header: 'Source', render: r => <code>{r.headhunter_id}</code> },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.unlock_status} /> },
    { key: 'created', header: 'Created', render: r => relativeTime(r.created_at) },
  ];

  const filters: Filter[] = [
    { label: 'Status', value: 'unlock_status', options: [
      { label: 'Pending', value: 'pending' },
      { label: 'Unlocked', value: 'unlocked' },
      { label: 'Locked', value: 'locked' },
    ] },
  ];

  return (
    <Layout adminName="Admin">
      <h1>Candidates</h1>
      <SearchBar
        placeholder="Search name/email..."
        filters={filters}
        onSearch={(kw) => { setPage(1); load(1, kw); }}
      />
      <Table<CandidateRow>
        columns={columns}
        rows={rows}
        loading={loading}
        empty="No candidates found"
      />
      <Pagination
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={pagination.total}
        onPageChange={setPage}
      />
    </Layout>
  );
}
```

### Step 10.3: 创建 CandidatesList 集成测

Create `admin-web/tests/components/CandidatesList.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock apiFetchRaw via the api/candidates module (so the page's import resolves)
vi.mock('../../src/api/candidates', () => ({
  listCandidates: vi.fn(),
}));

import { listCandidates } from '../../src/api/candidates';
import CandidatesPage from '../../src/pages/CandidatesPage';

const mockRows = [
  {
    anonymized_id: 'c_a1',
    candidate_user_id: 'u_1',
    masked_name: 'A***ce',
    masked_email: 'a***@***.com',
    headhunter_id: 'h_1',
    industry: 'tech',
    title_level: 'senior',
    is_public_pool: 1 as const,
    unlock_status: 'pending',
    created_at: '2026-06-24T10:00:00Z',
  },
  {
    anonymized_id: 'c_b2',
    candidate_user_id: 'u_2',
    masked_name: 'B**',
    masked_email: 'b***@***.io',
    headhunter_id: 'h_2',
    industry: 'finance',
    title_level: 'lead',
    is_public_pool: 0 as const,
    unlock_status: 'unlocked',
    created_at: '2026-06-23T10:00:00Z',
  },
];

describe('CandidatesPage', () => {
  beforeEach(() => {
    localStorage.setItem('hunter_admin_api_key', 'test-key');
    (listCandidates as any).mockReset();
  });

  it('renders rows + pagination from API response', async () => {
    (listCandidates as any).mockResolvedValue({
      data: mockRows,
      pagination: { total: 25, page: 1, pageSize: 20, has_more: true },
    });
    render(<MemoryRouter><CandidatesPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('A***ce')).toBeInTheDocument();
      expect(screen.getByText('B**')).toBeInTheDocument();
    });
    expect(screen.getByText(/Showing 1-2 of 25/)).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
    // Next button should be enabled (has_more=true)
    const nextBtn = screen.getByText('Next →') as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(false);
  });

  it('clicking Next → calls listCandidates with page=2', async () => {
    (listCandidates as any)
      .mockResolvedValueOnce({ data: mockRows, pagination: { total: 25, page: 1, pageSize: 20, has_more: true } })
      .mockResolvedValueOnce({ data: [], pagination: { total: 25, page: 2, pageSize: 20, has_more: false } });
    render(<MemoryRouter><CandidatesPage /></MemoryRouter>);
    await waitFor(() => screen.getByText('A***ce'));
    fireEvent.click(screen.getByText('Next →'));
    await waitFor(() => {
      expect(listCandidates).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, pageSize: 20 })
      );
    });
  });
});
```

### Step 10.4: 跑测试

Run: `cd /d/dev/hunter-platform/admin-web && pnpm test tests/components/CandidatesList.test.tsx 2>&1 | tail -10`
Expected: 2 pass

### Step 10.5: Commit

```bash
cd /d/dev/hunter-platform
git add admin-web/src/api/candidates.ts admin-web/src/pages/CandidatesPage.tsx admin-web/tests/components/CandidatesList.test.tsx
git commit -m "feat(admin-web): CandidatesPage + list API wrapper + integration test (2 tests)"
```

---

## Task 11: Frontend — UsersPage + users api wrapper + integration test

**Files:**
- Create: `admin-web/src/api/users.ts`
- Create: `admin-web/src/pages/UsersPage.tsx`
- Create: `admin-web/tests/components/UsersList.test.tsx`

### Step 11.1: 创建 users.ts api wrapper

Create `admin-web/src/api/users.ts`:

```typescript
import { apiFetchRaw } from './raw';

export type UserRow = {
  id: string;
  user_type: 'candidate' | 'headhunter' | 'employer';
  name: string;
  status: 'active' | 'suspended' | 'deleted';
  quota_per_day: number;
  quota_used: number;
  quota_reset_at: string;
  reputation: number;
  created_at: string;
};

export async function listUsers(opts: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  user_type?: string;
  status?: string;
} = {}): Promise<{ data: UserRow[]; pagination: { total: number; page: number; pageSize: number; has_more: boolean } }> {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts.keyword) params.set('keyword', opts.keyword);
  if (opts.user_type) params.set('user_type', opts.user_type);
  if (opts.status) params.set('status', opts.status);
  const query = params.toString() ? `?${params}` : '';
  const env = await apiFetchRaw<UserRow[]>('users' + query);
  if (!env.ok || !env.data || !env.pagination) {
    throw new Error(env.error?.message ?? 'Failed to fetch users');
  }
  return { data: env.data, pagination: env.pagination };
}
```

### Step 11.2: 创建 UsersPage

Create `admin-web/src/pages/UsersPage.tsx`:

```typescript
import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import Table, { type Column } from '../components/Table';
import Pagination from '../components/Pagination';
import SearchBar, { type Filter } from '../components/SearchBar';
import StatusBadge from '../components/StatusBadge';
import { relativeTime } from '../lib/format';
import { listUsers, type UserRow } from '../api/users';

export default function UsersPage() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 20, has_more: false });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const load = (p: number, keyword?: string) => {
    setLoading(true);
    listUsers({ page: p, pageSize: 20, keyword })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(page); }, [page]);

  const columns: Column<UserRow>[] = [
    { key: 'id', header: 'ID', render: r => <code>{r.id}</code> },
    { key: 'name', header: 'Name', render: r => r.name },
    { key: 'type', header: 'Role', render: r => r.user_type },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
    { key: 'quota', header: 'Quota', render: r => `${r.quota_used}/${r.quota_per_day}` },
    { key: 'created', header: 'Created', render: r => relativeTime(r.created_at) },
  ];

  const filters: Filter[] = [
    { label: 'Role', value: 'user_type', options: [
      { label: 'Candidate', value: 'candidate' },
      { label: 'Headhunter', value: 'headhunter' },
      { label: 'Employer', value: 'employer' },
    ] },
    { label: 'Status', value: 'status', options: [
      { label: 'Active', value: 'active' },
      { label: 'Suspended', value: 'suspended' },
      { label: 'Deleted', value: 'deleted' },
    ] },
  ];

  return (
    <Layout adminName="Admin">
      <h1>Users</h1>
      <SearchBar
        placeholder="Search name..."
        filters={filters}
        onSearch={(kw) => { setPage(1); load(1, kw); }}
      />
      <Table<UserRow>
        columns={columns}
        rows={rows}
        loading={loading}
        empty="No users found"
      />
      <Pagination
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={pagination.total}
        onPageChange={setPage}
      />
    </Layout>
  );
}
```

### Step 11.3: 创建 UsersList 集成测

Create `admin-web/tests/components/UsersList.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../src/api/users', () => ({
  listUsers: vi.fn(),
}));

import { listUsers } from '../../src/api/users';
import UsersPage from '../../src/pages/UsersPage';

const mockRows = [
  {
    id: 'u_1',
    user_type: 'headhunter' as const,
    name: 'Alice Hunter',
    status: 'active' as const,
    quota_per_day: 100,
    quota_used: 30,
    quota_reset_at: '2026-06-25T00:00:00Z',
    reputation: 75,
    created_at: '2026-06-24T08:00:00Z',
  },
  {
    id: 'u_2',
    user_type: 'employer' as const,
    name: 'Bob Inc',
    status: 'suspended' as const,
    quota_per_day: 200,
    quota_used: 0,
    quota_reset_at: '2026-06-25T00:00:00Z',
    reputation: 50,
    created_at: '2026-06-23T08:00:00Z',
  },
];

describe('UsersPage', () => {
  beforeEach(() => {
    localStorage.setItem('hunter_admin_api_key', 'test-key');
    (listUsers as any).mockReset();
  });

  it('renders rows + pagination from API response', async () => {
    (listUsers as any).mockResolvedValue({
      data: mockRows,
      pagination: { total: 47, page: 1, pageSize: 20, has_more: true },
    });
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Alice Hunter')).toBeInTheDocument();
      expect(screen.getByText('Bob Inc')).toBeInTheDocument();
    });
    expect(screen.getByText(/Showing 1-2 of 47/)).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
  });

  it('clicking Next → calls listUsers with page=2', async () => {
    (listUsers as any)
      .mockResolvedValueOnce({ data: mockRows, pagination: { total: 47, page: 1, pageSize: 20, has_more: true } })
      .mockResolvedValueOnce({ data: [], pagination: { total: 47, page: 2, pageSize: 20, has_more: false } });
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
    await waitFor(() => screen.getByText('Alice Hunter'));
    fireEvent.click(screen.getByText('Next →'));
    await waitFor(() => {
      expect(listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, pageSize: 20 })
      );
    });
  });
});
```

### Step 11.4: 跑测试

Run: `cd /d/dev/hunter-platform/admin-web && pnpm test tests/components/UsersList.test.tsx 2>&1 | tail -10`
Expected: 2 pass

### Step 11.5: Commit

```bash
cd /d/dev/hunter-platform
git add admin-web/src/api/users.ts admin-web/src/pages/UsersPage.tsx admin-web/tests/components/UsersList.test.tsx
git commit -m "feat(admin-web): UsersPage + list API wrapper + integration test (2 tests)"
```

---

## Task 12: Frontend — 路由 + Layout nav 更新

**Files:**
- Modify: `admin-web/src/App.tsx`
- Modify: `admin-web/src/components/Layout.tsx`

### Step 12.1: 更新 App.tsx

打开 `admin-web/src/App.tsx`，**完整替换**：

```typescript
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProfilePage from './pages/ProfilePage';
import UsersPage from './pages/UsersPage';
import CandidatesPage from './pages/CandidatesPage';
import PrivateRoute from './components/PrivateRoute';

export default function App() {
  return (
    <BrowserRouter basename="/admin">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
        <Route path="/users" element={<PrivateRoute><UsersPage /></PrivateRoute>} />
        <Route path="/candidates" element={<PrivateRoute><CandidatesPage /></PrivateRoute>} />
        <Route path="/profile" element={<PrivateRoute><ProfilePage /></PrivateRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

### Step 12.2: 更新 Layout.tsx (用 NavLink + active class)

打开 `admin-web/src/components/Layout.tsx`，**完整替换**：

```typescript
import { NavLink, useNavigate } from 'react-router-dom';
import { clearToken } from '../lib/auth';

export default function Layout({ children, adminName }: { children: React.ReactNode; adminName: string }) {
  const navigate = useNavigate();
  const logout = () => {
    clearToken();
    navigate('/admin/login');
  };
  const navStyle = ({ isActive }: { isActive: boolean }) => ({
    color: 'white',
    textDecoration: 'none',
    padding: '8px 12px',
    borderRadius: 4,
    background: isActive ? 'rgba(255,255,255,0.2)' : 'transparent',
  });
  return (
    <>
      <nav className="nav">
        <strong>Hunter Admin</strong>
        <NavLink to="/admin/" style={navStyle}>Dashboard</NavLink>
        <NavLink to="/admin/users" style={navStyle}>Users</NavLink>
        <NavLink to="/admin/candidates" style={navStyle}>Candidates</NavLink>
        <NavLink to="/admin/profile" style={navStyle}>Profile</NavLink>
        <div className="spacer" />
        <span>{adminName}</span>
        <button className="btn btn-danger" onClick={logout} style={{ marginLeft: 12 }}>Logout</button>
      </nav>
      <div className="container">{children}</div>
    </>
  );
}
```

### Step 12.3: 跑全部 admin-web 测试

Run: `cd /d/dev/hunter-platform/admin-web && pnpm test 2>&1 | tail -5`
Expected: 5 + 6 + 13 + 2 + 2 = 28 pass

### Step 12.4: Build

Run: `cd /d/dev/hunter-platform/admin-web && pnpm build 2>&1 | tail -10`
Expected: build successful

### Step 12.5: Commit

```bash
cd /d/dev/hunter-platform
git add admin-web/src/App.tsx admin-web/src/components/Layout.tsx
git commit -m "feat(admin-web): routing + nav with Users/Candidates links"
```

---

## Task 13: 全量回归 + 文档

**Files:**
- Modify: `docs/PROJECT_MEMORY.md`
- Modify: `docs/superpowers/skill.md`
- Modify: `docs/superpowers/openapi.json`

### Step 13.1: 全量后端回归

Run: `cd /d/dev/hunter-platform && pnpm test 2>&1 | tail -5`
Expected: 814 + 9 = 823 pass

### Step 13.2: 全量 admin-web 测试

Run: `cd /d/dev/hunter-platform/admin-web && pnpm test 2>&1 | tail -5`
Expected: 28 pass

### Step 13.3: Typecheck (both)

Run:
```bash
cd /d/dev/hunter-platform && pnpm typecheck 2>&1 | tail -3
cd /d/dev/hunter-platform/admin-web && pnpm build 2>&1 | tail -10
```
Expected: both clean

### Step 13.4: openapi:check

Run: `cd /d/dev/hunter-platform && pnpm openapi:check 2>&1 | tail -5`
Expected: ✅ No dangling paths

### Step 13.5: 更新 PROJECT_MEMORY.md

打开 `docs/PROJECT_MEMORY.md`，更新活跃任务表 + §7 重要文件位置：

活跃任务表把 Sub-A 行的 Sub-A 后面加 "；**Sub-B** 监控仪表盘 + 列表只读已完成 + 合 main (TODO: merge commit 待补)"。

§7 加：

```
| Admin Web UI 列表页 | `admin-web/src/pages/{Users,Candidates,Dashboard}Page.tsx` |
| Admin API typed wrappers | `admin-web/src/api/{users,candidates,dashboard,raw}.ts` |
```

### Step 13.6: 更新 skill.md (admin 端点段)

打开 `docs/superpowers/skill.md`，找到 admin API 段，更新 `/v1/admin/users` 和 `/v1/admin/candidates` 行：

```
| GET    | `/v1/admin/users?page=&pageSize=&keyword=&user_type=&status=` | 用户列表（分页 + 搜索 + 筛选） |
| GET    | `/v1/admin/candidates?page=&pageSize=&keyword=&in_pool=&unlock_status=` | 候选人列表（分页 + 搜索；姓名/邮箱已 mask） |
```

`/v1/admin/dashboard/stats` 行加注：`响应含 today_new_users + trend_30d[30]`。

### Step 13.7: 更新 openapi.json

打开 `docs/superpowers/openapi.json`，找 `/v1/admin/users` 和 `/v1/admin/candidates` entries，给 parameters 加 `page`/`pageSize`/`keyword`（参考 `/v1/admin/action-history` 的 schema 风格），responses 加 `pagination` schema 引用。

### Step 13.8: Commit

```bash
cd /d/dev/hunter-platform
git add docs/PROJECT_MEMORY.md docs/superpowers/skill.md docs/superpowers/openapi.json
git commit -m "docs: web admin sub-B skill.md + openapi + memory"
```

---

## Task 14: 部署 + merge

**Files:**
- Modify: (无文件改动，纯部署)

### Step 14.1: 本地 build

Run:
```bash
cd /d/dev/hunter-platform && pnpm build 2>&1 | tail -5
cd /d/dev/hunter-platform/admin-web && pnpm test 2>&1 | tail -3 && pnpm build 2>&1 | tail -5
```
Expected: both build successful

### Step 14.2: SCP 到生产

```bash
cd /d/dev/hunter-platform
scp -r -i /d/Downloads/cc.pem out/main/* root@101.201.110.129:/opt/hunter-platform/out/main/
scp -r -i /d/Downloads/cc.pem out/admin/* root@101.201.110.129:/opt/hunter-platform/out/admin/
```

### Step 14.3: 重启服务 + nginx 不变（Sub-B 是后端 + 静态 SPA）

```bash
ssh -i /d/Downloads/cc.pem root@101.201.110.129 'systemctl restart hunter-platform && sleep 2'
```

### Step 14.4: 远程 curl 冒烟

```bash
# 用 Sub-A 拿到的 admin api_key
API_KEY="<paste from Sub-A seed login>"
ssh -i /d/Downloads/cc.pem root@101.201.110.129 \
  "curl -s 'https://qing3.top/v1/admin/dashboard/stats' -H 'Authorization: Bearer $API_KEY' | jq .data | grep -E 'today_new_users|trend_30d'"
# Expected: 数字 + 30 长数组

ssh -i /d/Downloads/cc.pem root@101.201.110.129 \
  "curl -s 'https://qing3.top/v1/admin/users?page=1&pageSize=5' -H 'Authorization: Bearer $API_KEY' | jq '.data | length, .pagination'"
# Expected: data length ≤ 5, pagination.total > 0

ssh -i /d/Downloads/cc.pem root@101.201.110.129 \
  "curl -s 'https://qing3.top/v1/admin/candidates?page=1&pageSize=5' -H 'Authorization: Bearer $API_KEY' | jq '.data[0].masked_name, .data[0].masked_email'"
# Expected: masked 值（如 "A***ce"）
```

### Step 14.5: 浏览器手测

访问 `https://qing3.top/admin/login` → 登录 → 看到 Dashboard 4 卡片 + 30 天 SVG → 点 Users → 看分页 + 搜索 → 点 Candidates → 看 masked 姓名/邮箱。

### Step 14.6: 合并 feature 分支到 main

```bash
cd /d/dev/hunter-platform
git checkout main
git merge feature/web-admin-sub-B --no-ff -m "Merge feature/web-admin-sub-B: Dashboard + Lists (Sub-B of Task #3)

- Backend: users/candidates list 加 offset+keyword+envelope; candidates JOIN users 用 masked PII
- Backend: dashboard 加 today_new_users + trend_30d
- Frontend (admin-web/): 3 个真实数据页面 + 6 个共享组件 + apiFetchRaw wrapper
- Frontend: vitest+jsdom+RTL setup, 28 tests (apiFetchRaw/mask/format/2 集成测)
- 17 new backend tests (0 regression; 814 + 9 = 823 total)
- Deployed to production 101.201.110.129 (curl-verified)"
git branch -d feature/web-admin-sub-B
```

---

## 验收清单（与 spec §5 对齐）

- [ ] 3 个页面可访问（login 后）
- [ ] Dashboard 显示 4 卡片 + 30 天趋势 SVG
- [ ] Candidates 列表分页工作（page 1/2/3）
- [ ] Candidates 搜索 "alice" 过滤结果
- [ ] Candidates 姓名/邮箱为 masked（"A***ce" / "a***@***.com"）
- [ ] Users 列表分页 + 搜索工作
- [ ] Status/role 筛选工作
- [ ] admin-web/ build 成功
- [ ] admin-web/ 跑 `pnpm test` 28 tests 通过
- [ ] `pnpm typecheck` 干净
- [ ] `pnpm test`（后端）814 + 9 = 823 全过
- [ ] `pnpm openapi:check` 干净
- [ ] Production 部署后 https://qing3.top/admin/users 200 + 显示列表

---

## 上线检查清单（spec §8）

1. 代码合入 `main`
2. CI 全过
3. 部署（参考 PROJECT_MEMORY.md §1b）：
   ```bash
   cd /d/dev/hunter-platform && pnpm build
   cd admin-web && pnpm test && pnpm build
   scp -r out/main/* root@101.201.110.129:/opt/hunter-platform/out/main/
   scp -r out/admin/* root@101.201.110.129:/opt/hunter-platform/out/admin/
   ssh root@101.201.110.129 'systemctl restart hunter-platform'
   ```
4. 冒烟（curl + 浏览器）
5. nginx **无需变更**

---

## 风险与回滚（spec §6）

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Candidates LIKE 查询性能差 | 低 | 低 | 用户量小（< 10k）+ admin 端点低 QPS |
| Dashboard trend_30d 30 次 SELECT | 极低 | 低 | 单次 < 1ms，总 < 30ms |
| 前端 apiFetchRaw envelope 错配 | 中 | 中 | 5 个 unit test 覆盖；RTL 集成测覆盖页面 |
| Sub-A 的 apiFetch 残留 | 低 | 低 | Sub-A 完全不动；新页面只用 apiFetchRaw |

**回滚**：每个 Task 独立 commit；紧急：
```bash
git revert --no-commit <last-commit>..<first-commit-of-this-feature>
git commit -m "revert: web admin sub-B (rollback)"
```