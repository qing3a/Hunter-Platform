# Admin Web 中文化 (zh-CN) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `admin-web/` 所有用户可见的英文 UI 字符串改成中文,通过 vitest 验证 + 浏览器手动验证。

**Architecture:** 硬编码中文字符串到 .tsx / .ts 字符串字面量,不动组件结构、CSS、依赖。`StatusBadge` 加 `STATUS_LABELS` 映射表把 API 返回的英文 status 值翻译成中文展示。`format.ts` 的 `relativeTime` 函数返回中文格式。`index.html` 改 `<html lang>` 和 `<title>`。所有改动 + 上次未 commit 的路由修复放在一个 commit 里。

**Tech Stack:** React 18 + react-router-dom v6 + TypeScript + Vitest。**零新依赖**。

---

## File Structure

### 修改文件(14 源文件 + 1 HTML + 3 测试 = 18 个)

| 文件 | 改动类型 |
|---|---|
| `admin-web/index.html` | lang + title |
| `admin-web/src/components/Layout.tsx` | brand + 5 nav + Logout |
| `admin-web/src/components/Pagination.tsx` | 4 strings |
| `admin-web/src/components/SearchBar.tsx` | Search 按钮 + "{label}: all" |
| `admin-web/src/components/Table.tsx` | Loading + No data 默认 |
| `admin-web/src/components/AuditJsonDrawer.tsx` | Close |
| `admin-web/src/components/StatusBadge.tsx` | 加 STATUS_LABELS 映射 |
| `admin-web/src/lib/format.ts` | relativeTime 7 分支 |
| `admin-web/src/pages/LoginPage.tsx` | 4 strings |
| `admin-web/src/pages/DashboardPage.tsx` | 8 metric labels + 2 h2 + 副标题 |
| `admin-web/src/pages/UsersPage.tsx` | 标题 + placeholder + 过滤 + 列头 + 空态 |
| `admin-web/src/pages/CandidatesPage.tsx` | 同上 |
| `admin-web/src/pages/AuditPage.tsx` | 标题 + 3 tab + 3 sub-table |
| `admin-web/src/pages/ProfilePage.tsx` | 标题 + 5 label + API Key + confirm/alert |
| `admin-web/tests/lib/format.test.ts` | relativeTime 期望 |
| `admin-web/tests/components/UsersList.test.tsx` | Pagination/Page/Showing 期望 |
| `admin-web/tests/components/CandidatesList.test.tsx` | Pagination 期望 |

### 不动
- `src/api/*.ts`(API 路径保持不变)
- `src/components/MetricCard.tsx`(label 来自 props)
- `src/components/AuditDiffView.tsx`(无 UI 字符串)
- `src/components/PrivateRoute.tsx`(路由层面,本计划路由修复已部分 commit 通过)
- `src/styles.css`(完全不动)
- `src/main.tsx`、`src/App.tsx`(无 UI 字符串)
- `src/api/client.ts`、`src/api/raw.ts` 中的英文错误消息(`'Unauthorized'`、`'Failed to fetch users'`)— 不可见给最终用户

### Working tree 当前状态
**重要:** 当前 working tree 有上次未 commit 的 3 个路由修复文件:
- `src/components/Layout.tsx`(改了 NavLink `to` 从 `/admin/xxx` 到 `/xxx`)
- `src/components/PrivateRoute.tsx`(改了 `<Navigate to>`)
- `src/pages/LoginPage.tsx`(改了 `navigate('/')`)

这些改动 **必须保留**,作为本次 commit 的一部分。

---

## Task 1: 创建分支并验证 starting state

**Files:**
- N/A(只 git 操作)

- [ ] **Step 1.1: 确认当前 branch 是 main,且 working tree 有 3 个未 commit 文件**

```bash
cd "D:/dev/hunter-platform"
git status --short
git branch --show-current
```

Expected:
- branch: `main`
- 3 modified 文件:`src/components/Layout.tsx`、`src/components/PrivateRoute.tsx`、`src/pages/LoginPage.tsx`

- [ ] **Step 1.2: 创建并切到新 feature 分支**

