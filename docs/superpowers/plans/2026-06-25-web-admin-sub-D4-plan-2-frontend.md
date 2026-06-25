# Web Admin Sub-D4 Plan 2: Frontend (4 Detail Pages + 4 List Buttons)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **前置依赖：** Plan 1 (`2026-06-25-web-admin-sub-D4-plan-1-backend.md`) 必须**先 merge 到 main**。本 plan 消费 backend 的 4 个新 GET :id endpoint + webhook retry 的 audit 行为（前端不感知，但 audit log 现在会写到 `retry_webhook` 记录，详情可看 AuditPage）。

**Goal:** 给 admin-web 加 4 个新 detail page（user / candidate / job / recommendation），4 个 list page 行末加「详情」按钮跳到对应 detail page。

**Architecture:**
- **前端**：4 个 API wrapper 加 getX + 4 个新 page + 4 列表页按钮 + App.tsx 路由
- **测试**：~24 个新前端测试覆盖 API wrapper + 4 page + 4 button

**Tech Stack (existing):** React 18, Vite, react-router-dom, vanilla CSS, vitest+jsdom+RTL
**Spec:** [docs/superpowers/specs/2026-06-25-web-admin-sub-D4-design.md](../specs/2026-06-25-web-admin-sub-D4-design.md) — §4 frontend design

---

## 0. Reviewer decisions

| 反馈点 | 决策 |
|--------|------|
| 4 page 结构 | 各自独立（不抽公共 wrapper） |
| 内容 | 基本信息 + 1-2 个相关数据表 |
| 复用组件 | StatusBadge / Skeleton / Layout / Toast（Sub-C/D2/D3 都有） |
| URL 持久化 | 不做（详情页是只读，不需 filter sync） |
| 错误处理 | 主 entity 失败 → 整页错误 + 返回链接；关联数据失败 → 部分错误 |

---

## File Structure

| File | Change |
|------|--------|
| `admin-web/src/api/users.ts` | **Modify** — + getUser |
| `admin-web/src/api/jobs.ts` | **Modify** — + getJob |
| `admin-web/src/api/candidates.ts` | **Modify** — + getCandidate |
| `admin-web/src/api/recommendations.ts` | **Modify** — + getRecommendation |
| `admin-web/src/pages/UserDetailPage.tsx` | **Create** |
| `admin-web/src/pages/CandidateDetailPage.tsx` | **Create** |
| `admin-web/src/pages/JobDetailPage.tsx` | **Create** |
| `admin-web/src/pages/RecommendationDetailPage.tsx` | **Create** |
| `admin-web/src/App.tsx` | **Modify** — +4 routes |
| `admin-web/src/pages/UsersPage.tsx` | **Modify** — +「详情」按钮 |
| `admin-web/src/pages/CandidatesPage.tsx` | **Modify** — +「详情」按钮 |
| `admin-web/src/pages/JobsPage.tsx` | **Modify** — +「详情」按钮 |
| `admin-web/src/pages/RecommendationsPage.tsx` | **Modify** — +「详情」按钮 |
| `CHANGELOG.md` | **Modify** — v2.4.0 加 frontend 部分 |

---

## Task 1: API wrappers — getUser / getJob / getCandidate / getRecommendation

**Files:**
- Modify: 4 api files
- Create: 4 test files

### Step 1.1: api/users.ts 加 getUser

打开 `admin-web/src/api/users.ts`，在文件末尾追加（如已有 listUsers 则在 listUsers 之后）：

```typescript
export async function getUser(id: string): Promise<UserPublic> {
  const env = await apiFetchRaw<UserPublic>('users/' + id);
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to fetch user');
  return env.data;
}
```

### Step 1.2: api/jobs.ts 加 getJob

```typescript
export async function getJob(id: string): Promise<JobRow> {
  const env = await apiFetchRaw<JobRow>('jobs/' + id);
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to fetch job');
  return env.data;
}
```

### Step 1.3: api/candidates.ts 加 getCandidate

```typescript
export async function getCandidate(id: string): Promise<CandidateRow> {
  const env = await apiFetchRaw<CandidateRow>('candidates/' + id);
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to fetch candidate');
  return env.data;
}
```

### Step 1.4: api/recommendations.ts 加 getRecommendation

```typescript
export async function getRecommendation(id: string): Promise<RecommendationRow> {
  const env = await apiFetchRaw<RecommendationRow>('recommendations/' + id);
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to fetch recommendation');
  return env.data;
}
```

### Step 1.5: 创建 4 个 test 文件

