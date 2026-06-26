# Sub-E Cleanup + Config DB-Backed Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正之前 Sub-E 实现的 3 个问题：
1. Config backend 还是写 JSON 文件 → 改为 DB-backed（即时生效 + audit）
2. webhook_subscriptions 表 + handler + 4 routes + 4 capabilities + UI tab → 删（worker 不读，纯 dead code）
3. Rate-Limit UI tab → 删（worker 不读 Config，欺骗性 UI）

**Architecture:**
- **Backend**：1 migration（v025，drop webhook_subs + create config）+ config handler 重构 + 4 webhook endpoint 删 + 4 webhook capability 删 + routes/admin.ts 删 webhook section
- **前端**：SettingsPage 改 1 tab（删 2 个）+ api/ 删 2 个 wrapper
- **测试**：config handler test 重写（写文件→写 DB），webhook/rate-limit test 删

**Tech Stack (existing):** 全部沿用
**Spec:** [docs/superpowers/specs/2026-06-25-web-admin-sub-E-design.md](../specs/2026-06-25-web-admin-sub-E-design.md)（重写版）

---

## 0. Reviewer decisions

| 反馈点 | 决策 |
|--------|------|
| Config backend | DB + audit + 即时生效（替代写文件） |
| webhook_subscriptions | 全删（migration + handler + 4 routes + 4 capabilities + UI tab）|
| Rate-Limit | UI 删 tab；backend handler 保留（无影响）|
| Rate-Limit API wrapper | 删（前端不用） |

---

## 现有代码上下文（开始 Task 1 前必读）

- `src/main/modules/admin/handlers/config.ts` — 写 JSON 文件，需重构
- `src/main/modules/admin/handlers/webhook-subscriptions.ts` — 4 endpoint handler，删
- `src/main/db/migrations/v024_webhook_subscriptions.sql` — 需 drop 表
- `src/main/capabilities/admin.ts` — 有 4 个 webhook-subscription capability + 2 个 rate-limit capability，删
- `admin-web/src/pages/SettingsPage.tsx` — 3 tabs，改 1 tab
- `admin-web/src/api/{rate-limit,webhook-subscriptions}.ts` — 删

**不动**：`webhook-delivery-queue.ts`（队列表，Sub-D3 仍用，不动）

---

## File Structure

| File | Change |
|------|--------|
| `src/main/db/migrations/v024_webhook_subscriptions.sql` | **Modify** — 改为 v024-cleanup-and-config.sql（drop webhook + create config） |
| `src/main/modules/admin/handlers/config.ts` | **Rewrite** — DB-backed + audit |
| `src/main/modules/admin/handlers/webhook-subscriptions.ts` | **Delete** |
| `src/main/routes/admin.ts` | **Modify** — 删 4 个 webhook-subscriptions routes + rate-limit 改写 |
| `src/main/capabilities/admin.ts` | **Modify** — 删 4 webhook cap + 2 rate-limit cap；+ 2 config cap |
| `docs/superpowers/skill.md` | **Modify** — 删相关 capability 描述 |
| `src/main/server.ts` | **Modify** — 启动时数据迁移（从 JSON 文件读 → 写 DB） |
| `admin-web/src/pages/SettingsPage.tsx` | **Rewrite** — 1 tab (Config) |
| `admin-web/src/components/ConfigEditModal.tsx` | **Create** — key + value + reason 输入 |
| `admin-web/src/api/rate-limit.ts` | **Delete** |
| `admin-web/src/api/webhook-subscriptions.ts` | **Delete** |
| `admin-web/src/api/config.ts` | **Modify** — 加 updateConfig 必传 reason |
| `admin-web/tests/api/rate-limit.test.ts` | **Delete** |
| `admin-web/tests/api/webhook-subscriptions.test.ts` | **Delete** |
| `admin-web/tests/pages/SettingsPage.test.tsx` | **Rewrite** — 1 tab case |
| `docs/CHANGELOG.md` | **Modify** — v2.7.0 修正版（备注 cleanup） |

---

## Task 1: 修 migration — drop webhook + create config

**Files:**
- Modify: `src/main/db/migrations/v024_webhook_subscriptions.sql`
- Modify: `src/main/db/migrations.ts`

### Step 1.1: 重写 v024 文件

打开 `src/main/db/migrations/v024_webhook_subscriptions.sql`，**重写**为：

