import { useNavigate } from 'react-router-dom';
import { PROJECT_STATUS_LABELS, type ProjectStatus, type ProjectSummary } from '../../api/pm-portal';

// ============================================================================
// Status badge (project lifecycle)
// ============================================================================
//
// Five states; matches the backend CHECK constraint in
// src/main/db/migrations/v028__pm_workbench.sql. Colours follow the
// hunter-portal PipelineStageBadge convention: solid foreground colour
// with an alpha-tinted background (`<color>22` = ~13% alpha) and a 1px
// matching border. This makes the status pill legible against both
// light and dark surfaces without needing two separate palettes.
//
// We intentionally do NOT import a shared `<StatusBadge>` from the
// hunter portal — the colour palettes are different (pipeline stages
// are *workflow* states, project statuses are *lifecycle* states).

const STATUS_COLORS: Record<ProjectStatus, string> = {
  planning: '#6b7280',  // gray
  active: '#10b981',    // green
  paused: '#f59e0b',    // amber/yellow
  completed: '#2563eb', // blue
  cancelled: '#ef4444', // red
};

interface StatusBadgeProps {
  status: ProjectStatus;
}

function StatusBadge({ status }: StatusBadgeProps) {
  const color = STATUS_COLORS[status];
  return (
    <span
      className="pm-project-status"
      data-status={status}
      data-testid="pm-project-status"
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

// ============================================================================
// Budget formatter
// ============================================================================
//
// Backend stores `budget_total` as a non-negative integer in **分 (fen)** —
// the smallest unit of CNY. The UI shows ¥ (yuan) by convention, so we
// divide by 100. For amounts ≥ ¥10,000 we switch to the "万" (10k)
// unit, which is the more common shorthand in Chinese finance /
// recruitment circles.
//
// Precision bands:
//   - < ¥10,000       → yuan with thousands separator (e.g. "¥1,234")
//   - ¥10,000-¥99,999 → 1-decimal 万 (e.g. "¥5.0万", "¥9.9万")
//   - ≥ ¥100,000 (1万+) → 1-decimal 万 always, scaled to keep digits ≤ 4
//                          (e.g. "¥12.0万" for ¥120,000; "¥120.0万" for ¥1.2M)
//
// Returns "-" for null / undefined so the card never shows "¥NaN".

export function formatBudgetYuan(fen: number | null | undefined): string {
  if (fen == null) return '-';
  const yuan = fen / 100;
  if (yuan < 10_000) {
    return `¥${yuan.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
  }
  const wan = yuan / 10_000;
  return `¥${wan.toFixed(1)}万`;
}

// ============================================================================
// ProjectCard
// ============================================================================

interface ProjectCardProps {
  project: ProjectSummary;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function ProjectCard({ project }: ProjectCardProps) {
  const navigate = useNavigate();
  return (
    <div
      className="pm-project-card"
      data-testid="pm-project-card"
      data-project-id={project.id}
    >
      <div className="pm-project-card-header">
        <h3
          className="pm-project-card-name"
          data-testid="pm-project-card-name"
          title={project.name}
        >
          {truncate(project.name, 30)}
        </h3>
        <StatusBadge status={project.status} />
      </div>

      {project.target && (
        <p
          className="pm-project-card-target"
          data-testid="pm-project-card-target"
          title={project.target}
        >
          {truncate(project.target, 60)}
        </p>
      )}

      <dl className="pm-project-card-meta">
        <div className="pm-project-card-meta-row">
          <dt>预算</dt>
          <dd data-testid="pm-project-card-budget">{formatBudgetYuan(project.budget_total)}</dd>
        </div>
        <div className="pm-project-card-meta-row">
          <dt>岗位</dt>
          <dd data-testid="pm-project-card-positions">{project.position_count}</dd>
        </div>
        <div className="pm-project-card-meta-row">
          <dt>计划</dt>
          <dd data-testid="pm-project-card-plans">{project.plan_count}</dd>
        </div>
      </dl>

      <button
        type="button"
        className="pm-project-card-action"
        data-testid="pm-project-card-view"
        onClick={() => navigate(`/pm/projects/${project.id}`)}
      >
        查看详情 →
      </button>
    </div>
  );
}
