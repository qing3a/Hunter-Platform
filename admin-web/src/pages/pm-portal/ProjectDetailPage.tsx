import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  pmProjects,
  pmPositions,
  PROJECT_STATUS_LABELS,
  type ProjectStatus,
} from '../../api/pm-portal';
import { formatBudgetYuan } from '../../components/pm-portal/ProjectCard';
import { PositionTable } from '../../components/pm-portal/PositionTable';
import { ProjectKPICard } from '../../components/pm-portal/ProjectKPICard';
import { AIDecomposeModal } from '../../components/pm-portal/AIDecomposeModal';

// ============================================================================
// ProjectDetailPage (S2 / Task 5 + Task 6)
// ============================================================================
//
// Per-project detail surface for the PM Workbench. Renders the project
// header (name / target / budget / dates / team / status) plus four
// tabs:
//   - 概览 (Overview)   project-level KPI tiles + recent positions
//   - 岗位 (Positions)  full PositionTable + "智能拆岗位" CTA → AIDecomposeModal
//   - 计划 (Plans)      placeholder (Task 7)
//   - 匹配 (Matches)    placeholder (Task 10)
//
// Tab state is local (useState) — the URL doesn't carry a tab param yet
// because the page isn't mounted via App.tsx (Task 17 territory). When
// routing lands, the same component can be lifted to a URL-driven tab
// by replacing `activeTab` with `useSearchParams` and dropping the
// state hook — no other changes required.
//
// Network calls:
//   - pmProjects.get(id)       fetches the project + its positions / plans
//   - pmPositions.stats(id)    aggregate counts for the Overview tile row
//   - pmPositions.list(id)     lazy — only fires when the Positions tab
//                              is opened (avoids loading the full list
//                              for PMs who only want to read the Overview)
//
// Task 6 surface: the "智能拆岗位" button mounts AIDecomposeModal, which
// runs the heuristic, lets the PM edit suggestions inline, and on commit
// bulk-creates real project_positions. We invalidate the positions /
// project queries on commit so the Overview + Positions tabs refresh.

type TabKey = 'overview' | 'positions' | 'plans' | 'matches';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'positions', label: '岗位' },
  { key: 'plans', label: '计划' },
  { key: 'matches', label: '匹配' },
];

const STATUS_COLORS: Record<ProjectStatus, string> = {
  planning: '#6b7280',
  active: '#10b981',
  paused: '#f59e0b',
  completed: '#2563eb',
  cancelled: '#ef4444',
};

function StatusBadge({ status }: { status: ProjectStatus }) {
  const color = STATUS_COLORS[status];
  return (
    <span
      className="pm-project-status"
      data-status={status}
      data-testid="pm-detail-status"
      style={{
        backgroundColor: color + '22',
        color,
        borderColor: color,
      }}
    >
      {PROJECT_STATUS_LABELS[status]}
    </span>
  );
}

function formatDateRange(start: number | null, end: number | null): string {
  if (!start && !end) return '-';
  const fmt = (n: number) => new Date(n).toISOString().slice(0, 10);
  if (start && end) return `${fmt(start)} → ${fmt(end)}`;
  if (start) return `${fmt(start)} →`;
  return `→ ${fmt(end!)}`;
}