```sql
-- v024: Cleanup + Config table
-- 1) Drop unused webhook_subscriptions table (added in original v024, never wired to worker)
-- 2) Create config table (DB-backed, replaces JSON file storage)

DROP TABLE IF EXISTS webhook_subscriptions;

CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_admin_user_id TEXT
);
CREATE INDEX idx_config_updated ON config(updated_at);
```

### Step 1.2: 更新 migration 版本描述

打开 `src/main/db/migrations.ts`，找到 v024 那行：

```typescript
  { version: 24, description: 'webhook_subscriptions table for admin UI', file: 'migrations/v024_webhook_subscriptions.sql' },
```

替换为：

```typescript
  { version: 24, description: 'config table (DB-backed, replaces JSON file) — drops unused webhook_subscriptions', file: 'migrations/v024_webhook_subscriptions.sql' },
```

### Step 1.3: 跑现有后端测试（验证 migration 不破坏）

```bash
cd /d/dev/hunter-platform && npx vitest run 2>&1 | tail -5
```

如失败：检查是否有测试依赖 webhook_subscriptions 表（应该有，需删或调整）。

### Step 1.4: Commit

```bash
git -C D:/dev/hunter-platform add src/main/db/migrations/v024_webhook_subscriptions.sql src/main/db/migrations.ts
git -C D:/dev/hunter-platform commit -m "refactor(admin): migration v024 — drop unused webhook_subscriptions + create config table"
```

---

## Task 2: 重写 config.ts handler (DB-backed + audit)

**Files:**
- Modify: `src/main/modules/admin/handlers/config.ts`

### Step 2.1: 读现有 handler 确认 import

打开 `src/main/modules/admin/handlers/config.ts`（现有是文件读写版本）。整个文件替换为：

```typescript
import type { DB } from '../../../db/connection.js';
import { createAdminActionLogRepo } from '../../../db/repositories/admin-action-log.js';

export type ConfigEntry = {
  key: string;
  value: unknown;
  updated_at: string;
  updated_by_admin_user_id: string | null;
};

const KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

export function createAdminConfigHandler(db: DB) {
  const adminLog = createAdminActionLogRepo(db);
  return {
    list(): ConfigEntry[] {
      const rows = db.prepare(
        'SELECT key, value_json, updated_at, updated_by_admin_user_id FROM config ORDER BY key'
      ).all() as Array<{ key: string; value_json: string; updated_at: string; updated_by_admin_user_id: string | null }>;
      return rows.map(r => ({
        key: r.key,
        value: JSON.parse(r.value_json),
        updated_at: r.updated_at,
        updated_by_admin_user_id: r.updated_by_admin_user_id,
      }));
    },

    set(adminUserId: string, key: string, value: unknown): ConfigEntry {
      if (!KEY_RE.test(key)) {
        throw new Error('Invalid config key format: must be lowercase.dotted.path (e.g. platform.fee.pct)');
      }
      const valueJson = JSON.stringify(value);
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO config (key, value_json, updated_at, updated_by_admin_user_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at,
          updated_by_admin_user_id = excluded.updated_by_admin_user_id
      `).run(key, valueJson, now, adminUserId);
      adminLog.insert({
        admin_user_id: adminUserId,
        action: 'update_config',
        target_type: 'config',
        target_id: key,
        details_json: JSON.stringify({ value }),
      });
      return { key, value, updated_at: now, updated_by_admin_user_id: adminUserId };
    },
  };
}
```

### Step 2.2: 跑现有后端 config 测试（如有）

如 `tests/integration/admin-endpoints.test.ts` 测了 `/config` → 跑一下确认：

```bash
cd /d/dev/hunter-platform && npx vitest run tests/integration/admin-endpoints.test.ts 2>&1 | tail -10
```

如有 config 测试失败（因为 handler 行为变了），更新测试以匹配新行为。

### Step 2.3: Commit

```bash
git -C D:/dev/hunter-platform add src/main/modules/admin/handlers/config.ts
git -C D:/dev/hunter-platform commit -m "refactor(admin): config handler — DB-backed + audit (replaces JSON file write)"
```

---

## Task 3: 删 webhook-subscriptions handler + routes + capabilities

**Files:**
- Delete: `src/main/modules/admin/handlers/webhook-subscriptions.ts`
- Modify: `src/main/routes/admin.ts`
- Modify: `src/main/capabilities/admin.ts`
- Modify: `docs/superpowers/skill.md`

### Step 3.1: 删 handler 文件

```bash
rm /d/dev/hunter-platform/src/main/modules/admin/handlers/webhook-subscriptions.ts
```

### Step 3.2: 改 routes/admin.ts

打开文件，找到：
- `import { createAdminWebhookSubscriptionsHandler }` → 删
- `const webhookSubs = createAdminWebhookSubscriptionsHandler(db);` → 删
- 4 个 webhook-subscriptions route（list/create/patch/delete）→ 删

### Step 3.3: 改 capabilities/admin.ts

打开文件，找到 4 个 webhook-subscription capability → 删。

找到 2 个 rate-limit capability → 删（前端也不用了；保留 backend handler 即可，capability 删防止 admin 调用）。

**新增 2 个 config capability：**

```typescript
    {
      name: 'admin.list_config',
      description: '列出所有 config key-value',
      method: 'GET', path: '/v1/admin/config',
      response_schema: ListConfigResponseSchema,
      quota_cost: 0, preconditions: [],
    },
    {
      name: 'admin.update_config',
      description: '更新 config key（写 audit）',
      method: 'PUT', path: '/v1/admin/config/:key',
      response_schema: GetConfigResponseSchema,
      quota_cost: 0, preconditions: [],
    },
