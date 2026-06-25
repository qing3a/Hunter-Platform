# Web Admin Sub-D3 Plan 2: Frontend Webhooks + Placements Pages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **前置依赖：** Plan 1 (`2026-06-25-web-admin-sub-D3-plan-1-backend.md`) 必须**先 merge 到 main**。本 plan 消费 backend 的新 paginated endpoints。

**Goal:** 给 admin-web 加 2 个新 page（Webhook 死信 + Placements 列表）+ 共享 ConfirmModal 组件 + Layout/App 路由注册 + Dashboard 「Webhook 死信」卡片 link。

**Architecture:**
- **前端**：2 个 API wrapper + ConfirmModal 组件 + 2 个新 page + Dashboard link + Layout/App 路由
- **测试**：~19 个新前端测试覆盖 API wrapper + ConfirmModal + 2 page

**Tech Stack (existing):** React 18, Vite, react-router-dom, vanilla CSS, vitest+jsdom+RTL
**Spec:** [docs/superpowers/specs/2026-06-25-web-admin-sub-D3-design.md](../specs/2026-06-25-web-admin-sub-D3-design.md) — §4 frontend design

---

## 0. Reviewer decisions

| 反馈点 | 决策 |
|--------|------|
| ConfirmModal | 基于 Sub-C Modal 改造，加 loading/error/variant |
| 按钮点击 mark-paid → ConfirmModal primary | cancel → ConfirmModal danger | retry → 立即触发（无 confirm） |
| URL 持久化 | **不做**（Sub-D3 收工后独立 follow-up） |
| Dashboard 「Webhook 死信」卡片 | 加 `<Link>` 跳 `/webhooks/dead-letter` |

---

## File Structure

| File | Change |
|------|--------|
| `admin-web/src/api/webhooks.ts` | **Create** |
| `admin-web/src/api/placements.ts` | **Create** |
| `admin-web/src/components/ConfirmModal.tsx` | **Create** |
| `admin-web/src/pages/WebhookDeadLetterPage.tsx` | **Create** |
| `admin-web/src/pages/PlacementsPage.tsx` | **Create** |
| `admin-web/src/components/Layout.tsx` | **Modify** — +2 nav |
| `admin-web/src/App.tsx` | **Modify** — +2 routes |
| `admin-web/src/pages/DashboardPage.tsx` | **Modify** — Webhook 死信卡片加 Link |
| `CHANGELOG.md` | **Modify** — v2.3.0 加 frontend 部分 |

---

## Task 1: api/webhooks.ts + test

**Files:**
- Create: `admin-web/src/api/webhooks.ts`
- Create: `admin-web/tests/api/webhooks.test.ts`

### Step 1.1: 创建 api/webhooks.ts

Create `admin-web/src/api/webhooks.ts`:

```typescript
import { apiFetchRaw } from './raw';

export type DeadLetterRow = {
  id: number;
  target_user_id: string;
  event_type: string;
  attempt_count: number;
  last_error: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
};

type Paginated<T> = {
  data: T[];
  pagination: { total: number; page: number; pageSize: number; has_more: boolean };
};

export async function listDeadLetter(opts: {
  page?: number;
  pageSize?: number;
  event_type?: string;
  min_attempt_count?: number;
  from?: string;
  until?: string;
} = {}): Promise<Paginated<DeadLetterRow>> {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts.event_type) params.set('event_type', opts.event_type);
  if (opts.min_attempt_count !== undefined) params.set('min_attempt_count', String(opts.min_attempt_count));
  if (opts.from) params.set('from', opts.from);
  if (opts.until) params.set('until', opts.until);
  const query = params.toString() ? `?${params}` : '';
  const env = await apiFetchRaw<DeadLetterRow[]>('webhooks/dead-letter' + query);
  if (!env.ok || !env.data || !env.pagination) {
    throw new Error(env.error?.message ?? 'Failed to fetch dead-letter list');
  }
  return { data: env.data, pagination: env.pagination };
}

export async function retryDeadLetter(id: number): Promise<{ id: number; status: string }> {
  const env = await apiFetchRaw<{ id: number; status: string }>(`webhooks/${id}/retry`, { method: 'POST' });
  if (!env.ok || !env.data) {
    throw new Error(env.error?.message ?? 'Failed to retry dead-letter');
  }
  return env.data;
}
```

### Step 1.2: 创建 test

Create `admin-web/tests/api/webhooks.test.ts`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listDeadLetter, retryDeadLetter } from '../../src/api/webhooks';

vi.mock('../../src/api/raw', () => ({ apiFetchRaw: vi.fn() }));
import { apiFetchRaw } from '../../src/api/raw';

