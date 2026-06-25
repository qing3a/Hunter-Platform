# Web Admin Sub-D2 Plan 2: Frontend Timeline Pages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **前置依赖：** Plan 1 (`2026-06-25-web-admin-sub-D2-plan-1-backend.md`) 必须**先 merge 到 main**。本 plan 修改 frontend 来消费 backend 的新 endpoint。

**Goal:** 给 admin-web 加 4 个 per-entity timeline 页面（user/candidate/job/recommendation），共享 `<TimelineFilterBar>` + `<TimelineList>` 组件，给 4 个列表页行末加「时间轴」按钮作为入口。

**Architecture:**
- **前端**：1 个 API wrapper + 2 个共享组件 + 4 个 timeline page + 4 个列表页按钮 + 路由注册
- **测试**：~31 个新测试覆盖 API wrapper + 2 组件 + 4 页面 + 4 按钮
- **数据库**：0 改动
- **后端**：0 改动（Plan 1 已交付）

**Tech Stack (existing):** React 18, Vite, react-router-dom, vanilla CSS, vitest+jsdom+RTL
**Tech Stack (new):** 无
**Spec:** [docs/superpowers/specs/2026-06-25-web-admin-sub-D2-design.md](../specs/2026-06-25-web-admin-sub-D2-design.md) — §4 frontend design

---

## 0. Reviewer decisions

| 反馈点 | 决策 |
|--------|------|
| 4 page 文件 vs 1 通用 component | **4 个独立 page**（重复但易读，符合 Sub-C 风格） |
| 复用 `<AuditJsonDrawer>` | ✅ Sub-D1 已建，直接复用 |
| source badge 颜色 | admin=蓝、user=绿、unlock=橙 |
| filter 不持久化到 URL | 简化实现 |

---

## 现有代码上下文（开始 Task 1 前必读）

实施前应熟悉的文件：

- `admin-web/src/api/raw.ts` — `apiFetchRaw<T>()` 返回 envelope（Sub-B 加的）
- `admin-web/src/components/AuditJsonDrawer.tsx` — 通用详情侧滑（Sub-D1）
- `admin-web/src/components/Skeleton.tsx` — 4 变体加载占位（Sub-C）
- `admin-web/src/components/Pagination.tsx` — 分页组件（Sub-B）
- `admin-web/src/components/SearchBar.tsx` — SearchBar（Sub-B），本计划不直接复用但参考其 API
- `admin-web/src/api/users.ts` — `listUsers()` 模式参考
- `admin-web/src/pages/UsersPage.tsx` — 列表页范本（Sub-C 加过「详情」按钮）
- `admin-web/tests/helpers/render-with-router.tsx` — 路由测试 helper（Sub-B 加的）

**不动文件：**
- `src/main/**`（Plan 1 范围已交付，不动）
- `admin-web/src/components/Layout.tsx`（侧边栏不变）
- `admin-web/src/pages/CandidatesPage.tsx` 等 4 个列表页只加按钮，不改其他

---

## File Structure

| File | Change |
|------|--------|
| `admin-web/src/api/timeline.ts` | **Create** — `getTimeline()` + types |
| `admin-web/src/components/TimelineFilterBar.tsx` | **Create** |
| `admin-web/src/components/TimelineList.tsx` | **Create** |
| `admin-web/src/pages/UserTimelinePage.tsx` | **Create** |
| `admin-web/src/pages/CandidateTimelinePage.tsx` | **Create** |
| `admin-web/src/pages/JobTimelinePage.tsx` | **Create** |
| `admin-web/src/pages/RecommendationTimelinePage.tsx` | **Create** |
| `admin-web/src/App.tsx` | **Modify** — +4 routes |
| `admin-web/src/pages/UsersPage.tsx` | **Modify** — +「时间轴」Link |
| `admin-web/src/pages/CandidatesPage.tsx` | **Modify** — +「时间轴」Link |
| `admin-web/src/pages/JobsPage.tsx` | **Modify** — +「时间轴」Link |
| `admin-web/src/pages/RecommendationsPage.tsx` | **Modify** — +「时间轴」Link |
| `CHANGELOG.md` | **Modify** — v2.2.0 条目加 frontend 部分 |

---

## Task 1: API wrapper timeline.ts + test

**Files:**
- Create: `admin-web/src/api/timeline.ts`
- Create: `admin-web/tests/api/timeline.test.ts`

### Step 1.1: 创建 api/timeline.ts

Create `admin-web/src/api/timeline.ts`:

```typescript
import { apiFetchRaw } from './raw';

export type TimelineType = 'user' | 'candidate' | 'job' | 'recommendation';
export type TimelineSource = 'admin' | 'user' | 'unlock';

export type TimelineItem = {
  id: number;
  source: TimelineSource;
  action: string;
  actor: string | null;
  details: string | null;  // raw JSON string
  created_at: string;
};

type Paginated<T> = {
  data: T[];
  pagination: { total: number; page: number; pageSize: number; has_more: boolean };
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
): Promise<Paginated<TimelineItem>> {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts.source && opts.source !== 'all') params.set('source', opts.source);
  if (opts.from) params.set('from', opts.from);
  if (opts.until) params.set('until', opts.until);
  if (opts.actor) params.set('actor', opts.actor);
  const query = params.toString() ? `?${params}` : '';
  const env = await apiFetchRaw<TimelineItem[]>(`timeline/${type}/${id}${query}`);
  if (!env.ok || !env.data || !env.pagination) {
    throw new Error(env.error?.message ?? 'Failed to fetch timeline');
  }
  return { data: env.data, pagination: env.pagination };
}
```

