// ============================================================================
// ScoreBadge (Task 11 / S6)
// ============================================================================
//
// A small visual chip that displays a 0-100 match score with a colour
// band keyed by the score band:
//
//   90-100  -> green   (excellent)
//   75-89   -> blue    (good)
//   60-74   -> amber   (fair)
//    0-59   -> red     (poor)
//
// Why bands? The weighted-match score is the single most scannable
// signal on the Candidate Matches page; a coloured chip lets the PM
// triage 20+ candidates at a glance without reading the number.
//
// The component is intentionally presentation-only — it doesn't own
// any data, just renders a number with the right colour. The page
// decides where to place it (card / list / detail). Three size
// variants cover the common placements: `sm` (inline), `md`
// (default — card header), `lg` (detail page hero, future Task).
//
// The colour key is exposed via the `scoreBand()` helper for callers
// that want to render the band name in copy (e.g. "excellent match").
// Mirrors the colour tokens used by PipelineSandboxPage's risk
// indicator so the two pages feel visually consistent.

export type ScoreBand = 'excellent' | 'good' | 'fair' | 'poor';

export type ScoreBadgeSize = 'sm' | 'md' | 'lg';

/**
 * Map a 0-100 score to its display band. Boundaries are inclusive
 * on the lower end so 90 → excellent and 89 → good (matches the
 * thresholds documented in the task spec).
 */
export function scoreBand(score: number): ScoreBand {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 60) return 'fair';
  return 'poor';
}

/** Human-readable label for a score band. Used by aria-label copy. */
export const SCORE_BAND_LABELS: Record<ScoreBand, string> = {
  excellent: '优秀',
  good: '良好',
  fair: '一般',
  poor: '较弱',
};

interface ScoreBadgeProps {
  /** 0-100 integer. Values outside the range are clamped. */
  score: number;
  /** Visual size — see ScoreBadgeSize. Defaults to `md`. */
  size?: ScoreBadgeSize;
  /** Optional testid override (defaults to `pm-score-badge`). */
  testId?: string;
}

export function ScoreBadge({ score, size = 'md', testId }: ScoreBadgeProps) {
  // Clamp into [0, 100] so out-of-range values (e.g. from legacy rows)
  // still render cleanly rather than throwing or rendering NaN.
  const safeScore = Math.max(0, Math.min(100, Math.round(score)));
  const band = scoreBand(safeScore);

  const ariaLabel = `${safeLabel(safeScore)} · ${SCORE_BAND_LABELS[band]}`;

  return (
    <span
      className={`pm-score-badge pm-score-badge-${size} pm-score-badge-${band}`}
      data-testid={testId ?? 'pm-score-badge'}
      data-score={safeScore}
      data-band={band}
      data-size={size}
      aria-label={ariaLabel}
      role="img"
    >
      <span className="pm-score-badge-value" data-testid="pm-score-badge-value">
        {safeScore}
      </span>
    </span>
  );
}

function safeLabel(score: number): string {
  return `匹配分 ${score}`;
}