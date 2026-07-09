import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
  EmployerKPICard,
  type EmployerKpiAccent,
} from '../EmployerKPICard';

describe('EmployerKPICard', () => {
  afterEach(() => cleanup());

  it('renders the label', () => {
    render(<EmployerKPICard label="活跃工作" value={3} testId="kpi-1" />);
    expect(screen.getByText('活跃工作')).toBeInTheDocument();
  });

  it('renders a numeric value', () => {
    render(<EmployerKPICard label="活跃工作" value={3} testId="kpi-1" />);
    expect(screen.getByTestId('kpi-1-value')).toHaveTextContent('3');
  });

  it('renders a pre-formatted string value (e.g. ¥1.2M spend)', () => {
    render(
      <EmployerKPICard label="本月花费" value="¥12,000" testId="kpi-2" />,
    );
    expect(screen.getByTestId('kpi-2-value')).toHaveTextContent('¥12,000');
  });

  it('applies the data-accent attribute (defaults to blue)', () => {
    const { rerender } = render(
      <EmployerKPICard label="L" value={1} testId="kpi" />,
    );
    let tile = screen.getByTestId('kpi');
    expect(tile.getAttribute('data-accent')).toBe('blue');

    rerender(
      <EmployerKPICard label="L" value={1} accent="green" testId="kpi" />,
    );
    tile = screen.getByTestId('kpi');
    expect(tile.getAttribute('data-accent')).toBe('green');
  });

  it('supports all four accent variants from the design system', () => {
    const accents: EmployerKpiAccent[] = ['green', 'blue', 'amber', 'purple'];
    for (const accent of accents) {
      const { unmount } = render(
        <EmployerKPICard
          label="L"
          value={1}
          accent={accent}
          testId={`kpi-${accent}`}
        />,
      );
      expect(screen.getByTestId(`kpi-${accent}`).getAttribute('data-accent')).toBe(accent);
      unmount();
    }
  });

  it('renders 0 as a valid value (not blank)', () => {
    render(<EmployerKPICard label="成交数" value={0} testId="kpi-3" />);
    expect(screen.getByTestId('kpi-3-value')).toHaveTextContent('0');
  });

  it('renders an optional subText caption beneath the label', () => {
    render(
      <EmployerKPICard
        label="权威源"
        value="ERP-A"
        subText="同步于 2 分钟前"
        testId="kpi-4"
      />,
    );
    const tile = screen.getByTestId('kpi-4');
    expect(tile).toHaveTextContent('同步于 2 分钟前');
  });
});