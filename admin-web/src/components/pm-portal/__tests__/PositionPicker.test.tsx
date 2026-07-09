import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PositionPicker } from '../PositionPicker';

describe('PositionPicker', () => {
  const positions = [
    { id: 'pos-1', title: '前端', title_level: 'P5' },
    { id: 'pos-2', title: '后端', title_level: 'P6' },
  ];

  it('renders the select with level annotations', () => {
    render(
      <PositionPicker positions={positions} value="pos-1" onChange={vi.fn()} />,
    );
    const opts = screen
      .getByTestId('pm-position-picker')
      .querySelectorAll('option');
    expect(opts[0].textContent).toContain('前端 (P5)');
  });
});