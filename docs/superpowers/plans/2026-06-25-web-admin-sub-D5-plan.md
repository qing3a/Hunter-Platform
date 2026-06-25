# Web Admin Sub-D5 Plan: User Suspend/Unsuspend Quick Action

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 UserDetailPage 加 [暂停账号] / [恢复账号] 按钮（按 status 智能切换），弹 ConfirmModal（suspend 必填 reason ≥3 字符，unsuspend 直接确认）。

**Architecture:**
- **Backend**：0 改动（suspend/unsuspend endpoint 已存在，已写 audit log）
- **前端**：ConfirmModal 扩展 requireReason + UserDetailPage 加按钮 + 2 个 API wrapper + tests
- **测试**：~8 个新前端测试

**Tech Stack (existing):** React 18, react-router-dom, vanilla CSS, vitest+jsdom+RTL, ConfirmModal (Sub-D3)
**Spec:** [docs/superpowers/specs/2026-06-25-web-admin-sub-D5-design.md](../specs/2026-06-25-web-admin-sub-D5-design.md)

---

## 0. Reviewer decisions

| 反馈点 | 决策 |
|--------|------|
| Scope | 只 user suspend/unsuspend（minimal）|
| UI | 单 button 智能切换（active→暂停 / suspended→恢复 / deleted→无）|
| ConfirmModal | 扩展 `requireReason` prop，reason 校验 3+ 字符 |
| Backend | 0 改动 |

---

## 现有代码上下文（开始 Task 1 前必读）

- `admin-web/src/components/ConfirmModal.tsx` — 现有 onConfirm 签名 `() => Promise<void>`，需扩展
- `admin-web/src/pages/UserDetailPage.tsx` — Sub-D4 加的页面，已有 user state + load()
- `admin-web/src/api/users.ts` — 现有 `getUser` + `listUsers`，需加 `suspendUser` + `unsuspendUser`
- `src/main/routes/admin.ts` line ~112 — suspend/unsuspend routes 已存在，suspend 必填 reason

**不动文件**：`api/users.ts` 已有部分 + Tests 已有部分（除非需要 update）

---

## File Structure

| File | Change |
|------|--------|
| `admin-web/src/components/ConfirmModal.tsx` | **Modify** — 加 `requireReason` + `reasonMinLength` props + textarea + onConfirm 签名变更 |
| `admin-web/src/api/users.ts` | **Modify** — + `suspendUser` + `unsuspendUser` |
| `admin-web/src/pages/UserDetailPage.tsx` | **Modify** — + 按钮 + ConfirmModal state + handler |
| `admin-web/tests/components/ConfirmModal.test.tsx` | **Modify** — + 2 case for requireReason |
| `admin-web/tests/api/users-suspend.test.ts` | **Create** — 2 case for new wrappers |
| `admin-web/tests/pages/UserDetailPage.test.tsx` | **Modify** — + 4 case for button + handler |
| `docs/CHANGELOG.md` | **Modify** — v2.5.0 条目 |

---

## Task 1: ConfirmModal 扩展 requireReason

**Files:**
- Modify: `admin-web/src/components/ConfirmModal.tsx`

### Step 1.1: 读现有 ConfirmModal.tsx

打开文件，找到：
- type `ConfirmModalProps`
- `export default function ConfirmModal({ ... })`
- `handleConfirm` 函数
- JSX 内 `<p>{message}</p>` 处

### Step 1.2: 改 type 加 3 个新 props

在 `ConfirmModalProps` 加：

```tsx
type ConfirmModalProps = {
  // ... 现有 props
  requireReason?: boolean;
  reasonMinLength?: number;
  reasonPlaceholder?: string;
};
```

### Step 1.3: 改 onConfirm 签名

在 type 定义里把 `onConfirm: () => Promise<void>` 改为 `onConfirm: (reason?: string) => Promise<void>`。

### Step 1.4: 改函数体 — 加 reason state + 改 handleConfirm

