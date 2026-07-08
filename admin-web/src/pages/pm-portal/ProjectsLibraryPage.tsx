import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { pmProjects, PROJECT_STATUS_LABELS, type ProjectStatus, type ProjectSummary } from '../../api/pm-portal';
import { EmptyState } from '../../components/candidate-portal/EmptyState';
import { ProjectCard, formatBudgetYuan } from '../../components/pm-portal/ProjectCard';
import { ProjectKPICard } from '../../components/pm-portal/ProjectKPICard';

// ============================================================================
// Projects Library — S8 / Task 4
// ============================================================================
//
// First page of the PM Workbench. Shows the caller's projects with a
// KPI row (total / active / completed / total budget), a search box,
// a status filter, and a table ↔ card view toggle. View-mode choice
// persists in localStorage so a PM who prefers cards doesn't have to
// re-pick the mode every session.
//
// No PM-specific MobileLayout is used here — the full PM chrome ships
// with Task 17. For now the page renders a bare `.pm-library` wrapper
// and assumes the route registration in App.tsx (also Task 17) will
// place it behind RequirePMAuth.
//
// Stats derivation: the backend doesn't expose a /stats endpoint yet, so
// we derive active / completed / total-budget from a single list fetch
// with limit=100. For the v1 PM workload (<= 100 projects per PM) this
// is fine; if we ever expect more, add a dedicated stats endpoint in
// a follow-up task.

type ViewMode = 'table' | 'card';
const VIEW_MODE_KEY = 'pm.library.viewMode';

const STATUS_FILTERS: { value: ProjectStatus | 'all'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'planning', label: '筹备中' },
  { value: 'active', label: '进行中' },
  { value: 'paused', label: '已暂停' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
];

function loadViewMode(): ViewMode {
  try {
    const raw = localStorage.getItem(VIEW_MODE_KEY);
    return raw === 'card' ? 'card' : 'table';
  } catch {
    return 'table';
  }
}

interface KPIStats {
  total: number;
  active: number;
  completed: number;
  totalBudgetFen: number;
}

/**
 * Compute KPIs from a list of projects. `total` comes from the API
 * (un-paginated) so the count is accurate even if the list was clipped
 * at limit=100. active / completed / totalBudgetFen are derived from
 * the fetched page — which is acceptable for v1 but documented above.
 */
function computeStats(
  fetched: ProjectSummary[],
  totalFromServer: number,
): KPIStats {
  let active = 0;
  let completed = 0;
  let totalBudgetFen = 0;
  for (const p of fetched) {
    if (p.status === 'active') active += 1;
    if (p.status === 'completed') completed += 1;
    if (typeof p.budget_total === 'number') totalBudgetFen += p.budget_total;
  }
  return {
    total: totalFromServer,
    active,
    completed,
    totalBudgetFen,
  };
}

function filterAndSort(
  projects: ProjectSummary[],
  query: string,
  status: ProjectStatus | 'all',
): ProjectSummary[] {
  const q = query.trim().toLowerCase();
  return projects
    .filter((p) => (status === 'all' ? true : p.status === status))
    .filter((p) => (q ? p.name.toLowerCase().includes(q) : true));
}

