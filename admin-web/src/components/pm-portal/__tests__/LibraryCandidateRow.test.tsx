import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { LibraryCandidateRow } from '../LibraryCandidateRow';
import type { LibraryCandidate } from '../../../api/pm-portal';

// ---- Helpers --------------------------------------------------------------

function makeCandidate(overrides: Partial<LibraryCandidate> = {}): LibraryCandidate {
  return {
    candidate_user_id: 'cand-1',
    display_name: '张*三',
    current_best_match: {
      score: 90,
      position_title: '高级前端工程师',
      position_id: 'pos-1',
      project_name: 'AI 工程',
      project_id: 'proj-1',
    },
    position_count: 3,
    ...overrides,
  };
}

interface RenderArgs {
  candidate?: LibraryCandidate;
  index?: number;
  variant?: 'table' | 'card';
  starred?: boolean | null;
  noteText?: string;
}

function renderRow({
  candidate = makeCandidate(),
  index = 0,
  variant = 'table',
  starred = false,
  noteText = '',
}: RenderArgs = {}) {
  const onViewDetail = vi.fn();
  const onToggleStar = vi.fn();
  render(
    <LibraryCandidateRow
      candidate={candidate}
      index={index}
      variant={variant}
      onViewDetail={onViewDetail}
      onToggleStar={onToggleStar}
      starred={starred}
      noteText={noteText}
    />,
  );
  return { onViewDetail, onToggleStar };
}

// ============================================================================
// Table variant — happy path
// ============================================================================

describe('LibraryCandidateRow — table variant', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders the masked display name + position title + project name', () => {
    renderRow();
    const row = screen.getByTestId('pm-library-row-0');
    expect(row).toHaveTextContent('张*三');
    expect(row).toHaveTextContent('高级前端工程师');
    expect(screen.getByTestId('pm-library-row-0-project')).toHaveTextContent('AI 工程');
  });

  it('renders the candidate_user_id + best score as data-* attributes', () => {
    renderRow();
    const row = screen.getByTestId('pm-library-row-0');
    expect(row).toHaveAttribute('data-candidate-user-id', 'cand-1');
    expect(row).toHaveAttribute('data-score', '90');
    expect(row).toHaveAttribute('data-band', 'excellent');
  });

  it('renders the position_count in the dedicated cell', () => {
    renderRow();
    expect(screen.getByTestId('pm-library-row-0-positions')).toHaveTextContent('3');
  });

  it('falls back to 匿名候选人 when display_name is null', () => {
    renderRow({ candidate: makeCandidate({ display_name: null }) });
    expect(screen.getByTestId('pm-library-row-0-name')).toHaveTextContent('匿名候选人');
  });

  it('maps scores < 60 to the poor band via data-band', () => {
    renderRow({
      candidate: makeCandidate({
        current_best_match: {
          ...makeCandidate().current_best_match,
          score: 42,
        },
      }),
    });
    expect(screen.getByTestId('pm-library-row-0')).toHaveAttribute('data-band', 'poor');
  });

  it('renders the star button with aria-pressed=false when starred=false', () => {
    renderRow({ starred: false });
    const star = screen.getByTestId('pm-library-row-0-star');
    expect(star).toHaveAttribute('aria-pressed', 'false');
    expect(star).toHaveTextContent('☆');
  });

  it('renders the star button with aria-pressed=true + filled glyph when starred=true', () => {
    renderRow({ starred: true });
    const star = screen.getByTestId('pm-library-row-0-star');
    expect(star).toHaveAttribute('aria-pressed', 'true');
    expect(star).toHaveTextContent('★');
  });

  it('disables the star button while starred is null (still loading)', () => {
    renderRow({ starred: null });
    const star = screen.getByTestId('pm-library-row-0-star');
    expect(star).toBeDisabled();
  });

  it('disables the star button when onToggleStar is omitted', () => {
    render(
      <LibraryCandidateRow
        candidate={makeCandidate()}
        index={0}
        variant="table"
        starred={false}
      />,
    );
    expect(screen.getByTestId('pm-library-row-0-star')).toBeDisabled();
  });

  it('fires onToggleStar with the next boolean when the star is clicked', () => {
    const { onToggleStar } = renderRow({ starred: false });
    fireEvent.click(screen.getByTestId('pm-library-row-0-star'));
    expect(onToggleStar).toHaveBeenCalledTimes(1);
    const [arg1, arg2] = onToggleStar.mock.calls[0];
    expect(arg1.candidate_user_id).toBe('cand-1');
    expect(arg2).toBe(true);
  });

  it('fires onToggleStar(false) when an already-starred row is clicked', () => {
    const { onToggleStar } = renderRow({ starred: true });
    fireEvent.click(screen.getByTestId('pm-library-row-0-star'));
    expect(onToggleStar).toHaveBeenCalledWith(expect.any(Object), false);
  });

  it('fires onViewDetail with the candidate when 查看详情 is clicked', () => {
    const { onViewDetail } = renderRow();
    fireEvent.click(screen.getByTestId('pm-library-row-0-detail'));
    expect(onViewDetail).toHaveBeenCalledTimes(1);
    expect(onViewDetail.mock.calls[0][0].candidate_user_id).toBe('cand-1');
  });

  it('disables the 查看详情 button when onViewDetail is omitted', () => {
    render(
      <LibraryCandidateRow
        candidate={makeCandidate()}
        index={0}
        variant="table"
        starred={false}
      />,
    );
    expect(screen.getByTestId('pm-library-row-0-detail')).toBeDisabled();
  });
});

// ============================================================================
// Card variant
// ============================================================================

describe('LibraryCandidateRow — card variant', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders the card variant with the candidate name + score badge', () => {
    renderRow({ variant: 'card' });
    const card = screen.getByTestId('pm-library-row-0');
    expect(card).toHaveTextContent('张*三');
    expect(screen.getByTestId('pm-library-row-0-score')).toHaveTextContent('90');
  });

  it('hides the note preview chip when no noteText is supplied', () => {
    renderRow({ variant: 'card' });
    expect(screen.queryByTestId('pm-library-row-0-note')).toBeNull();
  });

  it('renders the note preview chip when noteText is non-empty', () => {
    renderRow({ variant: 'card', noteText: '已联系, 等回复' });
    const note = screen.getByTestId('pm-library-row-0-note');
    expect(note).toHaveTextContent('已联系, 等回复');
  });

  it('hides the note preview chip when noteText is whitespace only', () => {
    renderRow({ variant: 'card', noteText: '   ' });
    expect(screen.queryByTestId('pm-library-row-0-note')).toBeNull();
  });

  it('renders the position_count summary inside the project meta line', () => {
    renderRow({ variant: 'card' });
    expect(screen.getByTestId('pm-library-row-0-positions')).toHaveTextContent('3');
  });

  it('exposes the candidate_user_id + score + band as data-* attributes on the card', () => {
    renderRow({ variant: 'card' });
    const card = screen.getByTestId('pm-library-row-0');
    expect(card).toHaveAttribute('data-candidate-user-id', 'cand-1');
    expect(card).toHaveAttribute('data-score', '90');
    expect(card).toHaveAttribute('data-band', 'excellent');
  });
});