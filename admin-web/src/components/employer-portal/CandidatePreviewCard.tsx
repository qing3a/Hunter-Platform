import type { TalentPreview } from '../../api/employer';
import { MatchScore } from '../candidate-portal/MatchScore';

// ============================================================================
// CandidatePreviewCard (Employer Portal — Task 6 Browse Talent)
//
// Anonymized candidate card. The page is gated on employer authentication
// and the underlying data is already scrubbed (no real name / phone / email
// — only `anonymized_id`, industry, title level, years of experience,
// salary range, education tier, and skills). We display:
//
//   - Avatar (initial letter derived from the anonymized id — the only
//     visible identifier)
//   - Anonymized id as the card title (the masked identifier)
//   - Industry / title level / years experience meta tags
//   - Salary range (if present)
//   - Up to 5 skill tags + "+N" overflow chip
//   - Optional MatchScore (when a position context is provided)
//   - Action buttons: 表达兴趣 / 解锁
//
// The buttons are no-ops when callbacks are omitted — useful for read-only
// contexts (e.g. embedded cards in other surfaces) — and the click handler
// is the only thing that invokes the optional callbacks. We never log or
// forward the anonymized id from inside the component.
// ============================================================================

export interface CandidatePreviewCardProps {
  candidate: TalentPreview;
  /** Optional 0-100 match score (rendered when a position context is provided). */
  matchScore?: number;
  /** Click handler for the "表达兴趣" button. Optional — omitted = no-op. */
  onExpressInterest?: (candidate: TalentPreview) => void;
  /** Click handler for the "解锁" button. Optional — omitted = no-op. */
  onUnlock?: (candidate: TalentPreview) => void;
}

const MAX_VISIBLE_SKILLS = 5;

function avatarInitial(id: string): string {
  // The anonymized_id is the only visible identifier. We don't decode it
  // — just pick the first character (lowercased) for the avatar bubble.
  const first = id.trim().charAt(0);
  return first ? first.toLowerCase() : '?';
}

export function CandidatePreviewCard({
  candidate,
  matchScore,
  onExpressInterest,
  onUnlock,
}: CandidatePreviewCardProps) {
  const skills = candidate.skills ?? [];
  const visible = skills.slice(0, MAX_VISIBLE_SKILLS);
  const overflow = skills.length - visible.length;

  const handleExpress = () => {
    if (onExpressInterest) onExpressInterest(candidate);
  };
  const handleUnlock = () => {
    if (onUnlock) onUnlock(candidate);
  };

  return (
    <article
      className="employer-candidate-card"
      data-testid={`employer-candidate-card-${candidate.anonymized_id}`}
      data-anonymized-id={candidate.anonymized_id}
    >
      <header className="employer-candidate-card-header">
        <div className="employer-candidate-avatar" aria-hidden="true">
          {avatarInitial(candidate.anonymized_id)}
        </div>
        <div className="employer-candidate-card-titleblock">
          <h3 className="employer-candidate-card-title">
            {candidate.anonymized_id}
          </h3>
          <div className="employer-candidate-card-meta">
            {candidate.industry && (
              <span className="employer-candidate-tag">{candidate.industry}</span>
            )}
            {candidate.title_level && (
              <span className="employer-candidate-tag employer-candidate-tag-level">
                {candidate.title_level}
              </span>
            )}
            {candidate.years_experience != null && (
              <span className="employer-candidate-tag">
                {candidate.years_experience}年经验
              </span>
            )}
          </div>
        </div>
        {matchScore != null && <MatchScore score={matchScore} />}
      </header>

      {(candidate.salary_range || candidate.education_tier) && (
        <div className="employer-candidate-card-secondary">
          {candidate.salary_range && (
            <span className="employer-candidate-secondary-item">
              💰 {candidate.salary_range}
            </span>
          )}
          {candidate.education_tier && (
            <span className="employer-candidate-secondary-item">
              🎓 {candidate.education_tier}
            </span>
          )}
        </div>
      )}

      {visible.length > 0 && (
        <div className="employer-candidate-card-skills">
          {visible.map((skill) => (
            <span key={skill} className="employer-candidate-skill">
              {skill}
            </span>
          ))}
          {overflow > 0 && (
            <span className="employer-candidate-skill employer-candidate-skill-overflow">
              +{overflow}
            </span>
          )}
        </div>
      )}

      <footer className="employer-candidate-card-actions">
        <button
          type="button"
          className="employer-btn-secondary"
          data-testid={`employer-candidate-card-${candidate.anonymized_id}-express`}
          onClick={handleExpress}
        >
          表达兴趣
        </button>
        <button
          type="button"
          className="employer-btn-primary"
          data-testid={`employer-candidate-card-${candidate.anonymized_id}-unlock`}
          onClick={handleUnlock}
        >
          解锁
        </button>
      </footer>
    </article>
  );
}