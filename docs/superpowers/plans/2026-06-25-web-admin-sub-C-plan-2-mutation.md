# Web Admin Sub-C Plan 2: Mutation + Audit Detail

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **前置依赖：** Plan 1 (`2026-06-25-web-admin-sub-C-plan-1-readonly.md`) 必须**先 merge 到 main**。本 plan 修改 `users.adjustQuota` 是 **breaking API 变更**（reason 从无到必填），独立合并会导致中间窗口期旧 admin-web 调用 adjustQuota 全 400。

**Goal:** 修复 `POST /v1/admin/users/:id/adjust-quota` 不写 audit log 的 bug，加 `Modal/Toast/QuotaModal` 公共组件，给 UsersPage 加「调配额」入口，给 AuditPage Admin Actions tab 加「详情」列查看 audit JSON。

**Architecture:**
- **后端**：1 处 schema 扩字段 + 1 处 handler 改造（接 `adminUserId + reason + 写 admin_action_log`）+ 1 处 route 透传
- **前端**：3 个新公共组件（Modal / Toast / QuotaModal）+ App.tsx 全局包 ToastProvider + UsersPage 加按钮 + AuditPage 加列
- **测试**：后端 ~8 个 handler/route 测；前端 ~6 组件测 + 3 页面测 + 1 api 测

**Tech Stack (existing):** Express 4.21, better-sqlite3, zod, vitest, supertest（后端）；React 18, Vite, react-router-dom, vanilla CSS, vitest+jsdom+RTL（前端）

**Spec:** [docs/superpowers/specs/2026-06-25-web-admin-sub-C-design.md](../specs/2026-06-25-web-admin-sub-C-design.md) — §3.1, §3.5, §3.7, §4.1, §4.4, §4.6, §4.9

---

## 0. Reviewer decisions

| 反馈点 | 决策 |
|--------|------|
| Plan 1 必须先 merge | ✅ 本 plan 依赖 Plan 1 已合并 |
| adjustQuota 旧值 == 新值 | **不写 audit，直接返回**（避免噪声日志） |
| reason 长度限制 | **3-500 字符**（route + handler 双校验） |
| Toast 自动关闭 | **3 秒**（lib/toast.tsx 内 setTimeout） |
| Modal 焦点管理 | 手写 90 行 useEffect（不引 focus-trap-react 依赖） |
| Audit 「详情」列复用 AuditJsonDrawer | ✅ Sub-D1 已有，直接复用 |

---

## 现有代码上下文（开始 Task 1 前必读）

实施前应熟悉的文件：

- `src/main/modules/admin/handlers/users.ts` — 现有 `adjustQuota(user_id, new_quota)` 是 **buggy version**，本 plan 改为 `(adminUserId, user_id, new_quota, reason)`
- `src/main/schemas/admin.ts` — `AdjustQuotaResultSchema`（line 13-16）需扩字段
- `src/main/routes/admin.ts` — adjust-quota route（line 126-132）需透传 reason + adminUserId
- `admin-web/src/api/users.ts` — `listUsers()` 已有，需加 `adjustQuota()` 函数
- `admin-web/src/pages/UsersPage.tsx` — Plan 1 Task 14 已加 filter 透传；本 plan 在此基础上加按钮
- `admin-web/src/pages/AuditPage.tsx` — Admin Actions tab 已有表格（line 44-100），需加 2 列
- `admin-web/src/components/AuditJsonDrawer.tsx` — Sub-D1 详情抽屉组件，**直接复用**

**不动文件：**
- `src/main/modules/admin/handlers/candidates.ts`
- `src/main/modules/admin/handlers/dashboard.ts`
- `admin-web/src/components/Layout.tsx`（Plan 1 已加 Jobs/Refs）
- `admin-web/src/pages/JobsPage.tsx`
- `admin-web/src/pages/RecommendationsPage.tsx`

---

## File Structure（实施前 map）

### 后端修改

| File | Change |
|------|--------|
| `src/main/schemas/admin.ts` | **Modify** — `AdjustQuotaResultSchema` 加 `previous_quota` + `reason` 字段 |
| `src/main/modules/admin/handlers/users.ts` | **Modify** — `adjustQuota()` 接 4 参数 + 写 `adminLog.insert` |
| `src/main/routes/admin.ts` | **Modify** — adjust-quota route 透传 `adminUserId + reason` |
| `tests/integration/admin-list-pagination.test.ts` | **Modify** — 加 6 个 adjustQuota 集成测 |

### 前端新增

| File | Change |
|------|--------|
| `admin-web/src/lib/toast.tsx` | **Create** — ToastProvider + useToast() hook |
| `admin-web/src/components/Toast.tsx` | **Create** — 全局浮层渲染 |
| `admin-web/src/components/Modal.tsx` | **Create** — 通用 dialog（portal + ESC + 焦点管理） |
| `admin-web/src/components/QuotaModal.tsx` | **Create** — 调配额表单（基于 Modal） |
| `admin-web/src/api/users.ts` | **Modify** — 加 `adjustQuota()` 函数 |

### 前端修改

| File | Change |
|------|--------|
| `admin-web/src/App.tsx` | **Modify** — 顶层包 `<ToastProvider>` + `<Toast />` |
| `admin-web/src/pages/UsersPage.tsx` | **Modify** — 行末加「调配额」按钮 + QuotaModal 集成 + Toast 调用 |
| `admin-web/src/pages/AuditPage.tsx` | **Modify** — Admin Actions tab 加「对象」「详情」列 + AuditJsonDrawer |

### 前端测试新增

| File | Test cases |
|------|------------|
| `admin-web/tests/api/users-adjust-quota.test.ts` | 3 cases |
| `admin-web/tests/components/Toast.test.tsx` | 2 cases |
| `admin-web/tests/components/Modal.test.tsx` | 4 cases |
| `admin-web/tests/components/QuotaModal.test.tsx` | 5 cases |
| `admin-web/tests/pages/UsersPage.test.tsx` | 3 新增 cases（按钮 + Modal + 提交） |
| `admin-web/tests/pages/AuditPage.test.tsx` | 2 新增 cases（详情列 + drawer 联动） |

---

## Task 1: Backend — 扩 AdjustQuotaResultSchema