```bash
cd "D:/dev/hunter-platform"
git checkout -b feature/admin-web-zh-i18n
git branch --show-current
```

Expected: `feature/admin-web-zh-i18n`

- [ ] **Step 1.3: 跑一次 baseline 测试,确认现有 41/41 通过**

```bash
cd "D:/dev/hunter-platform/admin-web"
pnpm test 2>&1 | tail -10
```

Expected: `Tests  41 passed (41)` 或类似字样

> **注意:** 此时源文件还是英文,测试期望也是英文,所以 41/41 应该 pass。

---

## Task 2: 更新测试断言为中文(failing test 阶段)

> 思路:先把测试期望改成中文 → 跑测试会 FAIL(因为源还是英文)→ 后续 task 改源 → 测试 PASS。这模拟 TDD 的红→绿循环。

### Task 2.1: 更新 `format.test.ts`

**Files:**
- Modify: `admin-web/tests/lib/format.test.ts:13-35`

- [ ] **Step 2.1.1: 修改 `expect(format.relativeTime(...)).toBe(...)` 的字符串期望**

完整文件替换:

```typescript
import { describe, it, expect } from 'vitest';
import { relativeTime } from '../../src/lib/format';

describe('relativeTime', () => {
  const NOW = new Date('2026-06-24T12:00:00Z').getTime();

  it('returns 刚刚 for now', () => {
    expect(relativeTime(new Date(NOW), NOW)).toBe('刚刚');
  });

  it('returns 未来 for future dates', () => {
    const future = new Date(NOW + 60_000);
    expect(relativeTime(future, NOW)).toBe('未来');
  });

  it('returns X 分钟前 for minutes', () => {
    const t = new Date(NOW - 5 * 60_000);
    expect(relativeTime(t, NOW)).toBe('5 分钟前');
  });

  it('returns X 小时前 for hours', () => {
    const t = new Date(NOW - 2 * 3_600_000);
    expect(relativeTime(t, NOW)).toBe('2 小时前');
  });

  it('returns X 天前 for days', () => {
    const t = new Date(NOW - 3 * 86_400_000);
    expect(relativeTime(t, NOW)).toBe('3 天前');
  });

  it('returns X 个月前 for months', () => {
    const t = new Date(NOW - 5 * 30 * 86_400_000);
    expect(relativeTime(t, NOW)).toBe('5 个月前');
  });

  it('returns X 年前 for years', () => {
    const t = new Date(NOW - 365 * 86_400_000);
    expect(relativeTime(t, NOW)).toBe('1 年前');
  });
});
```

- [ ] **Step 2.1.2: 跑 format.test.ts,确认 FAIL**

```bash
cd "D:/dev/hunter-platform/admin-web"
pnpm test format 2>&1 | tail -20
```

Expected: FAIL with `'just now' !== '刚刚'` 等多个 diff(因为源文件还是英文)

### Task 2.2: 更新 `UsersList.test.tsx`

**Files:**
- Modify: `admin-web/tests/components/UsersList.test.tsx:66`

- [ ] **Step 2.2.1: 改 "Next →" 为 "下一页"**

在 `UsersList.test.tsx` 第 66 行附近,找到 `expect(screen.getByRole('button', { name: 'Next →' }))` → 改为 `expect(screen.getByRole('button', { name: '下一页' }))`

具体修改(精确匹配文件内容):

定位 string: `'Next →'` → 替换为 `'下一页'`

- [ ] **Step 2.2.2: 跑 UsersList 测试,确认 FAIL**

```bash
cd "D:/dev/hunter-platform/admin-web"
pnpm test UsersList 2>&1 | tail -20
```

Expected: FAIL,找不到 name=`下一页` 的按钮

### Task 2.3: 更新 `CandidatesList.test.tsx`

**Files:**
- Modify: `admin-web/tests/components/CandidatesList.test.tsx`(找 "Next →")

- [ ] **Step 2.3.1: 改 "Next →" 为 "下一页"**

定位 string: `'Next →'` → 替换为 `'下一页'`

- [ ] **Step 2.3.2: 跑 CandidatesList 测试,确认 FAIL**

