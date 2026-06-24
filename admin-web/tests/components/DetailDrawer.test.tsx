import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DetailDrawer from '../../src/components/DetailDrawer';

describe('DetailDrawer (Sub-C)', () => {
  it('1. does not render when open=false', () => {
    render(<DetailDrawer open={false} title="X" data={{ a: 1 }} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('2. renders title and JSON-stringified data when open', () => {
    render(<DetailDrawer open={true} title="Job Detail" data={{ id: 'job_1', status: 'open' }} onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Job Detail');
    expect(screen.getByText(/"id": "job_1"/)).toBeTruthy();
    expect(screen.getByText(/"status": "open"/)).toBeTruthy();
  });

  it('3. ESC key calls onClose', () => {
    const onClose = vi.fn();
    render(<DetailDrawer open={true} title="X" data={null} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});