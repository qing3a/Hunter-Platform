import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TriangleRadar } from '../TriangleRadar';

describe('TriangleRadar', () => {
  it('renders an inline SVG with 3 axes (gridline + value polygon)', () => {
    render(<TriangleRadar values={{ coverage: 80, match: 70, composite: 90 }} locked={false} />);
    const svg = screen.getByTestId('pm-triangle-radar');
    expect(svg.tagName).toBe('svg');
    // 2 polygons: outer gridline + inner value
    expect(svg.querySelectorAll('polygon')).toHaveLength(2);
  });

  it('applies locked color (#dbeafe) when locked=true', () => {
    render(<TriangleRadar values={{ coverage: 50, match: 60, composite: 70 }} locked={true} />);
    const value = screen.getByTestId('pm-triangle-radar-value');
    expect(value.getAttribute('fill')).toBe('#dbeafe');
  });

  it('applies unlocked color (#f3f4f6) when locked=false', () => {
    render(<TriangleRadar values={{ coverage: 50, match: 60, composite: 70 }} locked={false} />);
    const value = screen.getByTestId('pm-triangle-radar-value');
    expect(value.getAttribute('fill')).toBe('#f3f4f6');
  });
});
