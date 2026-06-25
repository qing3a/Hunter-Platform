# Web Admin Sub-D5 — User Suspend/Unsuspend Quick Action Design

> **For agentic workers:** 这是 design spec，配套 implementation plan 见 `docs/superpowers/plans/2026-06-25-web-admin-sub-D5-plan.md`（待 writing-plans skill 输出）。
>
> 续接 Sub-D4（v2.4.0，merge `1c8767a`）+ Small Fixes（v2.4.1，merge `b1bc15e`）。本 spec 是 **Sub-project D5：User suspend/unsuspend quick action on UserDetailPage**。后续 backlog：Sub-E（config UI）、详情页 filter URL 持久化等。

## ⚠️ 与已有 Sub-project 的关系

| Sub-project | 已交付 | 内容 |
|---|---|---|
| Sub-A | ✅ | 基础设施 + admin auth |
| Sub-D4 | ✅ | 4 个 per-entity 详情页（含 UserDetailPage） |
| **Sub-D5（本 spec）** | 设计中 | **UserDetailPage 加 suspend/unsuspend 按钮** |

**Sub-D5 解决的痛点**：
- UserDetailPage 现在**只读**——admin 想暂停可疑账号得去 UsersPage 找（但 UsersPage 也没按钮）或直接 SQL
- Ops 每天要处理 1-2 个 user 投诉，缺 UI 入口

---

## 1. 背景与动机

### 1.1 现状（Sub-D4 后）

| 项 | 现状 |
|----|------|
| Backend | `POST /v1/admin/users/:id/suspend` + `unsuspend` 已存在（Sub-C 加的）<br/>suspend 必填 reason（≥3 字符）<br/>两者都写 `admin_action_log`（通过 userFlow sideEffect 触发） |
| Frontend | `api/users.ts` **没有** `suspendUser` / `unsuspendUser` wrapper<br/>UserDetailPage 只显示基本信息 + 关联数据 + 返回链接<br/>UsersPage 只有 filter，没 action 按钮 |
| ConfirmModal | Sub-D3 已建（variant='danger' for cancel，'primary' for mark-paid）<br/>**已有** reason 输入能力（cancel 不需要，suspend 需要） |

### 1.2 真实需求

| 需求 | 痛点 |
|---|------|
| Ops 暂停可疑账号 | 需 SQL 改 DB，或要进 admin shell |
| Ops 恢复误暂停账号 | 同上 |
| Ops 需要 audit 记录 | 已自动（suspend/unsuspend 写 admin_action_log） |
| Ops 想知道暂停原因 | suspend 必填 reason 字段（前端 ConfirmModal 收集） |

### 1.3 非目标

- ❌ Suspend 一个用户后通知用户（留 Sub-E 或后续）
- ❌ Job pause/close actions（后续 backlog）
- ❌ Placement 详情页 + cancel/mark-paid 转移（PlacementsPage list 已 OK）
- ❌ Batch suspend（一次多 user）
- ❌ 时间限制（suspend 多少天后自动恢复）
- ❌ Audit UI 改动（已有 Sub-D1 AuditPage 覆盖）

---

## 2. 架构总览

### 2.1 模块改动图

```
hunter-platform/
└── admin-web/src/
    ├── api/users.ts                    # 改：+suspendUser + unsuspendUser wrappers
    ├── pages/UserDetailPage.tsx         # 改：+按钮 + ConfirmModal
    └── tests/
        ├── api/users-suspend.test.ts    # 新增：suspend/unsuspend wrapper test
        └── pages/UserDetailPage.test.tsx # 改：+action button test cases
```

### 2.2 后端 endpoint

| Method | Path | 改动 |
|--------|------|------|
| POST | `/v1/admin/users/:id/suspend` | **不动**（已存在，reason ≥3 字符） |
| POST | `/v1/admin/users/:id/unsuspend` | **不动** |

### 2.3 数据库改动

- ❌ **0 migration**（admin_action_log 已有，reason 字段已用）

### 2.4 Tech Stack

**沿用现有**：React 18, react-router-dom, vanilla CSS, vitest+jsdom+RTL, ConfirmModal (Sub-D3)

**无新依赖。**

---

## 3. 后端改动

**0 改动**。所有 endpoint 已存在，已写 audit log。

---

## 4. 前端设计

### 4.1 API wrappers (admin-web/src/api/users.ts)