Create `admin-web/tests/api/get-by-id.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getUser } from '../../src/api/users';
import { getJob } from '../../src/api/jobs';
import { getCandidate } from '../../src/api/candidates';
import { getRecommendation } from '../../src/api/recommendations';

vi.mock('../../src/api/raw', () => ({ apiFetchRaw: vi.fn() }));
import { apiFetchRaw } from '../../src/api/raw';

describe('get-by-id APIs (Sub-D4)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. getUser calls users/:id', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: { id: 'u_1' } });
    await getUser('u_1');
    expect(apiFetchRaw).toHaveBeenCalledWith('users/u_1');
  });

  it('2. getJob calls jobs/:id', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: { id: 'job_1' } });
    await getJob('job_1');
    expect(apiFetchRaw).toHaveBeenCalledWith('jobs/job_1');
  });

  it('3. getCandidate calls candidates/:id', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: { id: 'c_1' } });
    await getCandidate('c_1');
    expect(apiFetchRaw).toHaveBeenCalledWith('candidates/c_1');
  });

  it('4. getRecommendation calls recommendations/:id', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: { id: 'rec_1' } });
    await getRecommendation('rec_1');
    expect(apiFetchRaw).toHaveBeenCalledWith('recommendations/rec_1');
  });

  it('5. throws on non-ok', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: false, error: { code: 'NOT_FOUND', message: 'not found' } });
    await expect(getUser('x')).rejects.toThrow('not found');
  });
});
```

### Step 1.6: 跑测试

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/api/get-by-id.test.ts 2>&1 | tail -5`
Expected: 5 通过。

### Step 1.7: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/api/users.ts admin-web/src/api/jobs.ts admin-web/src/api/candidates.ts admin-web/src/api/recommendations.ts admin-web/tests/api/get-by-id.test.ts
git -C D:/dev/hunter-platform commit -m "feat(admin-web): api wrappers — getUser + getJob + getCandidate + getRecommendation"
```

---

## Task 2-5: 4 个详情页（每个一个 task，按模式重复）

4 个详情页结构类似（基本结构 + entity-specific 关联数据）。每个 task 一个 page。

### Task 2: UserDetailPage

**Files:**
- Create: `admin-web/src/pages/UserDetailPage.tsx`
- Create: `admin-web/tests/pages/UserDetailPage.test.tsx`

#### Step 2.1: 创建 UserDetailPage.tsx

Create `admin-web/src/pages/UserDetailPage.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import StatusBadge from '../components/StatusBadge';
import Skeleton from '../components/Skeleton';
import { getUser, type UserPublic } from '../api/users';
import { listPlacements, type PlacementRow } from '../api/placements';
import { useToast } from '../lib/toast';
import { relativeTime } from '../lib/format';

type DataState<T> = { loading: true } | { loading: false; data: T } | { loading: false; error: string };

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [user, setUser] = useState<DataState<UserPublic> | null>(null);
  const [placements, setPlacements] = useState<DataState<PlacementRow[]> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setUser({ loading: true });
    setPlacements({ loading: true });
    try {
      const [u, p] = await Promise.all([
        getUser(id),
        listPlacements({ pageSize: 5, /* TODO: filter by user if backend supports */ }),
      ]);
      setUser({ loading: false, data: u });
      setPlacements({ loading: false, data: p.data });
    } catch (e: any) {
      setUser({ loading: false, error: e.message });
      toast.push({ type: 'error', message: e.message });
    }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  if (user === null) return <Layout adminName="Admin"><p>加载中...</p></Layout>;
  if (user.loading) return <Layout adminName="Admin"><Skeleton variant="row" count={5} /></Layout>;
  if (user.error) {
    return (
      <Layout adminName="Admin">
        <p style={{ color: '#a8071a' }}>无法加载: {user.error}</p>
        <Link to="/admin/users" className="btn">← 返回用户列表</Link>
      </Layout>
    );
  }

  const u = user.data;
  return (
    <Layout adminName="Admin">
      <Link to="/admin/users">← 返回用户列表</Link>
      <h1 style={{ marginTop: 16 }}>{u.name}</h1>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <StatusBadge status={u.status} />
        <span>类型: {u.user_type}</span>
        <span>邮箱: {u.contact}</span>
        <span>配额: {u.quota_used}/{u.quota_per_day}</span>
        <span>创建: {relativeTime(u.created_at)}</span>
      </div>
      <div style={{ marginBottom: 24 }}>
        <Link to={`/admin/users/${u.id}/timeline`} className="btn btn-primary" data-testid="user-timeline-link">查看时间轴</Link>
        {u.status === 'active' && (
          <>
            {' '}
            {/* 调配额按钮如需保留，从 UsersPage 行模式搬过来 */}
          </>
        )}
      </div>

      <h2>关联的 Placements（最近 5 条）</h2>
      {placements?.loading && <Skeleton variant="row" count={3} />}
      {placements && !placements.loading && (
        placements.data.length === 0 ? <p>暂无 placement</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#fafafa' }}>
              <th style={{ padding: 8, textAlign: 'left' }}>ID</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Job</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Status</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Fee</th>
            </tr></thead>
            <tbody>
              {placements.data.map(p => (
                <tr key={p.id} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ padding: 8 }}><code>{p.id}</code></td>
                  <td style={{ padding: 8 }}>{p.job_id}</td>
                  <td style={{ padding: 8 }}><StatusBadge status={p.status} /></td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{p.platform_fee.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </Layout>
  );
}
```

