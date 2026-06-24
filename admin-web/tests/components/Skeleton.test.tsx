import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Skeleton from '../../src/components/Skeleton';

describe('Skeleton (Sub-C)', () => {
  it('1. renders count elements with role=status', () => {
    render(<Skeleton variant="row" count={3} />);
    expect(screen.getAllByRole('status')).toHaveLength(3);
  });

  it('2. respects explicit width and height', () => {
    const { container } = render(<Skeleton variant="block" width={300} height={150} count={1} />);
    const div = container.querySelector('[role="status"]') as HTMLElement;
    expect(div.style.width).toBe('300px');
    expect(div.style.height).toBe('150px');
  });
});