describe('webhooks api (Sub-D3 Plan 2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. listDeadLetter calls correct endpoint with no params', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } });
    await listDeadLetter();
    expect(apiFetchRaw).toHaveBeenCalledWith('webhooks/dead-letter');
  });

  it('2. listDeadLetter includes event_type + min_attempt_count + from + until', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } });
    await listDeadLetter({ event_type: 'payment.succeeded', min_attempt_count: 3, from: '2026-06-01T00:00:00Z', until: '2026-06-30T23:59:59Z' });
    const call = (apiFetchRaw as any).mock.calls[0][0];
    expect(call).toContain('event_type=payment.succeeded');
    expect(call).toContain('min_attempt_count=3');
    expect(call).toContain('from=2026-06-01');
    expect(call).toContain('until=2026-06-30');
  });

  it('3. retryDeadLetter POSTs to /:id/retry', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: { id: 5, status: 'pending' } });
    await retryDeadLetter(5);
    expect(apiFetchRaw).toHaveBeenCalledWith('webhooks/5/retry', expect.objectContaining({ method: 'POST' }));
  });

  it('4. throws on non-ok response', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: false, error: { code: 'NOT_FOUND', message: 'delivery not found' } });
    await expect(retryDeadLetter(99999)).rejects.toThrow('delivery not found');
  });
});
```

### Step 1.3: 跑测试

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/api/webhooks.test.ts 2>&1 | tail -5`
Expected: 4 通过。

### Step 1.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/api/webhooks.ts admin-web/tests/api/webhooks.test.ts
git -C D:/dev/hunter-platform commit -m "feat(admin-web): api/webhooks — listDeadLetter + retryDeadLetter"
```

---

## Task 2: api/placements.ts + test

**Files:**
- Create: `admin-web/src/api/placements.ts`
- Create: `admin-web/tests/api/placements.test.ts`

### Step 2.1: 创建 api/placements.ts

Create `admin-web/src/api/placements.ts`:

```typescript
import { apiFetchRaw } from './raw';

export type PlacementStatus = 'pending_payment' | 'paid' | 'cancelled';

export type PlacementRow = {
  id: string;
  job_id: string;
  employer_id: string;
  anonymized_candidate_id: string;
  primary_headhunter_id: string | null;
  referrer_headhunter_id: string | null;
  annual_salary: number;
  platform_fee: number;
  primary_share: number;
  referrer_share: number;
  status: PlacementStatus;
  created_at: string;
  updated_at: string;
};

type Paginated<T> = {
  data: T[];
  pagination: { total: number; page: number; pageSize: number; has_more: boolean };
};

export async function listPlacements(opts: {
  page?: number;
  pageSize?: number;
  status?: PlacementStatus | '';
  from?: string;
  until?: string;
} = {}): Promise<Paginated<PlacementRow>> {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts.status) params.set('status', opts.status);
  if (opts.from) params.set('from', opts.from);
  if (opts.until) params.set('until', opts.until);
  const query = params.toString() ? `?${params}` : '';
  const env = await apiFetchRaw<PlacementRow[]>('placements' + query);
  if (!env.ok || !env.data || !env.pagination) {
    throw new Error(env.error?.message ?? 'Failed to fetch placements');
  }
  return { data: env.data, pagination: env.pagination };
}

export async function markPlacementPaid(id: string): Promise<{ id: string; status: 'paid' }> {
  const env = await apiFetchRaw<{ id: string; status: 'paid' }>(`placements/${id}/mark-paid`, { method: 'POST' });
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to mark placement paid');
  return env.data;
}