```tsx
export default function ConfirmModal({
  open, title, message,
  confirmText = '确认', cancelText = '取消',
  variant = 'primary',
  error = null,
  requireReason = false,
  reasonMinLength = 3,
  reasonPlaceholder = '请输入原因（至少 3 字符）',
  onConfirm, onClose,
}: ConfirmModalProps) {
  const [reason, setReason] = useState('');
  // ... existing useState for loading, localError
  const displayError = error ?? localError;

  const handleConfirm = async () => {
    if (requireReason && reason.trim().length < reasonMinLength) {
      setLocalError(`原因至少 ${reasonMinLength} 字符`);
      return;
    }
    setLoading(true);
    setLocalError(null);
    try {
      await onConfirm(requireReason ? reason.trim() : undefined);
      onClose();
    } catch (e: any) {
      setLocalError(e?.message ?? '操作失败');
    } finally {
      setLoading(false);
    }
  };
  // ...
}
```

### Step 1.5: 改 JSX — 加 textarea

在 `<p style={{ margin: 0 }}>{message}</p>` 后面加：

```tsx
{requireReason && (
  <div style={{ marginTop: 12 }}>
    <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>原因 *</label>
    <textarea
      value={reason}
      onChange={e => setReason(e.target.value)}
      placeholder={reasonPlaceholder}
      rows={2}
      data-testid="confirm-modal-reason"
      style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box', fontFamily: 'inherit' }}
    />
  </div>
)}
```

### Step 1.6: 当 modal close 时清空 reason

在 useEffect 清理函数（如已有）或 modal 关闭的 onClose 路径加 `setReason('')`。

简化方法：在 `onClose={() => { setReason(''); setConfirm({open:false}) }}` 之类。

**最简**：在 handleConfirm 成功后 onClose 之前 setReason('')。失败时也清空（避免 stale state）。直接：

```tsx
// in handleConfirm
try {
  await onConfirm(requireReason ? reason.trim() : undefined);
  setReason('');  // 成功后清空
  onClose();
} catch (e: any) { ... }
```

注：失败时不清空（让用户能看到之前输入的内容，重新尝试）。**最简方案**。

### Step 1.7: 跑现有 ConfirmModal 测试

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/components/ConfirmModal.test.tsx 2>&1 | tail -5`
Expected: 现有 5 个测试应仍 pass（type signature 变更 `() => Promise<void>` → `(reason?: string) => Promise<void>` 是 backward compatible）。

如失败：检查现有 mock `vi.fn().mockResolvedValue(undefined)` 是否仍匹配新签名——应 OK（mock 返回 undefined，签名兼容）。

### Step 1.8: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/components/ConfirmModal.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): ConfirmModal — add requireReason prop (textarea + min length validation)"
```

---

## Task 2: ConfirmModal 测试 — requireReason

**Files:**
- Modify: `admin-web/tests/components/ConfirmModal.test.tsx`

### Step 2.1: 加 2 case

在 describe 末尾加：

```tsx
  it('6. requireReason=true shows textarea + blocks short input', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ConfirmModal
        open={true} title="T" message="M"
        requireReason={true}
        onConfirm={onConfirm}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId('confirm-modal-reason')).toBeTruthy();
    // Click without entering reason
    fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/原因至少 3 字符/)).toBeTruthy();
  });

  it('7. requireReason=true passes reason to onConfirm', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ConfirmModal
        open={true} title="T" message="M"
        requireReason={true}
        onConfirm={onConfirm}
        onClose={() => {}}
      />
    );
    fireEvent.change(screen.getByTestId('confirm-modal-reason'), { target: { value: '客户投诉违规行为' } });
    fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('客户投诉违规行为'));
  });
```

### Step 2.2: 跑测试

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/components/ConfirmModal.test.tsx 2>&1 | tail -5`
Expected: 7 通过（5 old + 2 new）。

### Step 2.3: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/tests/components/ConfirmModal.test.tsx
git -C D:/dev/hunter-platform commit -m "test(admin-web): ConfirmModal — requireReason 2 cases (validation + value pass-through)"
```

---

## Task 3: API wrappers — suspendUser / unsuspendUser

**Files:**
- Modify: `admin-web/src/api/users.ts`

