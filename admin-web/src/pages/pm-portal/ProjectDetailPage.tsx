import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  pmProjects,
  pmPositions,
  pmMatches,
  PROJECT_STATUS_LABELS,
  type ProjectStatus,
} from '../../api/pm-portal';
import { formatBudgetYuan } from '../../components/pm-portal/ProjectCard';
import { PositionTable } from '../../components/pm-portal/PositionTable';
import { ProjectKPICard } from '../../components/pm-portal/ProjectKPICard';
import { AIDecomposeModal } from '../../components/pm-portal/AIDecomposeModal';
import { MatchSidebar, type SidebarMatch } from '../../components/pm-portal/MatchSidebar';
import { AISuggestionBanner } from '../../components/pm-portal/AISuggestionBanner';
import { MetadataEditModal } from '../../components/pm-portal/MetadataEditModal';

// ============================================================================
// ProjectDetailPage (S2 / Task 4)
// ============================================================================
//
// Per-project detail surface for the PM Workbench. Renders the project
// header (name / target / budget / dates / team / status) plus an S2
// two-column layout:
//
//   ┌─────────────────────────────┬──────────────────┐
//   │  PositionTable              │  MatchSidebar    │
//   │  (left, 1fr)                │  (right, 320px)  │
//   └─────────────────────────────┴──────────────────┘
//
// A top action bar exposes 3 cross-cutting flows:
//   - 📋 项目元数据  → opens the metadata edit modal (Task 6 wires the modal)
//   - ⚖️ 方案对比     → navigates to /admin/pm/projects/:id/compare
//   - 📊 沙盘         → navigates to the first position's sandbox page
//                       (falls back to /admin/pm/snapshot when the project
//                       has no positions yet)
//
// The tab-based 概览/岗位/计划/匹配 layout (Task 5+6) was retired in
// favour of the S2 single-pane view so the candidate-match sidebar can
// stay sticky on the right at all times.
//
// Network calls:
//   - pmProjects.get(id)     fetches the project + its positions / plans
//   - pmPositions.stats(id)  aggregate counts for the overview tile row
//   - pmPositions.list(id)   always-on (no longer gated by tab visibility)
//   - pmMatches.list(pos)    top-N matches for the first position, used
//                            by the right-column MatchSidebar

const STATUS_COLORS: Record<ProjectStatus, string> = {
  planning: '#6b7280',
  active: '#10b981',
  paused: '#f59e0b',
  completed: '#2563eb',
  cancelled: '#ef4444',
};

