# Web Admin Sub-D6 Plan: Filter URL Persistence Sweep (7 List Pages)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把剩下 7 个 list page 的 filter 从 `useState` 迁到 `useUrlParam`（Small Fixes 已建），实现全站 filter URL 持久化。

**Architecture:**
- **Backend**：0 改动
- **前端**：7 个 page 文件 + 7 个 test 文件，~5-6 小时
- **数据库**：0 改动

**Tech Stack (existing):** React 18, react-router-dom, vanilla CSS, vitest+jsdom+RTL, `useUrlParam` hook (Small Fixes)
**Spec:** [docs/superpowers/specs/2026-06-25-web-admin-sub-D6-design.md](../specs/2026-06-25-web-admin-sub-D6-design.md)

---

## 0. Reviewer decisions

| 反馈点 | 决策 |
|--------|------|
| Scope | 全部 7 页（UsersPage / CandidatesPage / JobsPage / RecommendationsPage / PlacementsPage / WebhookDeadLetterPage / AuditPage）|
| Backend | 0 改动 |
| 复用 | Small Fixes 已建的 `useUrlParam` |
| UI 视觉 | 0 改动 |

---

## 现有代码上下文（开始 Task 1 前必读）

- `admin-web/src/hooks/useUrlParam.ts` — Small Fixes 已建，签名为 `useUrlParam<T = string>(key, defaultValue, parser?): [T, setter]`
- 4 个 timeline page 已用 `useTimelineFilters`（基于 useUrlParam）做参考模式
- 7 个 list page 当前用 `useState` 存 filter + page

**不动文件**：所有非 list page（如 dashboard / 4 个 detail page / 4 个 timeline page）

---

## File Structure

| File | Change |
|------|--------|
| `admin-web/src/pages/UsersPage.tsx` | **Modify** — `useState` filter → `useUrlParam` |
| `admin-web/src/pages/CandidatesPage.tsx` | **Modify** |
| `admin-web/src/pages/JobsPage.tsx` | **Modify** |
| `admin-web/src/pages/RecommendationsPage.tsx` | **Modify** |
| `admin-web/src/pages/PlacementsPage.tsx` | **Modify** |
| `admin-web/src/pages/WebhookDeadLetterPage.tsx` | **Modify** |
| `admin-web/src/pages/AuditPage.tsx` | **Modify** — 只 Admin Actions tab 的 actor + page |
| `admin-web/tests/pages/UsersPage.test.tsx` | **Modify** — +2 case |
| `admin-web/tests/pages/CandidatesList.test.tsx` | **Modify** — +2 case |
| `admin-web/tests/pages/JobsPage.test.tsx` | **Modify** — +2 case |
| `admin-web/tests/pages/RecommendationsPage.test.tsx` | **Modify** — +2 case |
| `admin-web/tests/pages/PlacementsPage.test.tsx` | **Modify** — +2 case |
| `admin-web/tests/pages/WebhookDeadLetterPage.test.tsx` | **Modify** — +2 case |
| `admin-web/tests/pages/AuditPage.test.tsx` | **Modify** — +2 case |
| `docs/CHANGELOG.md` | **Modify** — v2.6.0 条目 |

---

## 通用迁移模式（每个 page 的重复模式）

**改前**（典型）：
```tsx
const [userType, setUserType] = useState<string>('');
const [status, setStatus] = useState<string>('');
const [keyword, setKeyword] = useState('');
const [page, setPage] = useState(1);
```

**改后**：
```tsx
import { useUrlParam } from '../hooks/useUrlParam';
// ...
const [userType, setUserType] = useUrlParam<string>('user_type', '');
const [status, setStatus] = useUrlParam<string>('status', '');
const [keyword, setKeyword] = useUrlParam<string>('keyword', '');
const [page, setPage] = useUrlParam<number>('page', 1, pageParser);

const pageParser = (v: string | null) =>
  v && /^\d+$/.test(v) ? Math.max(1, parseInt(v, 10)) : null;
```

