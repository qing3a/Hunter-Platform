import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ReadOnlyChip } from '../ReadOnlyChip';

describe('ReadOnlyChip', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders the chip when mounted', () => {
    render(<ReadOnlyChip />);
    const chip = screen.getByTestId('pm-readonly-chip');
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent('只读');
  });

  it('renders with the data-testid="pm-readonly-chip" hook and an explanatory title', () => {
    render(<ReadOnlyChip />);
    const chip = screen.getByTestId('pm-readonly-chip');
    expect(chip.tagName).toBe('SPAN');
    expect(chip.className).toContain('pm-readonly-chip');
    expect(chip.getAttribute('title')).toBe('候选人权威在 ERP');
  });
});