export async function cancelPlacement(id: string): Promise<{ id: string; status: 'cancelled' }> {
  const env = await apiFetchRaw<{ id: string; status: 'cancelled' }>(`placements/${id}/cancel`, { method: 'POST' });
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to cancel placement');
  return env.data;
}
```

### Step 2.2: 创建 test

Create `admin-web/tests/api/placements.test.ts`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listPlacements, markPlacementPaid, cancelPlacement } from '../../src/api/placements';

vi.mock('../../src/api/raw', () => ({ apiFetchRaw: vi.fn() }));
import { apiFetchRaw } from '../../src/api/raw';

describe('placements api (Sub-D3 Plan 2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. listPlacements calls correct endpoint', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } });
    await listPlacements();
    expect(apiFetchRaw).toHaveBeenCalledWith('placements');
  });

  it('2. listPlacements includes status + from + until', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } });
    await listPlacements({ status: 'paid', from: '2026-06-01T00:00:00Z', until: '2026-06-30T23:59:59Z' });
    const call = (apiFetchRaw as any).mock.calls[0][0];
    expect(call).toContain('status=paid');
    expect(call).toContain('from=2026-06-01');
    expect(call).toContain('until=2026-06-30');
  });

  it('3. markPlacementPaid POSTs to /:id/mark-paid', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: { id: 'p_1', status: 'paid' } });
    await markPlacementPaid('p_1');
    expect(apiFetchRaw).toHaveBeenCalledWith('placements/p_1/mark-paid', expect.objectContaining({ method: 'POST' }));
  });

  it('4. cancelPlacement POSTs to /:id/cancel', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: { id: 'p_1', status: 'cancelled' } });
    await cancelPlacement('p_1');
    expect(apiFetchRaw).toHaveBeenCalledWith('placements/p_1/cancel', expect.objectContaining({ method: 'POST' }));
  });

  it('5. throws on non-ok response', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: false, error: { code: 'INVALID_STATE', message: 'cannot cancel paid' } });
    await expect(cancelPlacement('p_paid')).rejects.toThrow('cannot cancel paid');
  });
});
```

### Step 2.3: 跑测试

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/api/placements.test.ts 2>&1 | tail -5`
Expected: 5 通过。

### Step 2.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/api/placements.ts admin-web/tests/api/placements.test.ts
git -C D:/dev/hunter-platform commit -m "feat(admin-web): api/placements — list + markPaid + cancel"
```

---

## Task 3: ConfirmModal 组件 + test

**Files:**
- Create: `admin-web/src/components/ConfirmModal.tsx`
- Create: `admin-web/tests/components/ConfirmModal.test.tsx`

### Step 3.1: 创建 ConfirmModal.tsx

Create `admin-web/src/components/ConfirmModal.tsx`:

```tsx
import { useState } from 'react';
import Modal from './Modal';

type ConfirmModalProps = {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'primary';
  error?: string | null;
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

export default function ConfirmModal({
  open, title, message,
  confirmText = '确认', cancelText = '取消',
  variant = 'primary',
  error = null,
  onConfirm, onClose,
}: ConfirmModalProps) {
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const displayError = error ?? localError;

  const handleConfirm = async () => {
    setLoading(true);
    setLocalError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e: any) {
      setLocalError(e?.message ?? '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={loading} className="btn">{cancelText}</button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            data-testid="confirm-modal-confirm"
            className={variant === 'danger' ? 'btn btn-danger' : 'btn btn-primary'}
          >
            {loading ? '处理中...' : confirmText}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{message}</p>
      {displayError && (
        <div
          data-testid="confirm-modal-error"
          style={{ marginTop: 12, padding: 8, background: '#fff1f0', border: '1px solid #ff4d4f', borderRadius: 4, color: '#a8071a' }}
        >
          {displayError}
        </div>
      )}
    </Modal>
  );
}
```

### Step 3.2: 创建 test

Create `admin-web/tests/components/ConfirmModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ConfirmModal from '../../src/components/ConfirmModal';

describe('ConfirmModal (Sub-D3)', () => {
  it('1. renders title + message + 2 buttons', () => {
    render(<ConfirmModal open={true} title="T" message="M" onConfirm={async () => {}} onClose={() => {}} />);
    expect(screen.getByText('T')).toBeTruthy();
    expect(screen.getByText('M')).toBeTruthy();
    expect(screen.getByText('确认')).toBeTruthy();
    expect(screen.getByText('取消')).toBeTruthy();
  });

  it('2. clicking confirm calls onConfirm', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<ConfirmModal open={true} title="T" message="M" onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('3. clicking cancel calls onClose (without onConfirm)', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmModal open={true} title="T" message="M" onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.click(screen.getByText('取消'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('4. onConfirm rejection shows error inline + modal stays open', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('服务端错误'));
    const onClose = vi.fn();
    render(<ConfirmModal open={true} title="T" message="M" onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
    await waitFor(() => expect(screen.getByTestId('confirm-modal-error')).toBeTruthy());
    expect(screen.getByText('服务端错误')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('5. variant=danger renders btn-danger class', () => {
    const { container } = render(<ConfirmModal open={true} title="T" message="M" variant="danger" onConfirm={async () => {}} onClose={() => {}} />);
    const btn = screen.getByTestId('confirm-modal-confirm');
    expect(btn.className).toContain('btn-danger');
  });
});
```

### Step 3.3: 跑测试

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/components/ConfirmModal.test.tsx 2>&1 | tail -5`
Expected: 5 通过。

### Step 3.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/components/ConfirmModal.tsx admin-web/tests/components/ConfirmModal.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): ConfirmModal — shared confirm dialog with loading/error/variant"
```

