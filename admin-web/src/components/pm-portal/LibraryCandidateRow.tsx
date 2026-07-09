// ============================================================================
// LibraryCandidateRow (Task 14 / S9)
// ============================================================================
//
// A single row / card in the Candidate Library page. Renders either as
// a table row (`<tr>` with `<td>` cells) or as a compact card
// (`<article>`). The shape is selected by the `variant` prop so the
// parent page can swap modes via the view toggle.
//
// Visual contract
// ---------------
//   table:
//     ┌───────────────────────────────────────────────────────────┐
//     │ 姓名  | 当前最佳匹配     | 项目  | 岗位 | ⭐ | 操作        │
//     │ 张*三 | 90 高级前端      | AI工程| 3    | ★ | 查看详情  →  │
//     └───────────────────────────────────────────────────────────┘
//
//   card (vertical compact card, grid-laid by the parent):
//     ┌──────────────────────────┐
//     │ 张*三     [★]   [查看详情] │
//     │ 90 · 高级前端             │
//     │ AI工程 · 3 个岗位         │
//     └──────────────────────────┘
//
// Star button (⭐)
// ----------------
// Independent of "查看详情" — the PM can star a candidate inline
// without navigating away. The row never owns the star state; the
// parent page feeds the boolean + handler in via props so it can
// co-ordinate cache invalidation with the rest of the library.
//
// Click-through
// -------------
// The "查看详情" button is wired by the page via `onViewDetail`. The
// card variant renders the button as the primary CTA; the table
// variant renders it as the right-most cell. When `onViewDetail` is
// omitted the button is disabled and labelled as a placeholder
// (mirrors the MatchCard convention used elsewhere in the workbench).

import type { LibraryCandidate } from '../../api/pm-portal';
import { ScoreBadge, scoreBand } from './ScoreBadge';

export type LibraryCandidateRowVariant = 'table' | 'card';

interface LibraryCandidateRowProps {
  /** Aggregated candidate row from `pmLibrary.list()`. */
  candidate: LibraryCandidate;
  /**
   * Render position index — used to namespace testids when multiple
   * rows live on the page.
   */
  index: number;
  /** Visual variant. */
  variant: LibraryCandidateRowVariant;
  /** Click handler for the "查看详情" button. Disabled when omitted. */
  onViewDetail?: (candidate: LibraryCandidate) => void;
  /** PM-private starred flag. `null` = unknown / not yet fetched. */
  starred: boolean | null;
  /** Click handler for the ⭐ icon. Disabled when omitted. */
  onToggleStar?: (candidate: LibraryCandidate, next: boolean) => void;
  /**
   * PM-private note text preview. When omitted or empty the row
   * hides the note preview chip (the card variant renders the chip
   * only when there's text to show).
   */
  noteText?: string;
}

// ----- helpers -------------------------------------------------------------

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ----- component -----------------------------------------------------------

