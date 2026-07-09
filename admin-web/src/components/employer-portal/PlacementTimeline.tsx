import type { Placement, PlacementStatus, Job } from '../../api/employer';

// ============================================================================
// PlacementTimeline (Employer Portal — Task 7 Placements Page)
//
// One row in the Placements timeline. Renders the placed-candidate
// summary as a horizontal card:
//
//   ┌──────────────────────────────────────────────────────────────────┐
//   │ [候选人]  [工作]            ¥[成交金额]    [状态]    [日期]    │
//   └──────────────────────────────────────────────────────────────────┘
//
// Server data (see src/main/schemas/employer.ts → PlacementSchema):
//
//   - id, job_id, anonymized_candidate_id, annual_salary, status,
//     created_at, updated_at, plus commission split fields we don't
//     surface on the timeline (platform_fee / primary_share /
//     referrer_share / candidate_bonus → shown on the detail modal in
//     a follow-up).
//
// Design notes:
//
//   - The candidate column renders the masked `anonymized_candidate_id`
//     (no PII). The dashboard / unlock endpoints handle the unmask path;
//     the timeline itself never decodes.
//
//   - The job column renders the supplied `jobTitle` (string or Job
//     object's `.title`). When the caller didn't supply a title we
//     fall back to the raw `job_id` so the row is never empty.
//
//   - Amount is `annual_salary` in yuan (NOT fen — the placement
//     commission calculator stores integer yuan; see
//     src/main/modules/commission/calculator.ts). Format with thousands
//     separators and a "¥" prefix.
//
//   - Status badge: 待付款 / 已付款 / 已取消. A `paid` class hook on the
//     badge keeps the CSS palette thin (`.paid` green, default amber
//     for pending_payment, muted grey for cancelled).
// ============================================================================

export interface PlacementTimelineProps {
  placement: Placement;
  /**
   * Job title to display, supplied as either:
   *   - a plain `string` (caller has already resolved title from a join), or
   *   - a `Job` object (component extracts `.title`), or
   *   - omitted entirely (component falls back to the raw `placement.job_id`).
   */
  jobTitle?: string | Job;
  /** Click handler (optional). The row is a no-op when omitted. */
  onClick?: (placement: Placement) => void;
}

// ---- Status label + class mapping -----------------------------------------

const STATUS_LABEL: Record<PlacementStatus, string> = {
  pending_payment: '待付款',
  paid: '已付款',
  cancelled: '已取消',
};

const STATUS_CLASS: Record<PlacementStatus, string> = {
  pending_payment: 'employer-placement-status--pending',
  paid: 'employer-placement-status--paid',
  cancelled: 'employer-placement-status--cancelled',
};

// ---- Helpers --------------------------------------------------------------

function resolveJobTitle(placement: Placement, jobTitle?: string | Job): string {
  if (typeof jobTitle === 'string' && jobTitle.length > 0) return jobTitle;
  if (jobTitle && typeof jobTitle === 'object' && 'title' in jobTitle) {
    return jobTitle.title;
  }
  return placement.job_id;
}

function formatIsoDate(iso: string): string {
  // Backend emits strict ISO-8601; the date portion is the first 10 chars.
  // Defensive slice (in case a future API returns a non-ISO string we
  // gracefully degrade to whatever the first 10 chars are).
  return iso.slice(0, 10);
}

/**
 * Format an integer CNY-yuan amount as a human-readable ¥ string with
 * thousands separators. Unlike `formatCnyCents` (in api/employer.ts) which
 * divides by 100, placement monetary fields are already in yuan — see
 * src/main/modules/commission/calculator.ts where `platform_fee =
 * Math.round(clamped * 0.20)` produces yuan.
 *
 * Examples: 0 → "¥0", 360_000 → "¥360,000", 1_234_567 → "¥1,234,567".
 */
export function formatYuan(yuan: number): string {
  const safe = Number.isFinite(yuan) ? Math.round(yuan) : 0;
  return `¥${safe.toLocaleString('zh-CN')}`;
}

// ---- Component ------------------------------------------------------------

export function PlacementTimeline({ placement, jobTitle, onClick }: PlacementTimelineProps) {
  const displayTitle = resolveJobTitle(placement, jobTitle);
  const dateLabel = formatIsoDate(placement.created_at);
  const amountLabel = formatYuan(placement.annual_salary);
  const statusLabel = STATUS_LABEL[placement.status];
  const statusClass = STATUS_CLASS[placement.status];

  const handleClick = () => {
    if (onClick) onClick(placement);
  };

  // role="button" + keyboard handler keeps the row keyboard-accessible
  // when onClick is supplied. We don't set role when there's no handler
  // (the row is purely informational).
  const interactive = Boolean(onClick);
  const baseProps = interactive
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: handleClick,
        onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        },
      }
    : {};

  return (
    <article
      className={`employer-placement-row${interactive ? ' employer-placement-row--clickable' : ''}`}
      data-testid={`employer-placement-row-${placement.id}`}
      data-placement-id={placement.id}
      {...baseProps}
    >
      <div className="employer-placement-cell employer-placement-cell-candidate">
        <span
          className="employer-placement-candidate"
          data-testid="employer-placement-candidate"
          title={placement.anonymized_candidate_id}
        >
          {placement.anonymized_candidate_id}
        </span>
      </div>

      <div className="employer-placement-cell employer-placement-cell-job">
        <span
          className="employer-placement-job"
          data-testid="employer-placement-job"
          title={displayTitle}
        >
          {displayTitle}
        </span>
      </div>

      <div className="employer-placement-cell employer-placement-cell-amount">
        <span
          className="employer-placement-amount"
          data-testid="employer-placement-amount"
        >
          {amountLabel}
        </span>
      </div>

      <div className="employer-placement-cell employer-placement-cell-status">
        <span
          className={`employer-placement-status ${statusClass}`}
          data-testid="employer-placement-status"
          data-status={placement.status}
        >
          {statusLabel}
        </span>
      </div>

      <div className="employer-placement-cell employer-placement-cell-date">
        <time
          className="employer-placement-date"
          data-testid="employer-placement-date"
          dateTime={placement.created_at}
        >
          {dateLabel}
        </time>
      </div>
    </article>
  );
}