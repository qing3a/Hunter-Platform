import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MatchCard } from '../MatchCard';
import type { MatchListItem } from '../../../api/pm-portal';

// ---- Helpers --------------------------------------------------------------

function makeMatch(overrides: Partial<MatchListItem> = {}): MatchListItem {
  return {
    match_id: 1,
    position_id: 'pos-1',
    candidate_user_id: 'cand-1',
    score: 85,
    reasons: ['技能匹配', '职级匹配'],
    gaps: ['缺 rust 经验'],
    created_at: 1_700_000_000_000,
    candidate_display_name: '张*三',
    headline: '5 年前端 · React / TS',
    ...overrides,
  };
}

// ---- Tests ----------------------------------------------------------------

describe('MatchCard — basic rendering', () => {
  beforeEach(() => cleanup());

  it('renders the masked display name in the header', () => {
    render(<MatchCard match={makeMatch({ candidate_display_name: '李*四' })} index={0} />);
    expect(screen.getByTestId('pm-match-card-0-name')).toHaveTextContent('李*四');
  });

  it('falls back to "匿名候选人" when the display name is null', () => {
    render(<MatchCard match={makeMatch({ candidate_display_name: null })} index={0} />);
    expect(screen.getByTestId('pm-match-card-0-name')).toHaveTextContent('匿名候选人');
  });

  it('renders the headline when present', () => {
    render(
      <MatchCard match={makeMatch({ headline: '8 年后端 · Go / k8s' })} index={0} />,
    );
    const headline = screen.getByTestId('pm-match-card-0-headline');
    expect(headline).toBeInTheDocument();
    expect(headline).toHaveTextContent('8 年后端 · Go / k8s');
  });

  it('hides the headline block entirely when headline is null', () => {
    render(<MatchCard match={makeMatch({ headline: null })} index={0} />);
    expect(screen.queryByTestId('pm-match-card-0-headline')).toBeNull();
  });

  it('hides the headline block when headline is empty / whitespace-only', () => {
    render(<MatchCard match={makeMatch({ headline: '   ' })} index={0} />);
    expect(screen.queryByTestId('pm-match-card-0-headline')).toBeNull();
  });
});

describe('MatchCard — score / band wiring', () => {
  beforeEach(() => cleanup());

  it('embeds the score via ScoreBadge and reflects it on the article data-score', () => {
    render(<MatchCard match={makeMatch({ score: 92 })} index={0} />);
    const card = screen.getByTestId('pm-match-card-0');
    expect(card).toHaveAttribute('data-score', '92');
    expect(card).toHaveAttribute('data-band', 'excellent');
    // The score badge value should also render.
    expect(screen.getByTestId('pm-match-card-0-score')).toHaveTextContent('92');
  });

  it('maps low scores to the poor band', () => {
    render(<MatchCard match={makeMatch({ score: 35 })} index={0} />);
    expect(screen.getByTestId('pm-match-card-0')).toHaveAttribute('data-band', 'poor');
  });

  it('uses index to namespace nested test ids', () => {
    render(<MatchCard match={makeMatch()} index={3} />);
    expect(screen.getByTestId('pm-match-card-3')).toBeInTheDocument();
    expect(screen.getByTestId('pm-match-card-3-score')).toBeInTheDocument();
    expect(screen.getByTestId('pm-match-card-3-name')).toBeInTheDocument();
    expect(screen.queryByTestId('pm-match-card-0')).toBeNull();
  });
});

describe('MatchCard — match id / candidate id attrs', () => {
  beforeEach(() => cleanup());

  it('exposes match_id and candidate_user_id as data-* attrs', () => {
    render(
      <MatchCard
        match={makeMatch({ match_id: 42, candidate_user_id: 'cand-42' })}
        index={0}
      />,
    );
    const card = screen.getByTestId('pm-match-card-0');
    expect(card).toHaveAttribute('data-match-id', '42');
    expect(card).toHaveAttribute('data-candidate-user-id', 'cand-42');
  });
});

describe('MatchCard — reasons / gaps wiring', () => {
  beforeEach(() => cleanup());

  it('renders every reason with a positive item marker', () => {
    render(
      <MatchCard
        match={makeMatch({ reasons: ['技能匹配', '职级匹配', '城市匹配'] })}
        index={0}
      />,
    );
    expect(screen.getByTestId('pm-match-card-0-reasons-positive')).toBeInTheDocument();
    expect(screen.getByTestId('pm-match-card-0-reasons-item-0')).toHaveTextContent('技能匹配');
    expect(screen.getByTestId('pm-match-card-0-reasons-item-1')).toHaveTextContent('职级匹配');
    expect(screen.getByTestId('pm-match-card-0-reasons-item-2')).toHaveTextContent('城市匹配');
  });

  it('renders every gap with a negative item marker', () => {
    render(
      <MatchCard
        match={makeMatch({ gaps: ['缺 rust 经验', '期望薪资偏高'] })}
        index={0}
      />,
    );
    expect(screen.getByTestId('pm-match-card-0-reasons-negative')).toBeInTheDocument();
    expect(screen.getByTestId('pm-match-card-0-reasons-gap-0')).toHaveTextContent('缺 rust 经验');
    expect(screen.getByTestId('pm-match-card-0-reasons-gap-1')).toHaveTextContent('期望薪资偏高');
  });

  it('shows a "无明显差距" placeholder when gaps are empty', () => {
    render(<MatchCard match={makeMatch({ gaps: [] })} index={0} />);
    expect(screen.getByTestId('pm-match-card-0-reasons-negative-empty')).toHaveTextContent(
      '无明显差距',
    );
    expect(screen.queryByTestId('pm-match-card-0-reasons-negative')).toBeNull();
  });

  it('shows a "暂无匹配理由" placeholder when reasons are empty', () => {
    render(<MatchCard match={makeMatch({ reasons: [] })} index={0} />);
    expect(screen.getByTestId('pm-match-card-0-reasons-positive-empty')).toHaveTextContent(
      '暂无匹配理由',
    );
    expect(screen.queryByTestId('pm-match-card-0-reasons-positive')).toBeNull();
  });
});