**setter 行为不变**：
- `setUserType('admin')` → URL 含 `?user_type=admin`
- `setUserType('')` → URL delete `user_type`（保持 URL 干净）
- `setUserType('all')`（default）→ URL delete（`useUrlParam` 自动）

**setter 触发刷新**：
- 所有 setFilter 都要 `setPage(1)` 重置到第一页
- 在 SearchBar 的 onChange / input onChange / select onChange 已有此 pattern
- **保留** 这个 pattern

---

## Task 1: UsersPage 迁移

**Files:**
- Modify: `admin-web/src/pages/UsersPage.tsx`
- Modify: `admin-web/tests/pages/UsersPage.test.tsx`

### Step 1.1: 改 page 文件

打开 `admin-web/src/pages/UsersPage.tsx`，在顶部 imports 加：

```tsx
import { useUrlParam } from '../hooks/useUrlParam';
```

找到 `useState` 块（user_type / status / keyword / page 各一个），替换为：

```tsx
const [userType, setUserType] = useUrlParam<string>('user_type', '');
const [status, setStatus] = useUrlParam<string>('status', '');
const [keyword, setKeyword] = useUrlParam<string>('keyword', '');
const [page, setPage] = useUrlParam<number>('page', 1, (v) => v && /^\d+$/.test(v) ? Math.max(1, parseInt(v, 10)) : null);
```

注意：保留现有的 `useState` for rows / pagination / loading（如有）。

**pageParser inline**——可重复定义在每个 page（~5 行），或抽到 `useUrlParam.ts` 暴露为 named export（更 DRY）。

为减少 scope 风险，先在每个 page 重复定义 pageParser。后续 Sub-D6.1 follow-up 再抽。

### Step 1.2: 跑现有 UsersPage 测试

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/pages/UsersPage 2>&1 | tail -5`
Expected: 全绿（迁移 useUrlParam 不改变行为，URL 同步是隐式）。如失败：检查 SearchBar / onChange handler 是否仍正确调用 setter。

### Step 1.3: 加 2 case

打开 `admin-web/tests/pages/UsersPage.test.tsx`，在 describe 末尾加：

```tsx
  it('5. mount reads filter from URL', async () => {
    renderPage();  // 或 wrap with MemoryRouter initialEntries=['/users?user_type=headhunter&status=active']
    // 检查 getListUsers 被以正确 filter 调用
  });

  it('6. changing filter updates URL via useUrlParam', async () => {
    renderPage();
    // 触发 filter 变化，验证 URL 含新 key
  });
```

注：测试需包 `MemoryRouter` with `initialEntries` 才能测 URL 读取。具体 wrap 模式参考 `useTimelineFilters.test.tsx`。

如现有 `renderPage()` 没用 MemoryRouter，需要改 wrapper。参考 useTimelineFilters test pattern。

### Step 1.4: 跑测试

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/pages/UsersPage 2>&1 | tail -5`
Expected: 全绿（现有 + 2 新 = 通过）。

### Step 1.5: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/UsersPage.tsx admin-web/tests/pages/UsersPage.test.tsx
git -C D:/dev/hunter-platform commit -m "refactor(admin-web): UsersPage — filter useState → useUrlParam (URL persistence)"
```

---

## Task 2: CandidatesPage 迁移

**Files:**
- Modify: `admin-web/src/pages/CandidatesPage.tsx`
- Modify: `admin-web/tests/pages/CandidatesList.test.tsx`

### Step 2.1: 改 page 文件

同 Task 1 模式：

```tsx
import { useUrlParam } from '../hooks/useUrlParam';
// ...
const [unlockStatus, setUnlockStatus] = useUrlParam<string>('unlock_status', '');
const [keyword, setKeyword] = useUrlParam<string>('keyword', '');
const [page, setPage] = useUrlParam<number>('page', 1, (v) => v && /^\d+$/.test(v) ? Math.max(1, parseInt(v, 10)) : null);
```

### Step 2.2-2.4: 同 Task 1

跑测试 + 加 2 case + commit。

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/CandidatesPage.tsx admin-web/tests/pages/CandidatesList.test.tsx
git -C D:/dev/hunter-platform commit -m "refactor(admin-web): CandidatesPage — filter useState → useUrlParam"
```

