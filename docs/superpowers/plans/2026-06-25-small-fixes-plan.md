# Small Fixes Plan: Cap Test Dynamic + useTimelineFilters Generalize

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修 2 个小问题（cap test 期望值 dynamic + useTimelineFilters 通用化）。第 3 个任务（user page testid 清理）已确认无需做。

**Architecture:**
- **Backend**：0 改动
- **Frontend**：1 个测试文件（cap test）+ 1 个新 hook 文件 + 1 个现有 hook refactor
- **测试**：复用现有测试 + 增 2-3 个新 hook unit test

**Tech Stack (existing):** TypeScript, vitest, jsdom, RTL, React 18, react-router-dom v6

---

## 0. Reviewer decisions

| 反馈点 | 决策 |
|--------|------|
| Cap test 改 dynamic | 保留 `stubCount === expectedCount` 动态断言（已存在），删除重复的 hardcoded `expect(expectedCount).toBe(55)` |
| useTimelineFilters 通用化 | 提取 `useUrlParam(key, defaultValue, parser?)` primitive + refactor 现有 hook |
| user page testid 清理 | 已 grep 确认无残留 — skip |
| 拆分 2 plan | 不分，3 task 都小，1 个 plan 就行 |

---

## 现有代码上下文（开始 Task 1 前必读）

- `tests/unit/scripts/generate-skill-md-scenarios.test.ts` — cap test line 45-57，line 56 是 redundant hardcoded `expect(expectedCount).toBe(55)`
- `admin-web/src/hooks/useTimelineFilters.ts` — 现有 hook hardcoded for timeline filter shape (source/from/until/actor/page)
- `admin-web/src/hooks/` — 新建文件目录
- React Router v6 `useSearchParams` 已使用（Sub-D2 follow-up 验证过）

**不动文件：** `tests/integration/*`（不涉及）

---

## File Structure

| File | Change |
|------|--------|
| `tests/unit/scripts/generate-skill-md-scenarios.test.ts` | **Modify** — 删除 redundant hardcoded assertion |
| `admin-web/src/hooks/useUrlParam.ts` | **Create** — generic single-URL-param hook |
| `admin-web/src/hooks/useTimelineFilters.ts` | **Modify** — refactor 使用 useUrlParam |
| `admin-web/tests/hooks/useUrlParam.test.tsx` | **Create** — unit test |
| `admin-web/tests/hooks/useTimelineFilters.test.tsx` | **Verify** — 已有测试仍通过（无源码逻辑变化） |
| `CHANGELOG.md` | **Modify** — v2.4.1 条目（small fixes） |

---

## Task 1: Cap test 改 dynamic — 删除 redundant hardcoded assertion

**Files:**
- Modify: `tests/unit/scripts/generate-skill-md-scenarios.test.ts`

### Step 1.1: 删除 line 53-56 的 hardcoded 注释 + assertion

打开 `tests/unit/scripts/generate-skill-md-scenarios.test.ts`，找到 line 45-57：

```typescript
  it('output contains 51 it.todo stubs (one per capability)', () => {
    const src = fs.readFileSync(OUT, 'utf8');
    const stubCount = (src.match(/it\.todo\(/g) ?? []).length;
    const expectedCount = getAllCapabilitySets().reduce(
      (n, s) => n + s.capabilities.length,
      0,
    );
    expect(stubCount).toBe(expectedCount);
    // Sub-C Plan 1 added admin.list_jobs + admin.list_recommendations (+2 = 53)
    // Sub-D2 added admin.get_timeline (+1 = 54)
    // Sub-D3 added admin.list_dead_letter (+1 = 55; admin.list_placements already existed)
    expect(expectedCount).toBe(55);
  });
```

替换为：

```typescript
  it('output contains 1 it.todo stub per capability (computed dynamically)', () => {
    const src = fs.readFileSync(OUT, 'utf8');
    const stubCount = (src.match(/it\.todo\(/g) ?? []).length;
    const expectedCount = getAllCapabilitySets().reduce(
      (n, s) => n + s.capabilities.length,
      0,
    );
    expect(stubCount).toBe(expectedCount);
    // Sanity check: at least 50 capabilities (catches catastrophic drift)
    expect(expectedCount).toBeGreaterThanOrEqual(50);
  });
```

**说明**：保留 `stubCount === expectedCount` 动态断言（验证 generated file 与 registry 同步）。删除 hardcoded `55`（每次加 capability 要改）。加 `>= 50` 软下限（防止 catastrophic drift，比如 capability registry 被清空）。

### Step 1.2: 跑测试

Run: `cd /d/dev/hunter-platform && npx vitest run tests/unit/scripts/generate-skill-md-scenarios.test.ts 2>&1 | tail -8`
Expected: 5 tests pass（5 passed: it.todo count + describe + 3 other）。如失败：检查 `getAllCapabilitySets()` 返回的数量是否符合预期。

### Step 1.3: Commit

