import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from '@hunter-platform/shared-web/lib';
import PlacementsPage from '../../src/pages/PlacementsPage';

vi.mock('../../src/api/placements', () => ({
  listPlacements: vi.fn(),
  markPaid: vi.fn(),
  cancelPlacement: vi.fn(),
}));

import { listPlacements, markPaid, cancelPlacement } from '../../src/api/placements';

const renderPage = () => render(
  <MemoryRouter initialEntries={['/placements']}>
    <ToastProvider>
      <Routes>
        <Route path="/placements" element={<PlacementsPage />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>
);

const renderPageWithUrl = (initialUrl: string) => render(
  <MemoryRouter initialEntries={[initialUrl]}>
    <ToastProvider>
      <Routes>
        <Route path="/placements" element={<PlacementsPage />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>
);

const mockPending = {
  id: 'p_1', job_id: 'job_1', employer_id: 'u_emp',
  anonymized_candidate_id: 'c_1', primary_headhunter_id: null, referrer_headhunter_id: null,
  annual_salary: 500000, platform_fee: 50000, primary_share: 40000, referrer_share: 10000,
  status: 'pending_payment' as const, created_at: '2026-06-25T00:00:00Z', updated_at: '2026-06-25T00:00:00Z',
};

describe('PlacementsPage (Sub-D3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listPlacements as any).mockResolvedValue({
      data: [mockPending],
      pagination: { total: 1, page: 1, pageSize: 20, has_more: false },
    });
    (markPaid as any).mockResolvedValue({ id: 'p_1', status: 'paid' });
    (cancelPlacement as any).mockResolvedValue({ id: 'p_1', status: 'cancelled' });
  });

  it('1. mount calls listPlacements and renders row', async () => {
    renderPage();
    await waitFor(() => expect(listPlacements).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('placement-row-p_1')).toBeTruthy();
  });

  it('2. changing status triggers refetch', async () => {
    renderPage();
    await waitFor(() => expect(listPlacements).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByTestId('filter-status'), { target: { value: 'paid' } });
    await waitFor(() => expect(listPlacements).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid' })));
  });

  it('3. clicking 标记已付款 opens ConfirmModal', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('mark-paid-p_1'));
    fireEvent.click(screen.getByTestId('mark-paid-p_1'));
    expect(screen.getByText('确认标记为已付款？这将触发佣金结算。')).toBeTruthy();
  });

  it('4. confirming calls markPaid + refetches', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('mark-paid-p_1'));
    fireEvent.click(screen.getByTestId('mark-paid-p_1'));
    fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
    await waitFor(() => expect(markPaid).toHaveBeenCalledWith('p_1'));
    await waitFor(() => expect(listPlacements.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('5. clicking 取消 opens danger ConfirmModal + calls cancelPlacement', async () => {
    renderPage();
    await waitFor(() => screen.getByTestId('cancel-p_1'));
    fireEvent.click(screen.getByTestId('cancel-p_1'));
    expect(screen.getByText('确认取消此 placement？这将无法撤销。')).toBeTruthy();
    fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
    await waitFor(() => expect(cancelPlacement).toHaveBeenCalledWith('p_1'));
  });

  it('7. mount reads filter from URL (useUrlParam)', async () => {
    (listPlacements as any).mockResolvedValue({ data: [], pagination: { total: 0, page: 3, pageSize: 20, has_more: false } });
    renderPageWithUrl('/placements?status=paid&from=2026-06-01T00:00:00Z&until=2026-06-30T23:59:59Z&page=3');
    await waitFor(() => expect(listPlacements).toHaveBeenCalledWith(expect.objectContaining({
      page: 3,
      status: 'paid',
    })));
  });

  it('8. changing status filter updates list via useUrlParam', async () => {
    (listPlacements as any).mockResolvedValue({ data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } });
    renderPage();
    await waitFor(() => expect(listPlacements).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByTestId('filter-status'), { target: { value: 'paid' } });
    await waitFor(() => expect(listPlacements).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'paid' })
    ));
  });
});;