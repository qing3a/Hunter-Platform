import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TierBadgeRow } from '../TierBadgeRow';

describe('TierBadgeRow', () => {
  it('renders 5 tier badges with A/B/C/D grading', () => {
    render(
      <TierBadgeRow
        dims={[
          { label: '前端', value: 80 },
          { label: '后端', value: 60 },
          { label: '移动', value: 30 },
          { label: '数据', value: 75 },
          { label: '设计', value: 50 },
        ]}
      />,
    );
    expect(screen.getAllByTestId('pm-tier-badge')).toHaveLength(5);
    expect(screen.getByText('前端').closest('[data-tier]')).toHaveAttribute('data-tier', 'A');
  });
});
