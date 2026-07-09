// ============================================================================
// MatchCard (Task 11 / S6)
// ============================================================================
//
// One match card on the Candidate Matches page. Renders:
//
//   ┌───────────────────────────────────────────────┐
//   │ [score]   张*三                            [查看详情] │  <- score + name + CTA
//   │            前端 · 5 年 React                       │  <- headline (optional)
//   │ ─────────────────────────────────────────────  │
//   │ ✓ 技能匹配 (87%)                                  │  <- reasons
//   │ ✗ 缺 rust 经验                                     │  <- gaps
//   └───────────────────────────────────────────────┘
//
// Design choices
// --------------
// - The whole card is *not* clickable — only the "查看详情" button
//   is. This avoids accidental navigation when the PM is reading
//   the reasons/gaps text. Task 13 will replace the placeholder
//   disabled button with a real navigation handler.
// - The card exposes data-* attributes for every testable field
//   (match_id, candidate_user_id, score, band) so the page-level
//   tests can assert the rendered order without scraping text.
// - We accept both `display_name` (legacy/plan description) and
//   `candidate_display_name` (the actual wire field) — the parent
//   passes the latter. When the name is null we render "匿名候选人"
//   so the card doesn't render an empty heading.
// - The score band colour comes from `<ScoreBadge>` (green/blue/
//   amber/red) so the visual language stays consistent across
//   the page.

import type { MatchListItem } from '../../api/pm-portal';
import { ScoreBadge, scoreBand } from './ScoreBadge';
import { ReasonsList } from './ReasonsList';

interface MatchCardProps {
  match: MatchListItem;
  /**
   * Render position index — used by the page to namespace testids
   * when multiple cards live on the page. Defaults to `0`.
   */
  index?: number;
  /**
   * Optional click handler for the "查看详情" button. Wired up by
   * Task 13 (candidate detail page). When omitted the button is
   * rendered as a disabled placeholder, mirroring the
   * SandboxCandidateRow pattern.
   */
  onViewDetail?: (match: MatchListItem) => void;
}

export function MatchCard({ match, index = 0, onViewDetail }: MatchCardProps) {
  const testIdPrefix = `pm-match-card-${index}`;
  const displayName = match.candidate_display_name ?? '匿名候选人';
  const headline = match.headline ?? null;
  const hasHeadline = Boolean(headline && headline.trim().length > 0);

  const handleDetailClick = () => {
    if (onViewDetail) onViewDetail(match);
  };

  return (
    <article
      className="pm-match-card"
      data-testid={testIdPrefix}
      data-match-id={match.match_id}
      data-candidate-user-id={match.candidate_user_id}
      data-score={match.score}
      data-band={scoreBand(match.score)}
      aria-label={`候选人 ${displayName}，匹配分 ${match.score}`}
    >
      <header className="pm-match-card-header">
        <ScoreBadge score={match.score} size="md" testId={`${testIdPrefix}-score`} />
        <div className="pm-match-card-identity">
          <h3
            className="pm-match-card-name"
            data-testid={`${testIdPrefix}-name`}
          >
            {displayName}
          </h3>
          {hasHeadline && (
            <p
              className="pm-match-card-headline"
              data-testid={`${testIdPrefix}-headline`}
            >
              {headline}
            </p>
          )}
        </div>
        <button
          type="button"
          className="pm-match-card-detail"
          data-testid={`${testIdPrefix}-detail`}
          onClick={handleDetailClick}
          disabled={!onViewDetail}
          title={onViewDetail ? '查看候选人详情' : '查看详情（即将上线）'}
        >
          查看详情
        </button>
      </header>

      <ReasonsList
        reasons={match.reasons}
        gaps={match.gaps}
        testIdPrefix={`${testIdPrefix}-reasons`}
      />
    </article>
  );
}