export function LibraryCandidateRow({
  candidate,
  index,
  variant,
  onViewDetail,
  starred,
  onToggleStar,
  noteText,
}: LibraryCandidateRowProps) {
  const testIdPrefix = `pm-library-row-${index}`;
  const displayName = candidate.display_name ?? '匿名候选人';
  const band = scoreBand(candidate.current_best_match.score);
  const isStarred = starred === true;
  const isStarUnknown = starred === null;
  const notePreview = (noteText ?? '').trim();
  const hasNotePreview = notePreview.length > 0;

  // ----- shared handlers ------------------------------------------------

  const handleViewDetail = () => {
    if (onViewDetail) onViewDetail(candidate);
  };

  const handleToggleStar = () => {
    if (onToggleStar) onToggleStar(candidate, !isStarred);
  };

  // ----- shared children ------------------------------------------------

  const starButton = (
    <button
      type="button"
      className="pm-library-row-star"
      data-testid={`${testIdPrefix}-star`}
      onClick={handleToggleStar}
      disabled={!onToggleStar || isStarUnknown}
      aria-pressed={isStarred}
      aria-label={isStarred ? '取消关注候选人' : '关注候选人'}
      title={isStarred ? '取消关注' : '关注候选人'}
    >
      <span aria-hidden="true" className="pm-library-row-star-glyph">
        {isStarred ? '★' : '☆'}
      </span>
    </button>
  );

  const detailButton = (
    <button
      type="button"
      className="pm-library-row-detail"
      data-testid={`${testIdPrefix}-detail`}
      onClick={handleViewDetail}
      disabled={!onViewDetail}
      title={onViewDetail ? '查看候选人详情' : '查看详情（即将上线）'}
    >
      查看详情
    </button>
  );

  // ----- variant: card --------------------------------------------------

  if (variant === 'card') {
    return (
      <article
        className="pm-library-card"
        data-testid={testIdPrefix}
        data-candidate-user-id={candidate.candidate_user_id}
        data-score={candidate.current_best_match.score}
        data-band={band}
        data-starred={isStarUnknown ? 'unknown' : String(isStarred)}
        aria-label={`候选人 ${displayName}, 当前最佳匹配 ${candidate.current_best_match.score}`}
      >
        <header className="pm-library-card-header">
          <ScoreBadge
            score={candidate.current_best_match.score}
            size="md"
            testId={`${testIdPrefix}-score`}
          />
          <h3
            className="pm-library-card-name"
            data-testid={`${testIdPrefix}-name`}
            title={displayName}
          >
            {truncate(displayName, 16)}
          </h3>
          {starButton}
          {detailButton}
        </header>
        <div className="pm-library-card-meta">
          <span
            className="pm-library-card-position"
            data-testid={`${testIdPrefix}-position`}
            title={candidate.current_best_match.position_title}
          >
            {candidate.current_best_match.score} · {truncate(candidate.current_best_match.position_title, 18)}
          </span>
          <span
            className="pm-library-card-project"
            data-testid={`${testIdPrefix}-project`}
          >
            @{truncate(candidate.current_best_match.project_name, 18)}
            {' · '}
            <span data-testid={`${testIdPrefix}-positions`}>
              {candidate.position_count} 个岗位
            </span>
          </span>
          {hasNotePreview && (
            <span
              className="pm-library-card-note"
              data-testid={`${testIdPrefix}-note`}
              title={notePreview}
            >
              📝 {truncate(notePreview, 28)}
            </span>
          )}
        </div>
      </article>
    );
  }

  // ----- variant: table -------------------------------------------------

  return (
    <tr
      className="pm-library-row"
      data-testid={testIdPrefix}
      data-candidate-user-id={candidate.candidate_user_id}
      data-score={candidate.current_best_match.score}
      data-band={band}
      data-starred={isStarUnknown ? 'unknown' : String(isStarred)}
    >
      <td
        className="pm-library-row-name"
        data-testid={`${testIdPrefix}-name`}
        title={displayName}
      >
        {displayName}
      </td>
      <td
        className="pm-library-row-match"
        data-testid={`${testIdPrefix}-match`}
      >
        <ScoreBadge
          score={candidate.current_best_match.score}
          size="sm"
          testId={`${testIdPrefix}-score`}
        />
        <span className="pm-library-row-position">
          {candidate.current_best_match.position_title}
        </span>
      </td>
      <td
        className="pm-library-row-project"
        data-testid={`${testIdPrefix}-project`}
        title={candidate.current_best_match.project_name}
      >
        {truncate(candidate.current_best_match.project_name, 18)}
      </td>
      <td
        className="pm-library-row-positions"
        data-testid={`${testIdPrefix}-positions`}
      >
        {candidate.position_count}
      </td>
      <td className="pm-library-row-star-cell">{starButton}</td>
      <td className="pm-library-row-detail-cell">{detailButton}</td>
    </tr>
  );
}