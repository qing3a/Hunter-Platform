import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PipelineStageBadge } from '../PipelineStageBadge';
import type { PipelineStage } from '../../../api/hunter-portal';

const STAGE_LABELS: Record<PipelineStage, string> = {
  submitted: '投递',
  screen_passed: '简历过',
  interview: '面试',
  offer: 'Offer',
  onboarded: '到岗',
  rejected: '已拒绝',
};

const STAGE_COLORS: Record<PipelineStage, string> = {
  submitted: '#3b82f6',
  screen_passed: '#8b5cf6',
  interview: '#ec4899',
  offer: '#f59e0b',
  onboarded: '#10b981',
  rejected: '#6b7280',
};

const ALL_STAGES: PipelineStage[] = [
  'submitted',
  'screen_passed',
  'interview',
  'offer',
  'onboarded',
  'rejected',
];

describe('PipelineStageBadge', () => {
  it('renders label for every stage', () => {
    for (const stage of ALL_STAGES) {
      const { unmount } = render(<PipelineStageBadge stage={stage} />);
      expect(screen.getByText(STAGE_LABELS[stage])).toBeInTheDocument();
      unmount();
    }
  });

  it('uses the correct text color for the stage', () => {
    for (const stage of ALL_STAGES) {
      const { unmount } = render(<PipelineStageBadge stage={stage} />);
      const badge = screen.getByText(STAGE_LABELS[stage]);
      // jsdom normalizes hex colors to rgb(); check via style attribute on the element.
      const computed = (badge as HTMLElement).style.color;
      expect(computed).toBeTruthy();
      // The hex color must appear somewhere in the rgb conversion (browser normalizes).
      const hex = STAGE_COLORS[stage];
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      expect(computed).toBe(`rgb(${r}, ${g}, ${b})`);
      unmount();
    }
  });

  it('applies an alpha-tinted background color matching the stage color', () => {
    const stage: PipelineStage = 'submitted';
    render(<PipelineStageBadge stage={stage} />);
    const badge = screen.getByText(STAGE_LABELS[stage]) as HTMLElement;
    const bg = badge.style.backgroundColor;
    // The hex '22' suffix (alpha) becomes rgba() in jsdom. Verify the numeric RGB portion
    // matches the stage hex, and that an alpha channel is present.
    const hex = STAGE_COLORS[stage];
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    expect(bg.startsWith(`rgba(${r}, ${g}, ${b},`)).toBe(true);
  });

  it('applies borderColor matching the stage color', () => {
    render(<PipelineStageBadge stage="offer" />);
    const badge = screen.getByText('Offer') as HTMLElement;
    const hex = STAGE_COLORS.offer;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    expect(badge.style.borderColor).toBe(`rgb(${r}, ${g}, ${b})`);
  });

  it('uses md size by default (className contains hp-pipeline-badge--md)', () => {
    render(<PipelineStageBadge stage="interview" />);
    const badge = screen.getByText(STAGE_LABELS.interview);
    expect(badge.className).toContain('hp-pipeline-badge');
    expect(badge.className).toContain('hp-pipeline-badge--md');
    expect(badge.className).not.toContain('hp-pipeline-badge--sm');
  });

  it('uses sm size when size="sm" is passed', () => {
    render(<PipelineStageBadge stage="interview" size="sm" />);
    const badge = screen.getByText(STAGE_LABELS.interview);
    expect(badge.className).toContain('hp-pipeline-badge--sm');
    expect(badge.className).not.toContain('hp-pipeline-badge--md');
  });

  it('uses md size when size="md" is passed explicitly', () => {
    render(<PipelineStageBadge stage="onboarded" size="md" />);
    const badge = screen.getByText(STAGE_LABELS.onboarded);
    expect(badge.className).toContain('hp-pipeline-badge--md');
  });
});
