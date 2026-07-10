import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DrillFunnelCard } from '../DrillFunnelCard';

describe('DrillFunnelCard', () => {
  it('renders the stage label, count, and ordinal', () => {
    render(<DrillFunnelCard stage="projects" count={12} ordinal="①" subItems={[{ label: '进行中', value: 5 }]} onClick={vi.fn()} />);
    expect(screen.getByTestId('pm-funnel-stage-projects')).toHaveTextContent('①');
    expect(screen.getByTestId('pm-funnel-stage-projects')).toHaveTextContent('项目');
    expect(screen.getByTestId('pm-funnel-stage-projects')).toHaveTextContent('12');
    expect(screen.getByTestId('pm-funnel-stage-projects')).toHaveTextContent('进行中 5');
  });

  it('fires onClick when card is clicked', () => {
    const onClick = vi.fn();
    render(<DrillFunnelCard stage="projects" count={12} ordinal="①" subItems={[]} onClick={onClick} />);
    fireEvent.click(screen.getByTestId('pm-funnel-stage-projects'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('uses stage-specific colors via CSS vars', () => {
    render(<DrillFunnelCard stage="matches" count={4} ordinal="④" subItems={[]} onClick={vi.fn()} />);
    const card = screen.getByTestId('pm-funnel-stage-matches');
    expect(card.className).toMatch(/pm-funnel-stage--matches/);
  });
});