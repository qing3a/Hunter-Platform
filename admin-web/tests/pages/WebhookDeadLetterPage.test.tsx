import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from '../../src/lib/toast';
import WebhookDeadLetterPage from '../../src/pages/WebhookDeadLetterPage';

vi.mock('../../src/api/webhooks', () => ({
  listDeadLetter: vi.fn(),
  retryDeadLetter: vi.fn(),
}));

import { listDeadLetter, retryDeadLetter } from '../../src/api/webhooks';

const renderPage = () => render(
  <MemoryRouter initialEntries={['/webhooks/dead-letter']}>
    <ToastProvider>
      <Routes>
        <Route path="/webhooks/dead-letter" element={<WebhookDeadLetterPage />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>
);

const mockRow = {
  id: 1, target_user_id: 'u_1', event_type: 'payment.succeeded',
  attempt_count: 5, last_error: 'HTTP 500', next_retry_at: null,
  created_at: '2026-06-25T00:00:00Z', updated_at: '2026-06-25T12:00:00Z',
};

describe('WebhookDeadLetterPage (Sub-D3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listDeadLetter as any).mockResolvedValue({
      data: [mockRow],
      pagination: { total: 1, page: 1, pageSize: 20, has_more: false },
    });
    (retryDeadLetter as any).mockResolvedValue({ id: 1, status: 'pending' });
  });

  it('1. mount calls listDeadLetter', async () => {
    renderPage();
    await waitFor(() => expect(listDeadLetter).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('dead-letter-row-1')).toBeTruthy();
  });

  it('2. changing event_type filter triggers refetch', async () => {
    renderPage();
    await waitFor(() => expect(listDeadLetter).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByTestId('filter-event-type'), { target: { value: 'payment.succeeded' } });
    await waitFor(() => expect(listDeadLetter).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'payment.succeeded' })));
  });

  it('3. clicking 重试 calls retryDeadLetter', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('retry-1'));
    fireEvent.click(screen.getByTestId('retry-1'));
    await waitFor(() => expect(retryDeadLetter).toHaveBeenCalledWith(1));
    // After retry success, listDeadLetter is refetched (≥ 1 initial + ≥ 1 after retry)
    await waitFor(() => expect(listDeadLetter.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('4. empty state when no rows', async () => {
    (listDeadLetter as any).mockResolvedValueOnce({
      data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('暂无死信')).toBeTruthy());
  });
});