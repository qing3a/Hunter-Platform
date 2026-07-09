import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  employerDashboard,
  type DashboardData,
  formatCnyCents,
} from '../../api/employer';
import { EmployerKPICard } from '../../components/employer-portal/EmployerKPICard';

// ============================================================================
// EmployerDashboardPage (Phase 3c, Task 4)
// ============================================================================
//
// The Employer Panel home page. Single-purpose: render the seven KPI tiles
// that the backend's `GET /v1/employer-panel/dashboard` endpoint returns
// (see src/main/modules/employer/dashboard.ts → DashboardDataSchema in
// src/main/schemas/employer-panel.ts).
//
// Layout:
//   1. Page header — "雇主工作台" title + refresh button
//   2. 7-tile KPI grid in canonical order:
//        活跃工作 / 开放岗位 / 本月浏览 / 表达兴趣数 / 解锁数 / 成交数 / 本月花费
//      Each tile is an EmployerKPICard with a per-counter accent.
//   3. Quick-action row — three buttons that bounce to the dedicated
//      sub-pages (Tasks 5-9 will replace the placeholders with real
//      screens). Tasks 5-9 will also drill the KPI tiles themselves.
//
// Auto-refresh is OFF in v1 — the user clicks "刷新" to pull fresh data.
// The `refetchInterval` knob is reserved for the post-Task-9 stretch goal
// (the polling cadence is controlled there).

// ---- KPI tile definitions ----

interface KpiSpec {
  /** Stable key — drives the data-testid `employer-kpi-<id>`. */
  id: string;
  /** Field on `DashboardData` we read the integer from. */
  key: keyof DashboardData;
  /** Display label. */
  label: string;
  /** Accent colour (mirrors the PM dashboard's tile palette). */
  accent: 'green' | 'blue' | 'amber' | 'purple';
  /** Optional sub-caption (used by "本月花费" for the ERP source line). */
  subText?: string;
  /** Format the integer counter as a string. */
  format: (n: number) => string;
}

const KPIS: KpiSpec[] = [
  { id: 'active-jobs', key: 'active_jobs', label: '活跃工作', accent: 'blue', format: String },
  { id: 'open-positions', key: 'open_positions', label: '开放岗位', accent: 'blue', format: String },
  { id: 'candidates-viewed', key: 'candidates_viewed_this_month', label: '本月浏览', accent: 'purple', format: String },
  { id: 'interested', key: 'interested_count', label: '表达兴趣数', accent: 'amber', format: String },
  { id: 'unlocked', key: 'unlocked_count', label: '解锁数', accent: 'amber', format: String },
  { id: 'placements', key: 'placements_count', label: '成交数', accent: 'green', format: String },
  // 7th tile — currency. S7 will surface the ERP source id here.
  {
    id: 'spend',
    key: 'spend_this_month',
    label: '本月花费',
    accent: 'green',
    format: formatCnyCents,
    // subText reserved for S7 ERP settings — placeholder so the slot is
    // wired through the test surface today.
    subText: undefined,
  },
];

export function EmployerDashboardPage() {
  // ---- Network: dashboard ----
  // Single GET on mount; manual refresh only.
  const dashboardQuery = useQuery<DashboardData>({
    queryKey: ['employer', 'dashboard'],
    queryFn: () => employerDashboard.get(),
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  // ---- Navigation ----
  const navigate = useNavigate();

  // ---- Handlers ----
  const handleRefresh = () => {
    dashboardQuery.refetch();
  };

  // ---- Render: loading ----
  if (dashboardQuery.isLoading) {
    return (
      <div className="employer-dashboard" data-testid="employer-dashboard-loading">
        加载中…
      </div>
    );
  }

  // ---- Render: error ----
  if (dashboardQuery.isError) {
    return (
      <div className="employer-dashboard" data-testid="employer-dashboard-error-root">
        <header className="employer-dashboard-header">
          <h1 className="employer-dashboard-title">🏢 雇主工作台</h1>
          <button
            type="button"
            className="employer-dashboard-refresh"
            data-testid="employer-dashboard-refresh"
            onClick={handleRefresh}
          >
            ↻ 刷新
          </button>
        </header>
        <div className="employer-dashboard-error" data-testid="employer-dashboard-error">
          加载失败:{String((dashboardQuery.error as Error)?.message ?? '未知错误')}
        </div>
      </div>
    );
  }

  // ---- Render: success ----
  const data = dashboardQuery.data;
  if (!data) {
    return (
      <div className="employer-dashboard" data-testid="employer-dashboard-loading">
        加载中…
      </div>
    );
  }

  return (
    <div className="employer-dashboard" data-testid="employer-dashboard-root">
      <header className="employer-dashboard-header">
        <h1 className="employer-dashboard-title" data-testid="employer-dashboard-title">
          🏢 雇主工作台
        </h1>
        <button
          type="button"
          className="employer-dashboard-refresh"
          data-testid="employer-dashboard-refresh"
          onClick={handleRefresh}
        >
          ↻ 刷新
        </button>
      </header>

      <div className="employer-kpi-grid" data-testid="employer-kpi-grid">
        {KPIS.map((kpi) => {
          const raw = data[kpi.key];
          return (
            <EmployerKPICard
              key={kpi.id}
              label={kpi.label}
              value={kpi.format(raw)}
              accent={kpi.accent}
              subText={kpi.subText}
              testId={`employer-kpi-${kpi.id}`}
            />
          );
        })}
      </div>

      <div className="employer-dashboard-actions" data-testid="employer-dashboard-actions">
        <button
          type="button"
          className="employer-dashboard-action"
          data-testid="employer-dashboard-goto-jobs"
          onClick={() => navigate('/admin/employer/jobs')}
        >
          💼 管理岗位
        </button>
        <button
          type="button"
          className="employer-dashboard-action"
          data-testid="employer-dashboard-goto-candidates"
          onClick={() => navigate('/admin/employer/candidates')}
        >
          👤 浏览人才
        </button>
        <button
          type="button"
          className="employer-dashboard-action"
          data-testid="employer-dashboard-goto-placements"
          onClick={() => navigate('/admin/employer/placements')}
        >
          🤝 查看成交
        </button>
      </div>
    </div>
  );
}