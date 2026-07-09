import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  SandboxFunnelCard,
  SandboxCandidateRow,
} from '../SandboxFunnelCard';
import type {
  SandboxStageBucket,
  SandboxCandidate,
  SandboxStage,
} from '../../../api/pm-portal';

// ---- Helpers --------------------------------------------------------------

function makeBucket(stage: SandboxStage, overrides: Partial<SandboxStageBucket> = {}): SandboxStageBucket {
  return {
    stage,
    count: 0,
    risk_count: { stuck_long: 0, stuck_very_long: 0 },
    candidates: [],
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<SandboxCandidate> = {}): SandboxCandidate {
  return {
    recommendation_id: 'rec_1',
    candidate_user_id: 'cand_user_1',
    candidate_display_name: 'A***ce',
    stage_entered_at: Date.now() - 5 * 86_400_000,
    risk_flags: [],
    ...overrides,
  };
}

// ---- Tests ----------------------------------------------------------------

describe('SandboxFunnelCard', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders the stage label and count', () => {
    render(
      <SandboxFunnelCard
        bucket={makeBucket('submitted', { count: 7 })}
        isExpanded={false}
        onToggle={() => {}}
      />,
    );
    const card = screen.getByTestId('pm-sandbox-funnel-submitted');
    expect(card).toBeInTheDocument();
    expect(card).toHaveTextContent('投递');
    expect(card).toHaveTextContent('7');
    expect(card).toHaveAttribute('data-count', '7');
    expect(card).toHaveAttribute('data-stage', 'submitted');
    expect(card).toHaveAttribute('data-expanded', 'false');
  });

  it('fires onToggle with the stage on click', () => {
    const onToggle = vi.fn();
    render(
      <SandboxFunnelCard
        bucket={makeBucket('interview', { count: 3 })}
        isExpanded={false}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByTestId('pm-sandbox-funnel-interview'));
    expect(onToggle).toHaveBeenCalledWith('interview');
  });

  it('fires onToggle on Enter / Space keyboard activation', () => {
    const onToggle = vi.fn();
    render(
      <SandboxFunnelCard
        bucket={makeBucket('offer', { count: 1 })}
        isExpanded={false}
        onToggle={onToggle}
      />,
    );
    const card = screen.getByTestId('pm-sandbox-funnel-offer');
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onToggle).toHaveBeenNthCalledWith(1, 'offer');
    expect(onToggle).toHaveBeenNthCalledWith(2, 'offer');
  });

  it('does NOT show a risk indicator when both stuck_* counts are 0', () => {
    render(
      <SandboxFunnelCard
        bucket={makeBucket('submitted', { count: 2, risk_count: { stuck_long: 0, stuck_very_long: 0 } })}
        isExpanded={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.queryByTestId('pm-sandbox-funnel-risk-submitted')).toBeNull();
    expect(screen.getByTestId('pm-sandbox-funnel-submitted')).not.toHaveClass('has-risk');
  });

  it('shows a risk indicator with the correct total when stuck_long > 0', () => {
    render(
      <SandboxFunnelCard
        bucket={makeBucket('interview', {
          count: 5,
          risk_count: { stuck_long: 2, stuck_very_long: 0 },
        })}
        isExpanded={false}
        onToggle={() => {}}
      />,
    );
    const card = screen.getByTestId('pm-sandbox-funnel-interview');
    expect(card).toHaveClass('has-risk');
    const risk = screen.getByTestId('pm-sandbox-funnel-risk-interview');
    expect(risk).toHaveTextContent('2 风险');
    expect(card).toHaveAttribute('data-risk-count', '2');
  });

  it('shows the combined stuck_long + stuck_very_long risk total', () => {
    render(
      <SandboxFunnelCard
        bucket={makeBucket('screen_passed', {
          count: 4,
          risk_count: { stuck_long: 1, stuck_very_long: 2 },
        })}
        isExpanded={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByTestId('pm-sandbox-funnel-screen_passed')).toHaveAttribute('data-risk-count', '3');
    expect(screen.getByTestId('pm-sandbox-funnel-risk-screen_passed')).toHaveTextContent('3 风险');
  });

  it('marks the card as expanded when isExpanded=true', () => {
    render(
      <SandboxFunnelCard
        bucket={makeBucket('onboarded', { count: 1 })}
        isExpanded={true}
        onToggle={() => {}}
      />,
    );
    const card = screen.getByTestId('pm-sandbox-funnel-onboarded');
    expect(card).toHaveClass('is-expanded');
    expect(card).toHaveAttribute('data-expanded', 'true');
    expect(card).toHaveAttribute('aria-expanded', 'true');
    expect(card).toHaveTextContent('收起');
  });

  it('renders the empty hint when count is 0', () => {
    render(
      <SandboxFunnelCard
        bucket={makeBucket('rejected', { count: 0 })}
        isExpanded={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByTestId('pm-sandbox-funnel-rejected')).toHaveTextContent('空');
  });

  it('renders each of the 6 stages correctly via the same component', () => {
    const stages: SandboxStage[] = ['submitted', 'screen_passed', 'interview', 'offer', 'onboarded', 'rejected'];
    for (const stage of stages) {
      cleanup();
      render(
        <SandboxFunnelCard
          bucket={makeBucket(stage, { count: 1 })}
          isExpanded={false}
          onToggle={() => {}}
        />,
      );
      expect(screen.getByTestId(`pm-sandbox-funnel-${stage}`)).toBeInTheDocument();
    }
  });
});

describe('SandboxCandidateRow', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders the masked candidate name', () => {
    render(
      <SandboxCandidateRow
        candidate={makeCandidate({ candidate_display_name: 'A***ce' })}
        stage="submitted"
      />,
    );
    expect(screen.getByText('A***ce')).toBeInTheDocument();
  });

  it('renders "无风险" when the candidate has no flags', () => {
    render(
      <SandboxCandidateRow
        candidate={makeCandidate({ risk_flags: [] })}
        stage="submitted"
      />,
    );
    expect(screen.getByText('无风险')).toBeInTheDocument();
  });

  it('renders a stuck_long flag chip when present', () => {
    render(
      <SandboxCandidateRow
        candidate={makeCandidate({
          risk_flags: ['stuck_long'],
          recommendation_id: 'rec_x',
        })}
        stage="screen_passed"
      />,
    );
    expect(screen.getByTestId('pm-sandbox-candidate-flag-rec_x-stuck_long')).toHaveTextContent(
      '停留 > 30 天',
    );
  });

  it('renders a stuck_very_long flag chip with the severe style', () => {
    render(
      <SandboxCandidateRow
        candidate={makeCandidate({
          risk_flags: ['stuck_very_long'],
          recommendation_id: 'rec_y',
        })}
        stage="offer"
      />,
    );
    const chip = screen.getByTestId('pm-sandbox-candidate-flag-rec_y-stuck_very_long');
    expect(chip).toHaveTextContent('停留 > 60 天');
    expect(chip).toHaveClass('pm-sandbox-candidate-flag-severe');
  });

  it('disables the detail button (placeholder)', () => {
    render(
      <SandboxCandidateRow
        candidate={makeCandidate({ recommendation_id: 'rec_z' })}
        stage="submitted"
      />,
    );
    const btn = screen.getByTestId('pm-sandbox-candidate-detail-rec_z');
    expect(btn).toBeDisabled();
  });

  it('formats the stage_entered_at timestamp as a relative Chinese string', () => {
    render(
      <SandboxCandidateRow
        candidate={makeCandidate({
          stage_entered_at: Date.now() - 2 * 86_400_000,
        })}
        stage="submitted"
      />,
    );
    expect(screen.getByText(/2 天前/)).toBeInTheDocument();
  });
});