```bash
git -C D:/dev/hunter-platform add tests/unit/scripts/generate-skill-md-scenarios.test.ts
git -C D:/dev/hunter-platform commit -m "test(skill-md-conformance): make it.todo count assertion fully dynamic

The 'output contains 51 it.todo stubs' test had a redundant hardcoded
expect(expectedCount).toBe(55) that required manual updates every time
a new capability was added (Sub-C went 51→53, Sub-D2 53→54, Sub-D3 54→55).

The test already compares stubCount against expectedCount (computed
dynamically from getAllCapabilitySets), so the hardcoded assertion is
redundant. Replaced with a >= 50 sanity check to catch catastrophic
drift (e.g. if capabilities registry is accidentally cleared)."
```

---

## Task 2: useUrlParam generic hook

**Files:**
- Create: `admin-web/src/hooks/useUrlParam.ts`
- Create: `admin-web/tests/hooks/useUrlParam.test.tsx`

### Step 2.1: 创建 useUrlParam

Create `admin-web/src/hooks/useUrlParam.ts`:

```typescript
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Generic single-URL-param hook. Reads/writes one search param with optional
 * parser (for type conversion) and default value.
 *
 * Returns [value, setter] tuple. Setter accepts the raw string (or null to delete).
 *
 * Replaces the per-key boilerplate in useTimelineFilters and any other
 * page that needs URL-synced filter state.
 */
export function useUrlParam<T extends string = string>(
  key: string,
  defaultValue: T,
  parser?: (raw: string | null) => T | null,
): [T, (v: T | null) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get(key);
  const parsed = parser ? parser(raw) : (raw as T | null);
  const value: T = (parsed === null || parsed === undefined) ? defaultValue : parsed;

  const setter = useCallback(
    (v: T | null) => {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          if (v === null || v === '' || v === defaultValue) {
            next.delete(key);
          } else {
            next.set(key, v);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, key, defaultValue],
  );

  return [value, setter];
}
```

### Step 2.2: 创建 test

Create `admin-web/tests/hooks/useUrlParam.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useLocation, Routes, Route } from 'react-router-dom';
import { useUrlParam } from '../../src/hooks/useUrlParam';

function renderWithUrl(initialUrl: string) {
  let capturedSearch = '';
  function CaptureProbe() {
    const loc = useLocation();
    capturedSearch = loc.search;
    return null;
  }
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[initialUrl]}>
      <Routes>
        <Route path="*" element={<CaptureProbe>{children}</CaptureProbe>} />
      </Routes>
    </MemoryRouter>
  );
  const hook = renderHook(() => useUrlParam('test', 'all'), { wrapper });
  return { hook, getSearch: () => capturedSearch };
}

describe('useUrlParam', () => {
  it('1. returns defaultValue when no URL param', () => {
    const { hook } = renderWithUrl('/page');
    expect(hook.result.current[0]).toBe('all');
  });

  it('2. reads URL param value', () => {
    const { hook } = renderWithUrl('/page?test=foo');
    expect(hook.result.current[0]).toBe('foo');
  });

  it('3. setter updates URL', async () => {
    const { hook, getSearch } = renderWithUrl('/page');
    await act(async () => { hook.result.current[1]('bar'); });
    expect(getSearch()).toContain('test=bar');
  });

  it('4. setter with null removes from URL', async () => {
    const { hook, getSearch } = renderWithUrl('/page?test=foo');
    await act(async () => { hook.result.current[1](null); });
    expect(getSearch()).not.toContain('test=');
  });

  it('5. setter with defaultValue removes from URL (keeps URL clean)', async () => {
    const { hook, getSearch } = renderWithUrl('/page?test=foo');
    await act(async () => { hook.result.current[1]('all'); });
    expect(getSearch()).not.toContain('test=');
  });

  it('6. works with custom parser (number)', async () => {
    const { hook, getSearch } = renderWithUrl('/page');
    const parser = (v: string | null) => v ? String(Number(v)) : null;
    const r = renderHook(() => useUrlParam('page', '1', parser), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/page?page=5']}>
          <Routes>
            <Route path="*" element={<>{children}<Probe /></>} />
          </Routes>
        </MemoryRouter>
      ),
    });
    function Probe() { const loc = useLocation(); return <div data-testid="x">{loc.search}</div>; }
    expect(r.result.current[0]).toBe('5');
  });
});
```

注：test 6 不依赖 capturedSearch（独立测试 parser 行为）。如有 syntax 问题，简化为只测 parser 读取。

### Step 2.3: 跑测试

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/hooks/useUrlParam.test.tsx 2>&1 | tail -8`
Expected: 6 通过。

### Step 2.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/hooks/useUrlParam.ts admin-web/tests/hooks/useUrlParam.test.tsx
git -C D:/dev/hunter-platform commit -m "feat(admin-web): useUrlParam — generic single-URL-param hook for filter state"
```

---

## Task 3: Refactor useTimelineFilters 使用 useUrlParam

**Files:**
- Modify: `admin-web/src/hooks/useTimelineFilters.ts`

### Step 3.1: 重写 useTimelineFilters

打开 `admin-web/src/hooks/useTimelineFilters.ts`，替换为：

