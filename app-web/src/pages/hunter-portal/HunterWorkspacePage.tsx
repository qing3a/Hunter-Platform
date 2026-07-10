import { useQuery } from '@tanstack/react-query';
import { dashboard } from '../../api/hunter-portal';
import { HunterMobileLayout } from '../../components/hunter-portal/HunterMobileLayout';
import { HunterSidebar } from '../../components/hunter-portal/HunterSidebar';
import { PipelineStageBadge } from '../../components/hunter-portal/PipelineStageBadge';
import { EmptyState } from '../../components/candidate-portal/EmptyState';

interface KpiTileProps {
  label: string;
  value: number;
  accent: 'green' | 'blue' | 'amber' | 'purple';
}

function KpiTile({ label, value, accent }: KpiTileProps) {
  return (
    <div className="hp-kpi-tile" data-accent={accent}>
      <div className="hp-kpi-value" data-testid="hp-kpi-value">{value}</div>
      <div className="hp-kpi-label">{label}</div>
    </div>
  );
}

/**
 * Hunter Workspace dashboard — Phase 3a / Task 12.
 *
 * Composes:
 *   - 4 KPI tiles (本月到岗 / 进行中 / 成交 / 待认领)
 *   - Top pending tasks (priority + due date)
 *   - Kanban summary funnel (5 stages)
 *   - Recent recommendations (desensitized name + job + pipeline stage)
 *
 * Responsive shell: HunterSidebar is visible ≥1024px; HunterMobileLayout's
 * bottom tab bar is visible ≤768px. The two are siblings inside `.hp-page`.
 */
export function HunterWorkspacePage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['hunter', 'dashboard'],
    queryFn: () => dashboard.get(),
  });

  if (isLoading) {
    return (
      <div className="hp-page">
        <HunterSidebar />
        <div className="hp-layout">
          <div className="hp-loading" data-testid="hp-loading">加载中...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="hp-page">
        <HunterSidebar />
        <div className="hp-layout">
          <div className="hp-error" data-testid="hp-error">
            加载失败: {(error as Error).message}
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="hp-page">
        <HunterSidebar />
        <div className="hp-layout" />
      </div>
    );
  }

  return (
    <div className="hp-page" data-testid="hp-page">
      <HunterSidebar />
      <HunterMobileLayout title="工作台">
        <section className="hp-kpi-grid" data-testid="hp-kpi-grid">
          <KpiTile label="本月到岗" value={data.kpi.onboards_this_month} accent="green" />
          <KpiTile label="进行中" value={data.kpi.active_recommendations} accent="blue" />
          <KpiTile label="成交" value={data.kpi.placements_count} accent="amber" />
          <KpiTile label="待认领" value={data.kpi.pending_pickup_count} accent="purple" />
        </section>

        <section className="hp-section" data-testid="hp-section-tasks">
          <h2>待办任务</h2>
          {data.top_tasks.length === 0 ? (
            <EmptyState icon="✅" title="暂无待办任务" description="所有待办已处理完毕" />
          ) : (
            <ul className="hp-task-list" data-testid="hp-task-list">
              {data.top_tasks.map(task => (
                <li key={task.id} className="hp-task-item" data-testid="hp-task-item">
                  <span className="hp-task-priority" data-priority={task.priority}>
                    {task.priority}
                  </span>
                  <span className="hp-task-title">{task.title}</span>
                  {task.due_at != null && (
                    <span className="hp-task-due">
                      {new Date(task.due_at).toLocaleDateString()}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="hp-section" data-testid="hp-section-funnel">
          <h2>看板概览</h2>
          <div className="hp-funnel" data-testid="hp-funnel">
            {data.kanban_summary.map(s => (
              <div
                key={s.stage}
                className="hp-funnel-row"
                data-testid="hp-funnel-row"
                data-stage={s.stage}
              >
                <PipelineStageBadge stage={s.stage} size="sm" />
                <div
                  className="hp-funnel-bar"
                  style={{ width: `${Math.min(s.count * 20, 100)}%` }}
                />
                <span className="hp-funnel-count">{s.count}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="hp-section" data-testid="hp-section-recs">
          <h2>最近推荐</h2>
          {data.recent_recommendations.length === 0 ? (
            <EmptyState icon="📭" title="暂无最近推荐" description="新提交的推荐将出现在这里" />
          ) : (
            <ul className="hp-rec-list" data-testid="hp-rec-list">
              {data.recent_recommendations.map(rec => (
                <li
                  key={rec.recommendation_id}
                  className="hp-rec-item"
                  data-testid="hp-rec-item"
                >
                  <span className="hp-rec-name">{rec.candidate_name ?? '(匿名)'}</span>
                  <span className="hp-rec-job">{rec.job_title}</span>
                  <PipelineStageBadge stage={rec.pipeline_stage} size="sm" />
                </li>
              ))}
            </ul>
          )}
        </section>
      </HunterMobileLayout>
    </div>
  );
}