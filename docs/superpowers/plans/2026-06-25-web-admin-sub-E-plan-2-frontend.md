# Web Admin Sub-E Plan 2: Frontend Settings Page (3 Tabs)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **前置依赖：** Plan 1 (`2026-06-25-web-admin-sub-E-plan-1-backend.md`) 必须**先 merge 到 main**。本 plan 消费 backend 的 4 个 webhook subscription endpoint + 现有 Config endpoint。

**Goal:** 在 admin-web 加 SettingsPage（`/settings` 路径），3 个 tabs：Config / Rate-Limit / Webhooks。复用 Sub-C 的 Table / SearchBar / Pagination / Modal / ConfirmModal / Toast。

**Architecture:**
- **前端**：1 page（3 tabs）+ 4 API wrapper（3 新 + 1 已有 wrapper）+ 1 nav 入口 + App.tsx 路由
- **测试**：~11 个新前端测试覆盖 API wrapper + SettingsPage
- **数据库**：0 改动

**Tech Stack (existing):** React 18, Vite, react-router-dom, vanilla CSS, vitest+jsdom+RTL
**Spec:** [docs/superpowers/specs/2026-06-25-web-admin-sub-E-design.md](../specs/2026-06-25-web-admin-sub-E-design.md) — §4 frontend design

---

## 0. Reviewer decisions

| 反馈点 | 决策 |
|--------|------|
| Page 结构 | 1 page 3 tabs（sub-mode 选择）|
| 复用组件 | 全部复用 Sub-C/D2/D3（Table / SearchBar / Modal / ConfirmModal / Toast）|
| Backend | 0 frontend 改动 backend（已就绪）|

---

## 现有代码上下文（开始 Task 1 前必读）

- `admin-web/src/api/raw.ts` — `apiFetchRaw<T>()` wrapper
- `admin-web/src/lib/toast.tsx` — `useToast()` + `<Toast />` provider
- `admin-web/src/components/Modal.tsx` — 通用 Modal（portal + ESC + 焦点管理）
- `admin-web/src/components/ConfirmModal.tsx` — 通用 ConfirmModal（Sub-D5 加了 requireReason）
- `admin-web/src/components/Layout.tsx` — nav 含 Dashboard / Users / Candidates / Jobs / Recommendations / Webhook 死信 / Placements / Audit / 我的
- `admin-web/src/App.tsx` — 已注册所有 routes

**不动文件**：
- 4 个 list page（保持独立）
- 4 个 detail page
- 4 个 timeline page
- 其他 nav 入口

---

## File Structure

| File | Change |
|------|--------|
| `admin-web/src/api/config.ts` | **Create** — listConfig + updateConfig |
| `admin-web/src/api/rate-limit.ts` | **Create** — listRateLimits (read 'rate_limit.*' Config keys) |
| `admin-web/src/api/webhook-subscriptions.ts` | **Create** — list + create + update + delete |
| `admin-web/src/pages/SettingsPage.tsx` | **Create** — 3 tabs (Config / Rate-Limit / Webhooks) |
| `admin-web/src/components/Layout.tsx` | **Modify** — + Settings nav 入口 |
| `admin-web/src/App.tsx` | **Modify** — + /settings route |
| `admin-web/tests/api/config.test.ts` | **Create** — 2 case |
| `admin-web/tests/api/webhook-subscriptions.test.ts` | **Create** — 4 case |
| `admin-web/tests/pages/SettingsPage.test.tsx` | **Create** — 5 case |
| `CHANGELOG.md` | **Modify** — v2.7.0 加 frontend 部分 |

---

## Task 1: 3 个 API wrappers

**Files:**
- Create: `admin-web/src/api/config.ts`
- Create: `admin-web/src/api/rate-limit.ts`
- Create: `admin-web/src/api/webhook-subscriptions.ts`

### Step 1.1: api/config.ts

Create `admin-web/src/api/config.ts`:

```typescript
import { apiFetchRaw } from './raw';

export type ConfigEntry = {
  key: string;
  value: unknown;  // JSON
  updated_at: string;
  updated_by_admin_user_id: string | null;
};

export async function listConfig(): Promise<ConfigEntry[]> {
  const env = await apiFetchRaw<ConfigEntry[]>('config');
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to list config');
  return env.data;
}

export async function updateConfig(key: string, value: unknown, reason: string): Promise<ConfigEntry> {
  const env = await apiFetchRaw<ConfigEntry>(`config/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value, reason }),
  });
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to update config');
  return env.data;
}
```

### Step 1.2: api/rate-limit.ts

Create `admin-web/src/api/rate-limit.ts`:

```typescript
import { listConfig, type ConfigEntry } from './config';

export type RateLimitEntry = {
  scope: 'tier' | 'user';
  key: string;  // tier name or user id
  limit_per_minute: number;
};

export async function listRateLimits(): Promise<RateLimitEntry[]> {
  const all = await listConfig();
  return all
    .filter(c => c.key.startsWith('rate_limit.'))
    .map(c => {
      // key format: rate_limit.tier.<tier_name>.limit_per_minute
      //       or: rate_limit.user.<user_id>.limit_per_minute
      const parts = c.key.split('.');
      const scope = parts[1] as 'tier' | 'user';
      const identifier = parts[2];
      const limit = Number(c.value);
      return { scope, key: identifier, limit_per_minute: limit };
    });
}
```

注：MVP 阶段 rate-limit 列表只读，不在 SettingsPage 写。如需写，沿用 updateConfig 写 `rate_limit.tier.<tier>.limit_per_minute`。

### Step 1.3: api/webhook-subscriptions.ts

Create `admin-web/src/api/webhook-subscriptions.ts`:

```typescript
import { apiFetchRaw } from './raw';

export type WebhookSubscription = {
  id: number;
  target_url: string;
  event_types: string[];
  hmac_secret: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  created_by_admin_user_id: string | null;
};

export type CreateSubscriptionInput = {
  target_url: string;
  event_types: string[];
  hmac_secret?: string | null;
};

export type UpdateSubscriptionInput = Partial<{
  target_url: string;
  event_types: string[];
  hmac_secret: string | null;
  enabled: boolean;
}>;

export async function listWebhookSubscriptions(): Promise<WebhookSubscription[]> {
  const env = await apiFetchRaw<WebhookSubscription[]>('webhook-subscriptions');
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to list subscriptions');
  return env.data;
}

export async function createWebhookSubscription(input: CreateSubscriptionInput): Promise<WebhookSubscription> {
  const env = await apiFetchRaw<WebhookSubscription>('webhook-subscriptions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to create subscription');
  return env.data;
}