```bash
cd "D:/dev/hunter-platform/admin-web"
pnpm test CandidatesList 2>&1 | tail -20
```

Expected: FAIL

---

## Task 3: 更新 `index.html`

**Files:**
- Modify: `admin-web/index.html:3,7`

- [ ] **Step 3.1: 改 lang 和 title**

完整文件替换:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>猎头中介管理后台</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

---

## Task 4: 更新 utility + 共享组件(7 文件)

### Task 4.1: `src/lib/format.ts`

**Files:**
- Modify: `admin-web/src/lib/format.ts`(整文件替换)

- [ ] **Step 4.1.1: 完整替换文件**

```typescript
// Format an ISO timestamp as a Chinese relative-time string (e.g. "5 分钟前").
// `now` defaults to Date.now(); tests pass an explicit `now` for determinism.
export function relativeTime(iso: Date | string | number, now: number = Date.now()): string {
  const ts = iso instanceof Date ? iso.getTime() : new Date(iso).getTime();
  const diffMs = ts - now;
  const absMs = Math.abs(diffMs);
  const future = diffMs > 0;

  if (absMs < 60_000) return future ? '未来' : '刚刚';

  if (absMs < 3_600_000) {
    const n = Math.floor(absMs / 60_000);
    return future ? `${n} 分钟后` : `${n} 分钟前`;
  }
  if (absMs < 86_400_000) {
    const n = Math.floor(absMs / 3_600_000);
    return future ? `${n} 小时后` : `${n} 小时前`;
  }
  if (absMs < 30 * 86_400_000) {
    const n = Math.floor(absMs / 86_400_000);
    return future ? `${n} 天后` : `${n} 天前`;
  }
  if (absMs < 365 * 86_400_000) {
    const n = Math.floor(absMs / (30 * 86_400_000));
    return future ? `${n} 个月后` : `${n} 个月前`;
  }
  const n = Math.floor(absMs / (365 * 86_400_000));
  return future ? `${n} 年后` : `${n} 年前`;
}
```

### Task 4.2: `src/components/Pagination.tsx`

**Files:**
- Modify: `admin-web/src/components/Pagination.tsx`

- [ ] **Step 4.2.1: 替换 4 个字符串**

| 原 | 新 |
|---|---|
| `Showing ${start}-${end} of ${total}` | `显示 ${start}-${end} 共 ${total} 条` |
| `← Prev` | `上一页` |
| `Page ${page}` | `第 ${page} 页` |
| `Next →` | `下一页` |

### Task 4.3: `src/components/SearchBar.tsx`

**Files:**
- Modify: `admin-web/src/components/SearchBar.tsx`

- [ ] **Step 4.3.1: 替换 strings**

| 原 | 新 |
|---|---|
| `placeholder` 默认值 `'Search...'`(出现在 `placeholder ?? 'Search...'` 这一行) | `'搜索...'` |
| 按钮文本 `<button>Search</button>` | `<button>搜索</button>` |

> **实现细节:** SearchBar.tsx 本身只有这两个英文字符串。"{label}: all" 是 caller(各 page)传进来的 placeholder,会在 Task 5 改 page 时一起改。

### Task 4.4: `src/components/Table.tsx`

**Files:**
- Modify: `admin-web/src/components/Table.tsx`

- [ ] **Step 4.4.1: 替换默认 strings**

| 原 | 新 |
|---|---|
| `Loading...` | `加载中...` |
| `No data` (default prop) | `暂无数据` |

### Task 4.5: `src/components/AuditJsonDrawer.tsx`

**Files:**
- Modify: `admin-web/src/components/AuditJsonDrawer.tsx`

- [ ] **Step 4.5.1: 替换 Close 按钮**

| 原 | 新 |
|---|---|
| `Close` | `关闭` |

### Task 4.6: `src/components/StatusBadge.tsx`

**Files:**
- Modify: `admin-web/src/components/StatusBadge.tsx`

- [ ] **Step 4.6.1: 加 STATUS_LABELS 映射 + 修改渲染逻辑**

完整文件替换:

```tsx
import React from 'react';

const STATUS_LABELS: Record<string, string> = {
  active: '正常',
  suspended: '已暂停',
  deleted: '已删除',
  success: '成功',
  error: '失败',
  pending: '待处理',
  pending_payment: '待支付',
  in_pool: '候选池中',
  paid: '已支付',
  unlocked: '已解锁',
  locked: '已锁定',
};

const COLOR_MAP: Record<string, string> = {
  active: 'green',
  success: 'green',
  paid: 'green',
  unlocked: 'green',
  suspended: 'yellow',
  pending: 'yellow',
  pending_payment: 'yellow',
  in_pool: 'blue',
  error: 'red',
  deleted: 'gray',
  locked: 'red',
};

function colorFor(value: string): string {
  return COLOR_MAP[value.toLowerCase()] ?? 'gray';
}

function labelFor(value: string): string {
  return STATUS_LABELS[value.toLowerCase()] ?? value;
}

export function StatusBadge({ value }: { value: string }) {
  const color = colorFor(value);
  const label = labelFor(value);
  return <span className={`status-badge status-badge--${color}`}>{label}</span>;
}
```

> **注:** 保留原 COLOR_MAP 的颜色逻辑,仅新增 STATUS_LABELS 和 labelFor。

### Task 4.7: `src/components/Layout.tsx`

**Files:**
- Modify: `admin-web/src/components/Layout.tsx`

- [ ] **Step 4.7.1: 替换 brand、5 个 NavLink 文字、Logout 按钮**

| 原 | 新 |
|---|---|
| `Hunter Admin` | `猎头管理后台` |
| `Dashboard` | `仪表盘` |
| `Users` | `用户` |
| `Candidates` | `候选人` |
| `Audit` | `审计` |
| `Profile` | `我的` |
| `Logout` | `退出登录` |

> **注:** Layout.tsx 已经因路由修复修改过(to 改为 `/users` 等),只改文字,不改路径。

### Task 4.8: 跑一次测试,确认 format/UI 组件测试 pass

- [ ] **Step 4.8.1: 跑全量测试**

```bash
cd "D:/dev/hunter-platform/admin-web"
pnpm test 2>&1 | tail -10
```

Expected: 41/41 pass(format.test.ts 现在 PASS,Pagination/SearchBar 相关的 UsersList/CandidatesList 仍 FAIL,因为 page 还没改)

---

## Task 5: 更新 6 个 page 组件

### Task 5.1: `src/pages/LoginPage.tsx`

**Files:**
- Modify: `admin-web/src/pages/LoginPage.tsx`

- [ ] **Step 5.1.1: 替换 4 strings**

| 原 | 新 |
|---|---|
| `Hunter Platform Admin` | `猎头中介管理后台` |
| `Email` | `邮箱` |
| `Password` | `密码` |
| `Sign in` | `登录` |
| `Signing in...` | `登录中...` |

### Task 5.2: `src/pages/DashboardPage.tsx`

**Files:**
- Modify: `admin-web/src/pages/DashboardPage.tsx`

- [ ] **Step 5.2.1: 替换 14 strings**

| 原 | 新 |
|---|---|
| `Loading...` | `加载中...` |
| `Dashboard` | `仪表盘` |
| `Total Users` | `用户总数` |
| `Total Candidates` | `候选人总数` |
| `Today New Users` | `今日新增用户` |
| `vs prior days in trend below` | `下方趋势图显示每日对比` |
| `Open Placements` | `进行中的合作` |
| `User Growth — Last 30 Days` | `用户增长 — 最近 30 天` |
| `30 days ago` | `30 天前` |
| `today` | `今天` |
| `More Stats` | `更多统计` |
| `Total Jobs` | `职位总数` |
| `Open Jobs` | `开放职位` |
| `Daily Quota Used` | `今日已用配额` |
| `Webhook Dead Letters` | `Webhook 死信` |

### Task 5.3: `src/pages/UsersPage.tsx`

**Files:**
- Modify: `admin-web/src/pages/UsersPage.tsx`

- [ ] **Step 5.3.1: 替换 strings**