### Step 1.2: 创建 test

Create `admin-web/tests/api/timeline.test.ts`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTimeline } from '../../src/api/timeline';

vi.mock('../../src/api/raw', () => ({
  apiFetchRaw: vi.fn(),
}));

import { apiFetchRaw } from '../../src/api/raw';

describe('getTimeline (Sub-D2 Plan 2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. type=user — calls /v1/admin/timeline/user/:id', async () => {
    (apiFetchRaw as any).mockResolvedValue({
      ok: true, data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false },
    });
    await getTimeline('user', 'usr_1');
    expect(apiFetchRaw).toHaveBeenCalledWith('timeline/user/usr_1');
  });

  it('2. type=candidate with source=admin includes source param', async () => {
    (apiFetchRaw as any).mockResolvedValue({
      ok: true, data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false },
    });
    await getTimeline('candidate', 'can_1', { source: 'admin' });
    expect(apiFetchRaw).toHaveBeenCalledWith(expect.stringContaining('source=admin'));
  });

  it('3. type=job with from + until — both params included', async () => {
    (apiFetchRaw as any).mockResolvedValue({
      ok: true, data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false },
    });
    await getTimeline('job', 'job_1', {
      from: '2026-06-01T00:00:00Z',
      until: '2026-06-30T23:59:59Z',
    });
    const call = (apiFetchRaw as any).mock.calls[0][0];
    expect(call).toContain('from=2026-06-01');
    expect(call).toContain('until=2026-06-30');
  });

  it('4. type=recommendation with actor — actor param included', async () => {
    (apiFetchRaw as any).mockResolvedValue({
      ok: true, data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false },
    });
    await getTimeline('recommendation', 'rec_1', { actor: 'adm_default' });
    expect(apiFetchRaw).toHaveBeenCalledWith(expect.stringContaining('actor=adm_default'));
  });

  it('5. throws on non-ok response', async () => {
    (apiFetchRaw as any).mockResolvedValue({
      ok: false, error: { code: 'INVALID_PARAMS', message: 'invalid type' },
    });
    await expect(getTimeline('user', 'x')).rejects.toThrow('invalid type');
  });
});
```

### Step 1.3: 跑测试

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/api/timeline.test.ts 2>&1 | tail -8`
Expected: 5 通过。

### Step 1.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/api/timeline.ts admin-web/tests/api/timeline.test.ts
git -C D:/dev/hunter-platform commit -m "feat(admin-web): api/timeline — getTimeline() + test"
```

---

## Task 2: TimelineFilterBar 组件 + test

**Files:**
- Create: `admin-web/src/components/TimelineFilterBar.tsx`
- Create: `admin-web/tests/components/TimelineFilterBar.test.tsx`

### Step 2.1: 创建 TimelineFilterBar.tsx

Create `admin-web/src/components/TimelineFilterBar.tsx`:

```tsx
type Source = 'all' | 'admin' | 'user' | 'unlock';

type TimelineFilterBarProps = {
  source: Source;
  onSourceChange: (s: Source) => void;
  from: string;
  onFromChange: (v: string) => void;
  until: string;
  onUntilChange: (v: string) => void;
  actor: string;
  onActorChange: (v: string) => void;
  onClear: () => void;
};