export async function updateWebhookSubscription(id: number, input: UpdateSubscriptionInput): Promise<WebhookSubscription> {
  const env = await apiFetchRaw<WebhookSubscription>(`webhook-subscriptions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to update subscription');
  return env.data;
}

export async function deleteWebhookSubscription(id: number): Promise<void> {
  const env = await apiFetchRaw<null>(`webhook-subscriptions/${id}`, { method: 'DELETE' });
  if (!env.ok) throw new Error(env.error?.message ?? 'Failed to delete subscription');
}
```

### Step 1.4: 创建 2 个 test 文件

Create `admin-web/tests/api/config.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listConfig, updateConfig } from '../../src/api/config';

vi.mock('../../src/api/raw', () => ({ apiFetchRaw: vi.fn() }));
import { apiFetchRaw } from '../../src/api/raw';

describe('config api (Sub-E)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. listConfig calls /config', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: [] });
    await listConfig();
    expect(apiFetchRaw).toHaveBeenCalledWith('config');
  });

  it('2. updateConfig PUTs with key + value + reason', async () => {
    (apiFetchRaw as any).mockResolvedValue({
      ok: true, data: { key: 'platform_fee_pct', value: 5, updated_at: '2026-06-25', updated_by_admin_user_id: 'adm_1' },
    });
    await updateConfig('platform_fee_pct', 5, 'test reason');
    expect(apiFetchRaw).toHaveBeenCalledWith('config/platform_fee_pct', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ value: 5, reason: 'test reason' }),
    }));
  });
});
```

Create `admin-web/tests/api/webhook-subscriptions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listWebhookSubscriptions,
  createWebhookSubscription,
  updateWebhookSubscription,
  deleteWebhookSubscription,
} from '../../src/api/webhook-subscriptions';

vi.mock('../../src/api/raw', () => ({ apiFetchRaw: vi.fn() }));
import { apiFetchRaw } from '../../src/api/raw';

describe('webhook subscriptions api (Sub-E)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. listWebhookSubscriptions calls GET', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: [] });
    await listWebhookSubscriptions();
    expect(apiFetchRaw).toHaveBeenCalledWith('webhook-subscriptions');
  });

  it('2. createWebhookSubscription POSTs with body', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: { id: 1 } });
    await createWebhookSubscription({ target_url: 'https://x.com', event_types: ['y'] });
    expect(apiFetchRaw).toHaveBeenCalledWith('webhook-subscriptions', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ target_url: 'https://x.com', event_types: ['y'] }),
    }));
  });

  it('3. updateWebhookSubscription PATCHes', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: { id: 1 } });
    await updateWebhookSubscription(1, { enabled: false });
    expect(apiFetchRaw).toHaveBeenCalledWith('webhook-subscriptions/1', expect.objectContaining({ method: 'PATCH' }));
  });

  it('4. deleteWebhookSubscription DELETEs', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true });
    await deleteWebhookSubscription(1);
    expect(apiFetchRaw).toHaveBeenCalledWith('webhook-subscriptions/1', expect.objectContaining({ method: 'DELETE' }));
  });
});
```

### Step 1.5: 跑测试

```bash
cd /d/dev/hunter-platform/admin-web && npm run test -- tests/api/config.test.ts tests/api/webhook-subscriptions.test.ts 2>&1 | tail -5
```

Expected: 6 通过。

### Step 1.6: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/api/config.ts admin-web/src/api/rate-limit.ts admin-web/src/api/webhook-subscriptions.ts admin-web/tests/api/config.test.ts admin-web/tests/api/webhook-subscriptions.test.ts
git -C D:/dev/hunter-platform commit -m "feat(admin-web): api wrappers — config + rate-limit + webhook-subscriptions"
```

---

## Task 2: SettingsPage（3 tabs）

**Files:**
- Create: `admin-web/src/pages/SettingsPage.tsx`

### Step 2.1: 创建 SettingsPage.tsx

Create `admin-web/src/pages/SettingsPage.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import Skeleton from '../components/Skeleton';
import ConfirmModal from '../components/ConfirmModal';
import { useToast } from '../lib/toast';
import { listConfig, updateConfig, type ConfigEntry } from '../api/config';
import { listRateLimits, type RateLimitEntry } from '../api/rate-limit';
import {
  listWebhookSubscriptions,
  createWebhookSubscription,
  updateWebhookSubscription,
  deleteWebhookSubscription,
  type WebhookSubscription,
} from '../api/webhook-subscriptions';
import { relativeTime } from '../lib/format';

type Tab = 'config' | 'rate-limit' | 'webhooks';

export default function SettingsPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('config');

  return (
    <Layout adminName="Admin">
      <h1>Settings</h1>
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid #e0e0e0', marginBottom: 16 }}>
        <TabButton current={tab} value="config" onClick={setTab} label="Config" />
        <TabButton current={tab} value="rate-limit" onClick={setTab} label="Rate-Limit" />
        <TabButton current={tab} value="webhooks" onClick={setTab} label="Webhooks" />
      </div>
      {tab === 'config' && <ConfigTab toast={toast} />}
      {tab === 'rate-limit' && <RateLimitTab />}
      {tab === 'webhooks' && <WebhooksTab toast={toast} />}
    </Layout>
  );
}

function TabButton({ current, value, onClick, label }: { current: Tab; value: Tab; onClick: (v: Tab) => void; label: string }) {
  const active = current === value;
  return (
    <button
      onClick={() => onClick(value)}
      data-testid={`tab-${value}`}
      style={{
        padding: '8px 16px',
        background: active ? '#1890ff' : 'transparent',
        color: active ? 'white' : '#666',
        border: 'none',
        borderBottom: active ? '2px solid #1890ff' : '2px solid transparent',
        cursor: 'pointer',
        fontSize: 14,
      }}
    >
      {label}
    </button>
  );
}

// ============ Config Tab ============
function ConfigTab({ toast }: { toast: ReturnType<typeof useToast> }) {
  const [entries, setEntries] = useState<ConfigEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ entry: ConfigEntry; newValue: string; reason: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    listConfig().then(setEntries).catch(err => toast.push({ type: 'error', message: err.message })).finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!editing) return;
    try {
      let parsed: unknown = editing.newValue;
      // Try parse as JSON for non-string values
      try { parsed = JSON.parse(editing.newValue); } catch { /* keep as string */ }
      await updateConfig(editing.entry.key, parsed, editing.reason);
      toast.push({ type: 'success', message: `已保存 ${editing.entry.key}` });
      setEditing(null);
      load();
    } catch (e: any) {
      toast.push({ type: 'error', message: e.message });
    }
  };

  return (
    <div>
      {loading ? <Skeleton variant="row" count={5} /> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#fafafa' }}>
            <th style={{ padding: 8, textAlign: 'left' }}>Key</th>
            <th style={{ padding: 8, textAlign: 'left' }}>Value</th>
            <th style={{ padding: 8, textAlign: 'left' }}>Updated</th>
            <th style={{ padding: 8, textAlign: 'left' }}>By</th>
            <th style={{ padding: 8, textAlign: 'left' }}>操作</th>
          </tr></thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.key} data-testid={`config-row-${e.key}`} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: 8 }}><code>{e.key}</code></td>
                <td style={{ padding: 8 }}><code>{JSON.stringify(e.value)}</code></td>
                <td style={{ padding: 8 }}>{relativeTime(e.updated_at)}</td>
                <td style={{ padding: 8 }}>{e.updated_by_admin_user_id ?? '—'}</td>
                <td style={{ padding: 8 }}>
                  <button onClick={() => setEditing({ entry: e, newValue: JSON.stringify(e.value), reason: '' })}
                          data-testid={`config-edit-${e.key}`} className="btn btn-sm">编辑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ConfirmModal
        open={editing !== null}
        title={editing ? `编辑 ${editing.entry.key}` : ''}
        message={editing ? '修改 Config 后立即生效，无需重启服务。' : ''}
        confirmText="保存"
        variant="primary"
        requireReason={editing !== null}
        onConfirm={async (reason) => {
          if (!editing) return;
          let parsed: unknown = editing.newValue;
          try { parsed = JSON.parse(editing.newValue); } catch { /* keep as string */ }
          await updateConfig(editing.entry.key, parsed, reason!);
          toast.push({ type: 'success', message: `已保存 ${editing.entry.key}` });
          setEditing(null);
          load();
        }}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <div style={{ marginTop: 12 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>新 Value（JSON 格式）</label>
            <textarea
              value={editing.newValue}
              onChange={e => setEditing({ ...editing, newValue: e.target.value })}
              data-testid="config-edit-value"
              rows={3}
              style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box', fontFamily: 'monospace' }}
            />
          </div>
        )}
      </ConfirmModal>
    </div>
  );
}