---

## Task 4: WebhookDeadLetterPage + test

**Files:**
- Create: `admin-web/src/pages/WebhookDeadLetterPage.tsx`
- Create: `admin-web/tests/pages/WebhookDeadLetterPage.test.tsx`

### Step 4.1: 创建 WebhookDeadLetterPage.tsx

Create `admin-web/src/pages/WebhookDeadLetterPage.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import Pagination from '../components/Pagination';
import Skeleton from '../components/Skeleton';
import { listDeadLetter, retryDeadLetter, type DeadLetterRow } from '../api/webhooks';
import { useToast } from '../lib/toast';
import { relativeTime } from '../lib/format';

const EVENT_TYPE_OPTIONS = [
  { value: '', label: '全部 event_type' },
  { value: 'payment.succeeded', label: 'payment.succeeded' },
  { value: 'placement.created', label: 'placement.created' },
  { value: 'candidate.unlocked', label: 'candidate.unlocked' },
];

export default function WebhookDeadLetterPage() {
  const toast = useToast();
  const [rows, setRows] = useState<DeadLetterRow[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 20, has_more: false });
  const [loading, setLoading] = useState(true);
  const [eventType, setEventType] = useState('');
  const [minAttempts, setMinAttempts] = useState('');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback((p: number) => {
    setLoading(true);
    listDeadLetter({
      page: p, pageSize: 20,
      event_type: eventType || undefined,
      min_attempt_count: minAttempts ? Number(minAttempts) : undefined,
      from: from || undefined, until: until || undefined,
    })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .catch(err => toast.push({ type: 'error', message: err.message }))
      .finally(() => setLoading(false));
  }, [eventType, minAttempts, from, until, toast]);

  useEffect(() => { load(page); }, [load, page]);

  const handleRetry = async (id: number) => {
    try {
      await retryDeadLetter(id);
      toast.push({ type: 'success', message: '已加入重试队列' });
      load(page);
    } catch (err: any) {
      toast.push({ type: 'error', message: err.message ?? '重试失败' });
    }
  };

  return (
    <Layout adminName="Admin">
      <h1>Webhook 死信队列</h1>

      <div style={{ background: '#fafafa', border: '1px solid #e0e0e0', borderRadius: 4, padding: 16, marginBottom: 16, display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>Event Type</label>
          <select value={eventType} onChange={e => { setEventType(e.target.value); setPage(1); }} data-testid="filter-event-type" style={{ padding: '0 8px', height: 32, border: '1px solid #ccc', borderRadius: 4 }}>
            {EVENT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>Min Attempts</label>
          <input type="number" min={0} value={minAttempts} onChange={e => { setMinAttempts(e.target.value); setPage(1); }} placeholder="≥ N" data-testid="filter-min-attempts" style={{ padding: '0 8px', height: 32, width: 100, border: '1px solid #ccc', borderRadius: 4 }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>从</label>
          <input type="date" value={from.slice(0, 10)} onChange={e => { setFrom(e.target.value ? e.target.value + 'T00:00:00Z' : ''); setPage(1); }} data-testid="filter-from" style={{ padding: '0 8px', height: 32, border: '1px solid #ccc', borderRadius: 4 }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>至</label>
          <input type="date" value={until.slice(0, 10)} onChange={e => { setUntil(e.target.value ? e.target.value + 'T23:59:59Z' : ''); setPage(1); }} data-testid="filter-until" style={{ padding: '0 8px', height: 32, border: '1px solid #ccc', borderRadius: 4 }} />
        </div>
        <button onClick={() => { setEventType(''); setMinAttempts(''); setFrom(''); setUntil(''); setPage(1); }} data-testid="filter-clear" style={{ height: 32, padding: '0 16px', background: '#fff', border: '1px solid #ccc', borderRadius: 4 }}>清除</button>
      </div>

      {loading ? <Skeleton variant="row" count={5} /> : rows.length === 0 ? (
        <div className="card">暂无死信</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#fafafa' }}>
              <th style={{ padding: 8, textAlign: 'left' }}>ID</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Event Type</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Target User</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Attempts</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Last Error</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Updated</th>
              <th style={{ padding: 8, textAlign: 'left' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} data-testid={`dead-letter-row-${r.id}`} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: 8 }}><code>{r.id}</code></td>
                <td style={{ padding: 8 }}>{r.event_type}</td>
                <td style={{ padding: 8 }}>{r.target_user_id}</td>
                <td style={{ padding: 8 }}>{r.attempt_count}</td>
                <td style={{ padding: 8, color: '#a8071a', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.last_error ?? '—'}</td>
                <td style={{ padding: 8 }}>{relativeTime(r.updated_at)}</td>
                <td style={{ padding: 8 }}>
                  <button onClick={() => handleRetry(r.id)} className="btn btn-sm" data-testid={`retry-${r.id}`}>重试</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Pagination page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} onPageChange={setPage} />
    </Layout>
  );
}
```

