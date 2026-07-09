import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SandboxFunnelCard } from '../SandboxFunnelCard';
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
//
// Task 8 — SandboxFunnelCard refactor:
//   - props simplified to just `{ bucket }` (no more isExpanded/onToggle)
//   - the candidate list is ALWAYS rendered inline (no click-to-expand)
//
// Tests below cover both the basic funnel-card rendering AND the new
// always-inline candidate list behaviour.

describe('SandboxFunnelCard', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders the stage label and count', () => {
    render(
      <SandboxFunnelCard
        bucket={makeBucket('submitted', { count: 7 })}
      />,
    );
    const card = screen.getByTestId('pm-sandbox-funnel-submitted');
    expect(card).toBeInTheDocument();
    expect(card).toHaveTextContent('投递');
    expect(card).toHaveTextContent('7');
    expect(card).toHaveAttribute('data-count', '7');
    expect(card).toHaveAttribute('data-stage', 'submitted');
  });

  it('does NOT expose the click-to-expand interaction (Task 8 — always inline)', () => {
    render(
      <SandboxFunnelCard
        bucket={makeBucket('interview', { count: 3 })}
      />,
    );
    const card = screen.getByTestId('pm-sandbox-funnel-interview');
    expect(card).not.toHaveAttribute('role', 'button');
    expect(card).not.toHaveAttribute('aria-expanded');
    expect(card).not.toHaveAttribute('data-expanded');
  });

  it('does NOT show a risk indicator when both stuck_* counts are 0', () => {
    render(
      <SandboxFunnelCard
        bucket={makeBucket('submitted', { count: 2, risk_count: { stuck_long: 0, stuck_very_long: 0 } })}
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
      />,
    );
    expect(screen.getByTestId('pm-sandbox-funnel-screen_passed')).toHaveAttribute('data-risk-count', '3');
    expect(screen.getByTestId('pm-sandbox-funnel-risk-screen_passed')).toHaveTextContent('3 风险');
  });

  it('renders all 6 stages correctly via the same component', () => {
    const stages: SandboxStage[] = ['submitted', 'screen_passed', 'interview', 'offer', 'onboarded', 'rejected'];
    for (const stage of stages) {
      cleanup();
      render(
        <SandboxFunnelCard
          bucket={makeBucket(stage, { count: 1 })}
        />,
      );
      expect(screen.getByTestId(`pm-sandbox-funnel-${stage}`)).toBeInTheDocument();
    }
  });
});

// -------------------------------------------------------------------------
// Task 8 — inline candidate list (no longer behind a click)
// -------------------------------------------------------------------------

describe('SandboxFunnelCard — inline candidate list', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders <ul className="pm-funnel-candidates"> by default (no click needed)', () => {
    render(
      <SandboxFunnelCard
        bucket={makeBucket('screen_passed', {
          count: 2,
          candidates: [
            makeCandidate({ recommendation_id: 'rec_a', candidate_display_name: 'A***ce', stage_entered_at: Date.now() - 5 * 86_400_000 }),
            makeCandidate({ recommendation_id: 'rec_b', candidate_display_name: 'B***ob', stage_entered_at: Date.now() - 35 * 86_400_000, risk_flags: ['stuck_long'] }),
          ],
        })}
      />,
    );
    const list = screen.getByTestId('pm-sandbox-funnel-candidates-screen_passed');
    expect(list).toBeInTheDocument();
    expect(list.tagName).toBe('UL');
    expect(list).toHaveClass('pm-funnel-candidates');
  });

  it('renders each candidate with masked name + relative stage-entry time', () => {
    render(
      <SandboxFunnelCard
        bucket={makeBucket('interview', {
          count: 1,
          candidates: [
            makeCandidate({
              recommendation_id: 'rec_x',
              candidate_display_name: 'A***ce',
              stage_entered_at: Date.now() - 2 * 86_400_000,
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText('A***ce')).toBeInTheDocument();
    expect(
      screen.getByTestId('pm-sandbox-funnel-candidate-entered-interview-rec_x'),
    ).toHaveTextContent('2 天前进入');
  });

  it('renders risk-flag chips inline per candidate', () => {
    render(
      <SandboxFunnelCard
        bucket={makeBucket('offer', {
          count: 1,
          candidates: [
            makeCandidate({
              recommendation_id: 'rec_y',
              risk_flags: ['stuck_very_long'],
            }),
          ],
        })}
      />,
    );
    const chip = screen.getByTestId('pm-sandbox-funnel-candidate-flag-rec_y-stuck_very_long');
    expect(chip).toHaveTextContent('停留 > 60 天');
  });

  it('renders the empty placeholder when no candidates are present', () => {
    render(
      <SandboxFunnelCard
        bucket={makeBucket('rejected', { count: 0, candidates: [] })}
      />,
    );
    expect(
      screen.getByTestId('pm-sandbox-funnel-candidates-empty-rejected'),
    ).toHaveTextContent('—');
  });
});
