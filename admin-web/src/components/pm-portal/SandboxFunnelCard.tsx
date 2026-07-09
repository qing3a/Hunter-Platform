import {
  SANDBOX_STAGE_LABELS,
  SANDBOX_STAGE_ACCENTS,
  type SandboxStage,
  type SandboxStageBucket,
} from '../../api/pm-portal';

// ============================================================================
// SandboxFunnelCard (Task 9 / S3)
// ============================================================================
//
// A single card in the 5-stage funnel that powers the PM Sandbox page.
// Renders:
//   - stage label          (e.g. "面试")
//   - count                (large)
//   - risk indicator       (red dot + tooltip "N 个风险候选" when risk_count > 0)
//   - active state         (highlight + "展开中" hint when expanded)
//
// Click handler is owned by the parent page (PipelineSandboxPage) so
// it can manage the single-expanded-state invariant. The card itself
// just fires onClick(stage).
//
// Mirrors the styling of `FunnelCard` from
// admin-web/src/components/candidate-portal/FunnelCard.tsx but
// diverges in three ways:
//   1. We show risk_count in addition to count (a red dot / amber pill)
//   2. The card is interactive (cursor: pointer, keyboard support)
//   3. Each card has a colour-coded left border keyed by stage so the
//      funnel reads left-to-right at a glance.

interface SandboxFunnelCardProps {
  bucket: SandboxStageBucket;
  isExpanded: boolean;
  onToggle: (stage: SandboxStage) => void;
}

const RISK_FLAG_LABELS: Record<string, string> = {
  stuck_long: '停留 > 30 天',
  stuck_very_long: '停留 > 60 天',
};

function formatRelativeTime(unixMs: number, now: number = Date.now()): string {
  const deltaMs = now - unixMs;
  const days = Math.floor(deltaMs / 86_400_000);
  if (days < 0) return '刚刚';
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}

export function SandboxFunnelCard({ bucket, isExpanded, onToggle }: SandboxFunnelCardProps) {
  const accent = SANDBOX_STAGE_ACCENTS[bucket.stage];
  const label = SANDBOX_STAGE_LABELS[bucket.stage];
  const hasRisk = bucket.risk_count.stuck_long > 0 || bucket.risk_count.stuck_very_long > 0;
  const riskTotal = bucket.risk_count.stuck_long + bucket.risk_count.stuck_very_long;

  // Build the aria-label so screen readers get the full funnel state.
  const ariaLabel = `${label} ${bucket.count} 人${
    hasRisk ? `，${riskTotal} 个风险候选` : ''
  }，${isExpanded ? '已展开' : '点击展开'}`;

  return (
    <div
      className={`pm-sandbox-funnel-card pm-sandbox-funnel-card-${accent}${
        isExpanded ? ' is-expanded' : ''
      }${hasRisk ? ' has-risk' : ''}`}
      data-testid={`pm-sandbox-funnel-${bucket.stage}`}
      data-stage={bucket.stage}
      data-expanded={isExpanded ? 'true' : 'false'}
      data-count={bucket.count}
      data-risk-count={riskTotal}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-expanded={isExpanded}
      onClick={() => onToggle(bucket.stage)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle(bucket.stage);
        }
      }}
    >
      <div className="pm-sandbox-funnel-card-label">{label}</div>
      <div className="pm-sandbox-funnel-card-count">{bucket.count}</div>
      {hasRisk && (
        <div
          className="pm-sandbox-funnel-card-risk"
          data-testid={`pm-sandbox-funnel-risk-${bucket.stage}`}
          title={[
            bucket.risk_count.stuck_long > 0
              ? `${bucket.risk_count.stuck_long} 个${RISK_FLAG_LABELS.stuck_long}`
              : null,
            bucket.risk_count.stuck_very_long > 0
              ? `${bucket.risk_count.stuck_very_long} 个${RISK_FLAG_LABELS.stuck_very_long}`
              : null,
          ]
            .filter(Boolean)
            .join('；')}
        >
          <span className="pm-sandbox-funnel-card-risk-dot" aria-hidden="true" />
          <span className="pm-sandbox-funnel-card-risk-text">{riskTotal} 风险</span>
        </div>
      )}
      <div className="pm-sandbox-funnel-card-hint">
        {isExpanded ? '收起' : bucket.count > 0 ? '点击展开' : '空'}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Candidate row (used in the expanded list below the funnel).
// ----------------------------------------------------------------------------

interface SandboxCandidateRowProps {
  candidate: import('../../api/pm-portal').SandboxCandidate;
  stage: SandboxStage;
  /** Whether this row is rendered inside the expanded panel (used for
   *  test selectors that mirror the funnel-card namespace). */
  embedded?: boolean;
}

export function SandboxCandidateRow({ candidate, stage, embedded = true }: SandboxCandidateRowProps) {
  const stageEntered = formatRelativeTime(candidate.stage_entered_at);
  return (
    <div
      className="pm-sandbox-candidate-row"
      data-testid={embedded ? `pm-sandbox-candidate-${candidate.recommendation_id}` : undefined}
      data-rec-id={candidate.recommendation_id}
      data-stage={stage}
    >
      <div className="pm-sandbox-candidate-name">{candidate.candidate_display_name}</div>
      <div className="pm-sandbox-candidate-meta">
        <span className="pm-sandbox-candidate-entered">{stageEntered}进入</span>
        <div className="pm-sandbox-candidate-flags">
          {candidate.risk_flags.length === 0 ? (
            <span className="pm-sandbox-candidate-flag-empty">无风险</span>
          ) : (
            candidate.risk_flags.map((flag) => (
              <span
                key={flag}
                className={`pm-sandbox-candidate-flag pm-sandbox-candidate-flag-${flag === 'stuck_very_long' ? 'severe' : 'warn'}`}
                data-testid={`pm-sandbox-candidate-flag-${candidate.recommendation_id}-${flag}`}
              >
                {RISK_FLAG_LABELS[flag] ?? flag}
              </span>
            ))
          )}
        </div>
      </div>
      <button
        type="button"
        className="pm-sandbox-candidate-detail"
        data-testid={`pm-sandbox-candidate-detail-${candidate.recommendation_id}`}
        // Placeholder: detail page is out-of-scope for Task 9.
        disabled
        title="查看详情（即将上线）"
      >
        查看详情
      </button>
    </div>
  );
}