| 原 | 新 |
|---|---|
| `Users` (title) | `用户` |
| `Search name...` | `搜索姓名...` |
| `Role` | `角色` |
| `Candidate` | `候选人` |
| `Headhunter` | `猎头` |
| `Employer` | `雇主` |
| `Status` | `状态` |
| `Active` | `正常` |
| `Suspended` | `已暂停` |
| `Deleted` | `已删除` |
| `ID` | `ID` |
| `Name` | `姓名` |
| `Quota` | `配额` |
| `Created` | `创建时间` |
| `No users found` | `未找到用户` |

### Task 5.4: `src/pages/CandidatesPage.tsx`

**Files:**
- Modify: `admin-web/src/pages/CandidatesPage.tsx`

- [ ] **Step 5.4.1: 替换 strings**

| 原 | 新 |
|---|---|
| `Candidates` (title) | `候选人` |
| `Search name/email...` | `搜索姓名/邮箱...` |
| `Pending` | `待处理` |
| `Unlocked` | `已解锁` |
| `Locked` | `已锁定` |
| `Source` | `来源` |
| `No candidates found` | `未找到候选人` |

### Task 5.5: `src/pages/AuditPage.tsx`

**Files:**
- Modify: `admin-web/src/pages/AuditPage.tsx`

- [ ] **Step 5.5.1: 替换 18 strings**

| 原 | 新 |
|---|---|
| `Audit` (title) | `审计` |
| `Admin Actions` | `管理员操作` |
| `User Actions` | `用户操作` |
| `Login Events` | `登录事件` |
| `All events` | `全部事件` |
| `Success only` | `仅成功` |
| `Failure only` | `仅失败` |
| `Search by actor email/id...` | `按操作人邮箱/ID 搜索...` |
| `Time` | `时间` |
| `Actor` | `操作人` |
| `Action` | `操作` |
| `Target` | `目标` |
| `Reason` | `原因` |
| `User` | `用户` |
| `Capability` | `能力` |
| `Duration` | `耗时` |
| `Admin` | `管理员` |
| `Success` | `结果` |
| `IP` | `IP` |
| `No admin actions recorded` | `暂无管理员操作记录` |
| `No user actions recorded` | `暂无用户操作记录` |
| `No login events recorded` | `暂无登录事件记录` |

### Task 5.6: `src/pages/ProfilePage.tsx`

**Files:**
- Modify: `admin-web/src/pages/ProfilePage.tsx`

- [ ] **Step 5.6.1: 替换 strings**

| 原 | 新 |
|---|---|
| `Loading...` | `加载中...` |
| `Profile` (title) | `我的` |
| `ID:` | `ID:` |
| `Email:` | `邮箱:` |
| `Role:` | `角色:` |
| `Status:` | `状态:` |
| `Created:` | `创建时间:` |
| `API Key` | `API 密钥` |
| `⚠️ Rotate will invalidate the current key.` | `⚠️ 轮换将使当前密钥失效。` |
| `Rotate API Key` | `轮换 API 密钥` |
| `New key:` | `新密钥:` |
| `Rotate API key? Current key will be invalidated.` | `确认轮换 API 密钥?当前密钥将失效。` |
| `API key rotated. New key saved to localStorage.` | `API 密钥已轮换。新密钥已保存到 localStorage。` |
| `Failed: ` | `失败: ` |

---

## Task 6: 跑全量测试 + build 验证

**Files:**
- N/A(只跑命令)

- [ ] **Step 6.1: 跑 vitest**

```bash
cd "D:/dev/hunter-platform/admin-web"
pnpm test 2>&1 | tail -10
```

Expected: **41/41 tests pass**

- [ ] **Step 6.2: 跑 TypeScript 编译 + Vite build**

```bash
cd "D:/dev/hunter-platform/admin-web"
pnpm build 2>&1 | tail -20
```

Expected: 构建成功,无 type error

---

## Task 7: 浏览器手动验证(已运行的服务会自动 HMR)

**Files:**
- N/A

- [ ] **Step 7.1: 确认 backend (port 3000) 和 admin-web (port 5174) 仍在跑**