```

### Step 3.4: 改 skill.md

打开文件，找到 webhook-subscription + rate-limit capability 描述 → 删。
找到 admin capability 表，加 2 个 config 行。

### Step 3.5: 跑后端测试

```bash
cd /d/dev/hunter-platform && npx vitest run 2>&1 | tail -5
```

如失败：可能是 webhook-subscriptions test 还在，删除对应 test 文件。

### Step 3.6: 删 webhook-subscriptions test

```bash
rm /d/dev/hunter-platform/tests/integration/admin-webhook-subscriptions.test.ts
```

如还有其他 test 引用 webhook-subscriptions，一并删。

### Step 3.7: Commit

```bash
git -C D:/dev/hunter-platform add src/main/modules/admin/handlers/webhook-subscriptions.ts src/main/routes/admin.ts src/main/capabilities/admin.ts docs/superpowers/skill.md tests/integration/admin-webhook-subscriptions.test.ts
git -C D:/dev/hunter-platform commit -m "refactor(admin): remove webhook-subscriptions (table/handler/routes/capabilities) — worker never read it"
```

---

## Task 4: 加 config schema（ListConfigResponseSchema + GetConfigResponseSchema）

**Files:**
- Modify: `src/main/schemas/admin.ts`

### Step 4.1: 找 ConfigGetResponseSchema / ConfigPutResponseSchema

打开文件，找到现有的 config schema：

```typescript
const ConfigGetResponseSchema = EnvelopeSchema(z.record(z.string(), z.unknown()));
const ConfigPutResponseSchema = EnvelopeSchema(
  z.object({ key: z.string(), saved: z.literal(true) })
);
```

替换为：

```typescript
const ConfigEntrySchema = z.object({
  key: z.string(),
  value: z.unknown(),
  updated_at: ISODateTime,
  updated_by_admin_user_id: z.string().nullable(),
});
const ListConfigResponseSchema = EnvelopeSchema(z.array(ConfigEntrySchema));
const GetConfigResponseSchema = EnvelopeSchema(ConfigEntrySchema);
```

### Step 4.2: 跑后端 typecheck

```bash
cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -3
```

Expected: 无错误。

### Step 4.3: Commit

```bash
git -C D:/dev/hunter-platform add src/main/schemas/admin.ts
git -C D:/dev/hunter-platform commit -m "feat(admin-schemas): ListConfigResponseSchema + GetConfigResponseSchema (DB-backed config)"
```

---

## Task 5: 启动时数据迁移（JSON → DB）

**Files:**
- Modify: `src/main/server.ts`（或新建 `src/main/startup/config-migration.ts`）

### Step 5.1: 加 migration 函数

在 `src/main/server.ts` 中找到 `createAppFromDb()` 调用后加：

```typescript
import fs from 'node:fs';
import path from 'node:path';