---

## Task 3: JobsPage 迁移

**Files:**
- Modify: `admin-web/src/pages/JobsPage.tsx`
- Modify: `admin-web/tests/pages/JobsPage.test.tsx`

### Step 3.1: 改 page 文件

JobsPage filter keys：`status` / `keyword` / `from` / `until` / `page`：

```tsx
const [status, setStatus] = useUrlParam<string>('status', '');
const [keyword, setKeyword] = useUrlParam<string>('keyword', '');
const [from, setFrom] = useUrlParam<string>('from', '');
const [until, setUntil] = useUrlParam<string>('until', '');
const [page, setPage] = useUrlParam<number>('page', 1, pageParser);
```

### Step 3.2-3.4: 同 Task 1

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/JobsPage.tsx admin-web/tests/pages/JobsPage.test.tsx
git -C D:/dev/hunter-platform commit -m "refactor(admin-web): JobsPage — filter useState → useUrlParam"
```

---

## Task 4: RecommendationsPage 迁移

**Files:**
- Modify: `admin-web/src/pages/RecommendationsPage.tsx`
- Modify: `admin-web/tests/pages/RecommendationsPage.test.tsx`

### Step 4.1: 改 page 文件

同 JobsPage（filter keys 一样）：`status` / `keyword` / `from` / `until` / `page`

### Step 4.2-4.4

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/RecommendationsPage.tsx admin-web/tests/pages/RecommendationsPage.test.tsx
git -C D:/dev/hunter-platform commit -m "refactor(admin-web): RecommendationsPage — filter useState → useUrlParam"
```

---

## Task 5: PlacementsPage 迁移

**Files:**
- Modify: `admin-web/src/pages/PlacementsPage.tsx`
- Modify: `admin-web/tests/pages/PlacementsPage.test.tsx`

### Step 5.1: 改 page 文件

Filter keys：`status` / `from` / `until` / `page`

```tsx
const [status, setStatus] = useUrlParam<string>('status', '');
const [from, setFrom] = useUrlParam<string>('from', '');
const [until, setUntil] = useUrlParam<string>('until', '');
const [page, setPage] = useUrlParam<number>('page', 1, pageParser);
```

**注意**：PlacementsPage 还有 `confirm` state（用于 ConfirmModal）——**保留** useState，不替换。

### Step 5.2-5.4

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/PlacementsPage.tsx admin-web/tests/pages/PlacementsPage.test.tsx
git -C D:/dev/hunter-platform commit -m "refactor(admin-web): PlacementsPage — filter useState → useUrlParam"
```

---

## Task 6: WebhookDeadLetterPage 迁移

**Files:**
- Modify: `admin-web/src/pages/WebhookDeadLetterPage.tsx`
- Modify: `admin-web/tests/pages/WebhookDeadLetterPage.test.tsx`

### Step 6.1: 改 page 文件

Filter keys：`event_type` / `min_attempts` (number) / `from` / `until` / `page`：

```tsx
const [eventType, setEventType] = useUrlParam<string>('event_type', '');
const [minAttempts, setMinAttempts] = useUrlParam<number>('min_attempts', 0, (v) => v ? Number(v) : null);
const [from, setFrom] = useUrlParam<string>('from', '');
const [until, setUntil] = useUrlParam<string>('until', '');
const [page, setPage] = useUrlParam<number>('page', 1, pageParser);
```

注意：min_attempts 之前的 useState 类型是 `string`（input value），改用 useUrlParam<number> 后需要在 setX 调用处 `setMinAttempts(String(Number(minAttempts)) || null)`——具体看代码，**保证类型转换正确**。

### Step 6.2-6.4

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/WebhookDeadLetterPage.tsx admin-web/tests/pages/WebhookDeadLetterPage.test.tsx
git -C D:/dev/hunter-platform commit -m "refactor(admin-web): WebhookDeadLetterPage — filter useState → useUrlParam (incl. min_attempts number)"
```

