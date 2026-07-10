import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionStack } from '../ActionStack';

describe('ActionStack', () => {
  it('renders 3 action buttons (recommend / unlock / reject)', () => {
    render(
      <ActionStack
        onRecommend={vi.fn()}
        onUnlock={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /推荐给猎头/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /解锁/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /不合适/ })).toBeInTheDocument();
  });

  it('fires the matching callback when each button is clicked', () => {
    const onRecommend = vi.fn();
    const onUnlock = vi.fn();
    const onReject = vi.fn();
    render(
      <ActionStack
        onRecommend={onRecommend}
        onUnlock={onUnlock}
        onReject={onReject}
      />,
    );
    fireEvent.click(screen.getByTestId('pm-action-recommend'));
    fireEvent.click(screen.getByTestId('pm-action-unlock'));
    fireEvent.click(screen.getByTestId('pm-action-reject'));
    expect(onRecommend).toHaveBeenCalledTimes(1);
    expect(onUnlock).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
  });
});
