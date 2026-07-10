import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { OnTrackAlert } from '../OnTrackAlert';

describe('OnTrackAlert', () => {
  it('renders on-track when offer+onboarded >= target', () => {
    render(<OnTrackAlert offerOnboarded={4} target={3} />);
    expect(screen.getByTestId('pm-ontrack-ok')).toHaveTextContent('✓ 节奏正常');
  });

  it('renders remediation when offer+onboarded < target', () => {
    render(<OnTrackAlert offerOnboarded={1} target={3} />);
    expect(screen.getByTestId('pm-ontrack-warn')).toBeInTheDocument();
    expect(screen.getByTestId('pm-ontrack-warn')).toHaveTextContent('还差 2 个');
  });
});