---

## Task 7: AuditPage 迁移

**Files:**
- Modify: `admin-web/src/pages/AuditPage.tsx`
- Modify: `admin-web/tests/pages/AuditPage.test.tsx`

### Step 7.1: 改 page 文件

AuditPage 有 3 个 tab（admin / user / login），每个 tab 独立。**只 Admin Actions tab 用 useUrlParam**（其他 2 tab 没 filter 字段）。

```tsx
// 在 AdminActionsTab 函数体内
const [actor, setActor] = useUrlParam<string>('actor', '');
const [page, setPage] = useUrlParam<number>('page', 1, pageParser);
```

**注意**：
- `actor` 当前在 component 顶层用 `useState`（3 个 tab 共享一个 actor 状态——其实 UserActions / LoginEvents 不用 actor）。迁移后只 Admin Actions 用，其他 tab 不变
- `page` 当前在 AdminActionsTab 函数体内有 `useState(1)`，替换
- 不要改 AuditPage 顶层 page 状态（如果有）

### Step 7.2: 跑现有测试

```bash
cd /d/dev/hunter-platform/admin-web && npm run test -- tests/pages/AuditPage 2>&1 | tail -5
```

### Step 7.3: 加 2 case

```tsx
  it('5. mount reads actor from URL', async () => {
    // MemoryRouter initialEntries=['/audit?tab=admin&actor=adm_1']
    // 验证 getAdminLog 被以 actor='adm_1' 调用
  });

  it('6. changing actor input updates URL', async () => {
    // 触发 actor input change
    // 验证 URL 含 ?actor=...
  });
```

### Step 7.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/pages/AuditPage.tsx admin-web/tests/pages/AuditPage.test.tsx
git -C D:/dev/hunter-platform commit -m "refactor(admin-web): AuditPage Admin Actions — actor useState → useUrlParam"
```

---

## Task 8: 全量验证 + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

### Step 8.1: 跑全部 admin-web 测试

```bash
cd /d/dev/hunter-platform/admin-web && npm run test 2>&1 | tail -6
```

Expected: 180 + 14 = **194 通过**。

### Step 8.2: Typecheck

```bash
cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -3
cd /d/dev/hunter-platform/admin-web && npx tsc --noEmit 2>&1 | tail -3
```

Expected: 无错误。

### Step 8.3: 加 CHANGELOG

打开 `CHANGELOG.md`，在 `v2.5.0 (Sub-D5 ...)` 之后加：

```markdown
## v2.6.0 (Sub-D6 — Filter URL Persistence Sweep) — 2026-06-25

### 改进
- **Filter URL 持久化全站应用**：7 个 list page（UsersPage / CandidatesPage / JobsPage / RecommendationsPage / PlacementsPage / WebhookDeadLetterPage / AuditPage Admin Actions tab）从 `useState` 迁到 `useUrlParam`
- **一致性**：与 Sub-D2 follow-up 4 个 timeline page 行为完全一致
- 复用 Small Fixes 已建的 `useUrlParam` hook

### 测试
- 前端 +14 个 page test case（每页 2 个：URL 读取 + URL 写入）
```

### Step 8.4: Commit

```bash
git -C D:/dev/hunter-platform add CHANGELOG.md
git -C D:/dev/hunter-platform commit -m "docs(changelog): v2.6.0 — Sub-D6 (Filter URL Persistence Sweep)"
```

### Step 8.5: 最终 sanity check

```bash
git -C D:/dev/hunter-platform log --oneline -12
```

确认 8 个新 commit 都在（7 page + CHANGELOG）。

---

## Done criteria

- [ ] 7 个 page 全部 useUrlParam 化
- [ ] 14 个新测试通过
- [ ] 全 typecheck 干净
- [ ] CHANGELOG v2.6.0
- [ ] 8 个 task 都 commit

**预计 5-6 小时。** 单 plan 因为纯 frontend 改动。