export default function TimelineFilterBar(props: TimelineFilterBarProps) {
  const { source, onSourceChange, from, onFromChange, until, onUntilChange, actor, onActorChange, onClear } = props;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
      <select
        value={source}
        onChange={e => onSourceChange(e.target.value as Source)}
        data-testid="timeline-source-filter"
        style={{ padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
      >
        <option value="all">来源:全部</option>
        <option value="admin">来源:admin</option>
        <option value="user">来源:user</option>
        <option value="unlock">来源:unlock</option>
      </select>
      <label>
        从{' '}
        <input
          type="date"
          value={from.slice(0, 10)}
          onChange={e => onFromChange(e.target.value ? e.target.value + 'T00:00:00Z' : '')}
          data-testid="timeline-from"
          style={{ padding: 4 }}
        />
      </label>
      <label>
        至{' '}
        <input
          type="date"
          value={until.slice(0, 10)}
          onChange={e => onUntilChange(e.target.value ? e.target.value + 'T23:59:59Z' : '')}
          data-testid="timeline-until"
          style={{ padding: 4 }}
        />
      </label>
      <input
        type="text"
        placeholder="操作人搜索..."
        value={actor}
        onChange={e => onActorChange(e.target.value)}
        data-testid="timeline-actor"
        style={{ padding: 8, border: '1px solid #ccc', borderRadius: 4, width: 200 }}
      />
      <button onClick={onClear} className="btn" data-testid="timeline-clear">
        清除
      </button>
    </div>
  );
}
```

### Step 2.2: 创建 TimelineFilterBar.test.tsx

Create `admin-web/tests/components/TimelineFilterBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TimelineFilterBar from '../../src/components/TimelineFilterBar';

describe('TimelineFilterBar (Sub-D2)', () => {
  it('1. renders 4 filter controls', () => {
    render(
      <TimelineFilterBar
        source="all" onSourceChange={() => {}}
        from="" onFromChange={() => {}}
        until="" onUntilChange={() => {}}
        actor="" onActorChange={() => {}}
        onClear={() => {}}
      />,
    );
    expect(screen.getByTestId('timeline-source-filter')).toBeTruthy();
    expect(screen.getByTestId('timeline-from')).toBeTruthy();
    expect(screen.getByTestId('timeline-until')).toBeTruthy();
    expect(screen.getByTestId('timeline-actor')).toBeTruthy();
    expect(screen.getByTestId('timeline-clear')).toBeTruthy();
  });

  it('2. changing source calls onSourceChange', () => {
    const onSourceChange = vi.fn();
    render(
      <TimelineFilterBar
        source="all" onSourceChange={onSourceChange}
        from="" onFromChange={() => {}}
        until="" onUntilChange={() => {}}
        actor="" onActorChange={() => {}}
        onClear={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId('timeline-source-filter'), { target: { value: 'admin' } });
    expect(onSourceChange).toHaveBeenCalledWith('admin');
  });

  it('3. clicking 清除 calls onClear', () => {
    const onClear = vi.fn();
    render(
      <TimelineFilterBar
        source="admin" onSourceChange={() => {}}
        from="2026-06-25T00:00:00Z" onFromChange={() => {}}
        until="2026-06-25T23:59:59Z" onUntilChange={() => {}}
        actor="adm_1" onActorChange={() => {}}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByTestId('timeline-clear'));
    expect(onClear).toHaveBeenCalled();
  });
});
```

### Step 2.3: 跑测试

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/components/TimelineFilterBar.test.tsx 2>&1 | tail -8`
Expected: 3 通过。

### Step 2.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/components/TimelineFilterBar.tsx admin-web/tests/components/TimelineFilterBar.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): TimelineFilterBar — source + from/until + actor + clear"
```

---

## Task 3: TimelineList 组件 + test

**Files:**
- Create: `admin-web/src/components/TimelineList.tsx`
- Create: `admin-web/tests/components/TimelineList.test.tsx`

### Step 3.1: 创建 TimelineList.tsx

Create `admin-web/src/components/TimelineList.tsx`:

```tsx
import { useState } from 'react';
import AuditJsonDrawer from './AuditJsonDrawer';
import StatusBadge from './StatusBadge';
import { relativeTime } from '../lib/format';
import type { TimelineItem } from '../api/timeline';

const SOURCE_COLORS: Record<string, { bg: string; fg: string }> = {
  admin:  { bg: '#e6f7ff', fg: '#1890ff' },
  user:   { bg: '#f6ffed', fg: '#52c41a' },
  unlock: { bg: '#fff7e6', fg: '#fa8c16' },
};

type TimelineListProps = {
  items: TimelineItem[];
  loading: boolean;
  empty: string;
};

export default function TimelineList({ items, loading, empty }: TimelineListProps) {
  const [drawer, setDrawer] = useState<{ open: boolean; title: string; data: unknown }>({
    open: false, title: '', data: null,
  });

  if (loading) return <div>加载中...</div>;
  if (items.length === 0) return <div className="card">{empty}</div>;

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(item => {
          const color = SOURCE_COLORS[item.source] || SOURCE_COLORS.admin;
          return (
            <div
              key={`${item.source}-${item.id}`}
              data-testid={`timeline-item-${item.id}`}
              style={{ background: 'white', border: '1px solid #e0e0e0', borderRadius: 4, padding: 12 }}
            >
              <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
                {relativeTime(item.created_at)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span
                  data-testid={`timeline-source-${item.source}`}
                  style={{
                    background: color.bg, color: color.fg,
                    padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 'bold',
                  }}
                >
                  {item.source}
                </span>
                <code style={{ fontSize: 14 }}>{item.action}</code>
              </div>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>
                操作人: {item.actor ?? '—'}
              </div>
              {item.details && (
                <button
                  className="btn btn-sm"
                  data-testid={`timeline-detail-${item.id}`}
                  onClick={() => setDrawer({
                    open: true,
                    title: `${item.action} @ ${item.created_at}`,
                    data: item.details,
                  })}
                >
                  查看 JSON 详情
                </button>
              )}
            </div>
          );
        })}
      </div>
      <AuditJsonDrawer
        open={drawer.open}
        title={drawer.title}
        data={drawer.data}
        onClose={() => setDrawer({ open: false, title: '', data: null })}
      />
    </>
  );
}
```

### Step 3.2: 创建 TimelineList.test.tsx

Create `admin-web/tests/components/TimelineList.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TimelineList from '../../src/components/TimelineList';
import type { TimelineItem } from '../../src/api/timeline';

const items: TimelineItem[] = [
  {
    id: 1, source: 'admin', action: 'adjust_user_quota', actor: 'adm_1',
    details: '{"previous_quota":10,"new_quota":20}', created_at: '2026-06-25T10:00:00Z',
  },
  {
    id: 2, source: 'user', action: 'candidate.upload_resume', actor: 'u_1',
    details: null, created_at: '2026-06-25T11:00:00Z',
  },
];

describe('TimelineList (Sub-D2)', () => {
  it('1. renders items with source badges', () => {
    render(<TimelineList items={items} loading={false} empty="no events" />);
    expect(screen.getByTestId('timeline-item-1')).toBeTruthy();
    expect(screen.getByTestId('timeline-item-2')).toBeTruthy();
    expect(screen.getByTestId('timeline-source-admin')).toBeTruthy();
    expect(screen.getByTestId('timeline-source-user')).toBeTruthy();
  });

  it('2. clicking 详情 opens drawer (when details present)', () => {
    render(<TimelineList items={items} loading={false} empty="no events" />);
    fireEvent.click(screen.getByTestId('timeline-detail-1'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('3. no 详情 button when details is null', () => {
    render(<TimelineList items={items} loading={false} empty="no events" />);
    expect(screen.queryByTestId('timeline-detail-2')).toBeNull();
  });

  it('4. shows empty state when items is empty', () => {
    render(<TimelineList items={[]} loading={false} empty="暂无事件" />);
    expect(screen.getByText('暂无事件')).toBeTruthy();
  });
});
```

### Step 3.3: 跑测试

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/components/TimelineList.test.tsx 2>&1 | tail -8`
Expected: 4 通过。

### Step 3.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/components/TimelineList.tsx admin-web/tests/components/TimelineList.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): TimelineList — flat list with source badges + AuditJsonDrawer"
```

---

## Task 4: UserTimelinePage + test

**Files:**
- Create: `admin-web/src/pages/UserTimelinePage.tsx`
- Create: `admin-web/tests/pages/UserTimelinePage.test.tsx`

### Step 4.1: 创建 UserTimelinePage.tsx

Create `admin-web/src/pages/UserTimelinePage.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import TimelineFilterBar from '../components/TimelineFilterBar';
import TimelineList from '../components/TimelineList';
import Pagination from '../components/Pagination';
import Skeleton from '../components/Skeleton';
import { getTimeline, type TimelineItem } from '../api/timeline';

export default function UserTimelinePage() {
  const { id } = useParams<{ id: string }>();
  const [source, setSource] = useState<'all' | 'admin' | 'user' | 'unlock'>('all');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [actor, setActor] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<TimelineItem[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 20, has_more: false });
  const [loading, setLoading] = useState(true);

  const load = useCallback((p: number, src: string, f: string, u: string, a: string) => {
    if (!id) return;
    setLoading(true);
    getTimeline('user', id, {
      page: p, pageSize: 20,
      source: src as any,
      from: f || undefined, until: u || undefined, actor: a || undefined,
    })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .catch(err => console.error('Timeline load failed:', err))
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

### Step 4.2: 创建 UserTimelinePage.test.tsx

Create `admin-web/tests/pages/UserTimelinePage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import UserTimelinePage from '../../src/pages/UserTimelinePage';

vi.mock('../../src/api/timeline', () => ({
  getTimeline: vi.fn(),
}));

import { getTimeline } from '../../src/api/timeline';

const renderPage = (id = 'usr_1') => render(
  <MemoryRouter initialEntries={[`/users/${id}/timeline`]}>
    <Routes>
      <Route path="/users/:id/timeline" element={<UserTimelinePage />} />
    </Routes>
  </MemoryRouter>
);

const mockItem = {
  id: 1, source: 'admin' as const, action: 'adjust_user_quota', actor: 'adm_1',
  details: null, created_at: '2026-06-25T10:00:00Z',
};

describe('UserTimelinePage (Sub-D2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getTimeline as any).mockResolvedValue({
      data: [mockItem],
      pagination: { total: 1, page: 1, pageSize: 20, has_more: false },
    });
  });

  it('1. mount calls getTimeline with type=user and id from URL', async () => {
    renderPage('usr_42');
    await waitFor(() => expect(getTimeline).toHaveBeenCalledWith('user', 'usr_42', expect.any(Object)));
  });

  it('2. changing source filter triggers refetch', async () => {
    renderPage();
    await waitFor(() => expect(getTimeline).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByTestId('timeline-source-filter'), { target: { value: 'admin' } });
    await waitFor(() => expect(getTimeline).toHaveBeenCalledWith('user', expect.any(String), expect.objectContaining({ source: 'admin' })));
  });

  it('3. clearing filter resets all fields', async () => {
    renderPage();
    await waitFor(() => expect(getTimeline).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByTestId('timeline-source-filter'), { target: { value: 'admin' } });
    await waitFor(() => expect(getTimeline).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByTestId('timeline-clear'));
    await waitFor(() => expect(getTimeline).toHaveBeenLastCalledWith('user', expect.any(String), expect.objectContaining({ source: undefined })));
  });

  it('4. shows empty state when no items', async () => {
    (getTimeline as any).mockResolvedValueOnce({
      data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false },
    });
    renderPage('usr_empty');
    await waitFor(() => expect(screen.getByText('暂无事件')).toBeTruthy());
  });
});
```

### Step 4.3: 跑测试

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/pages/UserTimelinePage.test.tsx 2>&1 | tail -8`
Expected: 4 通过。

### Step 4.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/UserTimelinePage.tsx admin-web/tests/pages/UserTimelinePage.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): UserTimelinePage — list + filter + pagination"
```

---

## Task 5: CandidateTimelinePage + test

**Files:**
- Create: `admin-web/src/pages/CandidateTimelinePage.tsx`
- Create: `admin-web/tests/pages/CandidateTimelinePage.test.tsx`

### Step 5.1: 创建 CandidateTimelinePage.tsx

Create `admin-web/src/pages/CandidateTimelinePage.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import TimelineFilterBar from '../components/TimelineFilterBar';
import TimelineList from '../components/TimelineList';
import Pagination from '../components/Pagination';
import Skeleton from '../components/Skeleton';
import { getTimeline, type TimelineItem } from '../api/timeline';

export default function CandidateTimelinePage() {
  const { id } = useParams<{ id: string }>();
  const [source, setSource] = useState<'all' | 'admin' | 'user' | 'unlock'>('all');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [actor, setActor] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<TimelineItem[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 20, has_more: false });
  const [loading, setLoading] = useState(true);

  const load = useCallback((p: number, src: string, f: string, u: string, a: string) => {
    if (!id) return;
    setLoading(true);
    getTimeline('candidate', id, {
      page: p, pageSize: 20,
      source: src as any,
      from: f || undefined, until: u || undefined, actor: a || undefined,
    })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .catch(err => console.error('Timeline load failed:', err))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(page, source, from, until, actor); }, [load, page, source, from, until, actor]);

  return (
    <Layout adminName="Admin">
      <h1>候选人时间轴 — {id}</h1>
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

### Step 5.2: 创建 CandidateTimelinePage.test.tsx

Create `admin-web/tests/pages/CandidateTimelinePage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import CandidateTimelinePage from '../../src/pages/CandidateTimelinePage';

vi.mock('../../src/api/timeline', () => ({
  getTimeline: vi.fn(),
}));

import { getTimeline } from '../../src/api/timeline';

const renderPage = (id = 'can_1') => render(
  <MemoryRouter initialEntries={[`/candidates/${id}/timeline`]}>
    <Routes>
      <Route path="/candidates/:id/timeline" element={<CandidateTimelinePage />} />
    </Routes>
  </MemoryRouter>
);

const mockItem = {
  id: 1, source: 'unlock' as const, action: 'unlock_employer_view',
  actor: 'u_2', details: null, created_at: '2026-06-25T10:00:00Z',
};

describe('CandidateTimelinePage (Sub-D2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getTimeline as any).mockResolvedValue({
      data: [mockItem],
      pagination: { total: 1, page: 1, pageSize: 20, has_more: false },
    });
  });

  it('1. mount calls getTimeline with type=candidate and id', async () => {
    renderPage('can_42');
    await waitFor(() => expect(getTimeline).toHaveBeenCalledWith('candidate', 'can_42', expect.any(Object)));
  });

  it('2. renders unlock source badge', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('timeline-source-unlock'));
  });

  it('3. empty state', async () => {
    (getTimeline as any).mockResolvedValueOnce({
      data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false },
    });
    renderPage('can_empty');
    await waitFor(() => expect(screen.getByText('暂无事件')).toBeTruthy());
  });

  it('4. page title contains candidate id', async () => {
    renderPage('can_XYZ');
    await waitFor(() => expect(screen.getByText(/候选人时间轴 — can_XYZ/)).toBeTruthy());
  });
});
```

### Step 5.3: 跑测试

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/pages/CandidateTimelinePage.test.tsx 2>&1 | tail -8`
Expected: 4 通过。

