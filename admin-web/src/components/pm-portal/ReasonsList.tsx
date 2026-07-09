// ============================================================================
// ReasonsList (Task 11 / S6)
// ============================================================================
//
// Renders the reasons / gaps strings produced by the weighted-match
// heuristic. Each item is prefixed with a coloured glyph:
//   - reasons  -> green check
//   - gaps     -> red X
//
// Both lists are rendered as a single combined block (reasons first,
// gaps second) so the card stays compact. When one of the two lists
// is empty we render an explicit empty placeholder (with a tinted
// background) instead of hiding the block — this makes "no gaps"
// feel like a positive signal rather than missing data.
//
// Empty-array handling for the *whole* component (both lists empty)
// renders a single "无 signals" hint. Callers normally treat this
// as a render guard and skip the whole card, but we keep the
// behaviour defensive so the component is safe to embed anywhere.

interface ReasonsListProps {
  reasons: string[];
  gaps: string[];
  /**
   * Optional prefix used to namespace data-testids for testing
   * multiple ReasonsList instances on the same page. Defaults to
   * `pm-match-reasons`.
   */
  testIdPrefix?: string;
}

export function ReasonsList({ reasons, gaps, testIdPrefix = 'pm-match-reasons' }: ReasonsListProps) {
  // Render guards.
  const hasReasons = reasons.length > 0;
  const hasGaps = gaps.length > 0;

  return (
    <div
      className="pm-match-reasons"
      data-testid={testIdPrefix}
      data-has-reasons={hasReasons ? 'true' : 'false'}
      data-has-gaps={hasGaps ? 'true' : 'false'}
      data-reason-count={reasons.length}
      data-gap-count={gaps.length}
    >
      {!hasReasons && !hasGaps ? (
        <div className="pm-match-reasons-empty" data-testid={`${testIdPrefix}-empty`}>
          暂无匹配信号
        </div>
      ) : (
        <>
          {hasReasons ? (
            <ul
              className="pm-match-reasons-list pm-match-reasons-list-positive"
              data-testid={`${testIdPrefix}-positive`}
              aria-label="匹配理由"
            >
              {reasons.map((reason, idx) => (
                <li
                  key={`r-${idx}-${reason}`}
                  className="pm-match-reasons-item pm-match-reasons-item-positive"
                  data-testid={`${testIdPrefix}-item-${idx}`}
                  data-kind="reason"
                  data-text={reason}
                >
                  <span className="pm-match-reasons-glyph" aria-hidden="true">
                    ✓
                  </span>
                  <span className="pm-match-reasons-text">{reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div
              className="pm-match-reasons-empty-positive"
              data-testid={`${testIdPrefix}-positive-empty`}
            >
              暂无匹配理由
            </div>
          )}

          {hasGaps ? (
            <ul
              className="pm-match-reasons-list pm-match-reasons-list-negative"
              data-testid={`${testIdPrefix}-negative`}
              aria-label="差距"
            >
              {gaps.map((gap, idx) => (
                <li
                  key={`g-${idx}-${gap}`}
                  className="pm-match-reasons-item pm-match-reasons-item-negative"
                  data-testid={`${testIdPrefix}-gap-${idx}`}
                  data-kind="gap"
                  data-text={gap}
                >
                  <span className="pm-match-reasons-glyph" aria-hidden="true">
                    ✗
                  </span>
                  <span className="pm-match-reasons-text">{gap}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div
              className="pm-match-reasons-empty-negative"
              data-testid={`${testIdPrefix}-negative-empty`}
            >
              无明显差距
            </div>
          )}
        </>
      )}
    </div>
  );
}