import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../src/api/timeline', () => ({
  getTimeline: vi.fn(),
}));

import { getTimeline } from '../../src/api/timeline';
import UserTimelinePage from '../../src/pages/UserTimelinePage';

const renderPage = (id = 'usr_1') => render(
  <MemoryRouter initialEntries={[`/users/${id}/timeline`]}>
    <Routes>
      <Route path="/users/:id/timeline" element={<UserTimelinePage />} />
    </Routes>
  </MemoryRouter>
);

const mockItem = {
  id: 1, source: 'admin' as const, action: 'adjust_user_quota', actor: 'adm_1',
  details: null, created_at: '2026-06-25T10:00:00Z',
};

describe('UserTimelinePage (Sub-D2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getTimeline as any).mockResolvedValue({
      data: [mockItem],
      pagination: { total: 1, page: 1, pageSize: 20, has_more: false },
    });
  });

  it('1. mount calls getTimeline with type=user and id from URL', async () => {
    renderPage('usr_42');
    await waitFor(() => expect(getTimeline).toHaveBeenCalledWith('user', 'usr_42', expect.any(Object)));
  });

  it('2. changing source filter triggers refetch', async () => {
    renderPage();
    await waitFor(() => expect(getTimeline).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByTestId('timeline-source-filter'), { target: { value: 'admin' } });
    await waitFor(() => expect(getTimeline).toHaveBeenCalledWith('user', expect.any(String), expect.objectContaining({ source: 'admin' })));
  });

  it('3. clearing filter resets all fields', async () => {
    renderPage();
    await waitFor(() => expect(getTimeline).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByTestId('timeline-source-filter'), { target: { value: 'admin' } });
    await waitFor(() => expect(getTimeline).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByTestId('timeline-clear'));
    await waitFor(() => expect(getTimeline).toHaveBeenLastCalledWith('user', expect.any(String), expect.objectContaining({ source: 'all' })));
  });

  it('4. shows empty state when no items', async () => {
    (getTimeline as any).mockResolvedValueOnce({
      data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false },
    });
    renderPage('usr_empty');
    await waitFor(() => expect(screen.getByText('暂无事件')).toBeTruthy());
  });
});