### Step 5.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/CandidateTimelinePage.tsx admin-web/tests/pages/CandidateTimelinePage.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): CandidateTimelinePage"
```

---

## Task 6: JobTimelinePage + test

**Files:**
- Create: `admin-web/src/pages/JobTimelinePage.tsx`
- Create: `admin-web/tests/pages/JobTimelinePage.test.tsx`

### Step 6.1: 创建 JobTimelinePage.tsx

Create `admin-web/src/pages/JobTimelinePage.tsx` — 与 User/Candidate 几乎相同，只 type='job'：

```tsx
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import TimelineFilterBar from '../components/TimelineFilterBar';
import TimelineList from '../components/TimelineList';
import Pagination from '../components/Pagination';
import Skeleton from '../components/Skeleton';
import { getTimeline, type TimelineItem } from '../api/timeline';

export default function JobTimelinePage() {
  const { id } = useParams<{ id: string }>();
  const [source, setSource] = useState<'all' | 'admin' | 'user' | 'unlock'>('all');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [actor, setActor] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<TimelineItem[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 20, has_more: false });
  const [loading, setLoading] = useState(true);

  const load = useCallback((p: number, src: string, f: string, u: string, a: string) => {
    if (!id) return;
    setLoading(true);
    getTimeline('job', id, {
      page: p, pageSize: 20,
      source: src as any,
      from: f || undefined, until: u || undefined, actor: a || undefined,
    })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .catch(err => console.error('Timeline load failed:', err))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(page, source, from, until, actor); }, [load, page, source, from, until, actor]);

  return (
    <Layout adminName="Admin">
      <h1>职位时间轴 — {id}</h1>
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

### Step 6.2: 创建 JobTimelinePage.test.tsx

Create `admin-web/tests/pages/JobTimelinePage.test.tsx`（与 CandidateTimelinePage 测试结构相同，只改 type 和 url）：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import JobTimelinePage from '../../src/pages/JobTimelinePage';

vi.mock('../../src/api/timeline', () => ({
  getTimeline: vi.fn(),
}));

import { getTimeline } from '../../src/api/timeline';

const renderPage = (id = 'job_1') => render(
  <MemoryRouter initialEntries={[`/jobs/${id}/timeline`]}>
    <Routes>
      <Route path="/jobs/:id/timeline" element={<JobTimelinePage />} />
    </Routes>
  </MemoryRouter>
);

const mockItem = {
  id: 1, source: 'admin' as const, action: 'pause_job', actor: 'adm_1',
  details: null, created_at: '2026-06-25T10:00:00Z',
};

describe('JobTimelinePage (Sub-D2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getTimeline as any).mockResolvedValue({
      data: [mockItem],
      pagination: { total: 1, page: 1, pageSize: 20, has_more: false },
    });
  });

  it('1. mount calls getTimeline with type=job and id', async () => {
    renderPage('job_42');
    await waitFor(() => expect(getTimeline).toHaveBeenCalledWith('job', 'job_42', expect.any(Object)));
  });

  it('2. renders admin source badge', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('timeline-source-admin'));
  });

  it('3. empty state', async () => {
    (getTimeline as any).mockResolvedValueOnce({
      data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false },
    });
    renderPage('job_empty');
    await waitFor(() => expect(screen.getByText('暂无事件')).toBeTruthy());
  });

  it('4. page title contains job id', async () => {
    renderPage('job_XYZ');
    await waitFor(() => expect(screen.getByText(/职位时间轴 — job_XYZ/)).toBeTruthy());
  });
});
```

### Step 6.3: 跑测试 + commit

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/pages/JobTimelinePage.test.tsx 2>&1 | tail -8`
Expected: 4 通过。

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/JobTimelinePage.tsx admin-web/tests/pages/JobTimelinePage.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): JobTimelinePage"
```

---

## Task 7: RecommendationTimelinePage + test

**Files:**
- Create: `admin-web/src/pages/RecommendationTimelinePage.tsx`
- Create: `admin-web/tests/pages/RecommendationTimelinePage.test.tsx`

### Step 7.1: 创建 RecommendationTimelinePage.tsx

Create `admin-web/src/pages/RecommendationTimelinePage.tsx`（type='recommendation'）：

```tsx
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import TimelineFilterBar from '../components/TimelineFilterBar';
import TimelineList from '../components/TimelineList';
import Pagination from '../components/Pagination';
import Skeleton from '../components/Skeleton';
import { getTimeline, type TimelineItem } from '../api/timeline';