### Step 3.1: 加 2 个函数

打开 `admin-web/src/api/users.ts`，在文件末尾加：

```typescript
export async function suspendUser(id: string, reason: string): Promise<{ user_id: string; status: string; reason: string }> {
  const env = await apiFetchRaw<{ user_id: string; status: string; reason: string }>(`users/${id}/suspend`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
  if (!env.ok || !env.data) {
    throw new Error(env.error?.message ?? 'Failed to suspend user');
  }
  return env.data;
}

export async function unsuspendUser(id: string): Promise<{ user_id: string; status: string }> {
  const env = await apiFetchRaw<{ user_id: string; status: string }>(`users/${id}/unsuspend`, { method: 'POST' });
  if (!env.ok || !env.data) {
    throw new Error(env.error?.message ?? 'Failed to unsuspend user');
  }
  return env.data;
}
```

### Step 3.2: 创建 test

Create `admin-web/tests/api/users-suspend.test.ts`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { suspendUser, unsuspendUser } from '../../src/api/users';

vi.mock('../../src/api/raw', () => ({ apiFetchRaw: vi.fn() }));
import { apiFetchRaw } from '../../src/api/raw';

describe('suspend/unsuspend user API (Sub-D5)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. suspendUser POSTs with reason', async () => {
    (apiFetchRaw as any).mockResolvedValue({
      ok: true, data: { user_id: 'u_1', status: 'suspended', reason: '客户投诉' },
    });
    await suspendUser('u_1', '客户投诉');
    expect(apiFetchRaw).toHaveBeenCalledWith('users/u_1/suspend', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ reason: '客户投诉' }),
    }));
  });

  it('2. unsuspendUser POSTs without body', async () => {
    (apiFetchRaw as any).mockResolvedValue({
      ok: true, data: { user_id: 'u_1', status: 'active' },
    });
    await unsuspendUser('u_1');
    expect(apiFetchRaw).toHaveBeenCalledWith('users/u_1/unsuspend', expect.objectContaining({ method: 'POST' }));
  });

  it('3. suspendUser throws on non-ok', async () => {
    (apiFetchRaw as any).mockResolvedValue({
      ok: false, error: { code: 'INVALID_STATE', message: 'already suspended' },
    });
    await expect(suspendUser('u_1', 'reason')).rejects.toThrow('already suspended');
  });
});
```

### Step 3.3: 跑测试

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/api/users-suspend.test.ts 2>&1 | tail -5`
Expected: 3 通过。