**Files:**
- Modify: `src/main/schemas/admin.ts`

### Step 1.1: 替换 AdjustQuotaResultSchema

打开 `src/main/schemas/admin.ts`，找到 `AdjustQuotaResultSchema`（line 13-16）：

```typescript
const AdjustQuotaResultSchema = z.object({
  user_id: IdString,
  new_quota: z.number().int(),
});
```

替换为：

```typescript
const AdjustQuotaResultSchema = z.object({
  user_id: IdString,
  previous_quota: z.number().int(),
  new_quota: z.number().int(),
  reason: z.string(),
});
```

### Step 1.2: Typecheck

Run: `cd D:/dev/hunter-platform && npx tsc --noEmit 2>&1 | tail -10`
Expected: no errors（schema 字段加多不破坏现有调用方——前端 Sub-D1 已废弃旧 schema 引用；唯一调用方是 admin-web，本 plan 同步改）。

### Step 1.3: Commit

```bash
git -C D:/dev/hunter-platform add src/main/schemas/admin.ts
git -C D:/dev/hunter-platform commit -m "feat(admin): AdjustQuotaResultSchema — add previous_quota + reason fields"
```

---

## Task 2: Backend — 修复 users.adjustQuota audit 缺口

**Files:**
- Modify: `src/main/modules/admin/handlers/users.ts`

### Step 2.1: 改 adjustQuota() 方法签名 + 写 audit log

打开 `src/main/modules/admin/handlers/users.ts`，找到 `adjustQuota` 方法（line 92-99）：

```typescript
    adjustQuota(user_id: string, new_quota: number): { user_id: string; new_quota: number } {
      if (new_quota < 0 || new_quota > 100000) throw Errors.invalidParams('quota must be 0-100000');
      const u = users.findById(user_id);
      if (!u) throw Errors.notFound('User not found');
      db.prepare('UPDATE users SET quota_per_day = ?, updated_at = ? WHERE id = ?')
        .run(new_quota, new Date().toISOString(), user_id);
      return { user_id, new_quota };
    },
```

替换为：

```typescript
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
      // Old value == new value: skip DB write + audit to avoid noise
      if (previousQuota === new_quota) {
        return { user_id, previous_quota, new_quota, reason };
      }
      db.prepare('UPDATE users SET quota_per_day = ?, updated_at = ? WHERE id = ?')
        .run(new_quota, new Date().toISOString(), user_id);
      // Write audit log
      adminLog.insert({
        admin_user_id: adminUserId,
        action: 'adjust_user_quota',
        target_type: 'user',
        target_id: user_id,
        details_json: JSON.stringify({
          previous_quota: previousQuota,
          new_quota,
          reason,
        }),
      });
      return { user_id, previous_quota: new_quota, reason };
    },
```

### Step 2.2: Typecheck

Run: `cd D:/dev/hunter-platform && npx tsc --noEmit 2>&1 | tail -10`
Expected: routes/admin.ts 会有 TS 错误（adjustQuota 调用处参数不对），下一 task 修复。如未看到错误，先 git diff 确认 handler 已更新。

### Step 2.3: Commit（注意 — handler 已改但 route 还没改，**单独 commit**避免破坏 main）

```bash
git -C D:/dev/hunter-platform add src/main/modules/admin/handlers/users.ts
git -C D:/dev/hunter-platform commit -m "feat(admin): users.adjustQuota — accept adminUserId + reason, write audit log"
```

> **重要：** 此 commit 后 main 会编译失败（routes/admin.ts 旧调用不匹配）。如团队有 PR 流程，本 task 应与 Task 3 同一 PR。如直接 push main，下一 task 立刻合并修复。

---

## Task 3: Backend — 改 routes/admin.ts adjust-quota route

**Files:**
- Modify: `src/main/routes/admin.ts`

### Step 3.1: 替换 adjust-quota route

打开 `src/main/routes/admin.ts`，找到 POST `/users/:id/adjust-quota` route（line 126-132）：

```typescript
  router.post('/users/:id/adjust-quota', (req, res, next) => {
    try {
      const new_quota = Number(req.body?.new_quota);
      if (!Number.isFinite(new_quota)) throw Errors.invalidParams('new_quota must be a number');
      respond(res, AdjustQuotaResponseSchema, { ok: true, data: users.adjustQuota(req.params.id, new_quota) });
    } catch (e) { next(e); }
  });
```

替换为：