```typescript
// 加在文件末尾
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

### 4.2 UserDetailPage 改动

#### 当前（Sub-D4）
```tsx
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
    {/* ← 没有 action 按钮 */}
    
    <h2>关联的 Placements...</h2>
    ...
  </Layout>
);
```

#### 改后
```tsx
const u = user.data;
const isActive = u.status === 'active';
const isSuspended = u.status === 'suspended';
// 'deleted' 状态不显示按钮

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
      requireReason={confirm.open && confirm.type === 'suspend'}  {/* ↓ 新增 prop */}
      onConfirm={handleConfirm}
      onClose={() => setConfirm({ open: false })}
    />

    <h2>关联的 Placements...</h2>
    ...
  </Layout>
);
```

#### 新增 state + handler
```tsx
const [confirm, setConfirm] = useState<{ open: false } | { open: true; type: 'suspend' | 'unsuspend' }>({ open: false });

const handleConfirm = async (reason?: string) => {
  if (!confirm.open) return;
  if (confirm.type === 'suspend') {
    await suspendUser(u.id, reason!);  // reason 必填（ConfirmModal 已验证）
    toast.push({ type: 'success', message: `已暂停 ${u.name}` });
  } else {
    await unsuspendUser(u.id);
    toast.push({ type: 'success', message: `已恢复 ${u.name}` });
  }
  load();  // 重新加载 user 数据更新 status badge
};
```

### 4.3 ConfirmModal 扩展（admin-web/src/components/ConfirmModal.tsx）

**当前**：接受 `message` 作为 prop，handleConfirm 调 onConfirm()。

**改后**：可选 `requireReason` prop——为 true 时 ConfirmModal 在 footer 上方加 `<textarea>`，handleConfirm 把 textarea 值作为 `onConfirm(reason)` 第一参数。

```tsx
type ConfirmModalProps = {
  // ... 现有 props
  requireReason?: boolean;  // 新增
  reasonMinLength?: number;  // 新增，默认 3
  reasonPlaceholder?: string;
};