### Step 4.2: 创建 test

Create `admin-web/tests/pages/WebhookDeadLetterPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from '../../src/lib/toast';
import WebhookDeadLetterPage from '../../src/pages/WebhookDeadLetterPage';

vi.mock('../../src/api/webhooks', () => ({
  listDeadLetter: vi.fn(),
  retryDeadLetter: vi.fn(),
}));

import { listDeadLetter, retryDeadLetter } from '../../src/api/webhooks';

const renderPage = () => render(
  <MemoryRouter initialEntries={['/webhooks/dead-letter']}>
    <ToastProvider>
      <Routes>
        <Route path="/webhooks/dead-letter" element={<WebhookDeadLetterPage />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>
);

const mockRow = {
  id: 1, target_user_id: 'u_1', event_type: 'payment.succeeded',
  attempt_count: 5, last_error: 'HTTP 500', next_retry_at: null,
  created_at: '2026-06-25T00:00:00Z', updated_at: '2026-06-25T12:00:00Z',
};

describe('WebhookDeadLetterPage (Sub-D3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listDeadLetter as any).mockResolvedValue({
      data: [mockRow],
      pagination: { total: 1, page: 1, pageSize: 20, has_more: false },
    });
    (retryDeadLetter as any).mockResolvedValue({ id: 1, status: 'pending' });
  });

  it('1. mount calls listDeadLetter', async () => {
    renderPage();
    await waitFor(() => expect(listDeadLetter).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('dead-letter-row-1')).toBeTruthy();
  });

  it('2. changing event_type filter triggers refetch', async () => {
    renderPage();
    await waitFor(() => expect(listDeadLetter).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByTestId('filter-event-type'), { target: { value: 'payment.succeeded' } });
    await waitFor(() => expect(listDeadLetter).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'payment.succeeded' })));
  });

  it('3. clicking 重试 calls retryDeadLetter', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('retry-1'));
    fireEvent.click(screen.getByTestId('retry-1'));
    await waitFor(() => expect(retryDeadLetter).toHaveBeenCalledWith(1));
    await waitFor(() => expect(listDeadLetter).toHaveBeenCalledTimes(2));  // refetch after retry
  });

  it('4. empty state when no rows', async () => {
    (listDeadLetter as any).mockResolvedValueOnce({
      data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('暂无死信')).toBeTruthy());
  });
});
```

### Step 4.3: 跑测试

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/pages/WebhookDeadLetterPage.test.tsx 2>&1 | tail -5`
Expected: 4 通过。

### Step 4.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/WebhookDeadLetterPage.tsx admin-web/tests/pages/WebhookDeadLetterPage.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): WebhookDeadLetterPage — list + filter + retry"
```

---

## Task 5: PlacementsPage + test

**Files:**
- Create: `admin-web/src/pages/PlacementsPage.tsx`
- Create: `admin-web/tests/pages/PlacementsPage.test.tsx`

### Step 5.1: 创建 PlacementsPage.tsx