#### Step 2.2: 创建 UserDetailPage.test.tsx

Create `admin-web/tests/pages/UserDetailPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from '../../src/lib/toast';
import UserDetailPage from '../../src/pages/UserDetailPage';

vi.mock('../../src/api/users', () => ({ getUser: vi.fn() }));
vi.mock('../../src/api/placements', () => ({ listPlacements: vi.fn() }));

import { getUser } from '../../src/api/users';
import { listPlacements } from '../../src/api/placements';

const renderPage = (id = 'u_1') => render(
  <MemoryRouter initialEntries={[`/admin/users/${id}`]}>
    <ToastProvider>
      <Routes>
        <Route path="/admin/users/:id" element={<UserDetailPage />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>
);

describe('UserDetailPage (Sub-D4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getUser as any).mockResolvedValue({
      id: 'u_1', user_type: 'headhunter', name: '张三', contact: 'z@x', status: 'active',
      quota_per_day: 100, quota_used: 50, reputation: 80, created_at: '2026-06-01T00:00:00Z',
    });
    (listPlacements as any).mockResolvedValue({
      data: [], pagination: { total: 0, page: 1, pageSize: 5, has_more: false },
    });
  });

  it('1. mount calls getUser + listPlacements + renders user info', async () => {
    renderPage('u_test');
    await waitFor(() => expect(getUser).toHaveBeenCalledWith('u_test'));
    expect(screen.getByText('张三')).toBeTruthy();
    expect(screen.getByText('headhunter')).toBeTruthy();
    expect(screen.getByTestId('user-timeline-link')).toBeTruthy();
  });

  it('2. shows error if getUser throws', async () => {
    (getUser as any).mockRejectedValueOnce(new Error('user not found'));
    renderPage('u_404');
    await waitFor(() => expect(screen.getByText(/无法加载: user not found/)).toBeTruthy());
  });

  it('3. empty placements shows 暂无', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('暂无 placement')).toBeTruthy());
  });

  it('4. timeline link points to /timeline', async () => {
    renderPage('u_x');
    await waitFor(() => screen.getByTestId('user-timeline-link'));
    expect(screen.getByTestId('user-timeline-link').getAttribute('href')).toBe('/admin/users/u_x/timeline');
  });
});
```

#### Step 2.3: 跑测试

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/pages/UserDetailPage.test.tsx 2>&1 | tail -5`
Expected: 4 通过。

#### Step 2.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/UserDetailPage.tsx admin-web/tests/pages/UserDetailPage.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): UserDetailPage — basic info + related placements + timeline link"
```

---

### Task 3: CandidateDetailPage（同模式）

**Files:**
- Create: `admin-web/src/pages/CandidateDetailPage.tsx`
- Create: `admin-web/tests/pages/CandidateDetailPage.test.tsx`

#### Step 3.1: 创建 CandidateDetailPage.tsx