### Step 3.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/api/users.ts admin-web/tests/api/users-suspend.test.ts
git -C D:/dev/hunter-platform commit -m "feat(admin-web): api suspendUser + unsuspendUser wrappers + 3 tests"
```

---

## Task 4: UserDetailPage 加按钮 + handler

**Files:**
- Modify: `admin-web/src/pages/UserDetailPage.tsx`

### Step 4.1: 加 imports

在文件顶部 imports 加：

```tsx
import { suspendUser, unsuspendUser } from '../api/users';
```

### Step 4.2: 加 confirm state

在 UserDetailPage 函数体内，user/placements state 之后加：

```tsx
const [confirm, setConfirm] = useState<{ open: false } | { open: true; type: 'suspend' | 'unsuspend' }>({ open: false });
```

### Step 4.3: 加 handleConfirm

在 load 函数之后、useEffect 之前（或任何位置）加：

```tsx
const handleConfirm = async (reason?: string) => {
  if (!confirm.open) return;
  const u = user && !user.loading && !user.error ? user.data : null;
  if (!u) return;
  try {
    if (confirm.type === 'suspend') {
      await suspendUser(u.id, reason!);
      toast.push({ type: 'success', message: `已暂停 ${u.name}` });
    } else {
      await unsuspendUser(u.id);
      toast.push({ type: 'success', message: `已恢复 ${u.name}` });
    }
    setConfirm({ open: false });
    load();  // 重新加载 user
  } catch (e: any) {
    throw e;  // 让 ConfirmModal 显示错误
  }
};
```

注：throw 让 ConfirmModal 捕获错误并显示（ConfirmModal 的 catch 块设 localError）。

### Step 4.4: 在 return JSX 加按钮 + ConfirmModal

找到 `return (` 后、`Layout` 内、`</Layout>` 前。布局调整：

```tsx
const u = user.data;
const isActive = u.status === 'active';
const isSuspended = u.status === 'suspended';

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

    {/* ↓ 新增：suspend/unsuspend 按钮 */}
    {(isActive || isSuspended) && (
      <button
        onClick={() => setConfirm({ open: true, type: isActive ? 'suspend' : 'unsuspend' })}
        className={isActive ? 'btn btn-danger' : 'btn btn-primary'}
        data-testid="user-suspend-toggle"
        style={{ marginBottom: 24 }}
      >
        {isActive ? '暂停账号' : '恢复账号'}
      </button>
    )}

    <ConfirmModal
      open={confirm.open}
      title={confirm.open ? (confirm.type === 'suspend' ? '暂停账号' : '恢复账号') : ''}
      message={confirm.open ? (confirm.type === 'suspend' ? '确认暂停此账号？此操作可恢复。' : '确认恢复此账号？') : ''}
      confirmText={confirm.open ? (confirm.type === 'suspend' ? '确认暂停' : '确认恢复') : '确认'}
      variant={confirm.open && confirm.type === 'suspend' ? 'danger' : 'primary'}
      requireReason={confirm.open && confirm.type === 'suspend'}
      onConfirm={handleConfirm}
      onClose={() => setConfirm({ open: false })}
    />

    <h2>关联的 Placements（最近 5 条）</h2>
    ...
  </Layout>
);
```

### Step 4.5: Typecheck

Run: `cd /d/dev/hunter-platform/admin-web && npx tsc --noEmit 2>&1 | tail -3`
Expected: 无错误。

### Step 4.6: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/UserDetailPage.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): UserDetailPage — suspend/unsuspend button with smart switching + ConfirmModal"
```

---

## Task 5: UserDetailPage 测试

**Files:**
- Modify: `admin-web/tests/pages/UserDetailPage.test.tsx`

### Step 5.1: 读现有 test 文件

打开文件，找到现有的 beforeEach 和 mock。

### Step 5.2: 加 4 case

```tsx
import { suspendUser, unsuspendUser } from '../../src/api/users';

// 在 beforeEach 附近 mock
vi.mock('../../src/api/users', () => ({
  getUser: vi.fn(),
  suspendUser: vi.fn(),
  unsuspendUser: vi.fn(),
}));

// 在 beforeEach 中加 default mock
(suspendUser as any).mockResolvedValue({ user_id: 'u_1', status: 'suspended', reason: 'test' });
(unsuspendUser as any).mockResolvedValue({ user_id: 'u_1', status: 'active' });

// 加 4 case
it('5. active user shows 暂停账号 button', async () => {
  (getUser as any).mockResolvedValueOnce({
    id: 'u_1', user_type: 'candidate', name: 'X', contact: 'x@x', status: 'active',
    quota_per_day: 100, quota_used: 0, reputation: 50, created_at: '2026-06-25T00:00:00Z',
  });
  renderPage('u_active');
  await waitFor(() => expect(screen.getByTestId('user-suspend-toggle')).toBeTruthy());
  expect(screen.getByText('暂停账号')).toBeTruthy();
});

it('6. suspended user shows 恢复账号 button', async () => {
  (getUser as any).mockResolvedValueOnce({
    id: 'u_1', user_type: 'candidate', name: 'X', contact: 'x@x', status: 'suspended',
    quota_per_day: 100, quota_used: 0, reputation: 50, created_at: '2026-06-25T00:00:00Z',
  });
  renderPage('u_suspended');
  await waitFor(() => expect(screen.getByTestId('user-suspend-toggle')).toBeTruthy());
  expect(screen.getByText('恢复账号')).toBeTruthy();
});

it('7. deleted user shows no button', async () => {
  (getUser as any).mockResolvedValueOnce({
    id: 'u_1', user_type: 'candidate', name: 'X', contact: 'x@x', status: 'deleted',
    quota_per_day: 100, quota_used: 0, reputation: 50, created_at: '2026-06-25T00:00:00Z',
  });
  renderPage('u_deleted');
  await waitFor(() => expect(screen.getByText('候选人 user_u_deleted 暂无 placement')).toBeTruthy());  // 或任何 user 渲染完成的标识
  expect(screen.queryByTestId('user-suspend-toggle')).toBeNull();
});

it('8. clicking 暂停账号 opens ConfirmModal with reason textarea', async () => {
  (getUser as any).mockResolvedValueOnce({
    id: 'u_1', user_type: 'candidate', name: 'X', contact: 'x@x', status: 'active',
    quota_per_day: 100, quota_used: 0, reputation: 50, created_at: '2026-06-25T00:00:00Z',
  });
  renderPage('u_active');
  await waitFor(() => screen.getByTestId('user-suspend-toggle'));
  fireEvent.click(screen.getByTestId('user-suspend-toggle'));
  await waitFor(() => expect(screen.getByTestId('confirm-modal-reason')).toBeTruthy());
  // Verify reason required blocks submit
  fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
  expect(suspendUser).not.toHaveBeenCalled();
});
```

