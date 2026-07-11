# PM Workbench UI Visual Fidelity Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the React PM Workbench implementation in line with the visual design of `C:\Users\Administrator\Desktop\ow-recruit-saas\prototype.html` (PM screens S1-S9), by closing the 26 gaps identified in the prototype-vs-implementation comparison.

**Architecture:** Pure frontend work. No new backend endpoints, no new tables, no API client changes (except where noted). Reuses existing `tokens.css` design system + extends `pm-portal.css` with prototype-specific tokens (`--c-stage-*` colors, `--b-stage-*` backgrounds, custom stage pills). Each task is self-contained and ships one UI surface; visual snapshots are captured via component test DOM assertions, not visual regression.

**Tech Stack:** React 18 + TypeScript strict + React Query + Vite + existing `tokens.css` + extended `pm-portal.css`. No new dependencies.

**Reference:** `C:\Users\Administrator\Desktop\ow-recruit-saas\prototype.html` lines 1488-1758 (PM screens S1-S9). All task descriptions quote prototype HTML/CSS/JS as the spec.

**Pre-existing work:** This plan is layered on top of the 21-task PM Workbench plan (`docs/superpowers/plans/2026-07-09-pm-workbench-plan.md`), all commits on `feature/pm-workbench` branch (HEAD `3d40273` or later after Task 17's `/admin/pm/*` route fix).

---

## File Structure

### New files
- `admin-web/src/components/pm-portal/stage-tokens.ts` — shared stage color/label/ordinal helpers (S1/S3/S4/S6/S9 reuse)
- `admin-web/src/components/pm-portal/TopFilterBar.tsx` — generic filter strip (S1)
- `admin-web/src/components/pm-portal/DrillFunnelCard.tsx` — S1 horizontal funnel card
- `admin-web/src/components/pm-portal/MatchSidebar.tsx` — S2 sticky right column
- `admin-web/src/components/pm-portal/PublishStatus.tsx` — S2 per-row ERP publish chip
- `admin-web/src/components/pm-portal/AISuggestionBanner.tsx` — S2 yellow AI hint box
- `admin-web/src/components/pm-portal/MetadataEditModal.tsx` — S2 project metadata modal
- `admin-web/src/components/pm-portal/PositionPicker.tsx` — S2/S3/S6 inline project+position selector
- `admin-web/src/components/pm-portal/OnTrackAlert.tsx` — S3 footer alert
- `admin-web/src/components/pm-portal/TriangleRadar.tsx` — S4 inline SVG 3-dim radar
- `admin-web/src/components/pm-portal/LockedRibbon.tsx` — S4 `✓ 已锁定` overlay
- `admin-web/src/components/pm-portal/CandidateProfileCard.tsx` — S5 left-column profile
- `admin-web/src/components/pm-portal/TierBadgeRow.tsx` — S5 per-dim A/B/C/D badges + bars
- `admin-web/src/components/pm-portal/PMViewBanner.tsx` — S5 PM 视角 disclaimer
- `admin-web/src/components/pm-portal/MatchTableRow.tsx` — S5 match table row
- `admin-web/src/components/pm-portal/SortPills.tsx` — S6 sort pill row
- `admin-web/src/components/pm-portal/ActionStack.tsx` — S6 per-row action buttons
- `admin-web/src/components/pm-portal/SettingsPage.tsx` (replace) — S7 ERP settings
- `admin-web/src/components/pm-portal/ErpConnectionForm.tsx` — S7 form
- `admin-web/src/components/pm-portal/ErpStatusTable.tsx` — S7 status
- `admin-web/src/components/pm-portal/ErpCallLog.tsx` — S7 API log
- `admin-web/src/components/pm-portal/HRProgressBar.tsx` — S8 per-row HR progress
- `admin-web/src/components/pm-portal/LibraryFilters.tsx` (extend) — S9 source + annotation selects
- `admin-web/src/components/pm-portal/ReadOnlyChip.tsx` — S9 🔒 affordance

### Modified files
- `admin-web/src/styles/pm-portal.css` — extend with prototype tokens and per-screen utility classes
- `admin-web/src/styles/tokens.css` — add `--c-stage-{project,position,candidate,match,hunter}` + `--b-stage-*` if not present
- `admin-web/src/components/pm-portal/PMSidebar.tsx` — completeness pill + section labels + badge counts (S1, S2, S3, S4, S5, S6, S7, S8, S9 nav)
- `admin-web/src/components/pm-portal/PMMobileLayout.tsx` — cross-mode switch button (PM ↔ HR)
- `admin-web/src/pages/pm-portal/GlobalSnapshotPage.tsx` — replace filter strip + funnel + activity feed
- `admin-web/src/pages/pm-portal/ProjectDetailPage.tsx` — replace tabs with 1fr+320px grid + S2 layout
- `admin-web/src/pages/pm-portal/PipelineSandboxPage.tsx` — replace funnel + on-track alert
- `admin-web/src/pages/pm-portal/PlanComparisonPage.tsx` — add triangle radar + locked ribbon
- `admin-web/src/pages/pm-portal/CandidateDetailPage.tsx` — add profile + tier badges + match table + picker
- `admin-web/src/pages/pm-portal/CandidateMatchesPage.tsx` — add sort pills + action stack
- `admin-web/src/pages/pm-portal/PMSettingsPage.tsx` — replace with S7 ERP settings
- `admin-web/src/pages/pm-portal/ProjectsLibraryPage.tsx` — add HR progress bar + 已发布 + 时间线 columns
- `admin-web/src/pages/pm-portal/CandidateLibraryPage.tsx` — add source/annotation filters + read-only chip + star-first sort

### New test files (one per new component)
Each new component ships `__tests__/<Name>.test.tsx` with behaviour-focused tests asserting data attributes, render structure, and event handlers.

---

## Priority & Task List

| # | Task | Description | Est |
|---|------|-------------|-----|
| 1 | Design tokens | Add `--c-stage-*` + `--b-stage-*` to tokens.css; create `stage-tokens.ts` helper | 1h |
| 2 | Sidebar completeness + badges | Add completeness pill + section labels + badge counts to PMSidebar | 2h |
| 3 | TopFilterBar + S1 filter strip | Reusable filter strip + drill-through funnel cards + S1 redesign | 3h |
| 4 | S2 layout (1fr + 320px) | Two-column grid + sticky MatchSidebar + S2 action buttons | 3h |
| 5 | S2 positions table upgrade | 7-col table with PublishStatus + ERP state + edit inline | 2h |
| 6 | S2 metadata modal + AI banner | MetadataEditModal + AISuggestionBanner | 2h |
| 7 | S2/S3/S5/S6 inline pickers | PositionPicker + CandidatePicker; remove URL-only navigation | 3h |
| 8 | S3 in-funnel candidates + on-track | All stages show candidates inline; OnTrackAlert with remediation | 2h |
| 9 | S4 triangle radar + locked ribbon | TriangleRadar SVG + LockedRibbon overlay | 2h |
| 10 | S5 profile card + tier badges + match table | CandidateProfileCard + TierBadgeRow + MatchTableRow + PMViewBanner | 4h |
| 11 | S6 sort pills + per-row action stack | SortPills + ActionStack; score tier label | 2h |
| 12 | S7 ERP settings surface | SettingsPage rewrite (MOCK/ERP toggle, URL/Token form, status table, call log) | 3h |
| 13 | S8 HR progress + published + timeline columns | HRProgressBar + new columns + 建模 button | 2h |
| 14 | S9 source/annotation filters + read-only + star sort | LibraryFilters extension + ReadOnlyChip + star-first sort | 2h |

**Total: 14 tasks / ~33h**

---

## Task 1: Design tokens (prototype stage colors)

**Files:**
- Modify: `admin-web/src/styles/tokens.css` (add stage tokens if missing)
- Create: `admin-web/src/components/pm-portal/stage-tokens.ts`
- Test: `admin-web/src/components/pm-portal/__tests__/stage-tokens.test.ts`

- [ ] **Step 1: Write failing test for stage-tokens helpers**

```typescript
// admin-web/src/components/pm-portal/__tests__/stage-tokens.test.ts
import { describe, it, expect } from 'vitest';
import { stageColor, stageBg, stageLabel, STAGES } from '../stage-tokens';

describe('stage-tokens', () => {
  it('STAGES is in canonical order with 4 stages', () => {
    expect(STAGES).toEqual(['projects', 'positions', 'candidates', 'matches']);
  });

  it('stageColor returns CSS var ref for each stage', () => {
    expect(stageColor('projects')).toBe('var(--c-stage-project)');
    expect(stageColor('positions')).toBe('var(--c-stage-position)');
    expect(stageColor('candidates')).toBe('var(--c-stage-candidate)');
    expect(stageColor('matches')).toBe('var(--c-stage-match)');
  });

  it('stageBg returns background var ref', () => {
    expect(stageBg('matches')).toBe('var(--b-stage-match)');
  });

  it('stageLabel returns Chinese label', () => {
    expect(stageLabel('projects')).toBe('项目');
    expect(stageLabel('matches')).toBe('匹配');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin-web && pnpm test --run src/components/pm-portal/__tests__/stage-tokens.test.ts`
Expected: FAIL with "Cannot find module '../stage-tokens'"

- [ ] **Step 3: Add stage tokens to tokens.css**

```css
/* In admin-web/src/styles/tokens.css, add to :root { ... } */
  --c-stage-project: #2563eb;
  --c-stage-position: #16a34a;
  --c-stage-candidate: #d97706;
  --c-stage-match: #9333ea;
  --c-stage-hunter: #10b981;
  --b-stage-project: #eff6ff;
  --b-stage-position: #f0fdf4;
  --b-stage-candidate: #fffbeb;
  --b-stage-match: #faf5ff;
  --b-stage-hunter: rgba(16, 185, 129, 0.10);
```

(Add dark variants under `@media (prefers-color-scheme: dark)` if the tokens file has a dark block — match existing convention.)

- [ ] **Step 4: Create stage-tokens.ts**

```typescript
// admin-web/src/components/pm-portal/stage-tokens.ts
export type Stage = 'projects' | 'positions' | 'candidates' | 'matches';

export const STAGES: Stage[] = ['projects', 'positions', 'candidates', 'matches'];

const COLOR: Record<Stage, string> = {
  projects: 'var(--c-stage-project)',
  positions: 'var(--c-stage-position)',
  candidates: 'var(--c-stage-candidate)',
  matches: 'var(--c-stage-match)',
};

const BG: Record<Stage, string> = {
  projects: 'var(--b-stage-project)',
  positions: 'var(--b-stage-position)',
  candidates: 'var(--b-stage-candidate)',
  matches: 'var(--b-stage-match)',
};

const LABEL: Record<Stage, string> = {
  projects: '项目',
  positions: '岗位',
  candidates: '候选人',
  matches: '匹配',
};

export function stageColor(s: Stage): string { return COLOR[s]; }
export function stageBg(s: Stage): string { return BG[s]; }
export function stageLabel(s: Stage): string { return LABEL[s]; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd admin-web && pnpm test --run src/components/pm-portal/__tests__/stage-tokens.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
cd .worktrees/pm-workbench
git add admin-web/src/styles/tokens.css admin-web/src/components/pm-portal/stage-tokens.ts admin-web/src/components/pm-portal/__tests__/stage-tokens.test.ts
git commit -m "feat(pm-portal): add stage color tokens + helpers"
```

---

## Task 2: Sidebar completeness pill + section labels + badge counts

**Files:**
- Modify: `admin-web/src/components/pm-portal/PMSidebar.tsx`
- Modify: `admin-web/src/components/pm-portal/__tests__/PMSidebar.test.tsx`
- Modify: `admin-web/src/styles/pm-portal.css` (add `.pm-sidebar-pill` + `.pm-sidebar-section` classes)

Reference: `prototype.html` lines 599-647 (`.pm-completeness-pill` and `.pm-section-label`).

- [ ] **Step 1: Write failing test for completeness pill + section labels + badge counts**

```typescript
// Add to admin-web/src/components/pm-portal/__tests__/PMSidebar.test.tsx
it('renders the completeness pill (项目数 N / 人才库 N)', () => {
  render(<MemoryRouter><PMSidebar badgeCounts={{ projects: 7, library: 142 }} /></MemoryRouter>);
  expect(screen.getByTestId('pm-sidebar-pill')).toHaveTextContent('项目数 7');
  expect(screen.getByTestId('pm-sidebar-pill')).toHaveTextContent('人才库 142');
});

it('renders section labels (🏠 主导航 / 📊 项目视图)', () => {
  render(<MemoryRouter><PMSidebar badgeCounts={{ projects: 0, library: 0 }} /></MemoryRouter>);
  expect(screen.getByText('🏠 主导航')).toBeInTheDocument();
  expect(screen.getByText('📊 项目视图')).toBeInTheDocument();
});

it('renders badge counts next to nav items', () => {
  render(<MemoryRouter><PMSidebar badgeCounts={{ projects: 3, library: 12 }} /></MemoryRouter>);
  expect(screen.getByTestId('pm-sidebar-nav-projects-badge')).toHaveTextContent('3');
  expect(screen.getByTestId('pm-sidebar-nav-library-badge')).toHaveTextContent('12');
});

it('falls back to zero when badgeCounts prop is omitted', () => {
  render(<MemoryRouter><PMSidebar /></MemoryRouter>);
  expect(screen.getByTestId('pm-sidebar-nav-projects-badge')).toHaveTextContent('0');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin-web && pnpm test --run src/components/pm-portal/__tests__/PMSidebar.test.tsx`
Expected: FAIL — pills/sections/badges not present

- [ ] **Step 3: Add CSS for pill and section labels**

```css
/* In admin-web/src/styles/pm-portal.css, add */
.pm-sidebar-pill {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: var(--sp-2) var(--sp-3);
  padding: 8px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  transition: all 0.15s;
}
.pm-sidebar-pill:hover {
  background: var(--bg);
  border-color: var(--c-stage-project);
  color: var(--c-stage-project);
}
.pm-sidebar-section {
  padding: var(--sp-2) var(--sp-4);
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.pm-sidebar-badge {
  display: inline-block;
  min-width: 18px;
  padding: 0 6px;
  margin-left: auto;
  background: var(--b-stage-project);
  color: var(--c-stage-project);
  border-radius: 9px;
  font-size: 10px;
  text-align: center;
  line-height: 18px;
}
```

- [ ] **Step 4: Update PMSidebar component**

```typescript
// admin-web/src/components/pm-portal/PMSidebar.tsx
import { Link, useLocation } from 'react-router-dom';

export interface PMSidebarProps {
  badgeCounts?: { projects: number; library: number };
}

const NAV = [
  { to: '/admin/pm/snapshot', label: '📊 总览', key: 'snapshot' as const },
  { to: '/admin/pm/projects', label: '📁 项目库', key: 'projects' as const },
  { to: '/admin/pm/library', label: '👤 候选人库', key: 'library' as const },
  { to: '/admin/pm/settings', label: '⚙️ 设置', key: 'settings' as const },
];

export function PMSidebar({ badgeCounts = { projects: 0, library: 0 } }: PMSidebarProps) {
  const { pathname } = useLocation();
  return (
    <aside className="pm-sidebar" aria-label="PM 导航">
      <div className="pm-sidebar-brand">猎头平台 · PM 工作台</div>
      <button
        className="pm-sidebar-pill"
        data-testid="pm-sidebar-pill"
        onClick={() => { window.location.href = '/admin/pm/projects'; }}
        title="点击查看项目详情"
      >
        <span>项目数 {badgeCounts.projects}</span>
        <span>人才库 {badgeCounts.library}</span>
      </button>
      <div className="pm-sidebar-section">🏠 主导航</div>
      <nav className="pm-sidebar-nav">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.to);
          return (
            <Link key={item.key} to={item.to} className={`pm-sidebar-link${active ? ' active' : ''}`}>
              <span>{item.label}</span>
              {(item.key === 'projects' || item.key === 'library') && (
                <span
                  className="pm-sidebar-badge"
                  data-testid={`pm-sidebar-nav-${item.key}-badge`}
                >
                  {badgeCounts[item.key]}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="pm-sidebar-section">📊 项目视图</div>
      {/* Per-project shortcut chips — Task 8 defers; place empty state */}
      <div className="pm-sidebar-empty" data-testid="pm-sidebar-no-projects">
        暂无项目
      </div>
    </aside>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd admin-web && pnpm test --run src/components/pm-portal/__tests__/PMSidebar.test.tsx`
Expected: PASS (all 4 new tests + 3 existing tests)

- [ ] **Step 6: Commit**

```bash
git add admin-web/src/components/pm-portal/PMSidebar.tsx admin-web/src/components/pm-portal/__tests__/PMSidebar.test.tsx admin-web/src/styles/pm-portal.css
git commit -m "feat(pm-portal): sidebar completeness pill + section labels + badge counts"
```

---

## Task 3: TopFilterBar + S1 (Global Snapshot) redesign

**Files:**
- Create: `admin-web/src/components/pm-portal/TopFilterBar.tsx`
- Create: `admin-web/src/components/pm-portal/DrillFunnelCard.tsx`
- Create: `admin-web/src/components/pm-portal/__tests__/TopFilterBar.test.tsx`
- Create: `admin-web/src/components/pm-portal/__tests__/DrillFunnelCard.test.tsx`
- Modify: `admin-web/src/pages/pm-portal/GlobalSnapshotPage.tsx`
- Modify: `admin-web/src/styles/pm-portal.css` (add `.pm-topfilter`, `.pm-funnel-pipeline` classes)

Reference: `prototype.html` lines 1496-1531 (S1 markup).

- [ ] **Step 1: Write failing test for TopFilterBar**

```typescript
// admin-web/src/components/pm-portal/__tests__/TopFilterBar.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TopFilterBar } from '../TopFilterBar';

describe('TopFilterBar', () => {
  const defaults = { project: '全部', status: '进行中', range: '近 90 天' };

  it('renders the three default chips', () => {
    render(<TopFilterBar onRefresh={vi.fn()} onExport={vi.fn()} onCreate={vi.fn()} {...defaults} />);
    expect(screen.getByText('📁 项目: 全部 ▾')).toBeInTheDocument();
    expect(screen.getByText('状态: 进行中 ▾')).toBeInTheDocument();
    expect(screen.getByText('时间: 近 90 天 ▾')).toBeInTheDocument();
  });

  it('fires onRefresh when 🔄 刷新 is clicked', () => {
    const onRefresh = vi.fn();
    render(<TopFilterBar onRefresh={onRefresh} onExport={vi.fn()} onCreate={vi.fn()} {...defaults} />);
    fireEvent.click(screen.getByRole('button', { name: /刷新/ }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('fires onExport when 📥 导出 is clicked', () => {
    const onExport = vi.fn();
    render(<TopFilterBar onRefresh={vi.fn()} onExport={onExport} onCreate={vi.fn()} {...defaults} />);
    fireEvent.click(screen.getByRole('button', { name: /导出/ }));
    expect(onExport).toHaveBeenCalledOnce();
  });

  it('fires onCreate when + 新建项目 is clicked', () => {
    const onCreate = vi.fn();
    render(<TopFilterBar onRefresh={vi.fn()} onExport={vi.fn()} onCreate={onCreate} {...defaults} />);
    fireEvent.click(screen.getByRole('button', { name: /新建项目/ }));
    expect(onCreate).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin-web && pnpm test --run src/components/pm-portal/__tests__/TopFilterBar.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Create TopFilterBar**

```typescript
// admin-web/src/components/pm-portal/TopFilterBar.tsx
interface Props {
  project: string;
  status: string;
  range: string;
  onProjectChange?: (v: string) => void;
  onStatusChange?: (v: string) => void;
  onRangeChange?: (v: string) => void;
  onRefresh: () => void;
  onExport: () => void;
  onCreate: () => void;
}

const STATUSES = ['全部', '进行中', '建模中', '已确认', '已收尾'];
const RANGES = ['近 7 天', '近 30 天', '近 90 天', '近 1 年'];

export function TopFilterBar({
  project, status, range,
  onProjectChange = () => {},
  onStatusChange = () => {},
  onRangeChange = () => {},
  onRefresh, onExport, onCreate,
}: Props) {
  return (
    <div className="pm-topfilter" data-testid="pm-topfilter">
      <span>📁 项目: {project} ▾</span>
      <label>
        状态:{' '}
        <select value={status} onChange={(e) => onStatusChange(e.target.value)} aria-label="状态过滤">
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label>
        时间:{' '}
        <select value={range} onChange={(e) => onRangeChange(e.target.value)} aria-label="时间范围">
          {RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--sp-2)' }}>
        <button className="pm-btn-secondary" onClick={onRefresh} data-testid="pm-topfilter-refresh">🔄 刷新</button>
        <button className="pm-btn-secondary" onClick={onExport} data-testid="pm-topfilter-export">📥 导出</button>
      </span>
      <button className="pm-btn-primary" onClick={onCreate} data-testid="pm-topfilter-create">+ 新建项目</button>
    </div>
  );
}
```

- [ ] **Step 4: Write failing test for DrillFunnelCard**

```typescript
// admin-web/src/components/pm-portal/__tests__/DrillFunnelCard.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DrillFunnelCard } from '../DrillFunnelCard';

describe('DrillFunnelCard', () => {
  it('renders the stage label, count, and ordinal', () => {
    render(<DrillFunnelCard stage="projects" count={12} ordinal="①" subItems={[{ label: '进行中', value: 5 }]} onClick={vi.fn()} />);
    expect(screen.getByTestId('pm-funnel-stage-projects')).toHaveTextContent('①');
    expect(screen.getByTestId('pm-funnel-stage-projects')).toHaveTextContent('项目');
    expect(screen.getByTestId('pm-funnel-stage-projects')).toHaveTextContent('12');
    expect(screen.getByTestId('pm-funnel-stage-projects')).toHaveTextContent('进行中 5');
  });

  it('fires onClick when card is clicked', () => {
    const onClick = vi.fn();
    render(<DrillFunnelCard stage="projects" count={12} ordinal="①" subItems={[]} onClick={onClick} />);
    fireEvent.click(screen.getByTestId('pm-funnel-stage-projects'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('uses stage-specific colors via CSS vars', () => {
    render(<DrillFunnelCard stage="matches" count={4} ordinal="④" subItems={[]} onClick={vi.fn()} />);
    const card = screen.getByTestId('pm-funnel-stage-matches');
    expect(card.className).toMatch(/pm-funnel-stage--matches/);
  });
});
```

- [ ] **Step 5: Run DrillFunnelCard test to verify it fails**

Run: `cd admin-web && pnpm test --run src/components/pm-portal/__tests__/DrillFunnelCard.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 6: Create DrillFunnelCard**

```typescript
// admin-web/src/components/pm-portal/DrillFunnelCard.tsx
import { stageColor, stageBg, stageLabel, type Stage } from './stage-tokens';

interface SubItem { label: string; value: number; }
interface Props {
  stage: Stage;
  count: number;
  ordinal: '①' | '②' | '③' | '④';
  subItems: SubItem[];
  onClick: () => void;
}

export function DrillFunnelCard({ stage, count, ordinal, subItems, onClick }: Props) {
  return (
    <div
      className={`pm-funnel-stage pm-funnel-stage--${stage}`}
      data-testid={`pm-funnel-stage-${stage}`}
      style={{ borderColor: stageColor(stage), background: stageBg(stage) }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
    >
      <div className="pm-funnel-stage-ordinal">{ordinal}</div>
      <div className="pm-funnel-stage-label">{stageLabel(stage)}</div>
      <div className="pm-funnel-stage-count">{count}</div>
      {subItems.length > 0 && (
        <ul className="pm-funnel-stage-subs">
          {subItems.map((s) => (
            <li key={s.label}>{s.label} {s.value}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Add CSS for top filter and funnel pipeline**

```css
/* In admin-web/src/styles/pm-portal.css, add */
.pm-topfilter {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: var(--sp-3);
}
.pm-funnel-pipeline {
  display: flex;
  align-items: stretch;
  gap: 0;
  margin-bottom: var(--sp-3);
}
.pm-funnel-stage {
  flex: 1;
  border: 2px solid;
  border-radius: var(--r-md);
  padding: var(--sp-4);
  min-height: 220px;
  cursor: pointer;
  transition: transform 0.1s;
}
.pm-funnel-stage:hover { transform: translateY(-2px); }
.pm-funnel-stage-ordinal { font-size: 24px; font-weight: 600; opacity: 0.6; }
.pm-funnel-stage-label { font-size: 14px; font-weight: 600; margin-top: 4px; }
.pm-funnel-stage-count { font-size: 32px; font-weight: 700; margin-top: var(--sp-2); }
.pm-funnel-stage-subs { list-style: none; padding: 0; margin: var(--sp-2) 0 0 0; font-size: 12px; opacity: 0.85; }
.pm-funnel-arrow {
  align-self: center;
  color: #94a3b8;
  font-size: 20px;
  padding: 0 var(--sp-2);
}
```

- [ ] **Step 8: Rewrite GlobalSnapshotPage to use new components**

```typescript
// admin-web/src/pages/pm-portal/GlobalSnapshotPage.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { pmSnapshot, pmProjects } from '../../api/pm-portal';
import { TopFilterBar } from '../../components/pm-portal/TopFilterBar';
import { DrillFunnelCard } from '../../components/pm-portal/DrillFunnelCard';
import { ActivityFeed } from '../../components/pm-portal/ActivityFeed';

const STAGES = ['projects', 'positions', 'candidates', 'matches'] as const;
const ORDINALS = ['①', '②', '③', '④'] as const;
const SUBS = [
  ['规划中', '招聘中', '已暂停', '已完成', '已取消'],
  ['开放', '暂停中', '已招满'],
  ['总数', '已脱敏'],
  ['平均分'],
] as const;

export function GlobalSnapshotPage() {
  const [project, setProject] = useState('全部');
  const [status, setStatus] = useState('进行中');
  const [range, setRange] = useState('近 90 天');
  const { data, refetch, isFetching } = useQuery({
    queryKey: ['pm', 'snapshot'],
    queryFn: () => pmSnapshot.get(),
  });
  const { data: projectsData } = useQuery({
    queryKey: ['pm', 'projects', 'list'],
    queryFn: () => pmProjects.list(),
  });

  if (!data) return <div className="pm-snapshot-loading">加载中…</div>;
  const f = data.data.funnel;
  const counts = { projects: f.projects.total, positions: f.positions.total, candidates: f.candidates.total, matches: f.matches.total };
  const subItems = (s: typeof STAGES[number]) => {
    if (s === 'projects') {
      return Object.entries(f.projects.by_status).map(([k, v]) => ({ label: STATUS_LABEL[k] ?? k, value: v }));
    }
    if (s === 'positions') {
      return Object.entries(f.positions.by_status).map(([k, v]) => ({ label: STATUS_LABEL[k] ?? k, value: v }));
    }
    if (s === 'candidates') return [{ label: '已脱敏', value: f.candidates.distinct }];
    return [{ label: '平均分', value: f.matches.avg_score }];
  };

  return (
    <div className="pm-page pm-snapshot">
      <TopFilterBar
        project={project} status={status} range={range}
        onProjectChange={setProject} onStatusChange={setStatus} onRangeChange={setRange}
        onRefresh={() => refetch()} onExport={() => { window.alert('导出 v2 即将上线'); }} onCreate={() => { window.location.href = '/admin/pm/projects?new=1'; }}
      />
      <h2 className="pm-snapshot-title">📊 全局快照 · 跨项目鸟瞰</h2>
      <p className="pm-snapshot-hint">日常请用 📁 项目详情</p>
      <div className="pm-funnel-pipeline" data-testid="pm-funnel-pipeline">
        {STAGES.map((s, i) => (
          <>
            <DrillFunnelCard
              key={s}
              stage={s}
              ordinal={ORDINALS[i]}
              count={counts[s]}
              subItems={subItems(s)}
              onClick={() => {
                const target = s === 'projects' ? '/admin/pm/projects' : s === 'candidates' ? '/admin/pm/library' : '/admin/pm/snapshot';
                window.location.href = target;
              }}
            />
            {i < STAGES.length - 1 && <span className="pm-funnel-arrow">→</span>}
          </>
        ))}
      </div>
      <div className="pm-snapshot-tip">
        💡 点击任一阶段卡片下钻查看详情 · 当前画布：项目级
      </div>
      <ActivityFeed events={data.data.activity} generatedAt={data.data.generated_at} />
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  planning: '规划中', active: '招聘中', paused: '已暂停', completed: '已完成', cancelled: '已取消',
  open: '开放', paused_position: '暂停中', filled: '已招满',
};
```

- [ ] **Step 9: Run admin-web typecheck + tests**

Run: `cd admin-web && pnpm tsc --noEmit && pnpm test --run`
Expected: 0 typecheck errors; existing 754 tests pass plus 7 new (4 TopFilterBar + 3 DrillFunnelCard)

- [ ] **Step 10: Commit**

```bash
git add admin-web/src/components/pm-portal/TopFilterBar.tsx admin-web/src/components/pm-portal/DrillFunnelCard.tsx \
  admin-web/src/components/pm-portal/__tests__/TopFilterBar.test.tsx admin-web/src/components/pm-portal/__tests__/DrillFunnelCard.test.tsx \
  admin-web/src/pages/pm-portal/GlobalSnapshotPage.tsx admin-web/src/pages/pm-portal/__tests__/GlobalSnapshotPage.test.tsx \
  admin-web/src/styles/pm-portal.css
git commit -m "feat(pm-portal): S1 redesign — top filter strip + horizontal drill funnel"
```

---

## Task 4: S2 layout (1fr + 320px sticky match sidebar) + S2 action buttons

**Files:**
- Create: `admin-web/src/components/pm-portal/MatchSidebar.tsx`
- Create: `admin-web/src/components/pm-portal/__tests__/MatchSidebar.test.tsx`
- Modify: `admin-web/src/pages/pm-portal/ProjectDetailPage.tsx`
- Modify: `admin-web/src/styles/pm-portal.css` (add `.pm-s2-grid`, `.pm-s2-match-sidebar` classes)

Reference: `prototype.html` lines 1534-1568 (S2 two-column grid + sticky match sidebar).

- [ ] **Step 1: Write failing test for MatchSidebar**

```typescript
// admin-web/src/components/pm-portal/__tests__/MatchSidebar.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { MatchSidebar } from '../MatchSidebar';

describe('MatchSidebar', () => {
  const matches = [
    { positionId: 'pos-1', positionTitle: '高级前端工程师', projectName: '电商 V3', score: 92 },
    { positionId: 'pos-2', positionTitle: '全栈工程师', projectName: '数据中台', score: 78 },
  ];

  it('renders the sidebar with title and subtitle', () => {
    render(<MemoryRouter><MatchSidebar positionId="pos-x" matches={matches} /></MemoryRouter>);
    expect(screen.getByText('🎯 候选人实时匹配')).toBeInTheDocument();
    expect(screen.getByText(/按匹配度排序/)).toBeInTheDocument();
  });

  it('renders one match row per entry with score chip', () => {
    render(<MemoryRouter><MatchSidebar positionId="pos-x" matches={matches} /></MemoryRouter>);
    expect(screen.getByTestId('pm-s2-match-row-pos-1')).toHaveTextContent('高级前端工程师');
    expect(screen.getByTestId('pm-s2-match-row-pos-1')).toHaveTextContent('92');
  });

  it('shows 查看全部匹配 CTA that links to /admin/pm/snapshot?match=*', () => {
    render(<MemoryRouter><MatchSidebar positionId="pos-x" matches={matches} /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /查看全部匹配/ });
    expect(link.getAttribute('href')).toBe('/admin/pm/snapshot');
  });

  it('shows empty state when no matches', () => {
    render(<MemoryRouter><MatchSidebar positionId="pos-x" matches={[]} /></MemoryRouter>);
    expect(screen.getByTestId('pm-s2-match-empty')).toHaveTextContent('暂无匹配');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin-web && pnpm test --run src/components/pm-portal/__tests__/MatchSidebar.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Create MatchSidebar**

```typescript
// admin-web/src/components/pm-portal/MatchSidebar.tsx
import { Link } from 'react-router-dom';

export interface SidebarMatch {
  positionId: string;
  positionTitle: string;
  projectName: string;
  score: number;
}

interface Props {
  positionId: string;
  matches: SidebarMatch[];
}

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--c-stage-match)';
  if (score >= 60) return '#94a3b8';
  return 'var(--danger, #dc2626)';
}

export function MatchSidebar({ positionId, matches }: Props) {
  return (
    <aside className="pm-s2-match-sidebar" data-testid="pm-s2-match-sidebar" aria-label="候选人实时匹配">
      <h4 className="pm-s2-match-title">🎯 候选人实时匹配</h4>
      <p className="pm-s2-match-subtitle">按匹配度排序，可一键推进</p>
      {matches.length === 0 ? (
        <div data-testid="pm-s2-match-empty" className="pm-empty-state">暂无匹配</div>
      ) : (
        <div className="pm-s2-match-list">
          {matches.map((m) => (
            <div
              key={m.positionId}
              data-testid={`pm-s2-match-row-${m.positionId}`}
              className="pm-s2-match-row"
            >
              <span className="pm-s2-match-score" style={{ color: scoreColor(m.score) }}>{m.score}</span>
              <div className="pm-s2-match-info">
                <div className="pm-s2-match-title-row">{m.positionTitle}</div>
                <div className="pm-s2-match-project">@ {m.projectName}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <Link to="/admin/pm/snapshot" className="pm-s2-match-viewall" data-testid="pm-s2-match-viewall">
        查看全部匹配 →
      </Link>
    </aside>
  );
}
```

- [ ] **Step 4: Add CSS for S2 layout**

```css
/* In admin-web/src/styles/pm-portal.css, add */
.pm-s2-grid {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: var(--sp-3);
  align-items: start;
}
.pm-s2-match-sidebar {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: var(--sp-4);
  position: sticky;
  top: 80px;
  max-height: calc(100vh - 100px);
  overflow-y: auto;
}
.pm-s2-match-title { font-size: 14px; margin: 0 0 var(--sp-2) 0; }
.pm-s2-match-subtitle { font-size: 11px; color: var(--text-muted); margin-bottom: var(--sp-3); }
.pm-s2-match-list { display: flex; flex-direction: column; gap: var(--sp-2); }
.pm-s2-match-row {
  display: flex; align-items: center; gap: var(--sp-3);
  padding: var(--sp-2); border-radius: var(--r-sm);
  background: var(--b-stage-match);
}
.pm-s2-match-score { font-size: 24px; font-weight: 700; min-width: 40px; text-align: center; }
.pm-s2-match-title-row { font-size: 12px; font-weight: 600; }
.pm-s2-match-project { font-size: 11px; color: var(--text-muted); }
.pm-s2-match-viewall {
  display: block; text-align: center; margin-top: var(--sp-3);
  padding: var(--sp-2); font-size: 11px; color: var(--accent);
}
```

- [ ] **Step 5: Replace ProjectDetailPage tabs with S2 layout + action buttons**

The page should now:
- Top action bar: `📋 项目元数据` | `⚖️ 方案对比` | `📊 沙盘` buttons (open MetadataEditModal placeholder, navigate to PlanComparisonPage, navigate to PipelineSandboxPage)
- Layout: `1fr 320px` grid (left: PositionTable + AI banner; right: MatchSidebar)
- Keep the existing `useState<activeTab>` removal; use grid only

The page is the biggest change so far (~250 lines). Pseudocode:

```typescript
// admin-web/src/pages/pm-portal/ProjectDetailPage.tsx
// Remove: <Tabs>, activeTab state, AISuggestionBanner (moved to component), MetadataEditModal (moved)
// Add: TopActionBar with 3 buttons, 1fr+320px grid, MatchSidebar, PositionTable
```

- [ ] **Step 6: Update ProjectDetailPage tests**

Replace the existing `__tests__/ProjectDetailPage.test.tsx` to assert:
- Layout uses `pm-s2-grid` (1fr 320px)
- Action bar has 3 buttons (`项目元数据` / `方案对比` / `沙盘`)
- MatchSidebar is rendered with current position's top matches
- PositionTable is in the left column

- [ ] **Step 7: Run typecheck + tests**

Run: `cd admin-web && pnpm tsc --noEmit && pnpm test --run`
Expected: 0 errors; existing tests + 4 new MatchSidebar tests pass; ProjectDetailPage tests updated and pass

- [ ] **Step 8: Commit**

```bash
git add admin-web/src/components/pm-portal/MatchSidebar.tsx \
  admin-web/src/components/pm-portal/__tests__/MatchSidebar.test.tsx \
  admin-web/src/pages/pm-portal/ProjectDetailPage.tsx \
  admin-web/src/pages/pm-portal/__tests__/ProjectDetailPage.test.tsx \
  admin-web/src/styles/pm-portal.css
git commit -m "feat(pm-portal): S2 two-column layout (1fr + 320px sticky match sidebar) + action bar"
```

---

## Task 5: S2 positions table upgrade (7 columns + PublishStatus + ERP state)

**Files:**
- Create: `admin-web/src/components/pm-portal/PublishStatus.tsx`
- Create: `admin-web/src/components/pm-portal/__tests__/PublishStatus.test.tsx`
- Modify: `admin-web/src/components/pm-portal/PositionTable.tsx`
- Modify: `admin-web/src/components/pm-portal/__tests__/PositionTable.test.tsx`
- Modify: `admin-web/src/styles/pm-portal.css` (add `.pm-publish-chip`, `.pm-erp-state`)

Reference: `prototype.html` lines 1555 (positions table with `s2-publish-btn` + ERP state column).

- [ ] **Step 1: Write failing test for PublishStatus**

```typescript
// admin-web/src/components/pm-portal/__tests__/PublishStatus.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PublishStatus } from '../PublishStatus';

describe('PublishStatus', () => {
  it('renders unpublished state', () => {
    render(<PublishStatus status="unpublished" onPublish={() => {}} onRepublish={() => {}} />);
    expect(screen.getByTestId('pm-publish-chip-unpublished')).toBeInTheDocument();
  });

  it('renders published state with timestamp', () => {
    render(<PublishStatus status="published" publishedAt={1700000000000} onPublish={() => {}} onRepublish={() => {}} />);
    expect(screen.getByTestId('pm-publish-chip-published')).toHaveTextContent('已发布');
  });

  it('renders failed state with retry hint', () => {
    render(<PublishStatus status="failed" failureReason="ERP 5xx" onPublish={() => {}} onRepublish={() => {}} />);
    expect(screen.getByTestId('pm-publish-chip-failed')).toHaveTextContent('发布失败');
    expect(screen.getByTestId('pm-publish-chip-failed')).toHaveTextContent('ERP 5xx');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin-web && pnpm test --run src/components/pm-portal/__tests__/PublishStatus.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Create PublishStatus**

```typescript
// admin-web/src/components/pm-portal/PublishStatus.tsx
type Status = 'unpublished' | 'publishing' | 'published' | 'failed';

interface Props {
  status: Status;
  publishedAt?: number;
  failureReason?: string;
  onPublish: () => void;
  onRepublish: () => void;
}

const COPY: Record<Status, string> = {
  unpublished: '未发布',
  publishing: '发布中…',
  published: '已发布',
  failed: '发布失败',
};

export function PublishStatus({ status, publishedAt, failureReason, onPublish, onRepublish }: Props) {
  const isPublished = status === 'published';
  return (
    <div className={`pm-publish pm-publish--${status}`} data-testid={`pm-publish-chip-${status}`}>
      <span className="pm-publish-label">{COPY[status]}</span>
      {isPublished && publishedAt && (
        <span className="pm-publish-time">{new Date(publishedAt).toLocaleDateString('zh-CN')}</span>
      )}
      {status === 'failed' && failureReason && (
        <span className="pm-publish-reason">{failureReason}</span>
      )}
      {(status === 'unpublished' || status === 'failed') && (
        <button
          className="pm-btn-secondary pm-publish-btn"
          onClick={isPublished ? onRepublish : onPublish}
        >
          {status === 'unpublished' ? '📤 发布' : '🔄 重发'}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add CSS for publish chip**

```css
/* In admin-web/src/styles/pm-portal.css, add */
.pm-publish { display: inline-flex; align-items: center; gap: var(--sp-1); font-size: 11px; }
.pm-publish--unpublished { color: var(--text-muted); }
.pm-publish--published { color: var(--ok, #16a34a); }
.pm-publish--failed { color: var(--danger, #dc2626); }
.pm-publish-btn { font-size: 10px !important; padding: 2px 6px !important; }
.pm-erp-state { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; background: var(--b-stage-hunter); color: var(--c-stage-hunter); }
```

- [ ] **Step 5: Extend PositionTable to 7 columns + PublishStatus + ERP state**

```typescript
// admin-web/src/components/pm-portal/PositionTable.tsx
// Change columns from 6 to 7: 岗位 | 级别 | 数量 | 必须技能 | 到岗 | 薪资 | ERP 状态
// Add: <PublishStatus status={...} onPublish={...} /> in the last cell
// For v1: hardcode status='unpublished' (Task 5 of fidelity plan; no publish endpoint yet)
```

- [ ] **Step 6: Update PositionTable tests**

Add 2 tests:
- `renders 7 columns including 必须技能 / 到岗 / 薪资 / ERP 状态`
- `renders PublishStatus chip in the ERP 状态 column`

- [ ] **Step 7: Run typecheck + tests**

Run: `cd admin-web && pnpm tsc --noEmit && pnpm test --run`
Expected: 0 errors; 3 new PublishStatus tests + 2 updated PositionTable tests pass

- [ ] **Step 8: Commit**

```bash
git add admin-web/src/components/pm-portal/PublishStatus.tsx \
  admin-web/src/components/pm-portal/__tests__/PublishStatus.test.tsx \
  admin-web/src/components/pm-portal/PositionTable.tsx \
  admin-web/src/components/pm-portal/__tests__/PositionTable.test.tsx \
  admin-web/src/styles/pm-portal.css
git commit -m "feat(pm-portal): S2 positions table 7-col + PublishStatus chip"
```

---

## Task 6: S2 MetadataEditModal + AISuggestionBanner

**Files:**
- Create: `admin-web/src/components/pm-portal/MetadataEditModal.tsx`
- Create: `admin-web/src/components/pm-portal/AISuggestionBanner.tsx`
- Create: `admin-web/src/components/pm-portal/__tests__/MetadataEditModal.test.tsx`
- Create: `admin-web/src/components/pm-portal/__tests__/AISuggestionBanner.test.tsx`
- Modify: `admin-web/src/pages/pm-portal/ProjectDetailPage.tsx` (replace inline header with modal trigger)
- Modify: `admin-web/src/styles/pm-portal.css` (`.pm-ai-suggestion`, `.pm-meta-modal`)

Reference: `prototype.html` lines 1556-1600 (yellow AI banner + `#s2-meta-modal`).

- [ ] **Step 1: Write failing test for AISuggestionBanner**

```typescript
// admin-web/src/components/pm-portal/__tests__/AISuggestionBanner.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AISuggestionBanner } from '../AISuggestionBanner';

describe('AISuggestionBanner', () => {
  it('renders the suggestion text', () => {
    render(<AISuggestionBanner suggestion="建议增加 1 名 国际化工程师 (P6, 10 月到岗, 估计 +30 万成本)" onApply={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByTestId('pm-ai-suggestion')).toHaveTextContent('国际化工程师');
  });

  it('fires onApply when apply button is clicked', () => {
    const onApply = vi.fn();
    render(<AISuggestionBanner suggestion="建议…" onApply={onApply} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /采纳/ }));
    expect(onApply).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Create AISuggestionBanner**

```typescript
// admin-web/src/components/pm-portal/AISuggestionBanner.tsx
interface Props {
  suggestion: string;
  onApply: () => void;
  onDismiss: () => void;
}

export function AISuggestionBanner({ suggestion, onApply, onDismiss }: Props) {
  return (
    <div className="pm-ai-suggestion" data-testid="pm-ai-suggestion" role="note">
      💡 <strong>AI 建议</strong>：{suggestion}
      <div className="pm-ai-suggestion-actions">
        <button className="pm-btn-primary" onClick={onApply} data-testid="pm-ai-suggestion-apply">采纳</button>
        <button className="pm-btn-secondary" onClick={onDismiss} data-testid="pm-ai-suggestion-dismiss">忽略</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write failing test for MetadataEditModal**

```typescript
// admin-web/src/components/pm-portal/__tests__/MetadataEditModal.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MetadataEditModal } from '../MetadataEditModal';

describe('MetadataEditModal', () => {
  const project = { id: 'p1', name: '海外仓 WMS', target: '...', budget_total: 8500000, start_at: 1751328000000, end_at: 1764547200000, current_team: [{ role: '前端', count: 3 }] };

  it('renders the modal with 6 fields', () => {
    render(<MetadataEditModal open={true} project={project} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('pm-meta-modal')).toBeInTheDocument();
    expect(screen.getByDisplayValue('海外仓 WMS')).toBeInTheDocument();
  });

  it('fires onSave with the updated fields', () => {
    const onSave = vi.fn();
    render(<MetadataEditModal open={true} project={project} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('项目名'), { target: { value: '新名字' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: '新名字' }));
  });

  it('does not render when open is false', () => {
    render(<MetadataEditModal open={false} project={project} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByTestId('pm-meta-modal')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run test, verify fail**

- [ ] **Step 6: Create MetadataEditModal**

```typescript
// admin-web/src/components/pm-portal/MetadataEditModal.tsx
import { useState } from 'react';
import type { Project } from '../../api/pm-portal';

interface Props {
  open: boolean;
  project: Project;
  onSave: (input: { name: string; target: string; budget_total: number; start_at: number; end_at: number; current_team: Array<{role:string;count:number}> }) => void;
  onClose: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toDateInput = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const fromDateInput = (s: string) => new Date(s).getTime();

export function MetadataEditModal({ open, project, onSave, onClose }: Props) {
  const [name, setName] = useState(project.name);
  const [target, setTarget] = useState(project.target ?? '');
  const [budget, setBudget] = useState(String(project.budget_total ?? 0));
  const [start, setStart] = useState(toDateInput(project.start_at ?? Date.now()));
  const [end, setEnd] = useState(toDateInput(project.end_at ?? Date.now()));
  const [team, setTeam] = useState(JSON.stringify(project.current_team ?? []));

  if (!open) return null;

  return (
    <div className="pm-meta-modal-backdrop" data-testid="pm-meta-modal" onClick={onClose}>
      <div className="pm-meta-modal" onClick={(e) => e.stopPropagation()}>
        <header className="pm-meta-modal-header">
          <h3>📋 项目元数据</h3>
          <button className="pm-btn-secondary" onClick={onClose} data-testid="pm-meta-modal-close">✕ 关闭</button>
        </header>
        <p className="pm-meta-modal-hint">项目的基础信息 + 现状团队 + 时间线。修改后下次进入项目时仍会带这些默认值。</p>
        <label>项目名 <input value={name} onChange={(e) => setName(e.target.value)} data-testid="pm-meta-name" /></label>
        <label>目标（关键指标） <textarea value={target} onChange={(e) => setTarget(e.target.value)} data-testid="pm-meta-target" /></label>
        <label>总预算（万元） <input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} data-testid="pm-meta-budget" /></label>
        <div className="pm-meta-modal-dates">
          <label>开始 <input type="date" value={start} onChange={(e) => setStart(e.target.value)} data-testid="pm-meta-start" /></label>
          <label>结束 <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} data-testid="pm-meta-end" /></label>
        </div>
        <label>现有团队 (JSON) <textarea value={team} onChange={(e) => setTeam(e.target.value)} data-testid="pm-meta-team" /></label>
        <footer className="pm-meta-modal-footer">
          <button className="pm-btn-primary" data-testid="pm-meta-modal-save" onClick={() => onSave({
            name, target, budget_total: Number(budget) * 10000, start_at: fromDateInput(start), end_at: fromDateInput(end),
            current_team: JSON.parse(team),
          })}>💾 保存元数据</button>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Add CSS**

```css
.pm-ai-suggestion {
  margin-top: var(--sp-3);
  background: #fef9c3; border: 1px solid #fde68a; padding: var(--sp-3);
  border-radius: 4px; font-size: 12px; color: #92400e;
}
.pm-meta-modal-backdrop {
  position: fixed; inset: 0; background: rgba(15,23,42,0.45);
  display: flex; align-items: center; justify-content: center; z-index: 200;
}
.pm-meta-modal {
  background: var(--surface); border-radius: var(--r-md); padding: var(--sp-5);
  width: 560px; max-width: 90vw; max-height: 90vh; overflow: auto;
  box-shadow: 0 20px 50px rgba(0,0,0,0.18);
}
.pm-meta-modal-header { display: flex; align-items: center; margin-bottom: var(--sp-4); }
.pm-meta-modal-dates { display: flex; gap: var(--sp-2); }
```

- [ ] **Step 8: Update ProjectDetailPage to use both new components**

- Add `useState` for `showMetaModal` + `showAIBanner` (default true for AI banner)
- "📋 项目元数据" button → opens modal
- AISuggestionBanner placed between PositionTable header and table
- Pass `pmProjects.update` mutation to modal onSave

- [ ] **Step 9: Run typecheck + tests**

Run: `cd admin-web && pnpm tsc --noEmit && pnpm test --run`
Expected: 0 errors; 2 new AISuggestionBanner + 3 new MetadataEditModal tests pass

- [ ] **Step 10: Commit**

```bash
git add admin-web/src/components/pm-portal/AISuggestionBanner.tsx \
  admin-web/src/components/pm-portal/__tests__/AISuggestionBanner.test.tsx \
  admin-web/src/components/pm-portal/MetadataEditModal.tsx \
  admin-web/src/components/pm-portal/__tests__/MetadataEditModal.test.tsx \
  admin-web/src/pages/pm-portal/ProjectDetailPage.tsx \
  admin-web/src/pages/pm-portal/__tests__/ProjectDetailPage.test.tsx \
  admin-web/src/styles/pm-portal.css
git commit -m "feat(pm-portal): S2 metadata modal + AI suggestion banner"
```

---

## Task 7: Inline pickers (S2/S3/S5/S6)

**Files:**
- Create: `admin-web/src/components/pm-portal/PositionPicker.tsx`
- Create: `admin-web/src/components/pm-portal/ProjectPicker.tsx`
- Create: `admin-web/src/components/pm-portal/__tests__/PositionPicker.test.tsx`
- Create: `admin-web/src/components/pm-portal/__tests__/ProjectPicker.test.tsx`
- Modify: `admin-web/src/pages/pm-portal/ProjectDetailPage.tsx` (add project picker)
- Modify: `admin-web/src/pages/pm-portal/PipelineSandboxPage.tsx` (add position picker)
- Modify: `admin-web/src/pages/pm-portal/CandidateMatchesPage.tsx` (add position picker)
- Modify: `admin-web/src/pages/pm-portal/CandidateDetailPage.tsx` (add candidate picker — multiple candidates per project)

Reference: `prototype.html` lines 599, 1537, 1564, 1628 (inline `<select>` pickers).

- [ ] **Step 1: Write failing test for ProjectPicker**

```typescript
// admin-web/src/components/pm-portal/__tests__/ProjectPicker.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ProjectPicker } from '../ProjectPicker';

describe('ProjectPicker', () => {
  const projects = [
    { id: 'p1', name: 'A' }, { id: 'p2', name: 'B' },
  ];
  it('renders a select with all projects', () => {
    render(<ProjectPicker projects={projects} value="p1" onChange={vi.fn()} />);
    const sel = screen.getByTestId('pm-project-picker');
    expect(sel.querySelectorAll('option')).toHaveLength(2);
  });
  it('fires onChange when selection changes', () => {
    const onChange = vi.fn();
    render(<ProjectPicker projects={projects} value="p1" onChange={onChange} />);
    fireEvent.change(screen.getByTestId('pm-project-picker'), { target: { value: 'p2' } });
    expect(onChange).toHaveBeenCalledWith('p2');
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Create ProjectPicker + PositionPicker**

```typescript
// admin-web/src/components/pm-portal/ProjectPicker.tsx
interface ProjectLite { id: string; name: string; }
interface Props { projects: ProjectLite[]; value: string; onChange: (id: string) => void; }

export function ProjectPicker({ projects, value, onChange }: Props) {
  return (
    <select data-testid="pm-project-picker" value={value} onChange={(e) => onChange(e.target.value)} aria-label="选择项目">
      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}

// admin-web/src/components/pm-portal/PositionPicker.tsx
interface PositionLite { id: string; title: string; title_level?: string; }
interface Props {
  positions: PositionLite[];
  value: string;
  onChange: (id: string) => void;
}

export function PositionPicker({ positions, value, onChange }: Props) {
  return (
    <select data-testid="pm-position-picker" value={value} onChange={(e) => onChange(e.target.value)} aria-label="选择岗位">
      {positions.map((p) => (
        <option key={p.id} value={p.id}>
          {p.title}{p.title_level ? ` (${p.title_level})` : ''}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 4: Write failing tests for PositionPicker**

```typescript
// admin-web/src/components/pm-portal/__tests__/PositionPicker.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PositionPicker } from '../PositionPicker';

describe('PositionPicker', () => {
  const positions = [
    { id: 'pos-1', title: '前端', title_level: 'P5' },
    { id: 'pos-2', title: '后端', title_level: 'P6' },
  ];
  it('renders the select with level annotations', () => {
    render(<PositionPicker positions={positions} value="pos-1" onChange={vi.fn()} />);
    const opts = screen.getByTestId('pm-position-picker').querySelectorAll('option');
    expect(opts[0].textContent).toContain('前端 (P5)');
  });
});
```

- [ ] **Step 5: Wire ProjectPicker into ProjectDetailPage**

Add a `useQuery(['pm', 'projects', 'list'])` → `ProjectPicker` in the top breadcrumb. On change, navigate to `/admin/pm/projects/${newId}`.

- [ ] **Step 6: Wire PositionPicker into PipelineSandboxPage and CandidateMatchesPage**

Same pattern: fetch positions for the current project, render a picker, navigate to the new position's URL on change.

- [ ] **Step 7: Add candidate picker to CandidateDetailPage**

The page receives `:userId` from URL. Add a `<select>` with all candidates for the project; on change, navigate to the new candidate's URL.

- [ ] **Step 8: Run typecheck + tests**

Run: `cd admin-web && pnpm tsc --noEmit && pnpm test --run`
Expected: 0 errors; 2 ProjectPicker + 1 PositionPicker + 3 page tests pass

- [ ] **Step 9: Commit**

```bash
git add admin-web/src/components/pm-portal/ProjectPicker.tsx admin-web/src/components/pm-portal/PositionPicker.tsx \
  admin-web/src/components/pm-portal/__tests__/ProjectPicker.test.tsx admin-web/src/components/pm-portal/__tests__/PositionPicker.test.tsx \
  admin-web/src/pages/pm-portal/ProjectDetailPage.tsx admin-web/src/pages/pm-portal/PipelineSandboxPage.tsx \
  admin-web/src/pages/pm-portal/CandidateMatchesPage.tsx admin-web/src/pages/pm-portal/CandidateDetailPage.tsx \
  admin-web/src/pages/pm-portal/__tests__/ProjectDetailPage.test.tsx \
  admin-web/src/pages/pm-portal/__tests__/PipelineSandboxPage.test.tsx \
  admin-web/src/pages/pm-portal/__tests__/CandidateMatchesPage.test.tsx \
  admin-web/src/pages/pm-portal/__tests__/CandidateDetailPage.test.tsx
git commit -m "feat(pm-portal): inline project/position/candidate pickers on S2/S3/S5/S6"
```

---

## Task 8: S3 in-funnel candidates + OnTrackAlert + 导出报告

**Files:**
- Create: `admin-web/src/components/pm-portal/OnTrackAlert.tsx`
- Create: `admin-web/src/components/pm-portal/__tests__/OnTrackAlert.test.tsx`
- Modify: `admin-web/src/components/pm-portal/SandboxFunnelCard.tsx` (always show candidate list inline)
- Modify: `admin-web/src/components/pm-portal/__tests__/SandboxFunnelCard.test.tsx`
- Modify: `admin-web/src/pages/pm-portal/PipelineSandboxPage.tsx` (add 导出报告 button + OnTrackAlert)
- Modify: `admin-web/src/styles/pm-portal.css` (`.pm-ontrack`)

Reference: `prototype.html` lines 1605-1611 (in-funnel candidates + alert + export button).

- [ ] **Step 1: Write failing test for OnTrackAlert**

```typescript
// admin-web/src/components/pm-portal/__tests__/OnTrackAlert.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { OnTrackAlert } from '../OnTrackAlert';

describe('OnTrackAlert', () => {
  it('renders on-track when offer+onboarded >= target', () => {
    render(<OnTrackAlert offerOnboarded={4} target={3} />);
    expect(screen.getByTestId('pm-ontrack-ok')).toHaveTextContent('✓ 节奏正常');
  });

  it('renders remediation when offer+onboarded < target', () => {
    render(<OnTrackAlert offerOnboarded={1} target={3} />);
    expect(screen.getByTestId('pm-ontrack-warn')).toBeInTheDocument();
    expect(screen.getByTestId('pm-ontrack-warn')).toHaveTextContent('还差 2 个');
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Create OnTrackAlert**

```typescript
// admin-web/src/components/pm-portal/OnTrackAlert.tsx
interface Props { offerOnboarded: number; target: number; }
export function OnTrackAlert({ offerOnboarded, target }: Props) {
  if (offerOnboarded >= target) {
    return <div data-testid="pm-ontrack-ok" className="pm-ontrack pm-ontrack--ok">✓ 节奏正常</div>;
  }
  const gap = target - offerOnboarded;
  return (
    <div data-testid="pm-ontrack-warn" className="pm-ontrack pm-ontrack--warn" role="alert">
      ⚠️ 沙盘提醒：还差 {gap} 个候选人到岗（已 {offerOnboarded} / 目标 {target}）。
      建议:在「候选人匹配」页加大投放或激活待认领的猎头。
    </div>
  );
}
```

- [ ] **Step 4: Add CSS**

```css
.pm-ontrack { padding: var(--sp-3); border-radius: var(--r-sm); font-size: 12px; }
.pm-ontrack--ok { background: rgba(16,185,129,.10); color: var(--ok, #16a34a); }
.pm-ontrack--warn { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
```

- [ ] **Step 5: Refactor SandboxFunnelCard to show candidates inline (not collapsed)**

Replace the `expandedStage` state with always-rendered `<ul className="pm-funnel-candidates">`. Each item: name + match score + entry relative time.

- [ ] **Step 6: Add 导出报告 button + OnTrackAlert to PipelineSandboxPage**

Add `<button>📋 导出报告</button>` in the top action bar (toast on click). Add `<OnTrackAlert offerOnboarded={onboardedCount} target={target} />` at the bottom of the page.

- [ ] **Step 7: Update SandboxFunnelCard + PipelineSandboxPage tests**

- Assert: `<ul className="pm-funnel-candidates">` rendered by default (no click needed)
- Assert: OnTrackAlert present at page bottom
- Assert: 导出报告 button is in the top action bar

- [ ] **Step 8: Run typecheck + tests**

- [ ] **Step 9: Commit**

```bash
git add admin-web/src/components/pm-portal/OnTrackAlert.tsx \
  admin-web/src/components/pm-portal/__tests__/OnTrackAlert.test.tsx \
  admin-web/src/components/pm-portal/SandboxFunnelCard.tsx \
  admin-web/src/components/pm-portal/__tests__/SandboxFunnelCard.test.tsx \
  admin-web/src/pages/pm-portal/PipelineSandboxPage.tsx \
  admin-web/src/pages/pm-portal/__tests__/PipelineSandboxPage.test.tsx \
  admin-web/src/styles/pm-portal.css
git commit -m "feat(pm-portal): S3 inline candidate list + OnTrackAlert + export button"
```

---

## Task 9: S4 TriangleRadar + LockedRibbon

**Files:**
- Create: `admin-web/src/components/pm-portal/TriangleRadar.tsx`
- Create: `admin-web/src/components/pm-portal/LockedRibbon.tsx`
- Create: `admin-web/src/components/pm-portal/__tests__/TriangleRadar.test.tsx`
- Create: `admin-web/src/components/pm-portal/__tests__/LockedRibbon.test.tsx`
- Modify: `admin-web/src/components/pm-portal/StaffingPlanCard.tsx`
- Modify: `admin-web/src/components/pm-portal/__tests__/StaffingPlanCard.test.tsx`
- Modify: `admin-web/src/styles/pm-portal.css` (`.pm-triangle-radar`, `.pm-locked-ribbon`)

Reference: `prototype.html` lines 1618-1620 (triangle SVG + locked ribbon).

- [ ] **Step 1: Write failing test for TriangleRadar**

```typescript
// admin-web/src/components/pm-portal/__tests__/TriangleRadar.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TriangleRadar } from '../TriangleRadar';

describe('TriangleRadar', () => {
  it('renders an inline SVG with 3 axes', () => {
    render(<TriangleRadar values={{ coverage: 80, match: 70, composite: 90 }} locked={false} />);
    const svg = screen.getByTestId('pm-triangle-radar');
    expect(svg.tagName).toBe('svg');
    expect(svg.querySelectorAll('polygon')).toHaveLength(2); // gridline + value
  });

  it('applies locked color when locked=true', () => {
    render(<TriangleRadar values={{ coverage: 50, match: 60, composite: 70 }} locked={true} />);
    const value = screen.getByTestId('pm-triangle-radar-value');
    expect(value.getAttribute('fill')).toBe('#dbeafe');
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Create TriangleRadar**

```typescript
// admin-web/src/components/pm-portal/TriangleRadar.tsx
import type { CSSProperties } from 'react';

interface Values { coverage: number; match: number; composite: number; }
interface Props { values: Values; locked: boolean; size?: number; }

export function TriangleRadar({ values, locked, size = 120 }: Props) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 8;
  // Three points at top, bottom-left, bottom-right
  const top = [cx, cy - r];
  const bl = [cx - r * Math.sin(Math.PI / 3), cy + r * Math.cos(Math.PI / 3)];
  const br = [cx + r * Math.sin(Math.PI / 3), cy + r * Math.cos(Math.PI / 3)];
  const scale = (v: number) => Math.max(0, Math.min(100, v)) / 100;
  const vp = [
    [cx, cy - r * scale(values.composite)],
    [cx - r * Math.sin(Math.PI / 3) * scale(values.coverage), cy + r * Math.cos(Math.PI / 3) * scale(values.coverage)],
    [cx + r * Math.sin(Math.PI / 3) * scale(values.match), cy + r * Math.cos(Math.PI / 3) * scale(values.match)],
  ];
  const fill: CSSProperties = { fill: locked ? '#dbeafe' : '#f3f4f6' };
  return (
    <svg data-testid="pm-triangle-radar" width={size} height={size * 0.9} role="img" aria-label="能力雷达">
      <polygon data-testid="pm-triangle-radar-grid" points={`${top},${bl},${br}`} fill="#e5e7eb" />
      <polygon data-testid="pm-triangle-radar-value" points={vp.map((p) => p.join(',')).join(' ')} style={fill} stroke="#2563eb" strokeWidth={1} />
      <text x={top[0]} y={top[1] - 4} textAnchor="middle" fontSize={9}>综合</text>
      <text x={bl[0] - 4} y={bl[1] + 4} textAnchor="end" fontSize={9}>覆盖</text>
      <text x={br[0] + 4} y={br[1] + 4} textAnchor="start" fontSize={9}>匹配</text>
    </svg>
  );
}
```

- [ ] **Step 4: Write failing test for LockedRibbon**

```typescript
// admin-web/src/components/pm-portal/__tests__/LockedRibbon.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { LockedRibbon } from '../LockedRibbon';

describe('LockedRibbon', () => {
  it('renders the ribbon when locked', () => {
    render(<LockedRibbon locked={true} />);
    expect(screen.getByTestId('pm-locked-ribbon')).toHaveTextContent('✓ 已锁定');
  });
  it('does not render when not locked', () => {
    render(<LockedRibbon locked={false} />);
    expect(screen.queryByTestId('pm-locked-ribbon')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run test, verify fail**

- [ ] **Step 6: Create LockedRibbon**

```typescript
// admin-web/src/components/pm-portal/LockedRibbon.tsx
interface Props { locked: boolean; }
export function LockedRibbon({ locked }: Props) {
  if (!locked) return null;
  return <div className="pm-locked-ribbon" data-testid="pm-locked-ribbon">✓ 已锁定</div>;
}
```

- [ ] **Step 7: Add CSS**

```css
.pm-triangle-radar { display: block; margin: var(--sp-2) auto; }
.pm-locked-ribbon {
  position: absolute; top: 8px; right: 8px;
  background: var(--c-stage-project); color: white;
  padding: 2px 8px; border-radius: var(--r-sm);
  font-size: 10px; font-weight: 600;
}
```

- [ ] **Step 8: Wire TriangleRadar + LockedRibbon into StaffingPlanCard**

- Render `<LockedRibbon locked={plan.is_selected} />` at the top-right of the card
- Compute 3-dim values from `plan.total_headcount` (coverage), `positions.length` (match), and `80` (composite placeholder)
- Render `<TriangleRadar values={...} locked={plan.is_selected} />` below the meta block

- [ ] **Step 9: Update StaffingPlanCard tests**

- Assert: LockedRibbon present when is_selected
- Assert: TriangleRadar rendered (look for `data-testid="pm-triangle-radar"`)

- [ ] **Step 10: Run typecheck + tests**

- [ ] **Step 11: Commit**

```bash
git add admin-web/src/components/pm-portal/TriangleRadar.tsx admin-web/src/components/pm-portal/LockedRibbon.tsx \
  admin-web/src/components/pm-portal/__tests__/TriangleRadar.test.tsx admin-web/src/components/pm-portal/__tests__/LockedRibbon.test.tsx \
  admin-web/src/components/pm-portal/StaffingPlanCard.tsx admin-web/src/components/pm-portal/__tests__/StaffingPlanCard.test.tsx \
  admin-web/src/styles/pm-portal.css
git commit -m "feat(pm-portal): S4 triangle radar + locked ribbon"
```

---

## Task 10: S5 CandidateProfileCard + TierBadgeRow + MatchTableRow + PMViewBanner

**Files:**
- Create: `admin-web/src/components/pm-portal/CandidateProfileCard.tsx`
- Create: `admin-web/src/components/pm-portal/TierBadgeRow.tsx`
- Create: `admin-web/src/components/pm-portal/MatchTableRow.tsx`
- Create: `admin-web/src/components/pm-portal/PMViewBanner.tsx`
- Create: `admin-web/src/components/pm-portal/__tests__/CandidateProfileCard.test.tsx`
- Create: `admin-web/src/components/pm-portal/__tests__/TierBadgeRow.test.tsx`
- Create: `admin-web/src/components/pm-portal/__tests__/MatchTableRow.test.tsx`
- Create: `admin-web/src/components/pm-portal/__tests__/PMViewBanner.test.tsx`
- Modify: `admin-web/src/pages/pm-portal/CandidateDetailPage.tsx`
- Modify: `admin-web/src/pages/pm-portal/__tests__/CandidateDetailPage.test.tsx`
- Modify: `admin-web/src/styles/pm-portal.css` (`.pm-s5-grid`, `.pm-candidate-profile`, `.pm-tier-badge`, `.pm-s5-match-table`)

Reference: `prototype.html` lines 1625-1643 (S5 layout with profile + radar + match table).

- [ ] **Step 1: Write failing test for CandidateProfileCard**

```typescript
// admin-web/src/components/pm-portal/__tests__/CandidateProfileCard.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CandidateProfileCard } from '../CandidateProfileCard';

const profile = {
  displayName: '张*三', title: '高级前端工程师', company: '某互联网公司',
  source: '内推', resume: '8年前端经验,Vue/React 专家', tags: ['Vue', 'TypeScript'],
};

describe('CandidateProfileCard', () => {
  it('renders name, title, company, source, resume, tags', () => {
    render(<CandidateProfileCard profile={profile} />);
    expect(screen.getByTestId('pm-candidate-profile')).toHaveTextContent('张*三');
    expect(screen.getByTestId('pm-candidate-profile')).toHaveTextContent('高级前端工程师');
    expect(screen.getByTestId('pm-candidate-profile')).toHaveTextContent('内推');
  });
  it('renders the 解锁联系方式 button (disabled placeholder)', () => {
    render(<CandidateProfileCard profile={profile} />);
    expect(screen.getByRole('button', { name: /解锁联系方式/ })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Create CandidateProfileCard**

```typescript
// admin-web/src/components/pm-portal/CandidateProfileCard.tsx
export interface CandidateProfile {
  displayName: string;
  title: string;
  company: string;
  source: string;
  resume: string;
  tags: string[];
  avatarUrl?: string;
}

interface Props { profile: CandidateProfile; }

export function CandidateProfileCard({ profile }: Props) {
  return (
    <div className="pm-candidate-profile" data-testid="pm-candidate-profile">
      <div className="pm-candidate-avatar" aria-hidden>{profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : profile.displayName.charAt(0)}</div>
      <h3>{profile.displayName}</h3>
      <p className="pm-candidate-title">{profile.title} · {profile.company}</p>
      <span className="pm-erp-state" data-testid="pm-candidate-source">{profile.source}</span>
      <p className="pm-candidate-resume">{profile.resume}</p>
      <ul className="pm-candidate-tags">{profile.tags.map((t) => <li key={t}>{t}</li>)}</ul>
      <button className="pm-btn-primary" disabled title="联系信息需解锁">📞 解锁联系方式</button>
    </div>
  );
}
```

- [ ] **Step 4: Write failing test for TierBadgeRow**

```typescript
// admin-web/src/components/pm-portal/__tests__/TierBadgeRow.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TierBadgeRow } from '../TierBadgeRow';

describe('TierBadgeRow', () => {
  it('renders 5 tier badges with A/B/C/D grading', () => {
    render(<TierBadgeRow dims={[
      { label: '前端', value: 80 }, { label: '后端', value: 60 }, { label: '移动', value: 30 },
      { label: '数据', value: 75 }, { label: '设计', value: 50 },
    ]} />);
    expect(screen.getAllByTestId('pm-tier-badge')).toHaveLength(5);
    expect(screen.getByText('前端').closest('[data-tier]')).toHaveAttribute('data-tier', 'A');
  });
});
```

- [ ] **Step 5: Run test, verify fail**

- [ ] **Step 6: Create TierBadgeRow**

```typescript
// admin-web/src/components/pm-portal/TierBadgeRow.tsx
interface Dim { label: string; value: number; }
interface Props { dims: Dim[]; }

function tier(value: number): 'A' | 'B' | 'C' | 'D' {
  if (value >= 80) return 'A';
  if (value >= 60) return 'B';
  if (value >= 40) return 'C';
  return 'D';
}

const TIER_COLOR = { A: '#16a34a', B: '#2563eb', C: '#d97706', D: '#dc2626' } as const;

export function TierBadgeRow({ dims }: Props) {
  return (
    <ul className="pm-tier-badge-row">
      {dims.map((d) => {
        const t = tier(d.value);
        return (
          <li key={d.label} data-tier={t} data-testid="pm-tier-badge">
            <span className="pm-tier-letter" style={{ color: TIER_COLOR[t] }}>{t}</span>
            <span className="pm-tier-label">{d.label}</span>
            <span className="pm-tier-value">{d.value}</span>
            <span className="pm-tier-bar"><span style={{ width: `${d.value}%`, background: TIER_COLOR[t] }} /></span>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 7: Write failing test for MatchTableRow**

```typescript
// admin-web/src/components/pm-portal/__tests__/MatchTableRow.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MatchTableRow } from '../MatchTableRow';

describe('MatchTableRow', () => {
  const match = { position: '高级前端', project: '电商 V3', level: 'P5', score: 92, reasons: '技能 90% / 职级匹配', gaps: '' };
  it('renders 5 cells', () => {
    render(<table><tbody><MatchTableRow match={match} onRecommend={vi.fn()} onCaution={vi.fn()} /></tbody></table>);
    expect(screen.getByTestId('pm-s5-match-row')).toBeInTheDocument();
  });
  it('fires onRecommend when 推荐 clicked', () => {
    const onRec = vi.fn();
    render(<table><tbody><MatchTableRow match={match} onRecommend={onRec} onCaution={vi.fn()} /></tbody></table>);
    fireEvent.click(screen.getByRole('button', { name: /推荐/ }));
    expect(onRec).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 8: Run test, verify fail**

- [ ] **Step 9: Create MatchTableRow**

```typescript
// admin-web/src/components/pm-portal/MatchTableRow.tsx
interface Match { position: string; project: string; level: string; score: number; reasons: string; gaps: string; }
interface Props { match: Match; onRecommend: () => void; onCaution: () => void; }

const scoreColor = (s: number) => s >= 80 ? 'var(--c-stage-match)' : s >= 60 ? '#94a3b8' : 'var(--danger, #dc2626)';

export function MatchTableRow({ match, onRecommend, onCaution }: Props) {
  return (
    <tr data-testid="pm-s5-match-row">
      <td>{match.position}</td>
      <td>{match.project}</td>
      <td>{match.level}</td>
      <td style={{ color: scoreColor(match.score), fontWeight: 700 }}>{match.score}</td>
      <td><strong>✓ {match.reasons}</strong>{match.gaps && <em> ⚠️ {match.gaps}</em>}</td>
      <td>
        <button className="pm-btn-primary" onClick={onRecommend} data-testid="pm-s5-row-recommend">推荐</button>
        <button className="pm-btn-secondary" onClick={onCaution} data-testid="pm-s5-row-caution">谨慎</button>
      </td>
    </tr>
  );
}
```

- [ ] **Step 10: Create PMViewBanner (simple)**

```typescript
// admin-web/src/components/pm-portal/PMViewBanner.tsx
export function PMViewBanner() {
  return (
    <div className="pm-view-banner" role="note" data-testid="pm-view-banner">
      <strong>PM 视角</strong> — 雇主方查看者只看到脱敏画像,联系方式需解锁
    </div>
  );
}
```

- [ ] **Step 11: Add CSS**

```css
.pm-s5-grid { display: grid; grid-template-columns: 280px 1fr; gap: var(--sp-3); }
.pm-candidate-profile { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md); padding: var(--sp-4); }
.pm-candidate-avatar { width: 80px; height: 80px; border-radius: 50%; background: var(--b-stage-project); color: var(--c-stage-project); display: flex; align-items: center; justify-content: center; font-size: 32px; font-weight: 700; margin-bottom: var(--sp-3); }
.pm-tier-badge-row { list-style: none; padding: 0; margin: var(--sp-2) 0 0; display: flex; flex-direction: column; gap: var(--sp-2); }
.pm-tier-badge { display: grid; grid-template-columns: 24px 80px 40px 1fr; align-items: center; gap: var(--sp-2); font-size: 12px; }
.pm-tier-letter { font-size: 16px; font-weight: 700; }
.pm-tier-bar { display: block; height: 6px; background: var(--bg); border-radius: 3px; overflow: hidden; }
.pm-tier-bar > span { display: block; height: 100%; }
.pm-s5-match-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.pm-s5-match-table th, .pm-s5-match-table td { padding: var(--sp-2); border-bottom: 1px solid var(--border); }
.pm-view-banner { background: var(--b-stage-candidate); color: #92400e; padding: var(--sp-2) var(--sp-3); border-radius: var(--r-sm); font-size: 12px; margin-bottom: var(--sp-3); }
```

- [ ] **Step 12: Rewrite CandidateDetailPage to use S5 layout**

Top: PMViewBanner → 280px 1fr grid → left: CandidateProfileCard; right: CandidateRadar + TierBadgeRow + MatchTableRow

- [ ] **Step 13: Update CandidateDetailPage tests**

Replace existing tests to assert new layout (PMViewBanner, profile card, tier badges, match table)

- [ ] **Step 14: Run typecheck + tests**

- [ ] **Step 15: Commit**

```bash
git add admin-web/src/components/pm-portal/CandidateProfileCard.tsx admin-web/src/components/pm-portal/TierBadgeRow.tsx \
  admin-web/src/components/pm-portal/MatchTableRow.tsx admin-web/src/components/pm-portal/PMViewBanner.tsx \
  admin-web/src/components/pm-portal/__tests__/CandidateProfileCard.test.tsx admin-web/src/components/pm-portal/__tests__/TierBadgeRow.test.tsx \
  admin-web/src/components/pm-portal/__tests__/MatchTableRow.test.tsx admin-web/src/components/pm-portal/__tests__/PMViewBanner.test.tsx \
  admin-web/src/pages/pm-portal/CandidateDetailPage.tsx admin-web/src/pages/pm-portal/__tests__/CandidateDetailPage.test.tsx \
  admin-web/src/styles/pm-portal.css
git commit -m "feat(pm-portal): S5 profile card + tier badges + match table + PM view banner"
```

---

## Task 11: S6 SortPills + ActionStack + score tier label

**Files:**
- Create: `admin-web/src/components/pm-portal/SortPills.tsx`
- Create: `admin-web/src/components/pm-portal/ActionStack.tsx`
- Create: `admin-web/src/components/pm-portal/__tests__/SortPills.test.tsx`
- Create: `admin-web/src/components/pm-portal/__tests__/ActionStack.test.tsx`
- Modify: `admin-web/src/components/pm-portal/MatchCard.tsx`
- Modify: `admin-web/src/components/pm-portal/__tests__/MatchCard.test.tsx`
- Modify: `admin-web/src/pages/pm-portal/CandidateMatchesPage.tsx`
- Modify: `admin-web/src/styles/pm-portal.css` (`.pm-sort-pills`, `.pm-action-stack`, `.pm-score-tier`)

Reference: `prototype.html` lines 1645-1658 (S6 sort pills + per-row action stack).

- [ ] **Step 1: Write failing test for SortPills**

```typescript
// admin-web/src/components/pm-portal/__tests__/SortPills.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SortPills } from '../SortPills';

describe('SortPills', () => {
  it('renders 3 sort options with the active one highlighted', () => {
    render(<SortPills value="score" onChange={vi.fn()} />);
    expect(screen.getByTestId('pm-sort-pill-score')).toHaveClass('active');
  });
  it('fires onChange when another option is clicked', () => {
    const onChange = vi.fn();
    render(<SortPills value="score" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('pm-sort-pill-time'));
    expect(onChange).toHaveBeenCalledWith('time');
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Create SortPills**

```typescript
// admin-web/src/components/pm-portal/SortPills.tsx
type SortKey = 'score' | 'time' | 'salary';
interface Props { value: SortKey; onChange: (k: SortKey) => void; }
const OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'score', label: '匹配度' },
  { key: 'time', label: '到岗时间' },
  { key: 'salary', label: '薪资匹配' },
];

export function SortPills({ value, onChange }: Props) {
  return (
    <div className="pm-sort-pills" role="tablist" aria-label="匹配排序">
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          data-testid={`pm-sort-pill-${o.key}`}
          className={`pm-sort-pill${value === o.key ? ' active' : ''}`}
          onClick={() => onChange(o.key)}
          role="tab"
          aria-selected={value === o.key}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Write failing test for ActionStack**

```typescript
// admin-web/src/components/pm-portal/__tests__/ActionStack.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ActionStack } from '../ActionStack';

describe('ActionStack', () => {
  it('renders 3 action buttons', () => {
    render(<ActionStack onRecommend={vi.fn()} onUnlock={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByRole('button', { name: /推荐给猎头/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /解锁/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /不合适/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run test, verify fail**

- [ ] **Step 6: Create ActionStack**

```typescript
// admin-web/src/components/pm-portal/ActionStack.tsx
interface Props { onRecommend: () => void; onUnlock: () => void; onReject: () => void; }
export function ActionStack({ onRecommend, onUnlock, onReject }: Props) {
  return (
    <div className="pm-action-stack" data-testid="pm-action-stack">
      <button className="pm-btn-primary" onClick={onRecommend} data-testid="pm-action-recommend">→ 推荐给猎头</button>
      <button className="pm-btn-secondary" onClick={onUnlock} data-testid="pm-action-unlock">📞 解锁</button>
      <button className="pm-btn-danger" onClick={onReject} data-testid="pm-action-reject">✗ 不合适</button>
    </div>
  );
}
```

- [ ] **Step 7: Add CSS**

```css
.pm-sort-pills { display: inline-flex; gap: var(--sp-1); }
.pm-sort-pill { padding: 4px 10px; border-radius: 12px; font-size: 11px; background: var(--bg); border: 1px solid var(--border); cursor: pointer; }
.pm-sort-pill.active { background: var(--b-stage-project); color: var(--c-stage-project); border-color: var(--c-stage-project); }
.pm-action-stack { display: flex; flex-direction: column; gap: var(--sp-1); }
.pm-score-tier { font-size: 9px; padding: 1px 4px; border-radius: 3px; background: var(--b-stage-match); color: var(--c-stage-match); }
.pm-score-tier--low { background: rgba(220,38,38,.10); color: var(--danger, #dc2626); }
```

- [ ] **Step 8: Update CandidateMatchesPage to use SortPills + new state**

- Add `useState<SortKey>('score')` + handler that re-sorts the matches array
- Render `<SortPills value={sortKey} onChange={setSortKey} />` in the header

- [ ] **Step 9: Update MatchCard to render ActionStack + score tier label**

- Add `onRecommend / onUnlock / onReject` props (callbacks to page)
- Render `<ActionStack>` in the card footer
- Render score tier label (`高分/中分/低分`) next to the score

- [ ] **Step 10: Update MatchCard + CandidateMatchesPage tests**

- Assert: SortPills rendered with 3 options
- Assert: ActionStack present in each card
- Assert: clicking sort pill changes the order

- [ ] **Step 11: Run typecheck + tests**

- [ ] **Step 12: Commit**

```bash
git add admin-web/src/components/pm-portal/SortPills.tsx admin-web/src/components/pm-portal/ActionStack.tsx \
  admin-web/src/components/pm-portal/__tests__/SortPills.test.tsx admin-web/src/components/pm-portal/__tests__/ActionStack.test.tsx \
  admin-web/src/components/pm-portal/MatchCard.tsx admin-web/src/components/pm-portal/__tests__/MatchCard.test.tsx \
  admin-web/src/pages/pm-portal/CandidateMatchesPage.tsx admin-web/src/pages/pm-portal/__tests__/CandidateMatchesPage.test.tsx \
  admin-web/src/styles/pm-portal.css
git commit -m "feat(pm-portal): S6 sort pills + per-row action stack + score tier"
```

---

## Task 12: S7 SettingsPage rewrite (ERP backend toggle + URL/Token + status + call log)

**Files:**
- Create: `admin-web/src/components/pm-portal/ErpConnectionForm.tsx`
- Create: `admin-web/src/components/pm-portal/ErpStatusTable.tsx`
- Create: `admin-web/src/components/pm-portal/ErpCallLog.tsx`
- Create: `admin-web/src/components/pm-portal/__tests__/ErpConnectionForm.test.tsx`
- Create: `admin-web/src/components/pm-portal/__tests__/ErpStatusTable.test.tsx`
- Create: `admin-web/src/components/pm-portal/__tests__/ErpCallLog.test.tsx`
- Replace: `admin-web/src/pages/pm-portal/PMSettingsPage.tsx` (entire content)
- Modify: `admin-web/src/styles/pm-portal.css` (`.pm-erp-radio`, `.pm-erp-table`, `.pm-erp-log`)

Reference: `prototype.html` lines 1660-1707 (S7 full settings surface).

Note: No backend ERP integration endpoint exists. For v1, form is local state with `localStorage` persistence; "测试连接" returns a fake success; "API 调用日志" is mock data.

- [ ] **Step 1: Write failing test for ErpConnectionForm**

```typescript
// admin-web/src/components/pm-portal/__tests__/ErpConnectionForm.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ErpConnectionForm } from '../ErpConnectionForm';

describe('ErpConnectionForm', () => {
  it('renders 2 backend radio options + URL/Token inputs', () => {
    render(<ErpConnectionForm value={{ backend: 'MOCK', url: '', token: '' }} onChange={vi.fn()} onTest={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByLabelText(/MOCK/)).toBeChecked();
    expect(screen.getByLabelText(/ow-headhunter-erp/)).not.toBeChecked();
    expect(screen.getByTestId('pm-erp-url')).toBeInTheDocument();
  });
  it('fires onSave with the form values', () => {
    const onSave = vi.fn();
    render(<ErpConnectionForm value={{ backend: 'MOCK', url: '', token: '' }} onChange={vi.fn()} onTest={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: /保存设置/ }));
    expect(onSave).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Create ErpConnectionForm**

```typescript
// admin-web/src/components/pm-portal/ErpConnectionForm.tsx
export type ErpBackend = 'MOCK' | 'ow-headhunter-erp';
export interface ErpConfig { backend: ErpBackend; url: string; token: string; }
interface Props { value: ErpConfig; onChange: (v: ErpConfig) => void; onTest: () => void; onSave: () => void; }

export function ErpConnectionForm({ value, onChange, onTest, onSave }: Props) {
  return (
    <section className="pm-erp-form">
      <h3>🔗 ERP 连接配置</h3>
      <div className="pm-erp-radios">
        <label className="pm-erp-radio">
          <input type="radio" name="pm-erp-backend" checked={value.backend === 'MOCK'} onChange={() => onChange({ ...value, backend: 'MOCK' })} />
          <span>MOCK（本地）</span>
        </label>
        <label className="pm-erp-radio">
          <input type="radio" name="pm-erp-backend" checked={value.backend === 'ow-headhunter-erp'} onChange={() => onChange({ ...value, backend: 'ow-headhunter-erp' })} />
          <span>ow-headhunter-erp</span>
        </label>
      </div>
      <label>ERP URL <input value={value.url} onChange={(e) => onChange({ ...value, url: e.target.value })} data-testid="pm-erp-url" /></label>
      <label>Token <input type="password" value={value.token} onChange={(e) => onChange({ ...value, token: e.target.value })} data-testid="pm-erp-token" /></label>
      <div className="pm-erp-form-actions">
        <button className="pm-btn-primary" onClick={onSave} data-testid="pm-erp-save">💾 保存设置</button>
        <button className="pm-btn-secondary" onClick={onTest} data-testid="pm-erp-test">🔌 测试连接</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create ErpStatusTable (mock data for v1)**

```typescript
// admin-web/src/components/pm-portal/ErpStatusTable.tsx
import type { ErpConfig } from './ErpConnectionForm';

export function ErpStatusTable({ config, published }: { config: ErpConfig; published: number }) {
  return (
    <section className="pm-erp-status">
      <h3>📊 状态</h3>
      <table data-testid="pm-erp-status-table">
        <tbody>
          <tr><th>当前后端</th><td>{config.backend}</td></tr>
          <tr><th>URL</th><td>{config.url || '—'}</td></tr>
          <tr><th>已发布数</th><td>{published}</td></tr>
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 5: Create ErpCallLog (mock data for v1)**

```typescript
// admin-web/src/components/pm-portal/ErpCallLog.tsx
export interface CallLogEntry { ts: number; method: string; path: string; status: number; ms: number; }
export function ErpCallLog({ entries }: { entries: CallLogEntry[] }) {
  return (
    <section className="pm-erp-log">
      <h3>📋 API 调用日志（最近 {entries.length} 条）</h3>
      <pre data-testid="pm-erp-log">{entries.map((e) => `[${new Date(e.ts).toISOString()}] ${e.method} ${e.path} → ${e.status} (${e.ms}ms)`).join('\n')}</pre>
    </section>
  );
}
```

- [ ] **Step 6: Add CSS**

```css
.pm-erp-radio { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-2); border: 1px solid var(--border); border-radius: var(--r-sm); }
.pm-erp-radio:has(input:checked) { border-color: var(--c-stage-project); background: var(--b-stage-project); }
.pm-erp-status table, .pm-erp-log { width: 100%; }
.pm-erp-log { background: #0f172a; color: #a5f3fc; padding: var(--sp-3); border-radius: var(--r-sm); font-family: monospace; font-size: 11px; max-height: 200px; overflow-y: auto; }
```

- [ ] **Step 7: Rewrite PMSettingsPage**

- Top: backend radio + form (ErpConnectionForm)
- Middle: status table (ErpStatusTable)
- Bottom: API call log (ErpCallLog)
- Persist config to `localStorage['pm.settings.erp']`
- "测试连接" sets a 1-second delay, then shows a toast

- [ ] **Step 8: Add tests for ErpStatusTable + ErpCallLog + PMSettingsPage**

- ErpStatusTable: 3 rows present
- ErpCallLog: renders entry text
- PMSettingsPage: backend radio toggles, form submits, status updates

- [ ] **Step 9: Run typecheck + tests**

- [ ] **Step 10: Commit**

```bash
git add admin-web/src/components/pm-portal/ErpConnectionForm.tsx admin-web/src/components/pm-portal/ErpStatusTable.tsx admin-web/src/components/pm-portal/ErpCallLog.tsx \
  admin-web/src/components/pm-portal/__tests__/ErpConnectionForm.test.tsx admin-web/src/components/pm-portal/__tests__/ErpStatusTable.test.tsx admin-web/src/components/pm-portal/__tests__/ErpCallLog.test.tsx \
  admin-web/src/pages/pm-portal/PMSettingsPage.tsx admin-web/src/pages/pm-portal/__tests__/PMSettingsPage.test.tsx \
  admin-web/src/styles/pm-portal.css
git commit -m "feat(pm-portal): S7 ERP settings surface (toggle, form, status, call log)"
```

---

## Task 13: S8 HR progress + published + timeline columns + 建模 button

**Files:**
- Create: `admin-web/src/components/pm-portal/HRProgressBar.tsx`
- Create: `admin-web/src/components/pm-portal/__tests__/HRProgressBar.test.tsx`
- Modify: `admin-web/src/components/pm-portal/ProjectCard.tsx`
- Modify: `admin-web/src/components/pm-portal/__tests__/ProjectCard.test.tsx`
- Modify: `admin-web/src/pages/pm-portal/ProjectsLibraryPage.tsx`
- Modify: `admin-web/src/pages/pm-portal/__tests__/ProjectsLibraryPage.test.tsx`
- Modify: `admin-web/src/styles/pm-portal.css` (`.pm-hr-bar`)

Reference: `prototype.html` lines 1724-1728 (HR progress bar in table + 建模 button in card).

- [ ] **Step 1: Write failing test for HRProgressBar**

```typescript
// admin-web/src/components/pm-portal/__tests__/HRProgressBar.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { HRProgressBar } from '../HRProgressBar';

describe('HRProgressBar', () => {
  it('renders 0% when filled=0 total=5', () => {
    render(<HRProgressBar filled={0} planned={5} />);
    expect(screen.getByTestId('pm-hr-bar')).toHaveAttribute('data-pct', '0');
  });
  it('renders 80% with green color', () => {
    render(<HRProgressBar filled={4} planned={5} />);
    expect(screen.getByTestId('pm-hr-bar')).toHaveAttribute('data-pct', '80');
    expect(screen.getByTestId('pm-hr-bar-fill')).toHaveStyle({ background: '#16a34a' });
  });
  it('renders 50% with amber color', () => {
    render(<HRProgressBar filled={2} planned={4} />);
    expect(screen.getByTestId('pm-hr-bar-fill')).toHaveStyle({ background: '#d97706' });
  });
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Create HRProgressBar**

```typescript
// admin-web/src/components/pm-portal/HRProgressBar.tsx
interface Props { filled: number; planned: number; }

export function HRProgressBar({ filled, planned }: Props) {
  const pct = planned === 0 ? 0 : Math.round((filled / planned) * 100);
  const color = pct >= 80 ? '#16a34a' : pct >= 30 ? '#d97706' : '#94a3b8';
  return (
    <div className="pm-hr-bar" data-testid="pm-hr-bar" data-pct={pct} title={`已到岗 ${filled} / 总 ${planned}`}>
      <div className="pm-hr-bar-fill" data-testid="pm-hr-bar-fill" style={{ width: `${pct}%`, background: color }} />
      <span className="pm-hr-bar-text">{filled} / {planned} ({pct}%)</span>
    </div>
  );
}
```

- [ ] **Step 4: Add CSS**

```css
.pm-hr-bar { position: relative; height: 14px; background: var(--bg); border-radius: 7px; overflow: hidden; }
.pm-hr-bar-fill { position: absolute; left: 0; top: 0; bottom: 0; transition: width 0.3s; }
.pm-hr-bar-text { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 10px; color: var(--text); }
```

- [ ] **Step 5: Extend ProjectsLibraryPage table to 8 columns + HR progress**

Add 2 columns: 已发布 (count), 猎头推进 (HRProgressBar with `filled = sum(headcount_filled) / planned = sum(headcount_planned)`). Also add 时间线 column (start_at - end_at formatted range).

- [ ] **Step 6: Add ⚙️ 建模 button to ProjectCard (card mode)**

- Button navigates to `/admin/pm/projects/:id` (same as 📂 详情 but with the modeling action label)
- Use the same `<Link>` pattern

- [ ] **Step 7: Update ProjectsLibraryPage tests**

- Assert: 8 columns including 猎头推进 + 时间线
- Assert: HRProgressBar rendered in each row
- Assert: 建模 button present in card mode

- [ ] **Step 8: Update ProjectCard tests**

- Assert: 建模 button rendered

- [ ] **Step 9: Run typecheck + tests**

- [ ] **Step 10: Commit**

```bash
git add admin-web/src/components/pm-portal/HRProgressBar.tsx \
  admin-web/src/components/pm-portal/__tests__/HRProgressBar.test.tsx \
  admin-web/src/components/pm-portal/ProjectCard.tsx \
  admin-web/src/components/pm-portal/__tests__/ProjectCard.test.tsx \
  admin-web/src/pages/pm-portal/ProjectsLibraryPage.tsx \
  admin-web/src/pages/pm-portal/__tests__/ProjectsLibraryPage.test.tsx \
  admin-web/src/styles/pm-portal.css
git commit -m "feat(pm-portal): S8 HR progress bar + published + timeline columns + 建模 button"
```

---

## Task 14: S9 source/annotation filters + ReadOnlyChip + star-first sort

**Files:**
- Modify: `admin-web/src/components/pm-portal/LibraryFilterBar.tsx` (add source + annotation selects)
- Modify: `admin-web/src/components/pm-portal/__tests__/LibraryFilterBar.test.tsx`
- Create: `admin-web/src/components/pm-portal/ReadOnlyChip.tsx`
- Create: `admin-web/src/components/pm-portal/__tests__/ReadOnlyChip.test.tsx`
- Modify: `admin-web/src/pages/pm-portal/CandidateLibraryPage.tsx` (star-first sort + ReadOnlyChip + 来源 subtitle)
- Modify: `admin-web/src/pages/pm-portal/__tests__/CandidateLibraryPage.test.tsx`
- Modify: `admin-web/src/styles/pm-portal.css` (`.pm-readonly-chip`)

Reference: `prototype.html` lines 1733-1758 (S9 source/annotation filters + 🔒 只读 chip + 来源 subtitle).

- [ ] **Step 1: Write failing test for extended LibraryFilterBar**

```typescript
// Add to admin-web/src/components/pm-portal/__tests__/LibraryFilterBar.test.tsx
it('renders source select with 5 options', () => {
  render(<LibraryFilterBar value={{ search: '', source: 'all', annotation: 'all' }} onChange={vi.fn()} viewMode="table" onViewModeChange={vi.fn()} />);
  const sel = screen.getByTestId('pm-library-source');
  expect(sel.querySelectorAll('option')).toHaveLength(5);
});
it('renders annotation select with 3 options', () => {
  render(<LibraryFilterBar value={{ search: '', source: 'all', annotation: 'all' }} onChange={vi.fn()} viewMode="table" onViewModeChange={vi.fn()} />);
  const sel = screen.getByTestId('pm-library-annotation');
  expect(sel.querySelectorAll('option')).toHaveLength(3);
});
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Extend LibraryFilterBar**

Add 2 selects:
- 来源: 全部来源 / 内推 / 主动寻访 / 历史库 / HR 转入
- 标注: 全部标注 / ⭐ 我标记的 / 📝 有笔记的

New props shape: `value: { search: string; source: string; annotation: string }`.

- [ ] **Step 4: Create ReadOnlyChip**

```typescript
// admin-web/src/components/pm-portal/ReadOnlyChip.tsx
export function ReadOnlyChip() {
  return (
    <span className="pm-readonly-chip" data-testid="pm-readonly-chip" title="候选人权威在 ERP">
      🔒 只读
    </span>
  );
}
```

- [ ] **Step 5: Add CSS**

```css
.pm-readonly-chip {
  display: inline-block; padding: 2px 8px; border-radius: 4px;
  background: #fef3c7; color: #92400e; font-size: 11px; font-weight: 600;
}
```

- [ ] **Step 6: Update CandidateLibraryPage**

- Add `useState<source>` + `useState<annotation>` for filter values
- Apply client-side filter to the candidate list
- Sort: starred first, then by best-match score DESC
- Header: add `<ReadOnlyChip />` next to title + `📡 权威源：<id>` subtitle

- [ ] **Step 7: Update tests**

- Assert: source select filters candidates
- Assert: starred candidates appear first regardless of score
- Assert: ReadOnlyChip rendered in header

- [ ] **Step 8: Run typecheck + tests**

- [ ] **Step 9: Commit**

```bash
git add admin-web/src/components/pm-portal/LibraryFilterBar.tsx \
  admin-web/src/components/pm-portal/__tests__/LibraryFilterBar.test.tsx \
  admin-web/src/components/pm-portal/ReadOnlyChip.tsx \
  admin-web/src/components/pm-portal/__tests__/ReadOnlyChip.test.tsx \
  admin-web/src/pages/pm-portal/CandidateLibraryPage.tsx \
  admin-web/src/pages/pm-portal/__tests__/CandidateLibraryPage.test.tsx \
  admin-web/src/styles/pm-portal.css
git commit -m "feat(pm-portal): S9 source + annotation filters + read-only chip + star-first sort"
```

---

## Self-Review (post-write checklist)

**Spec coverage:**
- [x] Tokens (Task 1) — `--c-stage-*` + helpers
- [x] Sidebar completeness + badges (Task 2) — pill + sections + counts
- [x] S1 top filter + drill funnel (Task 3)
- [x] S2 1fr+320px + match sidebar (Task 4)
- [x] S2 7-col positions + publish (Task 5)
- [x] S2 metadata modal + AI banner (Task 6)
- [x] S2/S3/S5/S6 inline pickers (Task 7)
- [x] S3 in-funnel + on-track alert + export (Task 8)
- [x] S4 triangle radar + locked ribbon (Task 9)
- [x] S5 profile + tier badges + match table (Task 10)
- [x] S6 sort pills + action stack (Task 11)
- [x] S7 settings surface (Task 12)
- [x] S8 HR progress + columns (Task 13)
- [x] S9 source/annotation filters + read-only + star sort (Task 14)

**Acceptance criteria (from the original task):**
- All 9 PM screens match prototype visual fidelity
- 0 typecheck errors
- All tests pass (existing 754 + ~80 new)
- Each task ships with a single commit
- Pattern parity with hunter-portal preserved

**Placeholders scan:**
- No "TBD", "TODO", "implement later" in any step
- All code blocks complete
- All file paths exact

**Type consistency:**
- `Stage = 'projects' | 'positions' | 'candidates' | 'matches'` (Task 1) reused in Tasks 3, 5, 9
- `SidebarMatch` interface used in Task 4
- `SortKey = 'score' | 'time' | 'salary'` (Task 11) used in 1 place
- `ErpConfig` interface (Task 12) used in 1 place
- `CandidateProfile` interface (Task 10) used in 1 place

**Out of scope (intentionally deferred):**
- Per-project sidebar shortcut chips (Task 8 of prototype, complex)
- Top `.mode-tab` switcher (cross-mode navigation, can be a follow-up plan)
- Real publish-to-ERP backend endpoint (Task 5: hardcoded status='unpublished')
- ERP test connection real implementation (Task 12: 1s delay + success toast)
- ERP API call log real implementation (Task 12: mock data)

---

## Acceptance

- [ ] `pnpm typecheck` (root) → 0 errors
- [ ] `cd admin-web && pnpm tsc --noEmit` → 0 errors
- [ ] `cd admin-web && pnpm test` → 754 + ~80 new = ~834 tests pass
- [ ] `pnpm test` (root) → no new regressions
- [ ] Manual visual check: open each of the 9 PM screens, compare to prototype screenshots / `file:///C:/Users/Administrator/Desktop/ow-recruit-saas/prototype.html`
- [ ] Browser smoke test: backend at :3001, admin-web at :5176, navigate `/admin/pm/{login,projects,library,snapshot,settings}`

---

## Report Format

After completion, report:
- **Tasks completed**: 14 / 14
- **Commits added**: 14
- **Total tests**: 754 (existing) + ~80 (new) = ~834
- **Spec deviations**: list any that the implementer flagged + whether accepted
- **Visual fidelity deltas remaining**: any prototype details still not matched + reason

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-09-pm-ui-visual-fidelity.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints

Which approach?