```tsx
import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import StatusBadge from '../components/StatusBadge';
import Skeleton from '../components/Skeleton';
import { getCandidate, type CandidateRow } from '../api/candidates';
import { listRecommendations, type RecommendationRow } from '../api/recommendations';
import { useToast } from '../lib/toast';
import { relativeTime } from '../lib/format';

type DataState<T> = { loading: true } | { loading: false; data: T } | { loading: false; error: string };

export default function CandidateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [candidate, setCandidate] = useState<DataState<CandidateRow> | null>(null);
  const [recs, setRecs] = useState<DataState<RecommendationRow[]> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setCandidate({ loading: true });
    setRecs({ loading: true });
    try {
      const [c, r] = await Promise.all([
        getCandidate(id),
        listRecommendations({ pageSize: 5 }),
      ]);
      setCandidate({ loading: false, data: c });
      setRecs({ loading: false, data: r.data });
    } catch (e: any) {
      setCandidate({ loading: false, error: e.message });
      toast.push({ type: 'error', message: e.message });
    }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  if (candidate === null) return <Layout adminName="Admin"><p>加载中...</p></Layout>;
  if (candidate.loading) return <Layout adminName="Admin"><Skeleton variant="row" count={5} /></Layout>;
  if (candidate.error) {
    return (
      <Layout adminName="Admin">
        <p style={{ color: '#a8071a' }}>无法加载: {candidate.error}</p>
        <Link to="/admin/candidates" className="btn">← 返回候选人列表</Link>
      </Layout>
    );
  }

  const c = candidate.data;
  return (
    <Layout adminName="Admin">
      <Link to="/admin/candidates">← 返回候选人列表</Link>
      <h1 style={{ marginTop: 16 }}>候选人 #{c.anonymized_id}</h1>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <StatusBadge status={c.unlock_status} />
        <span>行业: {c.industry}</span>
        <span>职级: {c.title_level}</span>
        <span>创建: {relativeTime(c.created_at)}</span>
      </div>
      <Link to={`/admin/candidates/${c.anonymized_id}/timeline`} className="btn btn-primary">查看时间轴</Link>

      <h2 style={{ marginTop: 24 }}>关联的 Recommendations（最近 5 条）</h2>
      {recs?.loading && <Skeleton variant="row" count={3} />}
      {recs && !recs.loading && (
        recs.data.length === 0 ? <p>暂无推荐</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#fafafa' }}>
              <th style={{ padding: 8, textAlign: 'left' }}>ID</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Job</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Status</th>
            </tr></thead>
            <tbody>
              {recs.data.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ padding: 8 }}><code>{r.id}</code></td>
                  <td style={{ padding: 8 }}>{r.job_title}</td>
                  <td style={{ padding: 8 }}><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </Layout>
  );
}
```

#### Step 3.2: 创建 test（与 UserDetailPage 同模式，调整 entity 名称）

Create `admin-web/tests/pages/CandidateDetailPage.test.tsx` — 与 UserDetailPage test 同结构，调整：
- import `getCandidate` / `listRecommendations`
- mock 返回值含 `anonymized_id` / `industry` / `title_level` / `unlock_status`
- 返回链接是 `/admin/candidates`

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from '../../src/lib/toast';
import CandidateDetailPage from '../../src/pages/CandidateDetailPage';

vi.mock('../../src/api/candidates', () => ({ getCandidate: vi.fn() }));
vi.mock('../../src/api/recommendations', () => ({ listRecommendations: vi.fn() }));

import { getCandidate } from '../../src/api/candidates';
import { listRecommendations } from '../../src/api/recommendations';

const renderPage = (id = 'c_1') => render(
  <MemoryRouter initialEntries={[`/admin/candidates/${id}`]}>
    <ToastProvider>
      <Routes>
        <Route path="/admin/candidates/:id" element={<CandidateDetailPage />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>
);

describe('CandidateDetailPage (Sub-D4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getCandidate as any).mockResolvedValue({
      anonymized_id: 'canon_1', industry: 'tech', title_level: 'mid', unlock_status: 'pending',
      is_public_pool: 1, created_at: '2026-06-15T00:00:00Z',
    });
    (listRecommendations as any).mockResolvedValue({
      data: [], pagination: { total: 0, page: 1, pageSize: 5, has_more: false },
    });
  });

  it('1. mount calls getCandidate + listRecommendations', async () => {
    renderPage('canon_2');
    await waitFor(() => expect(getCandidate).toHaveBeenCalledWith('canon_2'));
    expect(screen.getByText('tech')).toBeTruthy();
    expect(screen.getByText('mid')).toBeTruthy();
  });

  it('2. error state', async () => {
    (getCandidate as any).mockRejectedValueOnce(new Error('not found'));
    renderPage('c_x');
    await waitFor(() => expect(screen.getByText(/无法加载: not found/)).toBeTruthy());
  });

  it('3. empty recs', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('暂无推荐')).toBeTruthy());
  });

  it('4. timeline link', async () => {
    renderPage('canon_x');
    await waitFor(() => screen.getByText('查看时间轴'));
    expect(screen.getByText('查看时间轴').getAttribute('href')).toBe('/admin/candidates/canon_x/timeline');
  });
});
```

#### Step 3.3: 跑测试 + commit

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/pages/CandidateDetailPage.test.tsx 2>&1 | tail -5`
Expected: 4 通过。

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/CandidateDetailPage.tsx admin-web/tests/pages/CandidateDetailPage.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): CandidateDetailPage"
```

---

### Task 4: JobDetailPage（同模式）

**Files:**
- Create: `admin-web/src/pages/JobDetailPage.tsx`
- Create: `admin-web/tests/pages/JobDetailPage.test.tsx`

#### Step 4.1: 创建 JobDetailPage.tsx

```tsx
import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import StatusBadge from '../components/StatusBadge';
import Skeleton from '../components/Skeleton';
import { getJob, type JobRow } from '../api/jobs';
import { listRecommendations, type RecommendationRow } from '../api/recommendations';
import { listPlacements, type PlacementRow } from '../api/placements';
import { useToast } from '../lib/toast';
import { relativeTime } from '../lib/format';

