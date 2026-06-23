import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AuditJsonDrawer from '../../src/components/AuditJsonDrawer';

describe('AuditJsonDrawer', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<AuditJsonDrawer open={false} onClose={() => {}} title="x" json="{}" />);
    expect(container.querySelector('.drawer-panel')).toBeNull();
  });

  it('renders title and json when open; onClose fires on backdrop click', () => {
    const onClose = vi.fn();
    render(<AuditJsonDrawer open={true} onClose={onClose} title="Request" json='{"a":1}' />);
    expect(screen.getByText('Request')).toBeInTheDocument();
    expect(screen.getByText(/a/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('drawer-backdrop'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});