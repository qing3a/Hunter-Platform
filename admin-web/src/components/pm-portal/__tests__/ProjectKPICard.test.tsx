import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { ProjectKPICard, type KpiAccent } from '../ProjectKPICard';

describe('ProjectKPICard', () => {
  afterEach(() => cleanup());

  it('renders the label', () => {
    render(<ProjectKPICard label="项目数" value={12} testId="kpi-1" />);
    expect(screen.getByText('项目数')).toBeInTheDocument();
  });

  it('renders a numeric value', () => {
    render(<ProjectKPICard label="项目数" value={12} testId="kpi-1" />);
    expect(screen.getByTestId('kpi-1-value')).toHaveTextContent('12');
  });

  it('renders a pre-formatted string value (e.g. ¥1.2M budget)', () => {
    render(<ProjectKPICard label="总预算" value="¥120万" testId="kpi-2" />);
    expect(screen.getByTestId('kpi-2-value')).toHaveTextContent('¥120万');
  });

  it('applies the data-accent attribute (defaults to blue)', () => {
    const { rerender } = render(<ProjectKPICard label="L" value={1} testId="kpi" />);
    let tile = screen.getByTestId('kpi');
    expect(tile.getAttribute('data-accent')).toBe('blue');

    rerender(<ProjectKPICard label="L" value={1} accent="green" testId="kpi" />);
    tile = screen.getByTestId('kpi');
    expect(tile.getAttribute('data-accent')).toBe('green');
  });

  it('supports all four accent variants from the design system', () => {
    const accents: KpiAccent[] = ['green', 'blue', 'amber', 'purple'];
    for (const accent of accents) {
      const { unmount } = render(
        <ProjectKPICard label="L" value={1} accent={accent} testId={`kpi-${accent}`} />,
      );
      expect(screen.getByTestId(`kpi-${accent}`).getAttribute('data-accent')).toBe(accent);
      unmount();
    }
  });

  it('renders 0 as a valid value (not blank)', () => {
    render(<ProjectKPICard label="活跃项目" value={0} testId="kpi-3" />);
    expect(screen.getByTestId('kpi-3-value')).toHaveTextContent('0');
  });
});