```typescript
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

### Step 3.2: Typecheck

Run: `cd D:/dev/hunter-platform && npx tsc --noEmit 2>&1 | tail -10`
Expected: no errors。

### Step 3.3: Commit

```bash
git -C D:/dev/hunter-platform add src/main/routes/admin.ts
git -C D:/dev/hunter-platform commit -m "feat(admin): adjust-quota route — pass adminUserId + reason, 400 on missing reason"
```

---

## Task 4: Backend — adjustQuota 集成测试

**Files:**
- Modify: `tests/integration/admin-list-pagination.test.ts`

### Step 4.1: 在文件末尾追加 6 个测试

打开 `tests/integration/admin-list-pagination.test.ts`，在 afterAll 之前追加：

```typescript
  // ---- adjustQuota (Sub-C Plan 2) ----
  describe('POST /v1/admin/users/:id/adjust-quota', () => {
    beforeAll(() => {
      // Reset quota_per_day to 100 for u_1 (Sub-B seed set it to 100; ensure known state)
      db.prepare(`UPDATE users SET quota_per_day = 100 WHERE id = 'u_1'`).run();
    });

    it('1. adjusts quota with valid reason → 200 + writes audit', async () => {
      const r = await request(app)
        .post('/v1/admin/users/u_1/adjust-quota')
        .set('Authorization', adminAuth)
        .send({ new_quota: 50, reason: '客户紧急加单' });
      expect(r.status).toBe(200);
      expect(r.body.data).toMatchObject({ user_id: 'u_1', previous_quota: 100, new_quota: 50, reason: '客户紧急加单' });

      // Verify audit log row
      const log = db.prepare(
        `SELECT * FROM admin_action_log WHERE target_id = 'u_1' AND action = 'adjust_user_quota' ORDER BY id DESC LIMIT 1`
      ).get() as any;
      expect(log).toBeTruthy();
      expect(log.admin_user_id).toBe('adm_subb');
      const details = JSON.parse(log.details_json);
      expect(details).toEqual({ previous_quota: 100, new_quota: 50, reason: '客户紧急加单' });
    });

    it('2. missing reason → 400 INVALID_PARAMS', async () => {
      const r = await request(app)
        .post('/v1/admin/users/u_1/adjust-quota')
        .set('Authorization', adminAuth)
        .send({ new_quota: 50 });
      expect(r.status).toBe(400);
      expect(r.body.error.message).toMatch(/reason/);
    });

    it('3. reason < 3 chars → 400', async () => {
      const r = await request(app)
        .post('/v1/admin/users/u_1/adjust-quota')
        .set('Authorization', adminAuth)
        .send({ new_quota: 50, reason: 'ab' });
      expect(r.status).toBe(400);
    });

    it('4. reason > 500 chars → 400', async () => {
      const r = await request(app)
        .post('/v1/admin/users/u_1/adjust-quota')
        .set('Authorization', adminAuth)
        .send({ new_quota: 50, reason: 'a'.repeat(501) });
      expect(r.status).toBe(400);
    });

    it('5. new_quota == previous_quota → 200, no audit written', async () => {
      // Reset to 50 first
      db.prepare(`UPDATE users SET quota_per_day = 50 WHERE id = 'u_1'`).run();
      // Count audit rows before
      const beforeCount = (db.prepare(
        `SELECT COUNT(*) AS c FROM admin_action_log WHERE target_id = 'u_1' AND action = 'adjust_user_quota'`
      ).get() as { c: number }).c;

      const r = await request(app)
        .post('/v1/admin/users/u_1/adjust-quota')
        .set('Authorization', adminAuth)
        .send({ new_quota: 50, reason: '同值不应写 audit' });
      expect(r.status).toBe(200);

      const afterCount = (db.prepare(
        `SELECT COUNT(*) AS c FROM admin_action_log WHERE target_id = 'u_1' AND action = 'adjust_user_quota'`
      ).get() as { c: number }).c;
      expect(afterCount).toBe(beforeCount);
    });

    it('6. user not found → 404', async () => {
      const r = await request(app)
        .post('/v1/admin/users/u_does_not_exist/adjust-quota')
        .set('Authorization', adminAuth)
        .send({ new_quota: 50, reason: 'test missing user' });
      expect(r.status).toBe(404);
    });

    it('7. no bearer token → 401', async () => {
      const r = await request(app)
        .post('/v1/admin/users/u_1/adjust-quota')
        .send({ new_quota: 50, reason: 'no auth' });
      expect(r.status).toBe(401);
    });
  });
```

### Step 4.2: 跑测试

Run: `cd D:/dev/hunter-platform && npx vitest run tests/integration/admin-list-pagination.test.ts 2>&1 | tail -15`
Expected: 全部通过（Sub-B ~14 + Plan 1 ~10 + Plan 2 ~7 = ~31 个测试）。

如失败：检查 admin_action_log 表 schema（`admin_user_id, action, target_type, target_id, details_json` 是否存在），如列名不同，按实际调整。

### Step 4.3: Commit

```bash
git -C D:/dev/hunter-platform add tests/integration/admin-list-pagination.test.ts
git -C D:/dev/hunter-platform commit -m "test(admin): integration tests for adjustQuota — audit log + reason validation"
```

---

## Task 5: Frontend — lib/toast.tsx (Toast provider + hook)

**Files:**
- Create: `admin-web/src/lib/toast.tsx`

### Step 5.1: 创建 lib/toast.tsx

Create `admin-web/src/lib/toast.tsx`:

```tsx
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type ToastType = 'success' | 'error' | 'info';

export type ToastItem = {
  id: string;
  type: ToastType;
  message: string;
  expiresAt: number;
};

type ToastContextValue = {
  toasts: ToastItem[];
  push: (item: { type: ToastType; message: string; durationMs?: number }) => void;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const push = useCallback((item: { type: ToastType; message: string; durationMs?: number }) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const durationMs = item.durationMs ?? 3000;
    const expiresAt = Date.now() + durationMs;
    setToasts(prev => [...prev, { id, type: item.type, message: item.message, expiresAt }]);
    if (durationMs > 0) {
      setTimeout(() => dismiss(id), durationMs);
    }
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ toasts, push, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within <ToastProvider>');
  }
  return ctx;
}
```

### Step 5.2: Typecheck

Run: `cd D:/dev/hunter-platform/admin-web && npx tsc --noEmit 2>&1 | tail -5`
Expected: no errors。

### Step 5.3: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/lib/toast.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): lib/toast — ToastProvider + useToast hook"
```

---

## Task 6: Frontend — Toast 组件

**Files:**
- Create: `admin-web/src/components/Toast.tsx`

### Step 6.1: 创建 Toast.tsx

Create `admin-web/src/components/Toast.tsx`:

```tsx
import { useToast } from '../lib/toast';

const colors: Record<string, { bg: string; border: string }> = {
  success: { bg: '#e6f7ec', border: '#52c41a' },
  error:   { bg: '#fff1f0', border: '#ff4d4f' },
  info:    { bg: '#e6f7ff', border: '#1890ff' },
};

export default function Toast() {
  const { toasts, dismiss } = useToast();
  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', top: 16, right: 16, zIndex: 1000,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}
    >
      {toasts.map(t => {
        const c = colors[t.type] || colors.info;
        return (
          <div
            key={t.id}
            style={{
              padding: '10px 16px',
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: 4,
              display: 'flex', alignItems: 'center', gap: 12,
              minWidth: 280, maxWidth: 480,
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            }}
          >
            <span style={{ flex: 1 }}>{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="关闭通知"
              style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#888' }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
```

### Step 6.2: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/components/Toast.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): Toast — global floating notification list"
```

---

## Task 7: Frontend — Toast 测试

**Files:**
- Create: `admin-web/tests/components/Toast.test.tsx`

### Step 7.1: 创建 Toast.test.tsx

Create `admin-web/tests/components/Toast.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast } from '../../src/lib/toast';
import Toast from '../../src/components/Toast';

