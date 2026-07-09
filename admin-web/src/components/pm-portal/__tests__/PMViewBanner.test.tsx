import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PMViewBanner } from '../PMViewBanner';

describe('PMViewBanner', () => {
  it('renders the PM 视角 disclaimer', () => {
    render(<PMViewBanner />);
    const banner = screen.getByTestId('pm-view-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('role', 'note');
    expect(banner).toHaveTextContent('PM 视角');
    expect(banner).toHaveTextContent('雇主方查看者只看到脱敏画像,联系方式需解锁');
  });
});
