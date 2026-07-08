import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RadarChart } from '../RadarChart';

describe('RadarChart', () => {
  it('renders svg with given dimensions', () => {
    const { container } = render(
      <RadarChart dimensions={[
        { label: '技能', score: 80 },
        { label: '经验', score: 60 },
        { label: '薪资', score: 90 },
        { label: '行业', score: 70 },
        { label: '职级', score: 85 },
      ]} />
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg!.querySelectorAll('text')).toHaveLength(5);
    expect(svg!.querySelector('polygon')).toBeInTheDocument();
  });

  it('handles fewer dimensions', () => {
    const { container } = render(
      <RadarChart dimensions={[
        { label: 'A', score: 50 },
        { label: 'B', score: 50 },
      ]} />
    );
    expect(container.querySelector('polygon')).toBeInTheDocument();
  });
});