Create `admin-web/src/pages/PlacementsPage.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import Pagination from '../components/Pagination';
import Skeleton from '../components/Skeleton';
import ConfirmModal from '../components/ConfirmModal';
import StatusBadge from '../components/StatusBadge';
import { listPlacements, markPlacementPaid, cancelPlacement, type PlacementRow, type PlacementStatus } from '../api/placements';
import { useToast } from '../lib/toast';
import { relativeTime } from '../lib/format';

const STATUS_OPTIONS = [
  { value: '', label: '全部 status' },
  { value: 'pending_payment', label: 'pending_payment' },
  { value: 'paid', label: 'paid' },
  { value: 'cancelled', label: 'cancelled' },
];

type ConfirmState =
  | { open: false }
  | { open: true; type: 'mark-paid' | 'cancel'; placement: PlacementRow };

export default function PlacementsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<PlacementRow[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 20, has_more: false });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<PlacementStatus | ''>('');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<ConfirmState>({ open: false });

  const load = useCallback((p: number) => {
    setLoading(true);
    listPlacements({
      page: p, pageSize: 20,
      status: status || undefined,
      from: from || undefined, until: until || undefined,
    })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .catch(err => toast.push({ type: 'error', message: err.message }))
      .finally(() => setLoading(false));
  }, [status, from, until, toast]);

  useEffect(() => { load(page); }, [load, page]);

  const handleConfirm = async () => {
    if (!confirm.open) return;
    if (confirm.type === 'mark-paid') {
      await markPlacementPaid(confirm.placement.id);
      toast.push({ type: 'success', message: `已标记 ${confirm.placement.id} 为已付款` });
    } else {
      await cancelPlacement(confirm.placement.id);
      toast.push({ type: 'success', message: `已取消 ${confirm.placement.id}` });
    }
    load(page);
  };

  return (
    <Layout adminName="Admin">
      <h1>Placements</h1>

      <div style={{ background: '#fafafa', border: '1px solid #e0e0e0', borderRadius: 4, padding: 16, marginBottom: 16, display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>Status</label>
          <select value={status} onChange={e => { setStatus(e.target.value as any); setPage(1); }} data-testid="filter-status" style={{ padding: '0 8px', height: 32, border: '1px solid #ccc', borderRadius: 4 }}>
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>从</label>
          <input type="date" value={from.slice(0, 10)} onChange={e => { setFrom(e.target.value ? e.target.value + 'T00:00:00Z' : ''); setPage(1); }} data-testid="filter-from" style={{ padding: '0 8px', height: 32, border: '1px solid #ccc', borderRadius: 4 }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>至</label>
          <input type="date" value={until.slice(0, 10)} onChange={e => { setUntil(e.target.value ? e.target.value + 'T23:59:59Z' : ''); setPage(1); }} data-testid="filter-until" style={{ padding: '0 8px', height: 32, border: '1px solid #ccc', borderRadius: 4 }} />
        </div>
        <button onClick={() => { setStatus(''); setFrom(''); setUntil(''); setPage(1); }} data-testid="filter-clear" style={{ height: 32, padding: '0 16px', background: '#fff', border: '1px solid #ccc', borderRadius: 4 }}>清除</button>
      </div>

      {loading ? <Skeleton variant="row" count={5} /> : rows.length === 0 ? (
        <div className="card">暂无 placement</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#fafafa' }}>
              <th style={{ padding: 8, textAlign: 'left' }}>ID</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Job</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Employer</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Status</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Salary</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Platform Fee</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Created</th>
              <th style={{ padding: 8, textAlign: 'left' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} data-testid={`placement-row-${r.id}`} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: 8 }}><code>{r.id}</code></td>
                <td style={{ padding: 8 }}>{r.job_id}</td>
                <td style={{ padding: 8 }}>{r.employer_id}</td>
                <td style={{ padding: 8 }}><StatusBadge status={r.status} /></td>
                <td style={{ padding: 8, textAlign: 'right' }}>{r.annual_salary.toLocaleString()}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>{r.platform_fee.toLocaleString()}</td>
                <td style={{ padding: 8 }}>{relativeTime(r.created_at)}</td>
                <td style={{ padding: 8 }}>
                  {r.status === 'pending_payment' && (
                    <>
                      <button onClick={() => setConfirm({ open: true, type: 'mark-paid', placement: r })} className="btn btn-sm btn-primary" data-testid={`mark-paid-${r.id}`}>标记已付款</button>{' '}
                      <button onClick={() => setConfirm({ open: true, type: 'cancel', placement: r })} className="btn btn-sm btn-danger" data-testid={`cancel-${r.id}`}>取消</button>
                    </>
                  )}
                  {r.status === 'paid' && <button disabled className="btn btn-sm">已付款</button>}
                  {r.status === 'cancelled' && <button disabled className="btn btn-sm">已取消</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Pagination page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} onPageChange={setPage} />

      <ConfirmModal
        open={confirm.open}
        title={confirm.open ? (confirm.type === 'mark-paid' ? '标记为已付款' : '取消 placement') : ''}
        message={confirm.open ? (confirm.type === 'mark-paid' ? '确认标记为已付款？这将触发佣金结算。' : '确认取消此 placement？这将无法撤销。') : ''}
        variant={confirm.open && confirm.type === 'cancel' ? 'danger' : 'primary'}
        confirmText={confirm.open && confirm.type === 'mark-paid' ? '确认已收款' : '确认'}
        onConfirm={handleConfirm}
        onClose={() => setConfirm({ open: false })}
      />
    </Layout>
  );
}
```

### Step 5.2: 创建 test