### Step 5.3: 跑测试

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/pages/UserDetailPage.test.tsx 2>&1 | tail -8`
Expected: 现有 + 4 新 = ~8 通过。

如失败：检查 test 7 的 "暂无 placement" 文本是否匹配——可能 detail page 实际有不同 empty 文本，按实际调整。

### Step 5.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/tests/pages/UserDetailPage.test.tsx
git -C D:/dev/hunter-platform commit -m "test(admin-web): UserDetailPage — 4 cases for suspend/unsuspend button + ConfirmModal integration"
```

---

## Task 6: 全验证 + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

### Step 6.1: 跑全部 admin-web 测试

```bash
cd /d/dev/hunter-platform/admin-web && npm run test 2>&1 | tail -6
```

Expected: 171 + ~9 (2 ConfirmModal + 3 suspend API + 4 UserDetailPage) = 180 通过。

### Step 6.2: Typecheck

```bash
cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -3
cd /d/dev/hunter-platform/admin-web && npx tsc --noEmit 2>&1 | tail -3
```

Expected: 无错误。

### Step 6.3: 加 CHANGELOG

打开 `CHANGELOG.md`，在 `v2.4.1 (Small Fixes ...)` 之后加：

```markdown
## v2.5.0 (Sub-D5 — User Suspend/Unsuspend Quick Action) — 2026-06-25

### 新增功能
- **UserDetailPage 智能按钮**：active 状态显示「暂停账号」（红色），suspended 显示「恢复账号」（蓝色），deleted 无按钮
- **ConfirmModal 扩展 `requireReason` prop**：suspend 时弹带 textarea 的弹窗，reason ≥3 字符才能提交
- **suspend/unsuspend audit**：写 `admin_action_log`（Sub-C 已实现，无需新代码）

### 测试
- 前端 +9 个组件/页面/API 测试
```

### Step 6.4: Commit

```bash
git -C D:/dev/hunter-platform add CHANGELOG.md
git -C D:/dev/hunter-platform commit -m "docs(changelog): v2.5.0 — Sub-D5 (User suspend/unsuspend)"
```

### Step 6.5: 最终 sanity check

```bash
git -C D:/dev/hunter-platform log --oneline -10
```

确认 6 个新 commit 都在（ConfirmModal x 2、API x 1、UserDetailPage x 2、CHANGELOG x 1）。

---

## Done criteria

- [ ] ConfirmModal 支持 requireReason
- [ ] suspendUser / unsuspendUser API wrapper
- [ ] UserDetailPage 智能按钮 + ConfirmModal
- [ ] 9 个新测试通过
- [ ] 全 typecheck 干净
- [ ] CHANGELOG v2.5.0
- [ ] 6 个 task 都 commit

**预计 3-4 小时。** 单 plan 因为纯 frontend 改动（backend 0 改动）。