export default function RecommendationTimelinePage() {
  const { id } = useParams<{ id: string }>();
  const [source, setSource] = useState<'all' | 'admin' | 'user' | 'unlock'>('all');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [actor, setActor] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<TimelineItem[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 20, has_more: false });
  const [loading, setLoading] = useState(true);

  const load = useCallback((p: number, src: string, f: string, u: string, a: string) => {
    if (!id) return;
    setLoading(true);
    getTimeline('recommendation', id, {
      page: p, pageSize: 20,
      source: src as any,
      from: f || undefined, until: u || undefined, actor: a || undefined,
    })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .catch(err => console.error('Timeline load failed:', err))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(page, source, from, until, actor); }, [load, page, source, from, until, actor]);

  return (
    <Layout adminName="Admin">
      <h1>推荐时间轴 — {id}</h1>
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

### Step 7.2: 创建 RecommendationTimelinePage.test.tsx

Create `admin-web/tests/pages/RecommendationTimelinePage.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import RecommendationTimelinePage from '../../src/pages/RecommendationTimelinePage';

vi.mock('../../src/api/timeline', () => ({
  getTimeline: vi.fn(),
}));

import { getTimeline } from '../../src/api/timeline';

const renderPage = (id = 'rec_1') => render(
  <MemoryRouter initialEntries={[`/recommendations/${id}/timeline`]}>
    <Routes>
      <Route path="/recommendations/:id/timeline" element={<RecommendationTimelinePage />} />
    </Routes>
  </MemoryRouter>
);

const mockItem = {
  id: 1, source: 'unlock' as const, action: 'candidate_approved', actor: 'u_3',
  details: null, created_at: '2026-06-25T10:00:00Z',
};

describe('RecommendationTimelinePage (Sub-D2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getTimeline as any).mockResolvedValue({
      data: [mockItem],
      pagination: { total: 1, page: 1, pageSize: 20, has_more: false },
    });
  });

  it('1. mount calls getTimeline with type=recommendation and id', async () => {
    renderPage('rec_42');
    await waitFor(() => expect(getTimeline).toHaveBeenCalledWith('recommendation', 'rec_42', expect.any(Object)));
  });

  it('2. renders unlock source badge', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('timeline-source-unlock'));
  });

  it('3. empty state', async () => {
    (getTimeline as any).mockResolvedValueOnce({
      data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false },
    });
    renderPage('rec_empty');
    await waitFor(() => expect(screen.getByText('暂无事件')).toBeTruthy());
  });

  it('4. page title contains recommendation id', async () => {
    renderPage('rec_XYZ');
    await waitFor(() => expect(screen.getByText(/推荐时间轴 — rec_XYZ/)).toBeTruthy());
  });
});
```

### Step 7.3: 跑测试 + commit

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/pages/RecommendationTimelinePage.test.tsx 2>&1 | tail -8`
Expected: 4 通过。

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/RecommendationTimelinePage.tsx admin-web/tests/pages/RecommendationTimelinePage.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): RecommendationTimelinePage"
```

---

## Task 8: App.tsx 路由注册

**Files:**
- Modify: `admin-web/src/App.tsx`

### Step 8.1: 加 4 个 route

打开 `admin-web/src/App.tsx`，找到 `import JobsPage` 附近，加 4 个 import：

```tsx
import UserTimelinePage from './pages/UserTimelinePage';
import CandidateTimelinePage from './pages/CandidateTimelinePage';
import JobTimelinePage from './pages/JobTimelinePage';
import RecommendationTimelinePage from './pages/RecommendationTimelinePage';
```

找到现有的 `<Route path="/recommendations" ...>` 行，在它之后加 4 个：

```tsx
        <Route path="/users/:id/timeline" element={<PrivateRoute><UserTimelinePage /></PrivateRoute>} />
        <Route path="/candidates/:id/timeline" element={<PrivateRoute><CandidateTimelinePage /></PrivateRoute>} />
        <Route path="/jobs/:id/timeline" element={<PrivateRoute><JobTimelinePage /></PrivateRoute>} />
        <Route path="/recommendations/:id/timeline" element={<PrivateRoute><RecommendationTimelinePage /></PrivateRoute>} />
```

### Step 8.2: Typecheck

Run: `cd /d/dev/hunter-platform/admin-web && npx tsc --noEmit 2>&1 | tail -3`
Expected: no errors。

### Step 8.3: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/App.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): App routes — +4 timeline routes"
```

---

## Task 9-12: 列表页「时间轴」按钮（4 处）

每个 list page 同样模式：找到 `columns` 数组，在「操作」列加 Link 按钮。test 加 1 case 验证 Link 存在。

### Task 9: UsersPage

**Files:**
- Modify: `admin-web/src/pages/UsersPage.tsx`
- Modify: `admin-web/tests/pages/UsersPage.test.tsx`

#### Step 9.1: 加 import

```tsx
import { Link } from 'react-router-dom';
```

#### Step 9.2: 在 columns 的「操作」列加 Link

找到 columns 定义中已有的「操作」列（如没有，在末尾添加），加一个 Link：

```tsx
    {
      key: 'timeline', header: '时间轴',
      render: r => <Link to={`/users/${r.id}/timeline`} className="btn btn-sm" data-testid={`user-timeline-${r.id}`}>时间轴</Link>,
    },
```

#### Step 9.3: 加 test case

在 describe 末尾加：

```tsx
  it('shows 时间轴 link for each user row', async () => {
    (listUsers as any).mockResolvedValue({
      data: [{ id: 'u_1', user_type: 'candidate', name: 'A', status: 'active', quota_per_day: 100, quota_used: 0, quota_reset_at: '', reputation: 50, created_at: '2026-06-25T00:00:00Z' }],
      pagination: { total: 1, page: 1, pageSize: 20, has_more: false },
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('user-timeline-u_1')).toBeTruthy());
  });
```

（如果 UsersPage.test.tsx 已有 Link import，需要更新 import。）

#### Step 9.4: 跑测试 + commit

```bash
cd /d/dev/hunter-platform/admin-web && npm run test -- tests/pages/UsersPage 2>&1 | tail -5
```

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/UsersPage.tsx admin-web/tests/pages/UsersPage.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): UsersPage — +时间轴 link"
```

### Task 10: CandidatesPage（同模式）

**Files:**
- Modify: `admin-web/src/pages/CandidatesPage.tsx`
- Modify: `admin-web/tests/pages/CandidatesList.test.tsx`（或实际文件名）

#### Step 10.1: 加 import

```tsx
import { Link } from 'react-router-dom';
```

#### Step 10.2: 加 column

```tsx
    {
      key: 'timeline', header: '时间轴',
      render: r => <Link to={`/candidates/${r.anonymized_id}/timeline`} className="btn btn-sm" data-testid={`candidate-timeline-${r.anonymized_id}`}>时间轴</Link>,
    },
```

注：candidates 的 id 字段是 `r.anonymized_id`（不是 `r.id`）。

#### Step 10.3: 加 test + commit

```bash
cd /d/dev/hunter-platform/admin-web && npm run test -- tests/pages/CandidatesList 2>&1 | tail -5
```

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/CandidatesPage.tsx admin-web/tests/pages/CandidatesList.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): CandidatesPage — +时间轴 link"
```

### Task 11: JobsPage（同模式）

**Files:**
- Modify: `admin-web/src/pages/JobsPage.tsx`
- Modify: `admin-web/tests/pages/JobsPage.test.tsx`

#### Step 11.1: 加 import

```tsx
import { Link } from 'react-router-dom';
```

#### Step 11.2: 加 column

```tsx
    {
      key: 'timeline', header: '时间轴',
      render: r => <Link to={`/jobs/${r.id}/timeline`} className="btn btn-sm" data-testid={`job-timeline-${r.id}`}>时间轴</Link>,
    },