```bash
curl -s -o /dev/null -w "backend: HTTP %{http_code}\n" http://localhost:3000/v1/health
curl -s -o /dev/null -w "admin-web: HTTP %{http_code}\n" http://localhost:5174/
```

Expected: 两个都是 200

- [ ] **Step 7.2: 浏览器验证清单**

打开 http://localhost:5174/admin/login,登录 `admin@qing3.top` / `local-test-pwd-12345`,逐页验证:

- [ ] 登录页标题:`猎头中介管理后台`
- [ ] 顶部 brand:`猎头管理后台`
- [ ] 5 个 nav:`仪表盘 / 用户 / 候选人 / 审计 / 我的`
- [ ] Dashboard:8 个指标中文 + 图表 label 中文 + 副标题中文
- [ ] Users 页:标题 `用户`,placeholder `搜索姓名...`,过滤 `角色 / 状态`(候选/猎头/雇主 / 正常/已暂停/已删除),列头,空态 `未找到用户`
- [ ] Candidates 页:同上,状态 `待处理 / 已解锁 / 已锁定`,空态 `未找到候选人`
- [ ] Audit 页:3 tab 翻译,各表列头/placeholder/空态都中文
- [ ] Profile 页:5 label 中文,API Key 部分全部中文,旋转确认对话框中文
- [ ] 状态 badge:StatusBadge 显示中文状态值(如 `正常 / 已暂停 / 已删除`)
- [ ] 退出按钮:`退出登录`,点击后回到 `猎头中介管理后台` 登录页

- [ ] **Step 7.3: 跑 typecheck 兜底**

```bash
cd "D:/dev/hunter-platform/admin-web"
pnpm tsc --noEmit 2>&1 | tail -10
```

Expected: 无 error

---

## Task 8: Commit

**Files:**
- N/A(只 git 操作)

- [ ] **Step 8.1: 检查 working tree**

```bash
cd "D:/dev/hunter-platform"
git status --short
```

Expected: 17 个 modified 文件(14 源 + 1 HTML + 2 测试,format.test.ts 也改了但已经在步骤 2.1 commit 之外)
实际上应该是 18 modified(17 翻译 + 3 路由修复重叠 = 14 源修改,1 HTML,3 测试 = 18)
> **注:** 3 个路由修复文件已经被包含在 14 个源文件改动里(Layout / PrivateRoute / LoginPage 同时改了路径和文字)。

- [ ] **Step 8.2: stage 所有改动**

```bash
cd "D:/dev/hunter-platform"
git add admin-web/
git status --short
```

Expected: staged 一批文件

- [ ] **Step 8.3: commit**

```bash
cd "D:/dev/hunter-platform"
git -c user.email="agent@local" -c user.name="ZCode Agent" commit -m "feat(admin-web): 中文化所有用户可见 UI

- 14 个 .tsx/.ts 文件 + 1 个 HTML + 3 个测试断言改为中文
- StatusBadge 加 STATUS_LABELS 映射(11 个状态值)
- format.ts 的 relativeTime 返回中文格式
- 同时包含上次的路由修复(NavLink basename 不匹配)
- 测试 41/41 通过,TypeScript 编译通过"
```

- [ ] **Step 8.4: 验证**

```bash
cd "D:/dev/hunter-platform"
git log --oneline -3
git status --short
```

Expected:
- `git log` 看到新的 feat commit 在最前
- `git status` 干净

---

## Self-Review Checklist

- [x] **Spec coverage:** spec §2 翻译表、§3 StatusBadge 映射、§4 文件清单都有对应 task(Task 4-5)
- [x] **Placeholder scan:** 没有 TBD / TODO / "implement later"
- [x] **Type consistency:** StatusBadge 内部 STATUS_LABELS / COLOR_MAP / labelFor / colorFor 一致
- [x] **TDD cycle:** Task 2 改测试 FAIL → Task 3-5 改源 → Task 6 PASS
- [x] **Frequent commits:** 单个 commit(spec 明确指定 1 commit)
- [x] **No placeholders in steps:** 每个 string 替换都给了精确 before/after
- [x] **Self-contained:** 每个 task 都标了 Files 和步骤,不依赖外部 context