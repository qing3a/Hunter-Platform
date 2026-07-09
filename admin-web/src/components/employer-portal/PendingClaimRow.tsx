import type { Job } from '../../api/employer';

// ============================================================================
// PendingClaimRow (Employer Portal — Task 8)
//
// A compact card for headhunter-created jobs that are still claimable by the
// logged-in employer. The backend returns the canonical Job shape; Task 8's UI
// also asks for HC, but the current Job schema has no headcount column. The
// optional `headcount` extension lets future backend payloads flow through while
// defaulting today's data to HC 1.
// ============================================================================

export interface PendingClaim extends Job {
  /** Optional future backend field; current /v1/employer/pending-claims omits it. */
  headcount?: number | null;
  /** Optional future backend field; current payload only has source_headhunter_id. */
  source_headhunter_name?: string | null;
}

export interface PendingClaimRowProps {
  claim: PendingClaim;
  onClaim: (claim: PendingClaim) => void;
  onReject: (claim: PendingClaim) => void;
  busyAction?: 'claim' | 'reject' | null;
}

function maskHeadhunter(value: string | null | undefined): string {
  const raw = value?.trim();
  if (!raw) return '未知猎头';
  if (raw.length <= 2) return `${raw.charAt(0)}****`;
  if (raw.length <= 4) return `${raw.slice(0, 1)}****${raw.slice(-1)}`;
  return `${raw.slice(0, 2)}****${raw.slice(-2)}`;
}

function normalizeHeadcount(value: number | null | undefined): number {
  if (value == null) return 1;
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

export function PendingClaimRow({
  claim,
  onClaim,
  onReject,
  busyAction = null,
}: PendingClaimRowProps) {
  const skills = claim.required_skills ?? [];
  const headhunterLabel = maskHeadhunter(
    claim.source_headhunter_name ?? claim.source_headhunter_id,
  );
  const headcount = normalizeHeadcount(claim.headcount);
  const isBusy = busyAction != null;

  return (
    <article
      className="employer-pending-claim-row"
      data-testid={`employer-pending-claim-row-${claim.id}`}
    >
      <header className="employer-pending-claim-row-header">
        <div className="employer-pending-claim-titleblock">
          <h3 className="employer-pending-claim-title">{claim.title}</h3>
          <span className="employer-pending-claim-industry">
            {claim.industry ?? '未标注行业'}
          </span>
        </div>
        <span className="employer-pending-claim-hc">HC {headcount}</span>
      </header>

      <div className="employer-pending-claim-meta">
        <span data-testid="employer-pending-claim-headhunter">
          猎头 {headhunterLabel}
        </span>
      </div>

      <div className="employer-pending-claim-skills">
        {skills.length === 0 ? (
          <span className="employer-pending-claim-skill employer-pending-claim-skill-empty">
            暂无技能标签
          </span>
        ) : (
          skills.map((skill) => (
            <span key={skill} className="employer-pending-claim-skill">
              {skill}
            </span>
          ))
        )}
      </div>

      <footer className="employer-pending-claim-actions">
        <button
          type="button"
          className="employer-btn-primary"
          data-testid="employer-pending-claim-action-claim"
          disabled={isBusy}
          onClick={() => onClaim(claim)}
        >
          {busyAction === 'claim' ? '领取中…' : '领取'}
        </button>
        <button
          type="button"
          className="employer-btn-secondary"
          data-testid="employer-pending-claim-action-reject"
          disabled={isBusy}
          onClick={() => onReject(claim)}
        >
          {busyAction === 'reject' ? '拒绝中…' : '拒绝'}
        </button>
      </footer>
    </article>
  );
}
