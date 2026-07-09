import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
  ScoreBadge,
  scoreBand,
  SCORE_BAND_LABELS,
  type ScoreBand,
} from '../ScoreBadge';

// ============================================================================
// scoreBand() — pure-function coverage. This is the single source of truth
// for the colour band so it deserves its own block.
// ============================================================================

describe('scoreBand()', () => {
  it('maps 100 down to 90 inclusive -> "excellent"', () => {
    for (const score of [100, 95, 90]) {
      expect(scoreBand(score), `score ${score} should be excellent`).toBe('excellent');
    }
  });

  it('maps 89 down to 75 inclusive -> "good"', () => {
    for (const score of [89, 80, 75]) {
      expect(scoreBand(score), `score ${score} should be good`).toBe('good');
    }
  });

  it('maps 74 down to 60 inclusive -> "fair"', () => {
    for (const score of [74, 67, 60]) {
      expect(scoreBand(score), `score ${score} should be fair`).toBe('fair');
    }
  });

  it('maps 59 down to 0 inclusive -> "poor"', () => {
    for (const score of [59, 30, 0]) {
      expect(scoreBand(score), `score ${score} should be poor`).toBe('poor');
    }
  });

  it('exposes a Chinese label for every band', () => {
    const bands: ScoreBand[] = ['excellent', 'good', 'fair', 'poor'];
    for (const b of bands) {
      expect(SCORE_BAND_LABELS[b]).toBeTruthy();
      expect(SCORE_BAND_LABELS[b]).not.toBe(b); // labels must be human Chinese, not the band key
    }
  });
});

// ============================================================================
// <ScoreBadge> — component coverage.
// ============================================================================

describe('ScoreBadge', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders the numeric score, the correct band class, and data-* attrs', () => {
    render(<ScoreBadge score={87} />);
    const badge = screen.getByTestId('pm-score-badge');
    expect(badge).toHaveClass('pm-score-badge');
    expect(badge).toHaveClass('pm-score-badge-md'); // default size
    expect(badge).toHaveClass('pm-score-badge-good');
    expect(badge).toHaveAttribute('data-score', '87');
    expect(badge).toHaveAttribute('data-band', 'good');
    expect(badge).toHaveAttribute('data-size', 'md');
    expect(screen.getByTestId('pm-score-badge-value')).toHaveTextContent('87');
  });

  it('supports sm / md / lg size variants', () => {
    const { rerender } = render(<ScoreBadge score={75} size="sm" />);
    expect(screen.getByTestId('pm-score-badge')).toHaveClass('pm-score-badge-sm');

    rerender(<ScoreBadge score={75} size="md" />);
    expect(screen.getByTestId('pm-score-badge')).toHaveClass('pm-score-badge-md');

    rerender(<ScoreBadge score={75} size="lg" />);
    expect(screen.getByTestId('pm-score-badge')).toHaveClass('pm-score-badge-lg');
  });

  it('respects a custom testId', () => {
    render(<ScoreBadge score={50} testId="my-score" />);
    expect(screen.getByTestId('my-score')).toBeInTheDocument();
    expect(screen.queryByTestId('pm-score-badge')).toBeNull();
  });

  it('clamps negative scores to 0 (poor band)', () => {
    render(<ScoreBadge score={-5} />);
    const badge = screen.getByTestId('pm-score-badge');
    expect(badge).toHaveAttribute('data-score', '0');
    expect(badge).toHaveClass('pm-score-badge-poor');
    expect(screen.getByTestId('pm-score-badge-value')).toHaveTextContent('0');
  });

  it('clamps scores above 100 to 100 (excellent band)', () => {
    render(<ScoreBadge score={250} />);
    const badge = screen.getByTestId('pm-score-badge');
    expect(badge).toHaveAttribute('data-score', '100');
    expect(badge).toHaveClass('pm-score-badge-excellent');
  });

  it('rounds fractional scores to the nearest integer', () => {
    render(<ScoreBadge score={59.6} />);
    // 59.6 rounds to 60 -> fair
    expect(screen.getByTestId('pm-score-badge')).toHaveAttribute('data-score', '60');
    expect(screen.getByTestId('pm-score-badge')).toHaveClass('pm-score-badge-fair');
  });

  it('sets an aria-label including the score and Chinese band label', () => {
    render(<ScoreBadge score={92} />);
    const badge = screen.getByTestId('pm-score-badge');
    const ariaLabel = badge.getAttribute('aria-label') ?? '';
    expect(ariaLabel).toContain('92');
    expect(ariaLabel).toContain('优秀');
  });

  it('uses role="img" so screen readers treat it as a label, not text', () => {
    render(<ScoreBadge score={40} />);
    expect(screen.getByTestId('pm-score-badge')).toHaveAttribute('role', 'img');
  });

  it('marks the boundary 90 as excellent (inclusive lower bound)', () => {
    render(<ScoreBadge score={90} />);
    expect(screen.getByTestId('pm-score-badge')).toHaveAttribute('data-band', 'excellent');
  });

  it('marks 89 as good (exclusive lower bound for excellent)', () => {
    render(<ScoreBadge score={89} />);
    expect(screen.getByTestId('pm-score-badge')).toHaveAttribute('data-band', 'good');
  });
});