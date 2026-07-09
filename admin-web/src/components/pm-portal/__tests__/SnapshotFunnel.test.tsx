import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SnapshotFunnel } from '../SnapshotFunnel';
import type { SnapshotFunnel as SnapshotFunnelData } from '../../../api/pm-portal';

// ---- Helpers --------------------------------------------------------------

function makeFunnel(overrides: Partial<SnapshotFunnelData> = {}): SnapshotFunnelData {
  return {
    funnel: undefined as never, // satisfy TS — we'll overwrite below
    ...overrides,
    projects: overrides.projects ?? {
      total: 0,
      by_status: { planning: 0, active: 0, paused: 0, completed: 0, cancelled: 0 },
    },
    positions: overrides.positions ?? {
      total: 0,
      by_status: { open: 0, paused: 0, filled: 0 },
      headcount_planned_total: 0,
      headcount_filled_total: 0,
    },
    candidates: overrides.candidates ?? { total: 0, distinct: 0 },
    matches: overrides.matches ?? { total: 0, avg_score: 0 },
  } as unknown as SnapshotFunnelData;
}

// ---- Tests ----------------------------------------------------------------

describe('SnapshotFunnel', () => {
  afterEach(() => cleanup());

  it('renders all 4 funnel cards in canonical funnel order', () => {
    render(<SnapshotFunnel funnel={makeFunnel()} />);
    const cards = screen.getAllByTestId(/^pm-snapshot-funnel-(projects|positions|candidates|matches)$/);
    expect(cards.map((c) => c.getAttribute('data-stage'))).toEqual([
      'projects', 'positions', 'candidates', 'matches',
    ]);
  });

  it('renders zeroed counts when the funnel is empty', () => {
    render(<SnapshotFunnel funnel={makeFunnel()} />);
    expect(screen.getByTestId('pm-snapshot-funnel-count-projects')).toHaveTextContent('0');
    expect(screen.getByTestId('pm-snapshot-funnel-count-positions')).toHaveTextContent('0');
    expect(screen.getByTestId('pm-snapshot-funnel-count-candidates')).toHaveTextContent('0');
    expect(screen.getByTestId('pm-snapshot-funnel-count-matches')).toHaveTextContent('0');
  });

  it('renders the headline counts for each stage', () => {
    const funnel = makeFunnel({
      projects: { total: 5, by_status: { planning: 1, active: 2, paused: 1, completed: 1, cancelled: 0 } },
      positions: { total: 12, by_status: { open: 8, paused: 2, filled: 2 }, headcount_planned_total: 30, headcount_filled_total: 12 },
      candidates: { total: 80, distinct: 45 },
      matches: { total: 120, avg_score: 76 },
    });
    render(<SnapshotFunnel funnel={funnel} />);
    expect(screen.getByTestId('pm-snapshot-funnel-projects')).toHaveAttribute('data-count', '5');
    expect(screen.getByTestId('pm-snapshot-funnel-positions')).toHaveAttribute('data-count', '12');
    // The "candidates" headline shows the DISTINCT count, not the raw total.
    expect(screen.getByTestId('pm-snapshot-funnel-candidates')).toHaveAttribute('data-count', '45');
    expect(screen.getByTestId('pm-snapshot-funnel-matches')).toHaveAttribute('data-count', '120');
    expect(screen.getByTestId('pm-snapshot-funnel-matches-avg')).toHaveTextContent('76');
  });

  it('renders the per-status bucket bullets inside each card', () => {
    const funnel = makeFunnel({
      projects: { total: 3, by_status: { planning: 1, active: 1, paused: 0, completed: 1, cancelled: 0 } },
    });
    render(<SnapshotFunnel funnel={funnel} />);
    const projectCard = screen.getByTestId('pm-snapshot-funnel-projects');
    expect(projectCard).toHaveTextContent('筹备中');
    expect(projectCard).toHaveTextContent('进行中');
    expect(projectCard).toHaveTextContent('已完成');
  });

  it('renders the position headcount totals (planned + filled)', () => {
    const funnel = makeFunnel({
      positions: { total: 2, by_status: { open: 1, paused: 0, filled: 1 }, headcount_planned_total: 8, headcount_filled_total: 3 },
    });
    render(<SnapshotFunnel funnel={funnel} />);
    const positionCard = screen.getByTestId('pm-snapshot-funnel-positions');
    expect(positionCard).toHaveTextContent('计划');
    expect(positionCard).toHaveTextContent('已填');
    expect(positionCard).toHaveTextContent('8');
    expect(positionCard).toHaveTextContent('3');
  });
});