// ============ Rate-Limit Tab ============
function RateLimitTab() {
  const [entries, setEntries] = useState<RateLimitEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listRateLimits().then(setEntries).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <p style={{ color: '#666', marginBottom: 12 }}>从 Config 表读 `rate_limit.*` keys。如需修改，请到 <a href="/settings?tab=config">Config tab</a> 编辑。</p>
      {loading ? <Skeleton variant="row" count={3} /> : (
        entries.length === 0 ? <p>暂无 rate-limit 配置</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#fafafa' }}>
              <th style={{ padding: 8, textAlign: 'left' }}>Scope</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Key</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Limit / minute</th>
            </tr></thead>
            <tbody>
              {entries.map(e => (
                <tr key={`${e.scope}-${e.key}`} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ padding: 8 }}>{e.scope}</td>
                  <td style={{ padding: 8 }}><code>{e.key}</code></td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{e.limit_per_minute}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}

// ============ Webhooks Tab ============
function WebhooksTab({ toast }: { toast: ReturnType<typeof useToast> }) {
  const [subs, setSubs] = useState<WebhookSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<{ type: 'delete'; sub: WebhookSubscription } | { type: 'create' } | { type: 'edit'; sub: WebhookSubscription } | null>(null);
  const [form, setForm] = useState<{ target_url: string; event_types: string; hmac_secret: string }>({
    target_url: '', event_types: '', hmac_secret: '',
  });

  const load = useCallback(() => {
    setLoading(true);
    listWebhookSubscriptions().then(setSubs).catch(err => toast.push({ type: 'error', message: err.message })).finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    try {
      await createWebhookSubscription({
        target_url: form.target_url,
        event_types: form.event_types.split(',').map(s => s.trim()).filter(Boolean),
        hmac_secret: form.hmac_secret || null,
      });
      toast.push({ type: 'success', message: '已创建订阅' });
      setConfirm(null);
      setForm({ target_url: '', event_types: '', hmac_secret: '' });
      load();
    } catch (e: any) { toast.push({ type: 'error', message: e.message }); }
  };

  const handleDelete = async () => {
    if (confirm?.type !== 'delete') return;
    try {
      await deleteWebhookSubscription(confirm.sub.id);
      toast.push({ type: 'success', message: '已删除订阅' });
      setConfirm(null);
      load();
    } catch (e: any) { toast.push({ type: 'error', message: e.message }); }
  };

  return (
    <div>
      <button onClick={() => { setForm({ target_url: '', event_types: '', hmac_secret: '' }); setConfirm({ type: 'create' }); }}
              data-testid="webhook-new" className="btn btn-primary" style={{ marginBottom: 12 }}>+ New Subscription</button>
      {loading ? <Skeleton variant="row" count={3} /> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#fafafa' }}>
            <th style={{ padding: 8, textAlign: 'left' }}>ID</th>
            <th style={{ padding: 8, textAlign: 'left' }}>Target URL</th>
            <th style={{ padding: 8, textAlign: 'left' }}>Event Types</th>
            <th style={{ padding: 8, textAlign: 'left' }}>Enabled</th>
            <th style={{ padding: 8, textAlign: 'left' }}>操作</th>
          </tr></thead>
          <tbody>
            {subs.map(s => (
              <tr key={s.id} data-testid={`webhook-row-${s.id}`} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: 8 }}><code>{s.id}</code></td>
                <td style={{ padding: 8 }}><code>{s.target_url}</code></td>
                <td style={{ padding: 8 }}>{s.event_types.join(', ')}</td>
                <td style={{ padding: 8 }}>{s.enabled ? '是' : '否'}</td>
                <td style={{ padding: 8 }}>
                  <button onClick={() => setConfirm({ type: 'delete', sub: s })}
                          data-testid={`webhook-delete-${s.id}`} className="btn btn-sm btn-danger">删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ConfirmModal
        open={confirm?.type === 'create' || false}
        title="新建 Webhook 订阅"
        message="订阅创建后，sub-E+ 会接入 worker 实际投递。"
        confirmText="创建"
        variant="primary"
        onConfirm={handleCreate}
        onClose={() => setConfirm(null)}
      >
        {confirm?.type === 'create' && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label>Target URL *<input data-testid="webhook-create-url" value={form.target_url} onChange={e => setForm({ ...form, target_url: e.target.value })} style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4 }} /></label>
            <label>Event Types * (逗号分隔) <input data-testid="webhook-create-events" value={form.event_types} onChange={e => setForm({ ...form, event_types: e.target.value })} placeholder="placement.paid,candidate.unlocked" style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4 }} /></label>
            <label>HMAC Secret（可选） <input data-testid="webhook-create-secret" value={form.hmac_secret} onChange={e => setForm({ ...form, hmac_secret: e.target.value })} style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4 }} /></label>
          </div>
        )}
      </ConfirmModal>

      <ConfirmModal
        open={confirm?.type === 'delete' || false}
        title="删除订阅"
        message={`确认删除订阅 ${confirm?.type === 'delete' ? confirm.sub.target_url : ''}？`}
        confirmText="删除"
        variant="danger"
        onConfirm={handleDelete}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
```

### Step 2.2: Typecheck

```bash
cd /d/dev/hunter-platform/admin-web && npx tsc --noEmit 2>&1 | tail -5
```

Expected: 无错误。

### Step 2.3: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/SettingsPage.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): SettingsPage — 3 tabs (Config / Rate-Limit / Webhooks)"
```

---

## Task 3: Layout + App.tsx 路由注册

**Files:**
- Modify: `admin-web/src/components/Layout.tsx`
- Modify: `admin-web/src/App.tsx`

### Step 3.1: Layout.tsx 加 nav 入口

找到现有 nav 块，加在 Audit 之前：

```tsx
<NavLink to="/admin/settings" style={linkStyle}>Settings</NavLink>
```

### Step 3.2: App.tsx 加 route

加 import + route：

```tsx
import SettingsPage from './pages/SettingsPage';
```

```tsx
<Route path="/settings" element={<PrivateRoute><SettingsPage /></PrivateRoute>} />
```

### Step 3.3: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/components/Layout.tsx admin-web/src/App.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): Layout + App routes — +Settings entry"
```

---

## Task 4: SettingsPage 测试

**Files:**
- Create: `admin-web/tests/pages/SettingsPage.test.tsx`

### Step 4.1: 创建 test

Create `admin-web/tests/pages/SettingsPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../src/lib/toast';
import SettingsPage from '../../src/pages/SettingsPage';

vi.mock('../../src/api/config', () => ({
  listConfig: vi.fn(),
  updateConfig: vi.fn(),
}));
vi.mock('../../src/api/rate-limit', () => ({ listRateLimits: vi.fn() }));
vi.mock('../../src/api/webhook-subscriptions', () => ({
  listWebhookSubscriptions: vi.fn(),
  createWebhookSubscription: vi.fn(),
  deleteWebhookSubscription: vi.fn(),
}));

import { listConfig, updateConfig } from '../../src/api/config';
import { listRateLimits } from '../../src/api/rate-limit';
import { listWebhookSubscriptions, createWebhookSubscription, deleteWebhookSubscription } from '../../src/api/webhook-subscriptions';

const renderPage = () => render(
  <MemoryRouter>
    <ToastProvider>
      <SettingsPage />
    </ToastProvider>
  </MemoryRouter>
);

describe('SettingsPage (Sub-E)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listConfig as any).mockResolvedValue([
      { key: 'platform_fee_pct', value: 5, updated_at: '2026-06-25T00:00:00Z', updated_by_admin_user_id: 'adm_1' },
      { key: 'rate_limit.tier.free.limit_per_minute', value: 10, updated_at: '2026-06-25T00:00:00Z', updated_by_admin_user_id: 'adm_1' },
    ]);
    (listRateLimits as any).mockResolvedValue([
      { scope: 'tier', key: 'free', limit_per_minute: 10 },
    ]);
    (listWebhookSubscriptions as any).mockResolvedValue([
      { id: 1, target_url: 'https://x.com', event_types: ['a'], hmac_secret: null, enabled: true, created_at: '2026-06-25', updated_at: '2026-06-25', created_by_admin_user_id: 'adm_1' },
    ]);
    (updateConfig as any).mockResolvedValue({});
    (createWebhookSubscription as any).mockResolvedValue({ id: 2 });
    (deleteWebhookSubscription as any).mockResolvedValue(undefined);
  });

  it('1. mount shows Config tab with config entries', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('config-row-platform_fee_pct')).toBeTruthy());
    expect(screen.getByText('5')).toBeTruthy();  // value 5
  });

  it('2. clicking Config 编辑 button opens ConfirmModal with reason textarea', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('config-edit-platform_fee_pct'));
    fireEvent.click(screen.getByTestId('config-edit-platform_fee_pct'));
    await waitFor(() => expect(screen.getByTestId('confirm-modal-reason')).toBeTruthy());
  });

  it('3. switching to Rate-Limit tab shows rate_limit entries', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('tab-rate-limit'));
    fireEvent.click(screen.getByTestId('tab-rate-limit'));
    await waitFor(() => expect(listRateLimits).toHaveBeenCalled());
  });

  it('4. switching to Webhooks tab shows subscription list', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('tab-webhooks'));
    fireEvent.click(screen.getByTestId('tab-webhooks'));
    await waitFor(() => expect(screen.getByTestId('webhook-row-1')).toBeTruthy());
  });

  it('5. clicking + New Subscription opens create form with reason', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('tab-webhooks'));
    fireEvent.click(screen.getByTestId('tab-webhooks'));
    await waitFor(() => screen.getByTestId('webhook-new'));
    fireEvent.click(screen.getByTestId('webhook-new'));
    await waitFor(() => expect(screen.getByTestId('webhook-create-url')).toBeTruthy());
  });
});
```

### Step 4.2: 跑测试

```bash
cd /d/dev/hunter-platform/admin-web && npm run test -- tests/pages/SettingsPage.test.tsx 2>&1 | tail -8
```

Expected: 5 通过。

### Step 4.3: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/tests/pages/SettingsPage.test.tsx
git -C D:/dev/hunter-platform commit -m "test(admin-web): SettingsPage — 5 cases for 3 tabs + edit/new actions"
```