```

#### Step 11.3: 加 test + commit

```bash
cd /d/dev/hunter-platform/admin-web && npm run test -- tests/pages/JobsPage 2>&1 | tail -5
```

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/JobsPage.tsx admin-web/tests/pages/JobsPage.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): JobsPage — +时间轴 link"
```

### Task 12: RecommendationsPage（同模式）

**Files:**
- Modify: `admin-web/src/pages/RecommendationsPage.tsx`
- Modify: `admin-web/tests/pages/RecommendationsPage.test.tsx`

#### Step 12.1: 加 import

```tsx
import { Link } from 'react-router-dom';
```

#### Step 12.2: 加 column

```tsx
    {
      key: 'timeline', header: '时间轴',
      render: r => <Link to={`/recommendations/${r.id}/timeline`} className="btn btn-sm" data-testid={`rec-timeline-${r.id}`}>时间轴</Link>,
    },
```

#### Step 12.3: 加 test + commit

```bash
cd /d/dev/hunter-platform/admin-web && npm run test -- tests/pages/RecommendationsPage 2>&1 | tail -5
```

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/RecommendationsPage.tsx admin-web/tests/pages/RecommendationsPage.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): RecommendationsPage — +时间轴 link"
```

---

## Task 13: 全量验证 + CHANGELOG + Handoff

**Files:**
- Modify: `CHANGELOG.md`
- Create: `docs/superpowers/plans/2026-06-25-web-admin-sub-D2-HANDOFF.md`（可选）

### Step 13.1: 跑全部后端 + 前端测试

```bash
cd /d/dev/hunter-platform && npx vitest run 2>&1 | tail -6
```

Expected: 全绿（932 backend from Plan 1）。

```bash
cd /d/dev/hunter-platform/admin-web && npm run test 2>&1 | tail -6
```

Expected: 88 + ~31 新测试 = ~119 通过。

### Step 13.2: Typecheck

```bash
cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -3
cd /d/dev/hunter-platform/admin-web && npx tsc --noEmit 2>&1 | tail -3
```

Expected: 无错误。

### Step 13.3: 更新 CHANGELOG

打开 `CHANGELOG.md`，找到 v2.2.0 (Sub-D2 Plan 1 — Backend Timeline) 条目，更新为：

```markdown
## v2.2.0 (Sub-D2 — Per-Entity Timeline) — 2026-06-25