describe('MatchCard — 查看详情 button', () => {
  beforeEach(() => cleanup());

  it('renders the button as disabled when no onViewDetail handler is provided', () => {
    render(<MatchCard match={makeMatch()} index={0} />);
    const btn = screen.getByTestId('pm-match-card-0-detail');
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('查看详情');
  });

  it('fires onViewDetail with the full match object on click', () => {
    const onViewDetail = vi.fn();
    const match = makeMatch({ match_id: 7 });
    render(<MatchCard match={match} index={0} onViewDetail={onViewDetail} />);
    const btn = screen.getByTestId('pm-match-card-0-detail');
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onViewDetail).toHaveBeenCalledTimes(1);
    expect(onViewDetail).toHaveBeenCalledWith(match);
  });

  it('does NOT fire onViewDetail when the button is disabled (no handler)', () => {
    const onViewDetail = vi.fn();
    render(<MatchCard match={makeMatch()} index={0} />);
    // Disabled buttons don't propagate click events in JSDOM/Testing Library.
    fireEvent.click(screen.getByTestId('pm-match-card-0-detail'));
    expect(onViewDetail).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Task 11 — score tier label + per-row ActionStack wiring
// ============================================================================

describe('MatchCard — score tier label (Task 11)', () => {
  beforeEach(() => cleanup());

  it('renders the 高分 tier for an excellent score (>=90)', () => {
    render(<MatchCard match={makeMatch({ score: 95 })} index={0} />);
    const tier = screen.getByTestId('pm-match-card-0-tier');
    expect(tier).toHaveTextContent('高分');
    expect(tier).toHaveAttribute('data-tier', 'high');
    expect(screen.getByTestId('pm-match-card-0')).toHaveAttribute('data-tier', 'high');
  });

  it('renders the 中分 tier for a good/fair score (60-89)', () => {
    render(<MatchCard match={makeMatch({ score: 72 })} index={0} />);
    const tier = screen.getByTestId('pm-match-card-0-tier');
    expect(tier).toHaveTextContent('中分');
    expect(tier).toHaveAttribute('data-tier', 'mid');
  });

  it('renders the 低分 tier for a poor score (<60)', () => {
    render(<MatchCard match={makeMatch({ score: 40 })} index={0} />);
    const tier = screen.getByTestId('pm-match-card-0-tier');
    expect(tier).toHaveTextContent('低分');
    expect(tier).toHaveAttribute('data-tier', 'low');
  });
});

describe('MatchCard — per-row ActionStack (Task 11)', () => {
  beforeEach(() => cleanup());

  it('renders an <ActionStack> in the card footer', () => {
    render(<MatchCard match={makeMatch()} index={0} />);
    expect(screen.getByTestId('pm-match-card-0-footer')).toBeInTheDocument();
    expect(screen.getByTestId('pm-action-stack')).toBeInTheDocument();
  });

  it('fires onRecommend with the match object when the recommend button is clicked', () => {
    const onRecommend = vi.fn();
    const match = makeMatch({ match_id: 99 });
    render(<MatchCard match={match} index={0} onRecommend={onRecommend} />);
    fireEvent.click(screen.getByTestId('pm-action-recommend'));
    expect(onRecommend).toHaveBeenCalledTimes(1);
    expect(onRecommend).toHaveBeenCalledWith(match);
  });

  it('fires onUnlock with the match object when the unlock button is clicked', () => {
    const onUnlock = vi.fn();
    const match = makeMatch({ match_id: 7 });
    render(<MatchCard match={match} index={0} onUnlock={onUnlock} />);
    fireEvent.click(screen.getByTestId('pm-action-unlock'));
    expect(onUnlock).toHaveBeenCalledTimes(1);
    expect(onUnlock).toHaveBeenCalledWith(match);
  });

  it('fires onReject with the match object when the reject button is clicked', () => {
    const onReject = vi.fn();
    const match = makeMatch({ match_id: 13 });
    render(<MatchCard match={match} index={0} onReject={onReject} />);
    fireEvent.click(screen.getByTestId('pm-action-reject'));
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledWith(match);
  });

  it('does nothing when action callbacks are omitted and the buttons are clicked', () => {
    // No callbacks — we just assert the buttons exist and clicking
    // them doesn't throw.
    render(<MatchCard match={makeMatch()} index={0} />);
    expect(() => {
      fireEvent.click(screen.getByTestId('pm-action-recommend'));
      fireEvent.click(screen.getByTestId('pm-action-unlock'));
      fireEvent.click(screen.getByTestId('pm-action-reject'));
    }).not.toThrow();
  });
});