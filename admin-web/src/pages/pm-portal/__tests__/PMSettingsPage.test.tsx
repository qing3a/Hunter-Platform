import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PMSettingsPage } from '../PMSettingsPage';

// The ToastProvider only holds state in context (no visual surface),
// so we mock useToast to assert on push() calls directly.
const pushSpy = vi.fn();
vi.mock('../../../lib/toast', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, useToast: () => ({ toasts: [], push: pushSpy, dismiss: vi.fn() }) };
});

const STORAGE_KEY = 'pm.settings.erp';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/pm/settings']}>
      <Routes>
        <Route path="/admin/pm/settings" element={<PMSettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PMSettingsPage', () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    pushSpy.mockReset();
    vi.useRealTimers();
  });
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it('renders form + status table + call log sections', () => {
    renderPage();
    expect(screen.getByTestId('pm-erp-form')).toBeInTheDocument();
    expect(screen.getByTestId('pm-erp-status-table')).toBeInTheDocument();
    expect(screen.getByTestId('pm-erp-log')).toBeInTheDocument();
  });

  it('seeds the form from localStorage on first render', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ backend: 'ow-headhunter-erp', url: 'https://erp.example.com', token: 'tok-123' }),
    );
    renderPage();
    expect(screen.getByLabelText(/ow-headhunter-erp/)).toBeChecked();
    expect(screen.getByTestId('pm-erp-url')).toHaveValue('https://erp.example.com');
    expect(screen.getByTestId('pm-erp-token')).toHaveValue('tok-123');
  });

  it('toggles the ERP backend radio', () => {
    renderPage();
    expect(screen.getByLabelText(/MOCK/)).toBeChecked();
    fireEvent.click(screen.getByLabelText(/ow-headhunter-erp/));
    expect(screen.getByLabelText(/ow-headhunter-erp/)).toBeChecked();
    expect(screen.getByLabelText(/MOCK/)).not.toBeChecked();
  });

  it('updates the URL input as a controlled field', () => {
    renderPage();
    const url = screen.getByTestId('pm-erp-url');
    fireEvent.change(url, { target: { value: 'https://erp.acme.io' } });
    expect(url).toHaveValue('https://erp.acme.io');
  });

  it('saves config to localStorage and pushes a success toast', () => {
    renderPage();
    fireEvent.change(screen.getByTestId('pm-erp-url'), { target: { value: 'https://erp.acme.io' } });
    fireEvent.change(screen.getByTestId('pm-erp-token'), { target: { value: 'tok-xyz' } });
    fireEvent.click(screen.getByRole('button', { name: /保存设置/ }));

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(stored.url).toBe('https://erp.acme.io');
    expect(stored.token).toBe('tok-xyz');

    const last = pushSpy.mock.calls[pushSpy.mock.calls.length - 1]?.[0] as { type: string; message: string };
    expect(last.type).toBe('success');
    expect(last.message).toMatch(/ERP 设置已保存/);
  });

  it('test connection: bumps published + toast after a 1s delay', () => {
    vi.useFakeTimers();
    renderPage();
    expect(screen.getByTestId('pm-erp-published')).toHaveTextContent('0');

    fireEvent.click(screen.getByRole('button', { name: /测试连接/ }));

    // No toast yet — the 1s setTimeout hasn't fired.
    expect(pushSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('pm-erp-published')).toHaveTextContent('0');

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(pushSpy).toHaveBeenCalled();
    const last = pushSpy.mock.calls[pushSpy.mock.calls.length - 1]?.[0] as { type: string; message: string };
    expect(last.type).toBe('success');
    expect(last.message).toMatch(/测试连接成功/);
    expect(screen.getByTestId('pm-erp-published')).toHaveTextContent('1');
  });

  it('reflects the saved backend in the status table immediately', () => {
    renderPage();
    expect(screen.getByTestId('pm-erp-status-table')).toHaveTextContent('MOCK');
    fireEvent.click(screen.getByLabelText(/ow-headhunter-erp/));
    expect(screen.getByTestId('pm-erp-status-table')).toHaveTextContent('ow-headhunter-erp');
  });
});