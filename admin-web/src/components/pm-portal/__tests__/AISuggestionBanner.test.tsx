import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AISuggestionBanner } from '../AISuggestionBanner';

describe('AISuggestionBanner', () => {
  it('renders the suggestion text', () => {
    render(<AISuggestionBanner suggestion="建议增加 1 名 国际化工程师 (P6, 10 月到岗, 估计 +30 万成本)" onApply={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByTestId('pm-ai-suggestion')).toHaveTextContent('国际化工程师');
  });

  it('fires onApply when apply button is clicked', () => {
    const onApply = vi.fn();
    render(<AISuggestionBanner suggestion="建议…" onApply={onApply} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /采纳/ }));
    expect(onApply).toHaveBeenCalledOnce();
  });
});