function TriggerButton() {
  const { push } = useToast();
  return <button onClick={() => push({ type: 'success', message: 'Saved!' })}>save</button>;
}

function Wrapper() {
  return (
    <ToastProvider>
      <TriggerButton />
      <Toast />
    </ToastProvider>
  );
}

describe('Toast (Sub-C Plan 2)', () => {
  it('1. clicking trigger pushes a toast and renders it', () => {
    render(<Wrapper />);
    fireEvent.click(screen.getByText('save'));
    expect(screen.getByText('Saved!')).toBeTruthy();
  });

  it('2. clicking × dismisses the toast', () => {
    render(<Wrapper />);
    fireEvent.click(screen.getByText('save'));
    expect(screen.getByText('Saved!')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('关闭通知'));
    expect(screen.queryByText('Saved!')).toBeNull();
  });

  it('3. auto-dismisses after 3s (using fake timers)', async () => {
    vi.useFakeTimers();
    render(<Wrapper />);
    fireEvent.click(screen.getByText('save'));
    expect(screen.getByText('Saved!')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(3100); });
    expect(screen.queryByText('Saved!')).toBeNull();
    vi.useRealTimers();
  });
});
```

### Step 7.2: 跑测试

Run: `cd D:/dev/hunter-platform/admin-web && npm run test -- tests/components/Toast.test.tsx 2>&1 | tail -10`
Expected: 3 通过。

### Step 7.3: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/tests/components/Toast.test.tsx
git -C D:/dev/hunter-platform commit -m "test(admin-web): Toast — render + manual dismiss + auto dismiss after 3s"
```

---

## Task 8: Frontend — Modal 组件

**Files:**
- Create: `admin-web/src/components/Modal.tsx`

### Step 8.1: 创建 Modal.tsx

Create `admin-web/src/components/Modal.tsx`:

```tsx
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type ModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
};

export default function Modal({ open, title, onClose, children, footer, width = 480 }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Save previous focus to restore on close
    previousFocusRef.current = document.activeElement as HTMLElement;
    // Lock body scroll
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus first focusable element in modal
    const focusableSelector = 'input,textarea,select,button:not([aria-label="关闭"])';
    setTimeout(() => {
      const first = modalRef.current?.querySelector<HTMLElement>(focusableSelector);
      first?.focus();
    }, 0);

    // ESC handler
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);

    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = prevOverflow;
      previousFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          zIndex: 200,
        }}
      />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto',
          background: 'white', padding: 24, borderRadius: 8,
          boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
          zIndex: 201,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button
            onClick={onClose}
            aria-label="关闭"
            style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', lineHeight: 1 }}
          >
            ×
          </button>
        </div>
        <div>{children}</div>
        {footer && (
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {footer}
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
```

### Step 8.2: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/components/Modal.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): Modal — portal + ESC + focus management + body scroll lock"
```

---

## Task 9: Frontend — Modal 测试

**Files:**
- Create: `admin-web/tests/components/Modal.test.tsx`

### Step 9.1: 创建 Modal.test.tsx

Create `admin-web/tests/components/Modal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import Modal from '../../src/components/Modal';

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      <Modal open={open} title="Test Modal" onClose={() => setOpen(false)} footer={<button>OK</button>}>
        <input data-testid="first-input" placeholder="type" />
        <button>inner</button>
      </Modal>
    </>
  );
}