const SIDEBAR_MATCH_LIMIT = 4;

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
  const [showAiModal, setShowAiModal] = useState(false);
  const [showMetaModal, setShowMetaModal] = useState(false);
  const [showAiBanner, setShowAiBanner] = useState(true);

  /**
   * Called by AIDecomposeModal after a successful commit. Invalidates
   * the three queries that reflect project_positions state so the
   * Positions table + MatchSidebar update immediately. No extra GET
   * round trips — react-query just refetches the cached queries.
   */
  function onDecomposeCommitted() {
    if (!id) return;
    queryClient.invalidateQueries({ queryKey: ['pm', 'positions', 'list', id] });
    queryClient.invalidateQueries({ queryKey: ['pm', 'positions', 'stats', id] });
    queryClient.invalidateQueries({ queryKey: ['pm', 'projects', 'get', id] });
  }

  /**
   * Mutation that PATCHes the project row with the form payload from
   * MetadataEditModal. The form's budget is in 万元 (10,000 元) and
   * the modal multiplies it back to 元 before handing it to the
   * mutation. On success we invalidate the project query so the
   * header re-renders with the new name / target / budget / dates /
   * team.
   */
  const updateProjectMutation = useMutation({
    mutationFn: (patch: Parameters<typeof pmProjects.update>[1]) =>
      pmProjects.update(id!, patch),
    onSuccess: () => {
      if (!id) return;
      queryClient.invalidateQueries({ queryKey: ['pm', 'projects', 'get', id] });
    },
  });

  // The project detail fetch. This is unconditional because every
  // section (header / PositionTable / MatchSidebar) needs the project
  // header and the positions list.
  const projectQuery = useQuery({
    queryKey: ['pm', 'projects', 'get', id],
    queryFn: () => pmProjects.get(id!),
    enabled: Boolean(id),
  });

  // Position stats for the overview tile row. Always-on in the S2
  // layout (the overview no longer hides behind a tab).
  const statsQuery = useQuery({
    queryKey: ['pm', 'positions', 'stats', id],
    queryFn: () => pmPositions.stats(id!),
    enabled: Boolean(id),
  });

  // Position list for PositionTable. Always-on too — the table is the
  // primary content of the left column.
  const positionsQuery = useQuery({
    queryKey: ['pm', 'positions', 'list', id],
    queryFn: () => pmPositions.list(id!),
    enabled: Boolean(id),
  });

  // Match sidebar is driven by the first position's top matches. This
  // keeps the v1 surface simple — Task 10 will let the PM switch
  // sidebar position context. The query is gated on the project
  // detail being available so we don't churn the server with
  // empty-position 404s. We resolve the position id from the cached
  // project detail (no extra round-trip).
  const sidebarPositionId = projectQuery.data?.positions?.[0]?.id ?? null;

  // Top matches for the right-column MatchSidebar. Backed by a
  // react-query that only fires once a position is available. The
  // hook must run unconditionally (Rules of Hooks) so we always
  // invoke it, even when the project detail is still loading.
  const sidebarMatchesQuery = useQuery({
    queryKey: ['pm', 'matches', 'sidebar', sidebarPositionId],
    queryFn: () =>
      pmMatches.list(sidebarPositionId!, { limit: SIDEBAR_MATCH_LIMIT }),
    enabled: Boolean(sidebarPositionId),
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
  const sidebarPosition = positions[0] ?? null;

  // Adapt MatchListItem → SidebarMatch. The match wire shape doesn't
  // carry a position title (the caller already knows it from the URL),
  // so we hydrate positionTitle from the parent project positions
  // list and projectName from the project itself. The display name
  // surface ("this position / project") is what the SidebarMatch
  // contract expects from the S2 visual mock.
  const sidebarMatches: SidebarMatch[] = (sidebarMatchesQuery.data?.matches ?? []).map((m) => ({
    matchId: m.match_id,
    positionId: m.position_id,
    positionTitle: sidebarPosition?.title ?? '该岗位',
    projectName: project.name,
    score: m.score,
  }));

  function handleMetadataClick() {
    setShowMetaModal(true);
  }

  function handleCompareClick() {
    if (!id) return;
    navigate(`/admin/pm/projects/${id}/compare`);
  }

  function handleSandboxClick() {
    if (!id) return;
    if (sidebarPositionId) {
      navigate(`/admin/pm/projects/${id}/positions/${sidebarPositionId}/sandbox`);
    } else {
      // No positions yet — fall back to the global snapshot so the
      // PM still lands on a meaningful surface.
      navigate('/admin/pm/snapshot');
    }
  }

  return (
    <div className="pm-detail" data-testid="pm-detail">
      <button
        type="button"
        className="pm-btn-link pm-detail-back"
        onClick={() => navigate('/admin/pm/projects')}
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

      <nav className="pm-detail-actionbar" data-testid="pm-detail-actionbar" aria-label="项目操作">
        <button
          type="button"
          className="pm-btn-secondary"
          data-testid="pm-detail-action-metadata"
          onClick={handleMetadataClick}
        >
          📋 项目元数据
        </button>
        <button
          type="button"
          className="pm-btn-secondary"
          data-testid="pm-detail-action-compare"
          onClick={handleCompareClick}
        >
          ⚖️ 方案对比
        </button>
        <button
          type="button"
          className="pm-btn-secondary"
          data-testid="pm-detail-action-sandbox"
          onClick={handleSandboxClick}
        >
          📊 沙盘
        </button>
      </nav>

      <section className="pm-detail-overview" data-testid="pm-detail-overview">
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

        <p className="pm-detail-overview-footnote" data-testid="pm-detail-overview-footnote">
          当前计划数:{stats.total_plans} 条(从 project detail 响应中读取,共 {plans.length} 条计划)。
        </p>
      </section>

      <div className="pm-s2-grid" data-testid="pm-s2-grid">
        <div className="pm-s2-main" data-testid="pm-s2-main">
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
          {showAiBanner && (
            <AISuggestionBanner
              suggestion="建议增加 1 名 国际化工程师 (P6, 10 月到岗, 估计 +30 万成本)"
              onApply={() => setShowAiBanner(false)}
              onDismiss={() => setShowAiBanner(false)}
            />
          )}
          <PositionTable
            positions={positionsQuery.data?.positions ?? []}
            loading={positionsQuery.isLoading}
          />
        </div>
        <MatchSidebar
          positionId={sidebarPositionId ?? ''}
          matches={sidebarMatches}
        />
      </div>

      {showAiModal && id && (
        <AIDecomposeModal
          projectId={id}
          onClose={() => setShowAiModal(false)}
          onCommitted={onDecomposeCommitted}
        />
      )}

      {showMetaModal && (
        <MetadataEditModal
          open={showMetaModal}
          project={project}
          onClose={() => setShowMetaModal(false)}
          onSave={(payload) => {
            updateProjectMutation.mutate(payload);
            setShowMetaModal(false);
          }}
        />
      )}
    </div>
  );
}