// 启动时一次性迁移（从 JSON 文件读 → 写 DB）
function migrateConfigFromFilesToDB(db: DB) {
  const configDir = path.join(process.cwd(), 'config');
  if (!fs.existsSync(configDir)) return;
  const files = ['desensitization.json', 'commission.json'];
  for (const f of files) {
    const full = path.join(configDir, f);
    if (!fs.existsSync(full)) continue;
    try {
      const content = fs.readFileSync(full, 'utf8');
      const key = path.basename(f, '.json');
      const now = new Date().toISOString();
      db.prepare(`
        INSERT OR IGNORE INTO config (key, value_json, updated_at, updated_by_admin_user_id)
        VALUES (?, ?, ?, NULL)
      `).run(key, content, now);
    } catch (e) {
      console.warn(`[startup] config migration failed for ${f}:`, e);
    }
  }
}
```

调用：

```typescript
const app = createAppFromDb(db, env);
migrateConfigFromFilesToDB(db);
```

### Step 5.2: 跑后端测试

确认启动路径不破坏。

### Step 5.3: Commit

```bash
git -C D:/dev/hunter-platform add src/main/server.ts
git -C D:/dev/hunter-platform commit -m "feat(admin): startup config migration — read JSON files into DB on first boot"
```

---

## Task 6: 前端 — SettingsPage 改 1 tab + 加 ConfigEditModal

**Files:**
- Modify: `admin-web/src/pages/SettingsPage.tsx`
- Create: `admin-web/src/components/ConfigEditModal.tsx`
- Delete: `admin-web/src/api/rate-limit.ts`
- Delete: `admin-web/src/api/webhook-subscriptions.ts`
- Modify: `admin-web/src/api/config.ts`
- Modify: `admin-web/tests/pages/SettingsPage.test.tsx`
- Delete: `admin-web/tests/api/rate-limit.test.ts`
- Delete: `admin-web/tests/api/webhook-subscriptions.test.ts`

### Step 6.1: 删 2 个 API wrapper + test

```bash
rm /d/dev/hunter-platform/admin-web/src/api/rate-limit.ts
rm /d/dev/hunter-platform/admin-web/src/api/webhook-subscriptions.ts
rm /d/dev/hunter-platform/admin-web/tests/api/rate-limit.test.ts
rm /d/dev/hunter-platform/admin-web/tests/api/webhook-subscriptions.test.ts
```

### Step 6.2: 改 api/config.ts — 加 reason 必填

找到 `updateConfig(key, value)`，改为：

```typescript
export async function updateConfig(key: string, value: unknown, reason: string): Promise<ConfigEntry> {
  const env = await apiFetchRaw<ConfigEntry>(`config/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value, reason }),
  });
  if (!env.ok || !env.data) {
    throw new Error(env.error?.message ?? 'Failed to update config');
  }
  return env.data;
}
```

### Step 6.3: 创建 ConfigEditModal.tsx

Create `admin-web/src/components/ConfigEditModal.tsx`:

```tsx
import { useState, useEffect } from 'react';
import Modal from './Modal';
import type { ConfigEntry } from '../api/config';

type ConfigEditModalProps = {
  open: boolean;
  entry: ConfigEntry | null;  // null = 新建
  onClose: () => void;
  onSave: (key: string, value: unknown, reason: string) => Promise<void>;
};

export default function ConfigEditModal({ open, entry, onClose, onSave }: ConfigEditModalProps) {
  const [key, setKey] = useState('');
  const [valueText, setValueText] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setKey(entry?.key ?? '');
      setValueText(entry ? JSON.stringify(entry.value, null, 2) : '{}');
      setReason('');
      setError(null);
    }
  }, [open, entry]);

  const handleSave = async () => {
    if (!key) { setError('Key 不能为空'); return; }
    if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/.test(key)) {
      setError('Key 格式：lowercase.dotted.path（如 platform.fee.pct）'); return;
    }
    if (reason.trim().length < 3) { setError('原因至少 3 字符'); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(valueText); } catch (e: any) {
      setError('Value 不是合法 JSON：' + e.message); return;
    }
    setLoading(true);
    try {
      await onSave(key, parsed, reason.trim());
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} title={entry ? '编辑 Config' : '新建 Config Key'} onClose={onClose} footer={
      <>
        <button onClick={onClose} disabled={loading} className="btn">取消</button>
        <button onClick={handleSave} disabled={loading} className="btn btn-primary" data-testid="config-save">保存</button>
      </>
    }>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>Key *</label>
        <input
          type="text"
          value={key}
          onChange={e => setKey(e.target.value)}
          disabled={!!entry}
          placeholder="lowercase.dotted.path"
          data-testid="config-key"
          style={{ width: '100%', height: 32, padding: '0 8px', border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>Value (JSON) *</label>
        <textarea
          value={valueText}
          onChange={e => setValueText(e.target.value)}
          rows={8}
          data-testid="config-value"
          style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, fontFamily: 'monospace', fontSize: 13, boxSizing: 'border-box' }}
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>原因 *</label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={2}
          placeholder="至少 3 字符（写入 audit log）"
          data-testid="config-reason"
          style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box' }}
        />
      </div>
      {error && <div style={{ color: '#a8071a', marginTop: 8 }} data-testid="config-modal-error">{error}</div>}
    </Modal>
  );
}
```

### Step 6.4: 改 SettingsPage.tsx

整个文件替换为：

```tsx
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import Skeleton from '../components/Skeleton';
import ConfigEditModal from '../components/ConfigEditModal';
import { listConfig, updateConfig, type ConfigEntry } from '../api/config';
import { useToast } from '../lib/toast';
import { relativeTime } from '../lib/format';

export default function SettingsPage() {
  const toast = useToast();
  const [entries, setEntries] = useState<ConfigEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editEntry, setEditEntry] = useState<ConfigEntry | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    listConfig()
      .then(setEntries)
      .catch(err => toast.push({ type: 'error', message: err.message }))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (key: string, value: unknown, reason: string) => {
    await updateConfig(key, value, reason);
    toast.push({ type: 'success', message: `已保存 ${key}` });
    load();
  };

  return (
    <Layout adminName="Admin">
      <Link to="/admin">← 返回 Dashboard</Link>
      <h1 style={{ marginTop: 16 }}>Settings — Config</h1>

      {loading ? <Skeleton variant="row" count={5} /> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
          <thead>
            <tr style={{ background: '#fafafa' }}>
              <th style={{ padding: 8, textAlign: 'left' }}>Key</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Value</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Updated</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Updated By</th>
              <th style={{ padding: 8, textAlign: 'left' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.key} data-testid={`config-row-${e.key}`} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: 8 }}><code>{e.key}</code></td>
                <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 12, maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis' }}>{JSON.stringify(e.value)}</td>
                <td style={{ padding: 8 }}>{relativeTime(e.updated_at)}</td>
                <td style={{ padding: 8 }}>{e.updated_by_admin_user_id ?? '—'}</td>
                <td style={{ padding: 8 }}>
                  <button onClick={() => { setEditEntry(e); setModalOpen(true); }} className="btn btn-sm" data-testid={`config-edit-${e.key}`}>编辑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button onClick={() => { setEditEntry(null); setModalOpen(true); }} className="btn btn-primary" data-testid="config-new" style={{ marginTop: 16 }}>+ New Key</button>

      <ConfigEditModal
        open={modalOpen}
        entry={editEntry}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
      />
    </Layout>
  );
}
```

### Step 6.5: 改 SettingsPage test

打开 `admin-web/tests/pages/SettingsPage.test.tsx`（如不存在则新建）。

整个文件替换为：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from '../../src/lib/toast';
import SettingsPage from '../../src/pages/SettingsPage';

vi.mock('../../src/api/config', () => ({
  listConfig: vi.fn(),
  updateConfig: vi.fn(),
}));

import { listConfig, updateConfig } from '../../src/api/config';

const renderPage = () => render(
  <MemoryRouter initialEntries={['/admin/settings']}>
    <ToastProvider>
      <Routes>
        <Route path="/admin/settings" element={<SettingsPage />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>
);

const mockEntry = {
  key: 'platform.fee.pct', value: { pct: 5 },
  updated_at: '2026-06-25T10:00:00Z',
  updated_by_admin_user_id: 'adm_1',
};

describe('SettingsPage (Sub-E Config only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listConfig as any).mockResolvedValue([mockEntry]);
    (updateConfig as any).mockResolvedValue(mockEntry);
  });

  it('1. mount calls listConfig + renders row', async () => {
    renderPage();
    await waitFor(() => expect(listConfig).toHaveBeenCalled());
    expect(screen.getByTestId('config-row-platform.fee.pct')).toBeTruthy();
  });

  it('2. clicking 编辑 opens modal pre-filled', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('config-edit-platform.fee.pct'));
    fireEvent.click(screen.getByTestId('config-edit-platform.fee.pct'));
    expect(screen.getByText('编辑 Config')).toBeTruthy();
    expect(screen.getByTestId('config-value').textContent).toContain('pct');
  });

  it('3. clicking + New Key opens empty modal', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('config-new'));
    fireEvent.click(screen.getByTestId('config-new'));
    expect(screen.getByText('新建 Config Key')).toBeTruthy();
  });

  it('4. save calls updateConfig with key + value + reason', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('config-edit-platform.fee.pct'));
    fireEvent.click(screen.getByTestId('config-edit-platform.fee.pct'));
    fireEvent.change(screen.getByTestId('config-reason'), { target: { value: '调整 fee' } });
    fireEvent.click(screen.getByTestId('config-save'));
    await waitFor(() => expect(updateConfig).toHaveBeenCalledWith('platform.fee.pct', { pct: 5 }, '调整 fee'));
  });
});
```

### Step 6.6: 跑 admin-web 测试

```bash
cd /d/dev/hunter-platform/admin-web && npm run test 2>&1 | tail -5
```

Expected: 全绿（旧的 rate-limit / webhook-subscriptions test 已删；新 SettingsPage 4 case 通过）。

### Step 6.7: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/api/config.ts admin-web/src/api/rate-limit.ts admin-web/src/api/webhook-subscriptions.ts admin-web/src/pages/SettingsPage.tsx admin-web/src/components/ConfigEditModal.tsx admin-web/tests/api/rate-limit.test.ts admin-web/tests/api/webhook-subscriptions.test.ts admin-web/tests/pages/SettingsPage.test.tsx
git -C D:/dev/hunter-platform commit -m "refactor(admin-web): SettingsPage — remove rate-limit/webhook tabs, add ConfigEditModal + DB-backed updateConfig"
```