Create `admin-web/tests/pages/PlacementsPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from '../../src/lib/toast';
import PlacementsPage from '../../src/pages/PlacementsPage';

vi.mock('../../src/api/placements', () => ({
  listPlacements: vi.fn(),
  markPlacementPaid: vi.fn(),
  cancelPlacement: vi.fn(),
}));

import { listPlacements, markPlacementPaid, cancelPlacement } from '../../src/api/placements';

const renderPage = () => render(
  <MemoryRouter initialEntries={['/placements']}>
    <ToastProvider>
      <Routes>
        <Route path="/placements" element={<PlacementsPage />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>
);

const mockPending = {
  id: 'p_1', job_id: 'job_1', employer_id: 'u_emp',
  anonymized_candidate_id: 'c_1', primary_headhunter_id: null, referrer_headhunter_id: null,
  annual_salary: 500000, platform_fee: 50000, primary_share: 40000, referrer_share: 10000,
  status: 'pending_payment' as const, created_at: '2026-06-25T00:00:00Z', updated_at: '2026-06-25T00:00:00Z',
};

describe('PlacementsPage (Sub-D3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listPlacements as any).mockResolvedValue({
      data: [mockPending],
      pagination: { total: 1, page: 1, pageSize: 20, has_more: false },
    });
    (markPlacementPaid as any).mockResolvedValue({ id: 'p_1', status: 'paid' });
    (cancelPlacement as any).mockResolvedValue({ id: 'p_1', status: 'cancelled' });
  });

  it('1. mount calls listPlacements and renders row', async () => {
    renderPage();
    await waitFor(() => expect(listPlacements).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('placement-row-p_1')).toBeTruthy();
  });

  it('2. changing status triggers refetch', async () => {
    renderPage();
    await waitFor(() => expect(listPlacements).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByTestId('filter-status'), { target: { value: 'paid' } });
    await waitFor(() => expect(listPlacements).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid' })));
  });

  it('3. clicking 标记已付款 opens ConfirmModal', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('mark-paid-p_1'));
    fireEvent.click(screen.getByTestId('mark-paid-p_1'));
    expect(screen.getByText('确认标记为已付款？这将触发佣金结算。')).toBeTruthy();
  });

  it('4. confirming calls markPlacementPaid + refetches', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('mark-paid-p_1'));
    fireEvent.click(screen.getByTestId('mark-paid-p_1'));
    fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
    await waitFor(() => expect(markPlacementPaid).toHaveBeenCalledWith('p_1'));
    await waitFor(() => expect(listPlacements).toHaveBeenCalledTimes(2));
  });

  it('5. clicking 取消 opens danger ConfirmModal', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('cancel-p_1'));
    fireEvent.click(screen.getByTestId('cancel-p_1'));
    expect(screen.getByText('确认取消此 placement？这将无法撤销。')).toBeTruthy();
    fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
    await waitFor(() => expect(cancelPlacement).toHaveBeenCalledWith('p_1'));
  });
});
```

### Step 5.3: 跑测试

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/pages/PlacementsPage.test.tsx 2>&1 | tail -5`
Expected: 5 通过。

### Step 5.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/PlacementsPage.tsx admin-web/tests/pages/PlacementsPage.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): PlacementsPage — list + filter + mark-paid/cancel with ConfirmModal"
```

---

## Task 6: Layout + App.tsx 路由注册

**Files:**
- Modify: `admin-web/src/components/Layout.tsx`
- Modify: `admin-web/src/App.tsx`

### Step 6.1: Layout.tsx 加 2 个 NavLink

打开 `admin-web/src/components/Layout.tsx`，找到 nav `<NavLink to="/audit" ...>审计</NavLink>` 之前，加：

```tsx
<NavLink to="/webhooks/dead-letter" style={linkStyle}>Webhook 死信</NavLink>
<NavLink to="/placements" style={linkStyle}>Placements</NavLink>
```

### Step 6.2: App.tsx 加 2 个 route + import

打开 `admin-web/src/App.tsx`，加 imports：

```tsx
import WebhookDeadLetterPage from './pages/WebhookDeadLetterPage';
import PlacementsPage from './pages/PlacementsPage';
```

找到 `<Route path="/audit" ...>` 行附近，加 2 个：

```tsx
<Route path="/webhooks/dead-letter" element={<PrivateRoute><WebhookDeadLetterPage /></PrivateRoute>} />
<Route path="/placements" element={<PrivateRoute><PlacementsPage /></PrivateRoute>} />
```

### Step 6.3: Typecheck

Run: `cd /d/dev/hunter-platform/admin-web && npx tsc --noEmit 2>&1 | tail -3`
Expected: 无错误。

