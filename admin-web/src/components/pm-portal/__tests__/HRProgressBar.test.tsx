import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { HRProgressBar } from '../HRProgressBar';

describe('HRProgressBar', () => {
  it('renders 0% when filled=0 planned=5', () => {
    render(<HRProgressBar filled={0} planned={5} />);
    expect(screen.getByTestId('pm-hr-bar')).toHaveAttribute('data-pct', '0');
  });

  it('renders 80% with green color when filled=4 planned=5', () => {
    render(<HRProgressBar filled={4} planned={5} />);
    expect(screen.getByTestId('pm-hr-bar')).toHaveAttribute('data-pct', '80');
    expect(screen.getByTestId('pm-hr-bar-fill')).toHaveStyle({ background: '#16a34a' });
  });

  it('renders 50% with amber color when filled=2 planned=4', () => {
    render(<HRProgressBar filled={2} planned={4} />);
    expect(screen.getByTestId('pm-hr-bar')).toHaveAttribute('data-pct', '50');
    expect(screen.getByTestId('pm-hr-bar-fill')).toHaveStyle({ background: '#d97706' });
  });
});