---

## Task 7: 全验证 + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

### Step 7.1: 跑全部后端 + 前端测试

```bash
cd /d/dev/hunter-platform && npx vitest run 2>&1 | tail -6
cd /d/dev/hunter-platform/admin-web && npm run test 2>&1 | tail -6
```

Expected: 后端 ~935-945（前 + 删 webhook + 加 config 测试），admin-web ~196 - 删 9 + 4 新 ≈ 191 通过。

### Step 7.2: Typecheck

```bash
cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -3
cd /d/dev/hunter-platform/admin-web && npx tsc --noEmit 2>&1 | tail -3
```

Expected: 无错误。

### Step 7.3: CHANGELOG

打开 `CHANGELOG.md`，找到 v2.7.0 那段（Sub-E Plan 1 和 Plan 2 各自 commit 的 CHANGELOG），合并/更新为：

```markdown
## v2.7.0 (Sub-E — Config DB-Backed) — 2026-06-25

### 新增功能
- **Config DB-backed**：从 JSON 文件迁移到 `config` 表（migration v024）
  - 写后立即生效（不需 restart 服务）
  - 写 `admin_action_log`（action='update_config'）
  - 启动时一次性从 JSON 文件读 → 写 DB（向后兼容）
- **SettingsPage 改 1 tab**（Config only）
- **ConfigEditModal** 组件（key + value JSON textarea + reason 必填）
- 2 个新 capability：`admin.list_config` + `admin.update_config`

### 清理
- **删 webhook_subscriptions**：表 + handler + 4 routes + 4 capabilities + UI tab（worker 不读，纯 dead code）
- **删 rate-limit UI tab + API wrappers**：worker 不读 Config key，UI 是欺骗性

### 测试
- 后端 +config tests（DB-backed），-webhook-subscriptions tests
- 前端 -rate-limit + -webhook-subscriptions tests，+SettingsPage 4 case + ConfigEditModal
```

### Step 7.4: Commit

```bash
git -C D:/dev/hunter-platform add CHANGELOG.md
git -C D:/dev/hunter-platform commit -m "docs(changelog): v2.7.0 — Sub-E cleanup (Config DB-backed + remove dead code)"
```

### Step 7.5: 最终 sanity check

```bash
git -C D:/dev/hunter-platform log --oneline -10
```

确认 7 个新 commit 都在。

---

## Done criteria

- [ ] webhook_subscriptions 全删（表/handler/routes/capabilities/UI）
- [ ] rate-limit UI/API/test 删
- [ ] Config 改 DB-backed + audit + 即时生效
- [ ] 启动时 JSON → DB 迁移
- [ ] SettingsPage 1 tab + ConfigEditModal
- [ ] 全测试绿
- [ ] CHANGELOG v2.7.0 修订版
- [ ] 7 个 task 都 commit

**预计 3-4 小时。** 单 plan 因为主要是清理 + 单 tab 改造。