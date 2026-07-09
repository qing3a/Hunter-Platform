import {
  SANDBOX_STAGE_LABELS,
  SANDBOX_STAGE_ACCENTS,
  type SandboxStageBucket,
} from '../../api/pm-portal';

// ============================================================================
// SandboxFunnelCard (Task 8 / S3)
// ============================================================================
//
// A single card in the 6-stage funnel that powers the PM Sandbox page.
// Renders:
//   - stage label          (e.g. "面试")
//   - count                (large)
//   - risk indicator       (red dot + tooltip "N 个风险候选" when risk_count > 0)
//   - inline candidate list `<ul className="pm-funnel-candidates">` —
//     always visible (no click-to-expand). Each item shows masked
//     name + relative stage-entry time + risk-flag chip when present.
//
// Styling mirrors FunnelCard from the candidate portal but the
// behaviour diverges in two ways:
//   1. The card is non-interactive (informational only)
//   2. Candidates are always rendered inline below the count
//
// A stage with zero candidates renders a muted "—" placeholder so
// users can tell at-a-glance that the stage is intentionally empty
// rather than missing data.

interface SandboxFunnelCardProps {
  bucket: SandboxStageBucket;
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

export function SandboxFunnelCard({ bucket }: SandboxFunnelCardProps) {
  const accent = SANDBOX_STAGE_ACCENTS[bucket.stage];
  const label = SANDBOX_STAGE_LABELS[bucket.stage];
  const hasRisk = bucket.risk_count.stuck_long > 0 || bucket.risk_count.stuck_very_long > 0;
  const riskTotal = bucket.risk_count.stuck_long + bucket.risk_count.stuck_very_long;

  return (
    <div
      className={`pm-sandbox-funnel-card pm-sandbox-funnel-card-${accent}${
        hasRisk ? ' has-risk' : ''
      }`}
      data-testid={`pm-sandbox-funnel-${bucket.stage}`}
      data-stage={bucket.stage}
      data-count={bucket.count}
      data-risk-count={riskTotal}
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
      {bucket.candidates.length > 0 ? (
        <ul
          className="pm-funnel-candidates"
          data-testid={`pm-sandbox-funnel-candidates-${bucket.stage}`}
          aria-label={`${label} 阶段候选人`}
        >
          {bucket.candidates.map((c) => {
            const stageEntered = formatRelativeTime(c.stage_entered_at);
            return (
              <li
                key={c.recommendation_id}
                data-testid={`pm-sandbox-funnel-candidate-${bucket.stage}-${c.recommendation_id}`}
                data-rec-id={c.recommendation_id}
              >
                <span className="pm-funnel-candidate-name">{c.candidate_display_name}</span>
                <span className="pm-funnel-candidate-meta">
                  <span data-testid={`pm-sandbox-funnel-candidate-entered-${bucket.stage}-${c.recommendation_id}`}>
                    {stageEntered}进入
                  </span>
                  {c.risk_flags.map((flag) => (
                    <span
                      key={flag}
                      className={`pm-sandbox-candidate-flag pm-sandbox-candidate-flag-${
                        flag === 'stuck_very_long' ? 'severe' : 'warn'
                      }`}
                      data-testid={`pm-sandbox-funnel-candidate-flag-${c.recommendation_id}-${flag}`}
                    >
                      {RISK_FLAG_LABELS[flag] ?? flag}
                    </span>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div
          className="pm-funnel-candidates-empty"
          data-testid={`pm-sandbox-funnel-candidates-empty-${bucket.stage}`}
        >
          —
        </div>
      )}
    </div>
  );
}