### Step 6.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/components/Layout.tsx admin-web/src/App.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): Layout + App — +2 nav links +2 routes for webhooks/placements"
```

---

## Task 7: DashboardPage — 「Webhook 死信」卡片加 Link

**Files:**
- Modify: `admin-web/src/pages/DashboardPage.tsx`

### Step 7.1: 找到现有 MetricCard

打开 `admin-web/src/pages/DashboardPage.tsx`，找到 `<MetricCard label="Webhook 死信" value={stats.webhook_dead_letters} ...>`（如 Sub-C 已有）：

```tsx
<MetricCard label="Webhook 死信" value={stats.webhook_dead_letters} />
```

替换为可点击 Link：

```tsx
<Link to="/webhooks/dead-letter" style={{ textDecoration: 'none' }}>
  <MetricCard label="Webhook 死信" value={stats.webhook_dead_letters} hint="点击查看详情" />
</Link>
```

如原文件已 `import { Link } from 'react-router-dom'`（大概率有，因为 Sub-C 加过 timeline 按钮），跳过 import；否则加：

```tsx
import { Link } from 'react-router-dom';
```

### Step 7.2: 跑现有 DashboardPage 测试

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/pages/DashboardPage 2>&1 | tail -5`
Expected: 全绿（按钮/卡片渲染不变）。

### Step 7.3: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/DashboardPage.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): DashboardPage — Webhook 死信 card → link to /webhooks/dead-letter"
```

---

## Task 8: 全量验证 + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

### Step 8.1: 跑全部后端 + 前端测试

```bash
cd /d/dev/hunter-platform && npx vitest run 2>&1 | tail -6
```

```bash
cd /d/dev/hunter-platform/admin-web && npm run test 2>&1 | tail -6
```

Expected: 946 backend (933 + 13 new) + 144 admin-web (125 + 19 new) = **1090 测试全绿**。

### Step 8.2: Typecheck

```bash
cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -3
cd /d/dev/hunter-platform/admin-web && npx tsc --noEmit 2>&1 | tail -3
```

Expected: 无错误。

### Step 8.3: 更新 CHANGELOG

打开 `CHANGELOG.md`，找到 `v2.3.0 (Sub-D3 Plan 1 — Backend)` 段落，扩展为完整 v2.3.0：

```markdown
## v2.3.0 (Sub-D3 — Webhook 死信 + Placements UI) — 2026-06-25

### 新增功能
- **Webhook 死信 UI**（`/webhooks/dead-letter`）：列表 + event_type/min_attempts/日期 filter + 一键重试（无确认弹窗）
- **Placements UI**（`/placements`）：列表 + status/日期 filter + 标记已付款/取消（带 ConfirmModal 确认）
- **共享 ConfirmModal 组件**：基于 Sub-C Modal，加 loading/error/variant/confirmText，支持危险操作二次确认
- **Dashboard 「Webhook 死信」卡片**：加 `<Link>`，点击直达死信页面

### 后端（Plan 1）
- GET `/v1/admin/webhooks/dead-letter` + GET `/v1/admin/placements` 改 paginated envelope（之前是 flat array）
- 2 个新 capability：`admin.list_dead_letter` + `admin.list_placements`

### 测试
- 后端 +13 个集成测试
- 前端 +19 个组件/页面测试
- **总计：1089 测试**（Sub-D2 后 1058 + 31 新）

### 已知限制
- Webhook retry 不写 audit log（留 Sub-D4）
- Filter 不持久化到 URL（避免 scope 膨胀，留 Sub-D3 follow-up）
- 没有 Placement 详情页（留 Sub-D4）
```

### Step 8.4: Commit

```bash
git -C D:/dev/hunter-platform add CHANGELOG.md
git -C D:/dev/hunter-platform commit -m "docs(changelog): v2.3.0 — Sub-D3 full (Webhooks + Placements UI)"
```

### Step 8.5: 最终 sanity check

```bash
git -C D:/dev/hunter-platform log --oneline -30
```

确认 Plan 2 所有 task 已 commit（应有 8 个新 commit）。

---

## Done criteria（Plan 2 完成）

- [ ] 2 个新 page 渲染、filter、mutations 工作
- [ ] ConfirmModal mark-paid 触发佣金（不破坏现有 commission.markPaid 测试）
- [ ] ~19 新前端测试通过 + 现有不退
- [ ] 全 typecheck 干净
- [ ] CHANGELOG v2.3.0 完整条目
- [ ] 8 个 task 都 commit

**Sub-D3 全部完成。** 下一步可选：Sub-D4（per-entity 详情页）或 Sub-E（config UI）。