function summarizeTeam(
  team: { role: string; count: number }[] | null,
): { label: string; testId: string }[] {
  if (!team || team.length === 0) {
    return [];
  }
  return team.map((member, i) => ({
    label: `${member.role} × ${member.count}`,
    testId: `pm-detail-team-${i}`,
  }));
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [showAiModal, setShowAiModal] = useState(false);

  /**
   * Called by AIDecomposeModal after a successful commit. Invalidates
   * the three queries that reflect project_positions state so the
   * Overview + Positions tabs update immediately. No extra GET round
   * trips — react-query just refetches the cached queries.
   */
  function onDecomposeCommitted() {
    if (!id) return;
    queryClient.invalidateQueries({ queryKey: ['pm', 'positions', 'list', id] });
    queryClient.invalidateQueries({ queryKey: ['pm', 'positions', 'stats', id] });
    queryClient.invalidateQueries({ queryKey: ['pm', 'projects', 'get', id] });
  }

  // The project detail fetch. This is unconditional because every tab
  // (Overview / Positions / Plans / Matches) needs the project header.
  const projectQuery = useQuery({
    queryKey: ['pm', 'projects', 'get', id],
    queryFn: () => pmProjects.get(id!),
    enabled: Boolean(id),
  });

  // The Overview tab also shows position stats (separate from the
  // project-level `stats.total_positions` so the UI can show distinct
  // open/paused/filled tiles). Fires on first Overview render.
  const statsQuery = useQuery({
    queryKey: ['pm', 'positions', 'stats', id],
    queryFn: () => pmPositions.stats(id!),
    enabled: Boolean(id) && activeTab === 'overview',
  });

  // The Positions tab lists every position. Lazy: doesn't fire until
  // the tab is opened (avoids a network call for PMs who only need the
  // Overview).
  const positionsQuery = useQuery({
    queryKey: ['pm', 'positions', 'list', id],
    queryFn: () => pmPositions.list(id!),
    enabled: Boolean(id) && activeTab === 'positions',
  });

  if (projectQuery.isLoading) {
    return (
      <div className="pm-detail" data-testid="pm-detail-loading">
        加载中...
      </div>
    );
  }

  if (projectQuery.error) {
    return (
      <div className="pm-error" data-testid="pm-detail-error">
        加载失败: {(projectQuery.error as Error).message}
      </div>
    );
  }

  const detail = projectQuery.data;
  if (!detail) {
    return null;
  }

  const { project, positions, plans, stats } = detail;
  const team = summarizeTeam(project.current_team);
  const positionStats = statsQuery.data;
  const recentPositions = positions.slice(0, 5);

  return (
    <div className="pm-detail" data-testid="pm-detail">
      <button
        type="button"
        className="pm-btn-link pm-detail-back"
        onClick={() => navigate('/pm/projects')}
        data-testid="pm-detail-back"
      >
        ← 返回项目库
      </button>

      <header className="pm-detail-header" data-testid="pm-detail-header">
        <div className="pm-detail-header-main">
          <h1 className="pm-detail-title" data-testid="pm-detail-title">
            {project.name}
          </h1>
          <StatusBadge status={project.status} />
        </div>
        {project.target && (
          <p className="pm-detail-target" data-testid="pm-detail-target">
            {project.target}
          </p>
        )}
        <dl className="pm-detail-meta">
          <div className="pm-detail-meta-row">
            <dt>预算</dt>
            <dd data-testid="pm-detail-budget">{formatBudgetYuan(project.budget_total)}</dd>
          </div>
          <div className="pm-detail-meta-row">
            <dt>时间</dt>
            <dd data-testid="pm-detail-dates">{formatDateRange(project.start_at, project.end_at)}</dd>
          </div>
          <div className="pm-detail-meta-row">
            <dt>团队</dt>
            <dd data-testid="pm-detail-team">
              {team.length === 0 ? '-' : team.map((t, i) => (
                <span key={i} data-testid={t.testId}>{t.label}{i < team.length - 1 ? ' / ' : ''}</span>
              ))}
            </dd>
          </div>
        </dl>
      </header>

      <nav className="pm-detail-tabs" role="tablist" aria-label="项目详情" data-testid="pm-detail-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            data-testid={`pm-detail-tab-${tab.key}`}
            className={`pm-detail-tab${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'overview' && (
        <section
          className="pm-detail-pane"
          role="tabpanel"
          data-testid="pm-detail-overview"
        >
          <div className="pm-kpi-grid" data-testid="pm-detail-overview-kpi">
            <ProjectKPICard
              label="岗位总数"
              value={positionStats?.total ?? stats.total_positions}
              accent="blue"
              testId="pm-detail-stat-total"
            />
            <ProjectKPICard
              label="招聘中"
              value={positionStats?.open ?? 0}
              accent="green"
              testId="pm-detail-stat-open"
            />
            <ProjectKPICard
              label="已招满"
              value={positionStats?.filled ?? 0}
              accent="purple"
              testId="pm-detail-stat-filled"
            />
            <ProjectKPICard
              label="HC 进度"
              value={`${positionStats?.headcount_filled_total ?? 0} / ${positionStats?.headcount_planned_total ?? 0}`}
              accent="amber"
              testId="pm-detail-stat-headcount"
            />
            <ProjectKPICard
              label="计划数"
              value={stats.total_plans}
              accent="blue"
              testId="pm-detail-stat-plans"
            />
          </div>

          <section className="pm-detail-recent" data-testid="pm-detail-recent">
            <h2 className="pm-detail-section-title">最近岗位</h2>
            {recentPositions.length === 0 ? (
              <p className="pm-detail-recent-empty" data-testid="pm-detail-recent-empty">
                暂无岗位
              </p>
            ) : (
              <ul className="pm-detail-recent-list">
                {recentPositions.map((p) => (
                  <li key={p.id} className="pm-detail-recent-item" data-testid="pm-detail-recent-item">
                    <span className="pm-detail-recent-title">{p.title}</span>
                    <span className="pm-detail-recent-meta">
                      {p.headcount_filled} / {p.headcount_planned} HC
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </section>
      )}

      {activeTab === 'positions' && (
        <section
          className="pm-detail-pane"
          role="tabpanel"
          data-testid="pm-detail-positions"
        >
          <div className="pm-detail-pane-toolbar">
            <button
              type="button"
              className="pm-btn-primary"
              data-testid="pm-detail-ai-decompose"
              onClick={() => setShowAiModal(true)}
            >
              ✨ 智能拆岗位
            </button>
          </div>
          <PositionTable
            positions={positionsQuery.data?.positions ?? []}
            loading={positionsQuery.isLoading}
          />
        </section>
      )}

      {activeTab === 'plans' && (
        <section
          className="pm-detail-pane"
          role="tabpanel"
          data-testid="pm-detail-plans-placeholder"
        >
          <h2>Plans — coming in Task 7</h2>
          <p>
            这里会展示项目的招聘计划列表和详情。当前的计划数:{stats.total_plans}。
            计划详情页会在 Task 7 中实现,届时会列出每个阶段的里程碑和任务。
          </p>
          <p>当前计划数:{plans.length} 条(从 project detail 响应中读取)。</p>
        </section>
      )}

      {activeTab === 'matches' && (
        <section
          className="pm-detail-pane"
          role="tabpanel"
          data-testid="pm-detail-matches-placeholder"
        >
          <h2>Matches — coming in Task 10</h2>
          <p>
            这里会展示系统为该项目推荐的人选匹配。匹配引擎在 Task 10 中实现,届时 PM
            可以浏览 / 接受 / 拒绝 AI 推荐的候选人,并为每个岗位生成 match queue。
          </p>
        </section>
      )}

      {showAiModal && id && (
        <AIDecomposeModal
          projectId={id}
          onClose={() => setShowAiModal(false)}
          onCommitted={onDecomposeCommitted}
        />
      )}
    </div>
  );
}