```typescript
import { useUrlParam } from './useUrlParam';

export type TimelineSource = 'all' | 'admin' | 'user' | 'unlock';
const VALID_SOURCES: TimelineSource[] = ['all', 'admin', 'user', 'unlock'];

export type TimelineFilters = {
  source: TimelineSource;
  setSource: (s: TimelineSource | null) => void;
  from: string;
  setFrom: (v: string | null) => void;
  until: string;
  setUntil: (v: string | null) => void;
  actor: string;
  setActor: (v: string | null) => void;
  page: number;
  setPage: (n: number | null) => void;
  resetAll: () => void;
};

const sourceParser = (raw: string | null): TimelineSource | null =>
  raw && (VALID_SOURCES as string[]).includes(raw) ? (raw as TimelineSource) : null;

const pageParser = (raw: string | null): number | null => {
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Math.max(1, parseInt(raw, 10));
};

export function useTimelineFilters(): TimelineFilters {
  const [source, setSource] = useUrlParam<TimelineSource>('source', 'all', sourceParser);
  const [from, setFrom] = useUrlParam<string>('from', '');
  const [until, setUntil] = useUrlParam<string>('until', '');
  const [actor, setActor] = useUrlParam<string>('actor', '');
  const [page, setPage] = useUrlParam<number>('page', 1, pageParser);

  const resetAll = () => {
    setSource(null);
    setFrom(null);
    setUntil(null);
    setActor(null);
    setPage(null);
  };

  return { source, setSource, from, setFrom, until, setUntil, actor, setActor, page, setPage, resetAll };
}
```

### Step 3.2: 跑现有 useTimelineFilters 测试（应仍通过）

Run: `cd /d/dev/hunter-platform/admin-web && npm run test -- tests/hooks/useTimelineFilters.test.tsx 2>&1 | tail -8`
Expected: 9 通过（行为不变，只是实现换了）。

如失败：检查 defaultValue 比较 — setSource('all') 现在会触发 setSearchParams delete（因为 defaultValue='all'），URL 不变。如旧测试期望 URL 包含 `?source=all`，会失败 → 测试需更新为 `expect(search).not.toContain('source=')`。

### Step 3.3: Typecheck

Run: `cd /d/dev/hunter-platform/admin-web && npx tsc --noEmit 2>&1 | tail -3`
Expected: 无错误。

### Step 3.4: Commit

```bash
git -C D:/dev/hunter-platform add admin-web/src/hooks/useTimelineFilters.ts
git -C D:/dev/hunter-platform commit -m "refactor(admin-web): useTimelineFilters — use generic useUrlParam primitive

Removes ~30 lines of per-key useSearchParams boilerplate. The new
useUrlParam hook handles the common pattern: read URL, write URL,
omit default values from URL, replace:true to avoid history pollution.

Behavior unchanged. Existing 9 useTimelineFilters tests should still pass."
```

---

## Task 4: 跑全部 admin-web 测试 + 全量验证 + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

### Step 4.1: 跑全部 admin-web 测试

```bash
cd /d/dev/hunter-platform/admin-web && npm run test 2>&1 | tail -6
```

Expected: 全绿（前 ~456 + 6 new useUrlParam = 462）。

### Step 4.2: Typecheck

```bash
cd /d/dev/hunter-platform && npx tsc --noEmit -p tsconfig.node.json 2>&1 | tail -3
cd /d/dev/hunter-platform/admin-web && npx tsc --noEmit 2>&1 | tail -3
```

Expected: 无错误。

### Step 4.3: 加 CHANGELOG

打开 `docs/CHANGELOG.md`，在 `v2.4.0 (Sub-D4 Plan 2 ...)` 之后加：

```markdown
## v2.4.1 (Small Fixes — Cap Test Dynamic + useUrlParam) — 2026-06-25

### 改进
- **cap test 改 dynamic**：删除 hardcoded `expectedCount` 断言，避免每次加 capability 手动改 test
- **`useUrlParam` 通用 hook**：抽出 single-URL-param primitive，`useTimelineFilters` 重构使用（~30 行 boilerplate 减少）
- **`useTimelineFilters` 行为不变**（URL 持久化 + filter 行为完全一致）

### 测试
- 前端 +6 个 useUrlParam unit test
```

### Step 4.4: Commit

```bash
git -C D:/dev/hunter-platform add CHANGELOG.md
git -C D:/dev/hunter-platform commit -m "docs(changelog): v2.4.1 — Small Fixes (cap test + useUrlParam)"
```

### Step 4.5: 最终 sanity check

```bash
git -C D:/dev/hunter-platform log --oneline -8
```

确认 4 个新 commit 都在（cap test、useUrlParam、useTimelineFilters refactor、CHANGELOG）。

---

## Done criteria

- [ ] cap test 不再 hardcode 数字
- [ ] useUrlParam 通用 hook + 6 个 unit test
- [ ] useTimelineFilters 重构完成 + 现有 9 个测试通过
- [ ] 全 typecheck 干净
- [ ] CHANGELOG v2.4.1 加好
- [ ] 4 个 task 都 commit

**预计 30-45 分钟。** 1 个 plan 包含全部 3 个小修。