export function ProjectsLibraryPage() {
  const [viewMode, setViewMode] = useState<ViewMode>(() => loadViewMode());
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const navigate = useNavigate();

  // Persist view mode across reloads. We write on every change rather
  // than in a beforeunload handler so a PM who closes the tab right
  // after toggling still gets the new mode next time.
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      // localStorage may be disabled (e.g. private mode in some
      // browsers). Tolerate silently — default view is table.
    }
  }, [viewMode]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['pm', 'projects', 'list'],
    // limit=100 is the repo's hard ceiling (see projects.ts → LIST_LIMIT_MAX).
    // That's the maximum we can show in v1; if a PM has more, the KPI
    // counts will be under-reported (noted in the file header).
    queryFn: () => pmProjects.list({ limit: 100 }),
  });

  const projects = data?.projects ?? [];
  const totalFromServer = data?.total ?? 0;
  const stats = useMemo(
    () => computeStats(projects, totalFromServer),
    [projects, totalFromServer],
  );

  const visible = useMemo(
    () => filterAndSort(projects, search, statusFilter),
    [projects, search, statusFilter],
  );

  return (
    <div className="pm-library" data-testid="pm-library">
      <header className="pm-library-header">
        <h1 className="pm-library-title">项目库</h1>
        <button
          type="button"
          className="pm-btn-primary"
          data-testid="pm-new-project"
          onClick={() => setShowNewProjectModal(true)}
        >
          + 新建项目
        </button>
      </header>

      <section className="pm-kpi-grid" data-testid="pm-library-kpi">
        <ProjectKPICard
          label="项目数"
          value={stats.total}
          accent="blue"
          testId="pm-kpi-total"
        />
        <ProjectKPICard
          label="活跃项目"
          value={stats.active}
          accent="green"
          testId="pm-kpi-active"
        />
        <ProjectKPICard
          label="已完成"
          value={stats.completed}
          accent="purple"
          testId="pm-kpi-completed"
        />
        <ProjectKPICard
          label="总预算"
          value={formatBudgetYuan(stats.totalBudgetFen)}
          accent="amber"
          testId="pm-kpi-budget"
        />
      </section>

      <section className="pm-filters" data-testid="pm-library-filters">
        <input
          type="search"
          className="pm-input"
          placeholder="搜索项目名"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="pm-library-search"
          aria-label="搜索项目名"
        />
        <select
          className="pm-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ProjectStatus | 'all')}
          data-testid="pm-library-status"
          aria-label="状态筛选"
        >
          {STATUS_FILTERS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <div className="pm-view-toggle" role="group" aria-label="视图切换">
          <button
            type="button"
            className={`pm-view-toggle-btn${viewMode === 'table' ? ' active' : ''}`}
            data-testid="pm-view-table"
            data-active={viewMode === 'table'}
            onClick={() => setViewMode('table')}
          >
            表格
          </button>
          <button
            type="button"
            className={`pm-view-toggle-btn${viewMode === 'card' ? ' active' : ''}`}
            data-testid="pm-view-card"
            data-active={viewMode === 'card'}
            onClick={() => setViewMode('card')}
          >
            卡片
          </button>
        </div>
      </section>

      {isLoading && (
        <div className="pm-loading" data-testid="pm-library-loading">加载中...</div>
      )}

      {error && !isLoading && (
        <div className="pm-error" data-testid="pm-library-error">
          加载失败: {(error as Error).message}
        </div>
      )}

      {!isLoading && !error && projects.length === 0 && (
        <EmptyState
          icon="📁"
          title="暂无项目"
          description="点击「新建项目」开始你的第一个招聘项目"
          action={{
            label: '+ 新建项目',
            onClick: () => setShowNewProjectModal(true),
          }}
        />
      )}

      {!isLoading && !error && projects.length > 0 && visible.length === 0 && (
        <EmptyState
          icon="🔍"
          title="没有匹配的项目"
          description="试试调整搜索关键词或状态筛选"
        />
      )}

      {!isLoading && !error && visible.length > 0 && viewMode === 'table' && (
        <table className="pm-table" data-testid="pm-library-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>状态</th>
              <th>预算</th>
              <th>岗位</th>
              <th>计划</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr
                key={p.id}
                data-testid="pm-library-row"
                data-project-id={p.id}
              >
                <td title={p.name}>{p.name.length > 30 ? `${p.name.slice(0, 30)}…` : p.name}</td>
                <td>
                  <span
                    className="pm-project-status"
                    data-status={p.status}
                  >
                    {PROJECT_STATUS_LABELS[p.status]}
                  </span>
                </td>
                <td>{formatBudgetYuan(p.budget_total)}</td>
                <td>{p.position_count}</td>
                <td>{p.plan_count}</td>
                <td>
                  <a
                    href={`/pm/projects/${p.id}`}
                    data-testid="pm-library-view"
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/pm/projects/${p.id}`);
                    }}
                  >
                    查看详情
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!isLoading && !error && visible.length > 0 && viewMode === 'card' && (
        <div className="pm-card-grid" data-testid="pm-library-cards">
          {visible.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}

      {showNewProjectModal && (
        <div
          className="pm-modal-backdrop"
          data-testid="pm-new-project-modal"
          onClick={() => setShowNewProjectModal(false)}
        >
          <div
            className="pm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pm-new-project-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="pm-new-project-modal-title">ProjectMetaModal — coming in Task 15</h2>
            <p>这里会展示创建项目的表单字段(名称 / 目标 / 预算 / 计划 / 团队)。</p>
            <button
              type="button"
              className="pm-btn-primary"
              data-testid="pm-new-project-modal-close"
              onClick={() => setShowNewProjectModal(false)}
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
