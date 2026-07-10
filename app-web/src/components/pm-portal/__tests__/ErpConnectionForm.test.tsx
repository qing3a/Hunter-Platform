import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ErpConnectionForm } from '../ErpConnectionForm';

describe('ErpConnectionForm', () => {
  it('renders 2 backend radio options + URL/Token inputs', () => {
    render(
      <ErpConnectionForm
        value={{ backend: 'MOCK', url: '', token: '' }}
        onChange={vi.fn()}
        onTest={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/MOCK/)).toBeChecked();
    expect(screen.getByLabelText(/ow-headhunter-erp/)).not.toBeChecked();
    expect(screen.getByTestId('pm-erp-url')).toBeInTheDocument();
    expect(screen.getByTestId('pm-erp-token')).toBeInTheDocument();
  });

  it('fires onSave with the form values', () => {
    const onSave = vi.fn();
    render(
      <ErpConnectionForm
        value={{ backend: 'MOCK', url: 'https://erp.example.com', token: 'tok' }}
        onChange={vi.fn()}
        onTest={vi.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /保存设置/ }));
    expect(onSave).toHaveBeenCalledOnce();
  });
});