export default function ConfirmModal({
  // ...
  requireReason = false,
  reasonMinLength = 3,
  reasonPlaceholder = '请输入原因（至少 3 字符）',
  // ...
}: ConfirmModalProps) {
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  
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

  return (
    <Modal open={open} title={title} onClose={onClose} footer={...}>
      <p style={{ margin: 0 }}>{message}</p>
      {requireReason && (
        <div style={{ marginTop: 12 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>原因 *</label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder={reasonPlaceholder}
            rows={2}
            data-testid="confirm-modal-reason"
            style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
          />
        </div>
      )}
      {displayError && (...)}
    </Modal>
  );
}
```

**type 变更**：`onConfirm` 从 `() => Promise<void>` 改为 `(reason?: string) => Promise<void>`（可选 reason 参数）。

### 4.4 4 个列表页行末按钮

**不动**。Sub-D5 只在 detail page 加按钮（per spec）。

### 4.5 错误处理

| 场景 | UI |
|------|-----|
| suspend 失败（network） | ConfirmModal 内联错误 |
| 409 INVALID_STATE（重复 suspend） | 后端 message 显示 |
| 404（user 不存在） | 后端 message 显示 |
| reason < 3 字符 | ConfirmModal 内联校验，不调 API |

### 4.6 不做

- ❌ Suspend 后自动跳转（留在当前页 + Toast）
- ❌ Audit tab 自动刷新（用户自己点）
- ❌ URL 持久化（详情页 filter 不需要）

---

## 5. 数据流 + Audit 链路

### 5.1 Suspend 链路

```
[1] UserDetailPage 点 [暂停账号] 按钮
    → setConfirm({ open: true, type: 'suspend' })
    → ConfirmModal 弹出（variant=danger, requireReason=true）
    → Modal 显示 textarea 收集 reason

[2] 用户输入 reason + 点 [确认暂停]
    → ConfirmModal 校验 reason.length >= 3
    → 调 handleConfirm(reason)
    → UserDetailPage.handleConfirm(reason)
    → suspendUser(u.id, reason)
    → POST /v1/admin/users/:id/suspend { reason }
    → 后端 users.suspend(adminUserId, id, reason)
    → 状态机检查（active → suspended）
    → UPDATE users SET status = 'suspended'
    → dispatchSideEffect → 写 admin_action_log（action='suspend_user'）
    → 响应 { user_id, status: 'suspended', reason }
    → Toast「已暂停 张三」
    → load() 重新拉 user 数据
    → 按钮变 [恢复账号]
    → StatusBadge 变 'suspended'
```

### 5.2 Unsuspend 链路

类似但无 reason 输入。

### 5.3 Audit 联动

- **suspend/unsuspend** → handler 内 `dispatchSideEffect(result.sideEffect, adminUserId)` 写 admin_action_log
- detail page 改变不写新 audit（只是查询）
- audit 显示在 AuditPage Admin Actions tab（Sub-D1 已实现）

### 5.4 失败链路

| 场景 | 表现 |
|------|------|
| reason < 3 字符 | ConfirmModal 内联红字提示，不调 API |
| 重复 suspend（已是 suspended） | ConfirmModal 显示后端 message「User is already suspended; cannot suspend」|
| network error | ConfirmModal 显示「服务端错误」 |
| 401 unauthorized | client.ts 处理跳 login |

---

## 6. 测试策略

### 6.1 覆盖目标

| 层 | 范围 | 数量 |
|----|------|------|
| 前端 API wrapper | suspendUser + unsuspendUser | 2 |
| 前端页面 | UserDetailPage 加 4 case（active 显示暂停 / suspended 显示恢复 / deleted 无按钮 / 点暂停弹 ConfirmModal） | 4 |
| ConfirmModal 新功能 | requireReason 模式 | 2 |
| **新增总计** | | **~8** |

回归目标：171 + 8 = **179 admin-web 测试**。

### 6.2 不做

- ❌ E2E（Playwright）
- ❌ 视觉回归

---

## 7. 验收标准（DoD）

1. ✅ UserDetailPage 显示 [暂停账号] / [恢复账号] 按钮（按 status 智能切换）
2. ✅ Suspend 弹 ConfirmModal（requireReason=true）必填 reason ≥3 字符
3. ✅ Unsuspend 弹 ConfirmModal（requireReason=false）直接确认
4. ✅ suspend/unsuspend 成功后 Toast + 列表更新
5. ✅ `deleted` 状态不显示按钮
6. ✅ 失败错误内联在 ConfirmModal
7. ✅ ~8 新测试通过 + 现有不退
8. ✅ 全 typecheck 干净
9. ✅ 手测 3 步（dev 模式）
10. ✅ CHANGELOG v2.5.0

---

## 8. 手测 3 步（dev 模式）

```bash
cd D:/dev/hunter-platform && npm run dev  # Terminal 1
cd D:/dev/hunter-platform/admin-web && npm run dev  # Terminal 2
```

| # | 操作 | 期望 |
|---|------|------|
| 1 | UsersPage → 点 active user「详情」→ 看到 [暂停账号] 按钮（红色） | 按钮可见 |
| 2 | 点 [暂停账号] → 弹 ConfirmModal（蓝色 primary 但红色 danger 边框? No——variant=danger 是按钮）→ 输 reason "测试暂停" → [确认暂停] | Toast「已暂停」+ 按钮变 [恢复账号] + StatusBadge 变 suspended |
| 3 | 重复点 [暂停账号]（现在是 suspended 状态）| 不应看到暂停按钮，只看到 [恢复账号]。点 [恢复账号] → 弹简单 ConfirmModal → 确认 → Toast + 状态回 active |

---

## 9. 部署 / 回滚

### 部署
- Plan 1（很小，单一 plan）：前端 0 改 backend → `npm run build` → nginx reload

### 回滚
- Revert commit + rebuild

---

## 10. 工作量

| 阶段 | 估时 |
|------|------|
| ConfirmModal 扩展 requireReason | 30 分钟 |
| UserDetailPage 加按钮 + handler | 1 小时 |
| api wrappers + tests | 30 分钟 |
| UserDetailPage tests | 1 小时 |
| 手测 + 修小问题 | 30 分钟 |
| **总计** | **~3-4 小时** |

---

## 11. 后续

| Sub | 内容 | 预计 |
|-----|------|------|
| Sub-D5 follow-up | 详情页 filter URL 持久化扩展 | v2.5.1 |
| Sub-E | webhooks/rate-limit/config 写入类 UI | v2.6 |
| Sub-D5+ | Job pause/close + Placement 详情页 + actions | v2.7 |

---

**Spec 结束。** 配套 implementation plan 见 `docs/superpowers/plans/2026-06-25-web-admin-sub-D5-plan.md`（待 writing-plans skill 输出）。