type DataState<T> = { loading: true } | { loading: false; data: T } | { loading: false; error: string };

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [job, setJob] = useState<DataState<JobRow> | null>(null);
  const [recs, setRecs] = useState<DataState<RecommendationRow[]> | null>(null);
  const [placements, setPlacements] = useState<DataState<PlacementRow[]> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setJob({ loading: true });
    setRecs({ loading: true });
    setPlacements({ loading: true });
    try {
      const [j, r, p] = await Promise.all([
        getJob(id),
        listRecommendations({ pageSize: 5 }),
        listPlacements({ pageSize: 5 }),
      ]);
      setJob({ loading: false, data: j });
      setRecs({ loading: false, data: r.data });
      setPlacements({ loading: false, data: p.data });
    } catch (e: any) {
      setJob({ loading: false, error: e.message });
      toast.push({ type: 'error', message: e.message });
    }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  if (job === null) return <Layout adminName="Admin"><p>加载中...</p></Layout>;
  if (job.loading) return <Layout adminName="Admin"><Skeleton variant="row" count={5} /></Layout>;
  if (job.error) {
    return (
      <Layout adminName="Admin">
        <p style={{ color: '#a8071a' }}>无法加载: {job.error}</p>
        <Link to="/admin/jobs" className="btn">← 返回职位列表</Link>
      </Layout>
    );
  }

  const j = job.data;
  return (
    <Layout adminName="Admin">
      <Link to="/admin/jobs">← 返回职位列表</Link>
      <h1 style={{ marginTop: 16 }}>{j.title}</h1>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <StatusBadge status={j.status} />
        <span>雇主: {j.employer_id}</span>
        <span>创建: {relativeTime(j.created_at)}</span>
      </div>
      <Link to={`/admin/jobs/${j.id}/timeline`} className="btn btn-primary">查看时间轴</Link>

      <h2 style={{ marginTop: 24 }}>关联的 Recommendations（最近 5 条）</h2>
      {recs?.loading && <Skeleton variant="row" count={3} />}
      {recs && !recs.loading && (
        recs.data.length === 0 ? <p>暂无推荐</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#fafafa' }}>
              <th style={{ padding: 8, textAlign: 'left' }}>ID</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Headhunter</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Status</th>
            </tr></thead>
            <tbody>
              {recs.data.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ padding: 8 }}><code>{r.id}</code></td>
                  <td style={{ padding: 8 }}>{r.headhunter_name}</td>
                  <td style={{ padding: 8 }}><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      <h2 style={{ marginTop: 24 }}>关联的 Placements（最近 5 条）</h2>
      {placements?.loading && <Skeleton variant="row" count={3} />}
      {placements && !placements.loading && (
        placements.data.length === 0 ? <p>暂无 placement</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#fafafa' }}>
              <th style={{ padding: 8, textAlign: 'left' }}>ID</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Status</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Fee</th>
            </tr></thead>
            <tbody>
              {placements.data.map(p => (
                <tr key={p.id} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ padding: 8 }}><code>{p.id}</code></td>
                  <td style={{ padding: 8 }}><StatusBadge status={p.status} /></td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{p.platform_fee.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </Layout>
  );
}
```

#### Step 4.2: test

Create `admin-web/tests/pages/JobDetailPage.test.tsx`（与 CandidateDetailPage test 同模式，调整 import + mock 字段名）：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from '../../src/lib/toast';
import JobDetailPage from '../../src/pages/JobDetailPage';

vi.mock('../../src/api/jobs', () => ({ getJob: vi.fn() }));
vi.mock('../../src/api/recommendations', () => ({ listRecommendations: vi.fn() }));
vi.mock('../../src/api/placements', () => ({ listPlacements: vi.fn() }));

import { getJob } from '../../src/api/jobs';
import { listRecommendations } from '../../src/api/recommendations';
import { listPlacements } from '../../src/api/placements';

const renderPage = (id = 'job_1') => render(
  <MemoryRouter initialEntries={[`/admin/jobs/${id}`]}>
    <ToastProvider>
      <Routes>
        <Route path="/admin/jobs/:id" element={<JobDetailPage />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>
);

describe('JobDetailPage (Sub-D4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getJob as any).mockResolvedValue({
      id: 'job_1', title: 'Senior Eng', employer_id: 'u_emp', status: 'open',
      created_at: '2026-06-20T00:00:00Z',
    });
    (listRecommendations as any).mockResolvedValue({ data: [], pagination: { total: 0, page: 1, pageSize: 5, has_more: false } });
    (listPlacements as any).mockResolvedValue({ data: [], pagination: { total: 0, page: 1, pageSize: 5, has_more: false } });
  });

  it('1. mount calls getJob + listRecommendations + listPlacements', async () => {
    renderPage('job_x');
    await waitFor(() => expect(getJob).toHaveBeenCalledWith('job_x'));
    expect(screen.getByText('Senior Eng')).toBeTruthy();
  });

  it('2. error state', async () => {
    (getJob as any).mockRejectedValueOnce(new Error('not found'));
    renderPage('job_err');
    await waitFor(() => expect(screen.getByText(/无法加载: not found/)).toBeTruthy());
  });

  it('3. empty related data', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('暂无推荐')).toBeTruthy());
    expect(screen.getByText('暂无 placement')).toBeTruthy();
  });

  it('4. timeline link', async () => {
    renderPage('job_y');
    await waitFor(() => screen.getByText('查看时间轴'));
    expect(screen.getByText('查看时间轴').getAttribute('href')).toBe('/admin/jobs/job_y/timeline');
  });
});
```

#### Step 4.3: 跑测试 + commit

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/pages/JobDetailPage.test.tsx 2>&1 | tail -5`
Expected: 4 通过。

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/JobDetailPage.tsx admin-web/tests/pages/JobDetailPage.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): JobDetailPage"
```

---

### Task 5: RecommendationDetailPage（同模式）

**Files:**
- Create: `admin-web/src/pages/RecommendationDetailPage.tsx`
- Create: `admin-web/tests/pages/RecommendationDetailPage.test.tsx`

#### Step 5.1: 创建 RecommendationDetailPage.tsx

```tsx
import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import StatusBadge from '../components/StatusBadge';
import Skeleton from '../components/Skeleton';
import { getRecommendation, type RecommendationRow } from '../api/recommendations';
import { useToast } from '../lib/toast';
import { relativeTime } from '../lib/format';

type DataState<T> = { loading: true } | { loading: false; data: T } | { loading: false; error: string };

export default function RecommendationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [rec, setRec] = useState<DataState<RecommendationRow> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setRec({ loading: true });
    try {
      const r = await getRecommendation(id);
      setRec({ loading: false, data: r });
    } catch (e: any) {
      setRec({ loading: false, error: e.message });
      toast.push({ type: 'error', message: e.message });
    }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  if (rec === null) return <Layout adminName="Admin"><p>加载中...</p></Layout>;
  if (rec.loading) return <Layout adminName="Admin"><Skeleton variant="row" count={5} /></Layout>;
  if (rec.error) {
    return (
      <Layout adminName="Admin">
        <p style={{ color: '#a8071a' }}>无法加载: {rec.error}</p>
        <Link to="/admin/recommendations" className="btn">← 返回推荐列表</Link>
      </Layout>
    );
  }

  const r = rec.data;
  return (
    <Layout adminName="Admin">
      <Link to="/admin/recommendations">← 返回推荐列表</Link>
      <h1 style={{ marginTop: 16 }}>Recommendation #{r.id}</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
        <tbody>
          <tr><td style={{ padding: 8, color: '#666' }}>Job</td><td style={{ padding: 8 }}>{r.job_title ?? r.job_id}</td></tr>
          <tr><td style={{ padding: 8, color: '#666' }}>Candidate</td><td style={{ padding: 8 }}>{r.anonymized_candidate_id}</td></tr>
          <tr><td style={{ padding: 8, color: '#666' }}>Headhunter</td><td style={{ padding: 8 }}>{r.headhunter_name ?? r.headhunter_id}</td></tr>
          <tr><td style={{ padding: 8, color: '#666' }}>Status</td><td style={{ padding: 8 }}><StatusBadge status={r.status} /></td></tr>
          <tr><td style={{ padding: 8, color: '#666' }}>Created</td><td style={{ padding: 8 }}>{relativeTime(r.created_at)}</td></tr>
        </tbody>
      </table>
      <Link to={`/admin/recommendations/${r.id}/timeline`} className="btn btn-primary">查看时间轴</Link>
    </Layout>
  );
}
```

#### Step 5.2: test

Create `admin-web/tests/pages/RecommendationDetailPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from '../../src/lib/toast';
import RecommendationDetailPage from '../../src/pages/RecommendationDetailPage';

vi.mock('../../src/api/recommendations', () => ({ getRecommendation: vi.fn() }));

import { getRecommendation } from '../../src/api/recommendations';

const renderPage = (id = 'rec_1') => render(
  <MemoryRouter initialEntries={[`/admin/recommendations/${id}`]}>
    <ToastProvider>
      <Routes>
        <Route path="/admin/recommendations/:id" element={<RecommendationDetailPage />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>
);

describe('RecommendationDetailPage (Sub-D4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getRecommendation as any).mockResolvedValue({
      id: 'rec_1', job_id: 'job_1', job_title: 'Senior Eng',
      anonymized_candidate_id: 'c_1', headhunter_id: 'u_2', headhunter_name: 'Bob',
      status: 'pending', created_at: '2026-06-25T00:00:00Z',
    });
  });

  it('1. mount calls getRecommendation + renders', async () => {
    renderPage('rec_x');
    await waitFor(() => expect(getRecommendation).toHaveBeenCalledWith('rec_x'));
    expect(screen.getByText('Senior Eng')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
  });

  it('2. error state', async () => {
    (getRecommendation as any).mockRejectedValueOnce(new Error('not found'));
    renderPage('rec_err');
    await waitFor(() => expect(screen.getByText(/无法加载: not found/)).toBeTruthy());
  });

  it('3. timeline link', async () => {
    renderPage('rec_y');
    await waitFor(() => screen.getByText('查看时间轴'));
    expect(screen.getByText('查看时间轴').getAttribute('href')).toBe('/admin/recommendations/rec_y/timeline');
  });

  it('4. back link goes to recommendations list', async () => {
    renderPage();
    await waitFor(() => screen.getByText('← 返回推荐列表'));
    expect(screen.getByText('← 返回推荐列表').getAttribute('href')).toBe('/admin/recommendations');
  });
});
```

#### Step 5.3: 跑测试 + commit

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/pages/RecommendationDetailPage.test.tsx 2>&1 | tail -5`
Expected: 4 通过。

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/RecommendationDetailPage.tsx admin-web/tests/pages/RecommendationDetailPage.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): RecommendationDetailPage"
```

---

## Task 6: App.tsx 路由注册

**Files:**
- Modify: `admin-web/src/App.tsx`

### Step 6.1: 加 4 个 imports

```tsx
import UserDetailPage from './pages/UserDetailPage';
import CandidateDetailPage from './pages/CandidateDetailPage';
import JobDetailPage from './pages/JobDetailPage';
import RecommendationDetailPage from './pages/RecommendationDetailPage';
```

### Step 6.2: 加 4 个 routes

找到 `<Route path="/users/:id/timeline"` 附近，加 4 个 detail route（必须在 :id/timeline 之前，避免 catch-all 拦截）：

```tsx
<Route path="/users/:id" element={<PrivateRoute><UserDetailPage /></PrivateRoute>} />
<Route path="/candidates/:id" element={<PrivateRoute><CandidateDetailPage /></PrivateRoute>} />
<Route path="/jobs/:id" element={<PrivateRoute><JobDetailPage /></PrivateRoute>} />
<Route path="/recommendations/:id" element={<PrivateRoute><RecommendationDetailPage /></PrivateRoute>} />
```

### Step 6.3: Typecheck

Run: `cd /d/dev/hunter-platform/admin-web && npx tsc --noEmit 2>&1 | tail -3`
Expected: 无错误。

### Step 6.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/App.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): App routes — +4 detail routes (user/candidate/job/recommendation)"
```

---

## Task 7-10: 4 个列表页加「详情」按钮

每个 list page 同模式：在 columns 数组「操作」列加一个 Link 按钮。test 加 1 case。

### Task 7: UsersPage

**Files:**
- Modify: `admin-web/src/pages/UsersPage.tsx`
- Modify: `admin-web/tests/pages/UsersPage.test.tsx` (或 UsersList.test.tsx)

#### Step 7.1: 加 column

找到 columns 数组，在「操作」列加 Link：

```tsx
    {
      key: 'detail', header: '详情',
      render: r => <Link to={`/admin/users/${r.id}`} className="btn btn-sm" data-testid={`user-detail-${r.id}`}>详情</Link>,
    },
```

#### Step 7.2: 加 test

```tsx
  it('shows 详情 link for each user row', async () => {
    (listUsers as any).mockResolvedValue({
      data: [{ id: 'u_x', user_type: 'candidate', name: 'A', status: 'active', quota_per_day: 100, quota_used: 0, quota_reset_at: '', reputation: 50, created_at: '2026-06-25T00:00:00Z' }],
      pagination: { total: 1, page: 1, pageSize: 20, has_more: false },
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('user-detail-u_x')).toBeTruthy());
  });
```

#### Step 7.3: 跑测试 + commit

```bash
cd /d/dev/hunter-platform/admin-web && npm run test -- tests/pages/UsersPage 2>&1 | tail -5
git -C D:/dev/hunter-platform add admin-web/src/pages/UsersPage.tsx admin-web/tests/pages/UsersPage.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): UsersPage — +详情 link"
```

### Task 8-10: CandidatesPage / JobsPage / RecommendationsPage

**每个文件同模式**：

- **CandidatesPage**：用 `r.anonymized_id` 作为 URL id
  ```tsx
  { key: 'detail', header: '详情',
    render: r => <Link to={`/admin/candidates/${r.anonymized_id}`} className="btn btn-sm" data-testid={`candidate-detail-${r.anonymized_id}`}>详情</Link> }
  ```
  test:
  ```tsx
  it('shows 详情 link for each candidate row', async () => {
    (listCandidates as any).mockResolvedValue({
      data: [{ anonymized_id: 'c_x', /* 其他 */ }],
      pagination: { total: 1, page: 1, pageSize: 20, has_more: false },
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('candidate-detail-c_x')).toBeTruthy());
  });
  ```
  commit: `feat(admin-web): CandidatesPage — +详情 link`

- **JobsPage**：用 `r.id`
  ```tsx
  { key: 'detail', header: '详情',
    render: r => <Link to={`/admin/jobs/${r.id}`} className="btn btn-sm" data-testid={`job-detail-${r.id}`}>详情</Link> }
  ```
  commit: `feat(admin-web): JobsPage — +详情 link`

- **RecommendationsPage**：用 `r.id`
  ```tsx
  { key: 'detail', header: '详情',
    render: r => <Link to={`/admin/recommendations/${r.id}`} className="btn btn-sm" data-testid={`rec-detail-${r.id}`}>详情</Link> }
  ```
  commit: `feat(admin-web): RecommendationsPage — +详情 link`

每页：跑 `npm run test -- tests/pages/<Page> 2>&1 | tail -5` 后 commit。

---

## Task 11: 全量验证 + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

### Step 11.1: 跑全部后端 + 前端测试

```bash
cd /d/dev/hunter-platform && npx vitest run 2>&1 | tail -6
```

```bash
cd /d/dev/hunter-platform/admin-web && npm run test 2>&1 | tail -6
```

Expected: 956 backend (947 + 9 new) + 172 admin-web (148 + 24 new) = **1128 测试**。

### Step 11.2: Typecheck

```bash
cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -3
cd /d/dev/hunter-platform/admin-web && npx tsc --noEmit 2>&1 | tail -3
```

Expected: 无错误。

### Step 11.3: 更新 CHANGELOG

打开 `CHANGELOG.md`，找到 `v2.4.0 (Sub-D4 Plan 1 — Backend ...)` 段落，扩展为完整 v2.4.0：

```markdown
## v2.4.0 (Sub-D4 — Per-Entity Detail + Webhook Retry Audit) — 2026-06-25

### 新增功能
- **4 个 Per-Entity 详情页**：
  - `/admin/users/:id` — UserDetailPage
  - `/admin/candidates/:id` — CandidateDetailPage
  - `/admin/jobs/:id` — JobDetailPage
  - `/admin/recommendations/:id` — RecommendationDetailPage
- 详情页内容：基本信息（header）+ 关联数据表（placements / recommendations / unlocks）+ 「查看时间轴」链接
- **4 个 GET :id endpoint**：返回单条 entity，404 if not found
- **Webhook retry 写 audit log**（Sub-D3 known limitation fix）：`webhooks.retry()` 写 `admin_action_log`（action='retry_webhook'）
- **4 个列表页行末「详情」按钮**：UsersPage / CandidatesPage / JobsPage / RecommendationsPage

### Breaking changes
- `webhooks.retry()` handler signature 加 `adminUserId` 参数

### 测试
- 后端 +9 个集成测试
- 前端 +24 个组件/页面测试
- **总计：1128 测试**

### 已知限制
- 详情页 admin 快捷操作（suspend user / cancel placement）— 留 Sub-D5
- filter URL 持久化扩展到详情页 — 留 Sub-D5 follow-up
```

### Step 11.4: Commit

```bash
git -C D:/dev/hunter-platform add CHANGELOG.md
git -C D:/dev/hunter-platform commit -m "docs(changelog): v2.4.0 — Sub-D4 full (Per-Entity Detail + Webhook Retry Audit)"
```

### Step 11.5: 最终 sanity check

```bash
git -C D:/dev/hunter-platform log --oneline -30
```

确认 Plan 2 所有 task 已 commit（应有 11 个新 commit）。

---

## Done criteria（Plan 2 完成）

- [ ] 4 个详情页渲染、关联数据加载、错误处理都工作
- [ ] 4 个列表页「详情」按钮跳转
- [ ] 「查看时间轴」链接到 Sub-D2 timeline
- [ ] ~24 新前端测试通过 + 现有不退
- [ ] 全 typecheck 干净
- [ ] CHANGELOG v2.4.0 完整条目
- [ ] 11 个 task 都 commit

**Sub-D4 全部完成。** 下一步可选：Sub-D5（详情页 admin 快捷操作）或 Sub-E（config UI）。