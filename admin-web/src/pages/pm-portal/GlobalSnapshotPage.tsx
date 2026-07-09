import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { pmSnapshot, type SnapshotSummary } from '../../api/pm-portal';
import { TopFilterBar } from '../../components/pm-portal/TopFilterBar';
import { DrillFunnelCard } from '../../components/pm-portal/DrillFunnelCard';
import { ActivityFeed } from '../../components/pm-portal/ActivityFeed';
import type { Stage } from '../../components/pm-portal/stage-tokens';

// ============================================================================
// GlobalSnapshotPage (Task 3 / S1 redesign)
// ============================================================================
//
// The PM Workbench home page. Two-part layout:
//   1. TopFilterBar — slim filter strip pinned to the top of the page
//   2. Horizontal drill funnel — 4 DrillFunnelCards in canonical order
//      (projects → positions → candidates → matches) separated by `→`
//      arrows. Each card is clickable and drills into the relevant page.
//   3. Activity feed — last 24h HR activity events (reused as-is from
//      Task 12).
//
// Drill-through destinations (per the S1 prototype):
//   projects    → /admin/pm/projects
//   positions   → /admin/pm/snapshot  (placeholder — future positions list)
//   candidates  → /admin/pm/library
//   matches     → /admin/pm/snapshot  (placeholder)
//
// Routing
// -------
// /admin/pm/snapshot. NOT registered in App.tsx yet — Task 17 wires the
// route. For now the test file mounts the page directly via
// MemoryRouter.

const STAGES: Stage[] = ['projects', 'positions', 'candidates', 'matches'];
const ORDINALS = ['①', '②', '③', '④'] as const;

const STATUS_LABEL: Record<string, string> = {
  planning: '规划中',
  active: '招聘中',
  paused: '已暂停',
  completed: '已完成',
  cancelled: '已取消',
  open: '开放',
  paused_position: '暂停中',
  filled: '已招满',
};

export function GlobalSnapshotPage() {
  // ---- Local UI state ----
  // The 3 filter values live in local state until the backend exposes
  // the `?range=&status=&project_id=` query params on `/v1/pm/snapshot`
  // (post-Task 14). At that point these can be hoisted into the URL.
  const [project, setProject] = useState('全部');
  const [status, setStatus] = useState('进行中');
  const [range, setRange] = useState('近 90 天');

  // ---- Network: snapshot ----
  // Auto-refresh is OFF in v1 (the user clicks "刷新" to pull fresh
  // data). The `refetchInterval` knob is reserved for the stretch goal
  // described in the plan.
  const snapshotQuery = useQuery<SnapshotSummary>({
    queryKey: ['pm', 'snapshot'],
    queryFn: () => pmSnapshot.get(),
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  // ---- Navigation ----
  // The page uses `useNavigate()` (not `window.location.href`) so the
  // react-router lifecycle stays in control — same convention Task 2
  // adopted for the sidebar pill.
  const navigate = useNavigate();

  // ---- Handlers ----
  const handleRefresh = () => {
    snapshotQuery.refetch();
  };

  const handleExport = () => {
    // v2 of the snapshot will support CSV / Excel export. Until then
    // show a friendly placeholder so the user knows the action exists.
    window.alert('导出 v2 即将上线');
  };

  const handleCreate = () => {
    navigate('/admin/pm/projects?new=1');
  };

  const drillTo = (stage: Stage) => {
    switch (stage) {
      case 'projects':
        navigate('/admin/pm/projects');
        break;
      case 'candidates':
        navigate('/admin/pm/library');
        break;
      case 'positions':
      case 'matches':
      default:
        // Placeholder — the dedicated positions / matches pages are
        // post-Task 3 work. Stay on the snapshot so the click feels
        // honest.
        navigate('/admin/pm/snapshot');
        break;
    }
  };

  // ---- Render: loading ----
  if (snapshotQuery.isLoading) {
    return (
      <div className="pm-page pm-snapshot" data-testid="pm-snapshot-loading">
        加载中…
      </div>
    );
  }

  // ---- Render: error ----
  if (snapshotQuery.isError) {
    return (
      <div className="pm-page pm-snapshot" data-testid="pm-snapshot-error-root">
        <header className="pm-snapshot-header">
          <h1 className="pm-snapshot-title">📊 全局快照 · 跨项目鸟瞰</h1>
        </header>
        <div className="pm-snapshot-error" data-testid="pm-snapshot-error">
          加载失败:{String((snapshotQuery.error as Error)?.message ?? '未知错误')}
        </div>
      </div>
    );
  }

  // ---- Render: success ----
  const data = snapshotQuery.data;
  if (!data) {
    return (
      <div className="pm-page pm-snapshot" data-testid="pm-snapshot-loading">
        加载中…
      </div>
    );
  }

  const f = data.funnel;
  const counts: Record<Stage, number> = {
    projects: f.projects.total,
    positions: f.positions.total,
    candidates: f.candidates.total,
    matches: f.matches.total,
  };

  const subItems = (s: Stage): Array<{ label: string; value: number }> => {
    if (s === 'projects') {
      return Object.entries(f.projects.by_status).map(([k, v]) => ({
        label: STATUS_LABEL[k] ?? k,
        value: v,
      }));
    }
    if (s === 'positions') {
      return Object.entries(f.positions.by_status).map(([k, v]) => ({
        label: STATUS_LABEL[k] ?? k,
        value: v,
      }));
    }
    if (s === 'candidates') {
      return [{ label: '已脱敏', value: f.candidates.distinct }];
    }
    // matches
    return [{ label: '平均分', value: f.matches.avg_score }];
  };

  return (
    <div className="pm-page pm-snapshot" data-testid="pm-snapshot-root">
      <TopFilterBar
        project={project}
        status={status}
        range={range}
        onProjectChange={setProject}
        onStatusChange={setStatus}
        onRangeChange={setRange}
        onRefresh={handleRefresh}
        onExport={handleExport}
        onCreate={handleCreate}
      />

      <h2 className="pm-snapshot-title" data-testid="pm-snapshot-title">
        📊 全局快照 · 跨项目鸟瞰
      </h2>
      <p className="pm-snapshot-hint">日常请用 📁 项目详情</p>

      <div className="pm-funnel-pipeline" data-testid="pm-funnel-pipeline">
        {STAGES.map((s, i) => (
          <span key={s} style={{ display: 'contents' }}>
            <DrillFunnelCard
              stage={s}
              ordinal={ORDINALS[i]}
              count={counts[s]}
              subItems={subItems(s)}
              onClick={() => drillTo(s)}
            />
            {i < STAGES.length - 1 && (
              <span className="pm-funnel-arrow" aria-hidden="true">→</span>
            )}
          </span>
        ))}
      </div>

      <div className="pm-snapshot-tip" data-testid="pm-snapshot-tip">
        💡 点击任一阶段卡片下钻查看详情 · 当前画布：项目级
      </div>

      <section
        className="pm-snapshot-section"
        data-testid="pm-snapshot-activity-section"
        aria-label="近 24 小时活动"
      >
        <h3 className="pm-snapshot-section-title">近 24 小时活动</h3>
        <ActivityFeed events={data.activity} />
      </section>
    </div>
  );
}