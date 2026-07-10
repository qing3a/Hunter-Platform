import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { LockedRibbon } from '../LockedRibbon';

describe('LockedRibbon', () => {
  it('renders the ribbon with "✓ 已锁定" text when locked=true', () => {
    render(<LockedRibbon locked={true} />);
    const ribbon = screen.getByTestId('pm-locked-ribbon');
    expect(ribbon).toBeInTheDocument();
    expect(ribbon.textContent).toContain('已锁定');
  });

  it('does not render anything when locked=false', () => {
    render(<LockedRibbon locked={false} />);
    expect(screen.queryByTestId('pm-locked-ribbon')).not.toBeInTheDocument();
  });
});