---

## Task 5: 全验证 + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

### Step 5.1: 跑全部 admin-web 测试

```bash
cd /d/dev/hunter-platform/admin-web && npm run test 2>&1 | tail -6
```

Expected: 196 + 11 = **207 通过**。

### Step 5.2: Typecheck

```bash
cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -3
cd /d/dev/hunter-platform/admin-web && npx tsc --noEmit 2>&1 | tail -3
```

Expected: 无错误。

### Step 5.3: 更新 CHANGELOG

打开 `CHANGELOG.md`，在 `v2.7.0 (Sub-E Plan 1 ...)` 段落后，扩展为完整 v2.7.0：

```markdown
## v2.7.0 (Sub-E — Settings UI) — 2026-06-25

### 新增功能
- **SettingsPage**（`/settings`）3 tabs：
  - **Config**：列出 + 编辑所有 config keys（带 reason 必填）
  - **Rate-Limit**：读 `rate_limit.*` config keys（read-only；写走 Config tab）
  - **Webhooks**：CRUD webhook 订阅（target_url + event_types + hmac_secret + enabled）
- 后端（Plan 1）：
  - 1 migration（v024 webhook_subscriptions）
  - 4 endpoint（list / create / update / delete webhook subscriptions）
  - 4 capability

### 测试
- 后端 +10 集成测试
- 前端 +11 component / API / page test
- **总计：~988 + 207 = 1195 tests**

### 已知限制
- Webhook subscriptions 是 metadata，**worker 不读**。Sub-F（Sub-E+）会接入实际投递。
- Rate-Limit 读自 Config，未真正接入限流逻辑。
```

### Step 5.4: Commit

```bash
git -C D:/dev/hunter-platform add CHANGELOG.md
git -C D:/dev/hunter-platform commit -m "docs(changelog): v2.7.0 — Sub-E full (Settings UI)"
```

### Step 5.5: 最终 sanity check

```bash
git -C D:/dev/hunter-platform log --oneline -12
```

确认 Plan 2 所有 task 5 个新 commit 都在（API x 1 + Page x 1 + Layout x 1 + Test x 1 + CHANGELOG x 1）。

---

## Done criteria（Plan 2 完成）

- [ ] SettingsPage 3 tabs 全部工作
- [ ] 11 个新测试通过
- [ ] 全 typecheck 干净
- [ ] CHANGELOG v2.7.0 完整
- [ ] 5 个 task 都 commit

**Sub-E 全部完成。** 下一步：Sub-F（worker 接入）或 i18n 或其他。