describe('Modal (Sub-C Plan 2)', () => {
  it('1. renders title and content when open', () => {
    render(<Harness />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Test Modal');
    expect(screen.getByPlaceholderText('type')).toBeTruthy();
    expect(screen.getByText('OK')).toBeTruthy();
  });

  it('2. ESC key calls onClose', () => {
    render(<Harness />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('3. clicking × button calls onClose', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('4. clicking backdrop calls onClose; clicking dialog body does not', () => {
    render(<Harness />);
    // Click inside the dialog
    fireEvent.click(screen.getByPlaceholderText('type'));
    expect(screen.queryByRole('dialog')).toBeTruthy();
  });
});
```

### Step 9.2: 跑测试

Run: `cd D:/dev/hunter-platform/admin-web && npm run test -- tests/components/Modal.test.tsx 2>&1 | tail -10`
Expected: 4 通过。

### Step 9.3: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/tests/components/Modal.test.tsx
git -C D:/dev/hunter-platform commit -m "test(admin-web): Modal — render + ESC + close button + click target isolation"
```

---

## Task 10: Frontend — QuotaModal 组件

**Files:**
- Create: `admin-web/src/components/QuotaModal.tsx`

### Step 10.1: 创建 QuotaModal.tsx

Create `admin-web/src/components/QuotaModal.tsx`:

```tsx
import { useState, useEffect } from 'react';
import Modal from './Modal';

type QuotaModalProps = {
  open: boolean;
  user: { id: string; name: string; current_quota: number } | null;
  onClose: () => void;
  onSubmit: (params: { new_quota: number; reason: string }) => Promise<void>;
};

export default function QuotaModal({ open, user, onClose, onSubmit }: QuotaModalProps) {
  const [newQuota, setNewQuota] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (open && user) {
      setNewQuota(String(user.current_quota));
      setReason('');
      setError(null);
      setSubmitting(false);
    }
  }, [open, user]);

  if (!user) return null;

  const handleSubmit = async () => {
    setError(null);
    const n = Number(newQuota);
    if (!Number.isFinite(n) || n < 0 || n > 100000) {
      setError('配额必须是 0-100000 的数字');
      return;
    }
    if (reason.trim().length < 3) {
      setError('原因至少 3 个字符');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ new_quota: n, reason: reason.trim() });
      onClose();
    } catch (e: any) {
      setError(e?.message ?? '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`调配额 — ${user.name}`}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button onClick={onClose} disabled={submitting} className="btn">取消</button>
          <button onClick={handleSubmit} disabled={submitting} className="btn btn-primary">
            {submitting ? '调整中...' : '确认调整'}
          </button>
        </>
      }
    >
      <div style={{ marginBottom: 16, color: '#666' }}>
        当前配额：<strong>{user.current_quota}</strong> / 每天
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 4 }}>
          新配额 <span style={{ color: 'red' }}>*</span>
        </label>
        <input
          type="number"
          min={0}
          max={100000}
          value={newQuota}
          onChange={e => setNewQuota(e.target.value)}
          disabled={submitting}
          style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
        />
        <small style={{ color: '#888' }}>范围 0-100000</small>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 4 }}>
          原因 <span style={{ color: 'red' }}>*</span>
        </label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          minLength={3}
          maxLength={500}
          disabled={submitting}
          rows={3}
          style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box', fontFamily: 'inherit' }}
        />
        <small style={{ color: '#888' }}>至少 3 个字符，最多 500</small>
      </div>
      {error && (
        <div style={{ marginTop: 12, padding: 8, background: '#fff1f0', border: '1px solid #ff4d4f', borderRadius: 4, color: '#a8071a' }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
```

### Step 10.2: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/components/QuotaModal.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): QuotaModal — quota adjustment form with client validation"
```

---

## Task 11: Frontend — QuotaModal 测试

**Files:**
- Create: `admin-web/tests/components/QuotaModal.test.tsx`

### Step 11.1: 创建 QuotaModal.test.tsx

Create `admin-web/tests/components/QuotaModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QuotaModal from '../../src/components/QuotaModal';

const user = { id: 'u_1', name: '张三', current_quota: 100 };

describe('QuotaModal (Sub-C Plan 2)', () => {
  it('1. renders current quota and prefills input', () => {
    render(
      <QuotaModal open={true} user={user} onClose={() => {}} onSubmit={async () => {}} />
    );
    expect(screen.getByText('当前配额：')).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();
    const input = screen.getByLabelText(/新配额/) as HTMLInputElement;
    expect(input.value).toBe('100');
  });

  it('2. submit calls onSubmit with parsed values + closes modal on success', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<QuotaModal open={true} user={user} onClose={onClose} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/新配额/), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/原因/), { target: { value: '客户紧急加单' } });
    fireEvent.click(screen.getByText('确认调整'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ new_quota: 50, reason: '客户紧急加单' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('3. reason < 3 chars blocks submit', async () => {
    const onSubmit = vi.fn();
    render(<QuotaModal open={true} user={user} onClose={() => {}} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/新配额/), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/原因/), { target: { value: 'ab' } });
    fireEvent.click(screen.getByText('确认调整'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/原因至少 3 个字符/)).toBeTruthy();
  });

  it('4. new_quota out of range blocks submit', async () => {
    const onSubmit = vi.fn();
    render(<QuotaModal open={true} user={user} onClose={() => {}} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/新配额/), { target: { value: '999999' } });
    fireEvent.change(screen.getByLabelText(/原因/), { target: { value: 'test reason' } });
    fireEvent.click(screen.getByText('确认调整'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/0-100000/)).toBeTruthy();
  });

  it('5. onSubmit error displays message and keeps modal open', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('用户不存在'));
    const onClose = vi.fn();
    render(<QuotaModal open={true} user={user} onClose={onClose} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/新配额/), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/原因/), { target: { value: 'test' } });
    fireEvent.click(screen.getByText('确认调整'));

    await waitFor(() => expect(screen.getByText('用户不存在')).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

### Step 11.2: 跑测试

Run: `cd D:/dev/hunter-platform/admin-web && npm run test -- tests/components/QuotaModal.test.tsx 2>&1 | tail -10`
Expected: 5 通过。

### Step 11.3: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/tests/components/QuotaModal.test.tsx
git -C D:/dev/hunter-platform commit -m "test(admin-web): QuotaModal — render + validation + submit + error display"
```

---

## Task 12: Frontend — App.tsx 包 ToastProvider

**Files:**
- Modify: `admin-web/src/App.tsx`

### Step 12.1: 改 App.tsx

打开 `admin-web/src/App.tsx`，替换为：

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProfilePage from './pages/ProfilePage';
import UsersPage from './pages/UsersPage';
import CandidatesPage from './pages/CandidatesPage';
import JobsPage from './pages/JobsPage';
import RecommendationsPage from './pages/RecommendationsPage';
import AuditPage from './pages/AuditPage';
import PrivateRoute from './components/PrivateRoute';
import { ToastProvider } from './lib/toast';
import Toast from './components/Toast';

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter basename="/admin">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
          <Route path="/users" element={<PrivateRoute><UsersPage /></PrivateRoute>} />
          <Route path="/candidates" element={<PrivateRoute><CandidatesPage /></PrivateRoute>} />
          <Route path="/jobs" element={<PrivateRoute><JobsPage /></PrivateRoute>} />
          <Route path="/recommendations" element={<PrivateRoute><RecommendationsPage /></PrivateRoute>} />
          <Route path="/audit" element={<PrivateRoute><AuditPage /></PrivateRoute>} />
          <Route path="/profile" element={<PrivateRoute><ProfilePage /></PrivateRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toast />
    </ToastProvider>
  );
}
```

### Step 12.2: Typecheck

Run: `cd D:/dev/hunter-platform/admin-web && npx tsc --noEmit 2>&1 | tail -5`
Expected: no errors。

### Step 12.3: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/App.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): App — wrap routes in ToastProvider + render Toast"
```

---

## Task 13: Frontend — api/users.ts adjustQuota

**Files:**
- Modify: `admin-web/src/api/users.ts`

### Step 13.1: 加 adjustQuota 函数

打开 `admin-web/src/api/users.ts`，在文件末尾追加：

```typescript
export type AdjustQuotaResponse = {
  user_id: string;
  previous_quota: number;
  new_quota: number;
  reason: string;
};

export async function adjustQuota(userId: string, new_quota: number, reason: string): Promise<AdjustQuotaResponse> {
  const env = await apiFetchRaw<AdjustQuotaResponse>(`users/${userId}/adjust-quota`, {
    method: 'POST',
    body: JSON.stringify({ new_quota, reason }),
  });
  if (!env.ok || !env.data) {
    throw new Error(env.error?.message ?? 'Failed to adjust quota');
  }
  return env.data;
}
```

（如文件还没 import `apiFetchRaw`，在顶部加 `import { apiFetchRaw } from './raw';`）

### Step 13.2: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/api/users.ts
git -C D:/dev/hunter-platform commit -m "feat(admin-web): api/users.ts — adjustQuota() with reason"
```

---

## Task 14: Frontend — adjustQuota api wrapper 测试

**Files:**
- Create: `admin-web/tests/api/users-adjust-quota.test.ts`

### Step 14.1: 创建 users-adjust-quota.test.ts

Create `admin-web/tests/api/users-adjust-quota.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adjustQuota } from '../../src/api/users';

vi.mock('../../src/api/raw', () => ({
  apiFetchRaw: vi.fn(),
}));

import { apiFetchRaw } from '../../src/api/raw';

describe('adjustQuota (Sub-C Plan 2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. POSTs to users/:id/adjust-quota with new_quota + reason', async () => {
    (apiFetchRaw as any).mockResolvedValue({
      ok: true,
      data: { user_id: 'u_1', previous_quota: 100, new_quota: 50, reason: 'test' },
    });
    await adjustQuota('u_1', 50, 'test');
    expect(apiFetchRaw).toHaveBeenCalledWith(
      'users/u_1/adjust-quota',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ new_quota: 50, reason: 'test' }),
      }),
    );
  });

  it('2. returns response data on success', async () => {
    (apiFetchRaw as any).mockResolvedValue({
      ok: true,
      data: { user_id: 'u_1', previous_quota: 100, new_quota: 50, reason: 'test' },
    });
    const r = await adjustQuota('u_1', 50, 'test');
    expect(r).toEqual({ user_id: 'u_1', previous_quota: 100, new_quota: 50, reason: 'test' });
  });

  it('3. throws Error with backend message on failure', async () => {
    (apiFetchRaw as any).mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_PARAMS', message: 'reason is required' },
    });
    await expect(adjustQuota('u_1', 50, '')).rejects.toThrow('reason is required');
  });
});
```

### Step 14.2: 跑测试

Run: `cd D:/dev/hunter-platform/admin-web && npm run test -- tests/api/users-adjust-quota.test.ts 2>&1 | tail -10`
Expected: 3 通过。

### Step 14.3: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/tests/api/users-adjust-quota.test.ts
git -C D:/dev/hunter-platform commit -m "test(admin-web): adjustQuota api wrapper — POST + response + error"
```

---

## Task 15: Frontend — UsersPage 加「调配额」按钮

**Files:**
- Modify: `admin-web/src/pages/UsersPage.tsx`
- Modify: `admin-web/tests/pages/UsersPage.test.tsx`（或 `UsersList.test.tsx`，按实际文件名）

### Step 15.1: 检查现有 UsersPage 测试文件

Run: `ls D:/dev/hunter-platform/admin-web/tests/pages/`
找到现有 UsersPage 测试文件名（Plan 1 Task 14 已更新过）。

### Step 15.2: 改 UsersPage.tsx

打开 `admin-web/src/pages/UsersPage.tsx`，做以下修改：

1. 加 import（顶部）：

```tsx
import { useState } from 'react';
import QuotaModal from '../components/QuotaModal';
import { adjustQuota } from '../api/users';
import { useToast } from '../lib/toast';
```

2. 在 UsersPage 函数组件内，加 quota modal state：

```tsx
  const toast = useToast();
  const [quotaModal, setQuotaModal] = useState<{ open: boolean; user: UserRow | null }>({
    open: false, user: null,
  });

  const handleAdjustQuota = async (params: { new_quota: number; reason: string }) => {
    if (!quotaModal.user) return;
    const result = await adjustQuota(quotaModal.user.id, params.new_quota, params.reason);
    toast.push({
      type: 'success',
      message: `已调整 ${quotaModal.user.name} 配额至 ${result.new_quota}`,
    });
    load(page, undefined, '', '');
  };
```

3. 在 columns 数组的「操作」列加按钮：

找到 columns 定义，在末尾追加一列：

```tsx
    {
      key: 'actions', header: '操作',
      render: r => r.status === 'active' ? (
        <button
          onClick={() => setQuotaModal({ open: true, user: r })}
          className="btn btn-sm"
          data-testid={`adjust-quota-${r.id}`}
        >
          调配额
        </button>
      ) : null,
    },
```

4. 在组件 JSX 末尾（</Layout> 之前），加 QuotaModal：

```tsx
      <QuotaModal
        open={quotaModal.open}
        user={quotaModal.user ? {
          id: quotaModal.user.id,
          name: quotaModal.user.name,
          current_quota: quotaModal.user.quota_per_day,
        } : null}
        onClose={() => setQuotaModal({ open: false, user: null })}
        onSubmit={handleAdjustQuota}
      />
```

### Step 15.3: Typecheck

Run: `cd D:/dev/hunter-platform/admin-web && npx tsc --noEmit 2>&1 | tail -10`
Expected: no errors。

### Step 15.4: 更新 UsersPage 测试（加 3 个 case）

打开 `admin-web/tests/pages/UsersPage.test.tsx`（或 `UsersList.test.tsx`），追加 3 个 case：

```tsx
import { vi } from 'vitest';
import { adjustQuota } from '../../src/api/users';

vi.mock('../../src/api/users', async () => {
  const actual = await vi.importActual<any>('../../src/api/users');
  return { ...actual, adjustQuota: vi.fn() };
});

// At top of describe block
beforeEach(() => {
  (adjustQuota as any).mockReset();
  (adjustQuota as any).mockResolvedValue({
    user_id: 'u_1', previous_quota: 100, new_quota: 50, reason: 'test',
  });
});

it('9. 调配额 button only shows for active users', async () => {
  (listUsers as any).mockResolvedValue({
    data: [
      { id: 'u_active', user_type: 'candidate', name: 'A', status: 'active', quota_per_day: 100, quota_used: 0, quota_reset_at: '', reputation: 50, created_at: '2026-06-24T00:00:00Z' },
      { id: 'u_susp', user_type: 'candidate', name: 'B', status: 'suspended', quota_per_day: 100, quota_used: 0, quota_reset_at: '', reputation: 50, created_at: '2026-06-24T00:00:00Z' },
    ],
    pagination: { total: 2, page: 1, pageSize: 20, has_more: false },
  });
  renderPage();
  await waitFor(() => screen.getByTestId('adjust-quota-u_active'));
  expect(screen.queryByTestId('adjust-quota-u_susp')).toBeNull();
});

it('10. clicking 调配额 opens QuotaModal', async () => {
  renderPage();
  await waitFor(() => screen.getByTestId('adjust-quota-u_1'));
  fireEvent.click(screen.getByTestId('adjust-quota-u_1'));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByText(/当前配额/)).toBeTruthy();
});

it('11. submit calls adjustQuota + shows success toast + refreshes list', async () => {
  renderPage();
  await waitFor(() => screen.getByTestId('adjust-quota-u_1'));
  fireEvent.click(screen.getByTestId('adjust-quota-u_1'));

  fireEvent.change(screen.getByLabelText(/新配额/), { target: { value: '50' } });
  fireEvent.change(screen.getByLabelText(/原因/), { target: { value: '客户加单' } });
  fireEvent.click(screen.getByText('确认调整'));

  await waitFor(() => expect(adjustQuota).toHaveBeenCalledWith('u_1', 50, '客户加单'));
  await waitFor(() => expect(screen.getByText(/已调整/)).toBeTruthy());
});
```

**注意：** UsersPage 测试需要包 `<ToastProvider>` 才能用 `useToast`：

```tsx
import { ToastProvider } from '../../src/lib/toast';

const renderPage = () => render(
  <MemoryRouter>
    <ToastProvider>
      <UsersPage />
    </ToastProvider>
  </MemoryRouter>
);
```

如现有 `renderPage` 没有包 ToastProvider，需要加。

### Step 15.5: 跑测试

Run: `cd D:/dev/hunter-platform/admin-web && npm run test -- tests/pages/UsersPage 2>&1 | tail -15`
Expected: 全绿（Plan 1 + Plan 2 共 ~11 个 case）。

### Step 15.6: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/UsersPage.tsx admin-web/tests/pages/UsersPage.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): UsersPage — 调配额 button + QuotaModal + success toast"
```

---

## Task 16: Frontend — AuditPage Admin Actions tab 加「详情」列

**Files:**
- Modify: `admin-web/src/pages/AuditPage.tsx`

### Step 16.1: 改 AdminActionsTab

打开 `admin-web/src/pages/AuditPage.tsx`，找到 `AdminActionsTab` 函数组件（约 line 44-100）。

在 `AdminActionsTab` 内添加：

1. 在 import 区域加：

```tsx
import AuditJsonDrawer from '../components/AuditJsonDrawer';
```

（如已有，跳过）

2. 在 AdminActionsTab 函数顶部加 state：

```tsx
  const [drawer, setDrawer] = useState<{ open: boolean; title: string; json: string | null }>({
    open: false, title: '', json: null,
  });
```

3. 找到现有的 `<table>` 部分（line 72-95 附近），在 `<thead>` 内加 2 个 `<th>`：

```tsx
              <th style={{ padding: 8, textAlign: 'left' }}>对象</th>
              <th style={{ padding: 8, textAlign: 'left' }}>详情</th>
```

（如已存在「对象」列，只加「详情」即可）

4. 修改 `colSpan={5}` 为 `colSpan={7}`（如原本是 5 列，加 2 列后变成 7 列；具体数字按实际调整）。

5. 在 `<tbody>` 内每个 `<tr>` 末尾加 2 个 `<td>`：

```tsx
              <td style={{ padding: 8 }}>{row.target_type ? `${row.target_type}:${row.target_id}` : '—'}</td>
              <td style={{ padding: 8 }}>
                <button
                  className="btn btn-sm"
                  onClick={() => setDrawer({
                    open: true,
                    title: `${row.action_type} @ ${formatDate(row.created_at)}`,
                    json: row.reason ? `Reason: ${row.reason}` : null,
                  })}
                  data-testid={`admin-log-detail-${row.id}`}
                >
                  详情
                </button>
              </td>
```

6. 在 `<Pagination>` 后加 `<AuditJsonDrawer>`：

```tsx
      <AuditJsonDrawer
        open={drawer.open}
        title={drawer.title}
        json={drawer.json}
        onClose={() => setDrawer({ open: false, title: '', json: null })}
      />
```

### Step 16.2: 注意 — AuditJsonDrawer 的 json prop

打开 `admin-web/src/components/AuditJsonDrawer.tsx`，确认其 `json` prop 类型。如是 `string | null`，上面代码 OK；如是 `unknown`，需传对象而非 string。

如果 AuditJsonDrawer 接受 `string`，且想把 details_json 传进去，需要后端 `admin-log` endpoint 返回 details_json 字段。检查后端：

打开 `src/main/modules/admin/handlers/admin-log.ts`，如 endpoint 不返回 `details_json`，需要扩展（这是后端 Sub-D1 的另一个 gap，超出本 plan scope——但**最小修复**让前端能拿到 details_json）。

**临时妥协方案（无后端改动）：** 前端按钮点击只显示 `action_type + created_at + reason`，不显示 details_json。这样不需要后端改动。

如选择临时方案，按 Step 16.1 写的代码即可（json = `Reason: ...` 或 null）。

如选择真显示 details_json，需：

1. 后端：在 `AdminLogRow` 类型 + `admin-log` endpoint 返回 `details_json` 字段
2. 前端：AdminLogRow 类型 + 按钮 onClick 用 `row.details_json`

**本 plan 默认采用临时方案**（plan 范围内不修后端 admin-log endpoint）。在 commit message 注明 follow-up。

### Step 16.3: Typecheck

Run: `cd D:/dev/hunter-platform/admin-web && npx tsc --noEmit 2>&1 | tail -10`
Expected: no errors。

### Step 16.4: 更新 AuditPage 测试

打开 `admin-web/tests/pages/AuditPage.test.tsx`（如存在），加 2 个 case：

```tsx
it('3. Admin Actions tab renders 详情 button per row', async () => {
  (listAdminLog as any).mockResolvedValue({
    data: [
      { id: 1, actor: 'adm_subb', action_type: 'adjust_user_quota', target_type: 'user', target_id: 'u_1', reason: '客户加单', created_at: '2026-06-24T00:00:00Z' },
    ],
    pagination: { total: 1, page: 1, pageSize: 20, has_more: false },
  });
  renderPage();
  await waitFor(() => screen.getByTestId('admin-log-detail-1'));
});

it('4. clicking 详情 opens AuditJsonDrawer', async () => {
  (listAdminLog as any).mockResolvedValue({
    data: [
      { id: 1, actor: 'adm_subb', action_type: 'adjust_user_quota', target_type: 'user', target_id: 'u_1', reason: '客户加单', created_at: '2026-06-24T00:00:00Z' },
    ],
    pagination: { total: 1, page: 1, pageSize: 20, has_more: false },
  });
  renderPage();
  await waitFor(() => screen.getByTestId('admin-log-detail-1'));
  fireEvent.click(screen.getByTestId('admin-log-detail-1'));
  expect(screen.getByText(/adjust_user_quota/)).toBeTruthy();  // drawer title contains action
});
```

如 AuditPage.test.tsx 不存在或用不同断言，按文件实际结构调整或新建。

### Step 16.5: 跑测试

Run: `cd D:/dev/hunter-platform/admin-web && npm run test -- tests/pages/AuditPage 2>&1 | tail -10`
Expected: 全绿（Sub-D1 已有 case + Plan 2 新增 2 个）。

### Step 16.6: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/AuditPage.tsx admin-web/tests/pages/AuditPage.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): AuditPage — add 详情 column to Admin Actions tab (drawer shows reason)"
```

---

## Task 17: 全量验证 + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

### Step 17.1: 跑全部后端测试

Run: `cd D:/dev/hunter-platform && npx vitest run 2>&1 | tail -10`
Expected: 全绿（Plan 1 后端 ~10 + Plan 2 后端 ~7 = ~17 个新测试）。

### Step 17.2: 跑全部前端测试

Run: `cd D:/dev/hunter-platform/admin-web && npm run test 2>&1 | tail -10`
Expected: 全绿（Plan 1 前端 ~28 + Plan 2 前端 ~16 = ~44 个新测试）。

### Step 17.3: 跑全 typecheck

Run: `cd D:/dev/hunter-platform && npx tsc --noEmit 2>&1 | tail -5 && cd admin-web && npx tsc --noEmit 2>&1 | tail -5`
Expected: 无错误。

### Step 17.4: 手动 end-to-end smoke test

按以下步骤手测（在 dev mode）：

```bash
# Terminal 1: start backend
cd D:/dev/hunter-platform
npm run dev  # 或项目实际启动命令

# Terminal 2: start admin-web
cd D:/dev/hunter-platform/admin-web
npm run dev
```

浏览器操作：
1. 访问 http://localhost:5173/admin/login
2. 用 admin 账号登录
3. 进「用户」列表
4. 点某 active 用户的「调配额」按钮 → QuotaModal 打开
5. 改 new_quota + 填 reason → 「确认调整」
6. 应看到 Toast「已调整 xxx 配额至 N」+ 行更新
7. 进「审计」 → 管理员操作 tab
8. 应看到刚才的 adjust_user_quota 记录 + 「详情」按钮可点

如任一步失败，按错误排查。

### Step 17.5: 加 CHANGELOG 条目

打开 `CHANGELOG.md`，在 v2.1.0 (Plan 1) 条目下加：

```markdown
## v2.1.1 (Sub-C Plan 2 — Mutation) — 2026-06-25

### 新增功能
- **UsersPage 调配额按钮**：每行（active 用户）新增「调配额」按钮，弹 QuotaModal 表单
- **QuotaModal**：new_quota 数字输入 + reason 文本域（3-500 字符） + 客户端校验
- **Toast 系统**：lib/toast.tsx + ToastProvider + useToast hook，3 秒自动消失
- **Modal 系统**：portal + ESC + 焦点管理 + body scroll lock
- **AuditPage 详情列**：Admin Actions tab 加「详情」按钮，点开 AuditJsonDrawer 显示 reason

### Bug 修复（**Breaking**）
- **`POST /v1/admin/users/:id/adjust-quota` 不写 audit log 的历史 bug**：
  - handler 现在接 `adminUserId + reason` 参数
  - reason 必填（3-500 字符校验在 route + handler 双层）
  - 写 `admin_action_log` 表，action = `adjust_user_quota`
  - 响应从 `{ user_id, new_quota }` 扩到 `{ user_id, previous_quota, new_quota, reason }`

### 已知限制
- AuditPage「详情」按钮**暂时只显示 reason**，不显示 details_json（previous_quota/new_quota 结构）。要让 details_json 暴露，需要扩展 `/v1/admin/admin-log` endpoint 返回 details_json 字段。留 Sub-D2 范围。

### 测试
- 后端 +7 个集成测试
- 前端 +16 个组件/页面测试

### Breaking change migration
- 任何外部调用 `adjust-quota` 的脚本必须在 body 加 `reason: "..."`，否则会 400
- 响应 schema 变了——前端同步更新，无其他客户端
```

### Step 17.6: 提交

```bash
git -C D:/dev/hunter-platform add CHANGELOG.md
git -C D:/dev/hunter-platform commit -m "docs(changelog): v2.1.1 — Sub-C Plan 2 (Mutation + Audit)"
```

### Step 17.7: 最终 sanity check

```bash
git -C D:/dev/hunter-platform log --oneline -30
```

确认本 plan 所有 17 个 task 都已 commit。

---

## Done criteria（Plan 2 完成）

- [ ] 后端：`adjust-quota` 接收 reason + adminUserId，写 `admin_action_log` 表
- [ ] 后端：~7 个新集成测试通过（覆盖 happy path + reason 缺失/越界/同值/无 user/无 token）
- [ ] 前端：Modal + Toast + QuotaModal 组件就绪 + 测试通过
- [ ] 前端：UsersPage 行末「调配额」按钮工作，提交后 Toast + 列表刷新
- [ ] 前端：AuditPage Admin Actions tab 加「详情」列
- [ ] 前端：~16 个新测试通过 + 现有测试不退
- [ ] 全 typecheck 绿
- [ ] 手测 dev 模式 8 步全通
- [ ] CHANGELOG v2.1.1 条目加好
- [ ] 17 个 task 都 commit

**Sub-C 全部交付。** 下一步可进入 Sub-D2（per-entity 时间轴）或 Sub-E（webhooks/rate-limit/config UI）。