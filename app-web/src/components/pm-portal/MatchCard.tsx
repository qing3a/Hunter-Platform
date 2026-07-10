// ============================================================================
// MatchCard (Task 11 / S6)
// ============================================================================
//
// One match card on the Candidate Matches page. Renders:
//
//   ┌───────────────────────────────────────────────┐
//   │ [score] 高分 张*三                            [查看详情] │  <- score + tier + name + CTA
//   │            前端 · 5 年 React                       │  <- headline (optional)
//   │ ─────────────────────────────────────────────  │
//   │ ✓ 技能匹配 (87%)                                  │  <- reasons
//   │ ✗ 缺 rust 经验                                     │  <- gaps
//   │ ─────────────────────────────────────────────  │
//   │ → 推荐给猎头   (primary)                          │  <- per-row actions
//   │ 📞 解锁        (secondary)                        │
//   │ ✗ 不合适       (danger)                           │
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
// - The score tier label (`高分 / 中分 / 低分`) is a small text chip
//   rendered next to the score badge so the PM can triage at a
//   glance without parsing the band colour. Tier buckets are
//   derived from the same bands the ScoreBadge uses:
//     excellent (90+) -> 高分
//     good/fair       -> 中分
//     poor (<60)      -> 低分
// - The per-row action stack is rendered at the foot of the card.
//   All three callbacks are optional; when a callback is omitted
//   we still render the button but render it disabled so the layout
//   stays stable across cards.

import type { MatchListItem } from '../../api/pm-portal';
import { ScoreBadge, scoreBand } from './ScoreBadge';
import { ReasonsList } from './ReasonsList';
import { ActionStack } from './ActionStack';

export type ScoreTier = 'high' | 'mid' | 'low';

/**
 * Map a 0-100 score to a coarse 3-bucket tier for the score-tier chip.
 * The "high" / "mid" / "low" buckets collapse the 4 score bands into a
 * friendlier wording that fits in a 9px chip next to the score number.
 */
export function scoreTier(score: number): ScoreTier {
  if (score >= 90) return 'high';
  if (score >= 60) return 'mid';
  return 'low';
}

export const SCORE_TIER_LABELS: Record<ScoreTier, string> = {
  high: '高分',
  mid: '中分',
  low: '低分',
};

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
  /**
   * Optional callback for the "→ 推荐给猎头" button. Wired by
   * the parent page (CandidateMatchesPage). When omitted the
   * button is rendered disabled so the layout stays stable.
   */
  onRecommend?: (match: MatchListItem) => void;
  /**
   * Optional callback for the "📞 解锁" button.
   */
  onUnlock?: (match: MatchListItem) => void;
  /**
   * Optional callback for the "✗ 不合适" button.
   */
  onReject?: (match: MatchListItem) => void;
}

export function MatchCard({
  match,
  index = 0,
  onViewDetail,
  onRecommend,
  onUnlock,
  onReject,
}: MatchCardProps) {
  const testIdPrefix = `pm-match-card-${index}`;
  const displayName = match.candidate_display_name ?? '匿名候选人';
  const headline = match.headline ?? null;
  const hasHeadline = Boolean(headline && headline.trim().length > 0);
  const tier = scoreTier(match.score);

  const handleDetailClick = () => {
    if (onViewDetail) onViewDetail(match);
  };
  const handleRecommend = () => {
    if (onRecommend) onRecommend(match);
  };
  const handleUnlock = () => {
    if (onUnlock) onUnlock(match);
  };
  const handleReject = () => {
    if (onReject) onReject(match);
  };

  return (
    <article
      className="pm-match-card"
      data-testid={testIdPrefix}
      data-match-id={match.match_id}
      data-candidate-user-id={match.candidate_user_id}
      data-score={match.score}
      data-band={scoreBand(match.score)}
      data-tier={tier}
      aria-label={`候选人 ${displayName}，匹配分 ${match.score}（${SCORE_TIER_LABELS[tier]}）`}
    >
      <header className="pm-match-card-header">
        <ScoreBadge score={match.score} size="md" testId={`${testIdPrefix}-score`} />
        <span
          className={`pm-score-tier pm-score-tier--${tier}`}
          data-testid={`${testIdPrefix}-tier`}
          data-tier={tier}
          aria-label={`档位 ${SCORE_TIER_LABELS[tier]}`}
        >
          {SCORE_TIER_LABELS[tier]}
        </span>
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

      <footer
        className="pm-match-card-footer"
        data-testid={`${testIdPrefix}-footer`}
      >
        <ActionStack
          onRecommend={handleRecommend}
          onUnlock={handleUnlock}
          onReject={handleReject}
        />
      </footer>
    </article>
  );
}