### 新增功能
- **Per-Entity Timeline 后端**：`GET /v1/admin/timeline/:type/:id` UNION 3 audit 表
- **Per-Entity Timeline 前端**：4 个独立页面（user/candidate/job/recommendation）
- **共享组件**：`<TimelineFilterBar>` + `<TimelineList>` + source badges
- **列表入口**：UsersPage / CandidatesPage / JobsPage / RecommendationsPage 行末加「时间轴」按钮
- **Filter 能力**：source（admin/user/unlock）+ 时间范围（from/until）+ actor 搜索
- **新 capability**：`admin.get_timeline`

### 测试
- 后端 +15 个集成测试
- 前端 +31 个组件/页面测试

### Plan
- Plan 1（backend）：`docs/superpowers/plans/2026-06-25-web-admin-sub-D2-plan-1-backend.md`
- Plan 2（frontend，本 plan）：`docs/superpowers/plans/2026-06-25-web-admin-sub-D2-plan-2-frontend.md`
```

### Step 13.4: Commit

```bash
git -C D:/dev/hunter-platform add CHANGELOG.md
git -C D:/dev/hunter-platform commit -m "docs(changelog): v2.2.0 — Sub-D2 (Per-Entity Timeline, full)"
```

### Step 13.5: 最终 sanity check

```bash
git -C D:/dev/hunter-platform log --oneline -25
```

确认 Plan 2 所有 task 已 commit（应有 13 个新 commit）。

---

## Done criteria（Plan 2 完成）

- [ ] 4 个 timeline page 渲染、filter、详情工作
- [ ] 4 个列表页行末「时间轴」按钮跳转
- [ ] 复用 `<AuditJsonDrawer>` 显示 details
- [ ] ~31 个新前端测试通过 + 现有测试不退
- [ ] 88 admin-web + 31 new + 932 backend = ~963 测试全绿
- [ ] 全 typecheck 干净
- [ ] CHANGELOG v2.2.0 条目更新
- [ ] 13 个 task 都 commit

**Sub-D2 全部完成。** 下一步可选：Sub-D3（webhook + placements）或 Sub-E（config UI）。