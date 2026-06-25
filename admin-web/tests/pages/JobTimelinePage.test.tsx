import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../src/api/timeline', () => ({
  getTimeline: vi.fn(),
}));

import { getTimeline } from '../../src/api/timeline';
import JobTimelinePage from '../../src/pages/JobTimelinePage';

const renderPage = (id = 'job_1') => render(
  <MemoryRouter initialEntries={[`/jobs/${id}/timeline`]}>
    <Routes>
      <Route path="/jobs/:id/timeline" element={<JobTimelinePage />} />
    </Routes>
  </MemoryRouter>
);

const mockItem = {
  id: 1, source: 'admin' as const, action: 'pause_job', actor: 'adm_1',
  details: null, created_at: '2026-06-25T10:00:00Z',
};

describe('JobTimelinePage (Sub-D2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getTimeline as any).mockResolvedValue({
      data: [mockItem],
      pagination: { total: 1, page: 1, pageSize: 20, has_more: false },
    });
  });

  it('1. mount calls getTimeline with type=job and id from URL', async () => {
    renderPage('job_42');
    await waitFor(() => expect(getTimeline).toHaveBeenCalledWith('job', 'job_42', expect.any(Object)));
  });

  it('2. changing source filter triggers refetch', async () => {
    renderPage();
    await waitFor(() => expect(getTimeline).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByTestId('timeline-source-filter'), { target: { value: 'unlock' } });
    await waitFor(() => expect(getTimeline).toHaveBeenCalledWith('job', expect.any(String), expect.objectContaining({ source: 'unlock' })));
  });

  it('3. clearing filter resets source to all', async () => {
    renderPage();
    await waitFor(() => expect(getTimeline).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByTestId('timeline-source-filter'), { target: { value: 'admin' } });
    await waitFor(() => expect(getTimeline).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByTestId('timeline-clear'));
    await waitFor(() => expect(getTimeline).toHaveBeenLastCalledWith('job', expect.any(String), expect.objectContaining({ source: 'all' })));
  });

  it('4. shows empty state when no items', async () => {
    (getTimeline as any).mockResolvedValueOnce({
      data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false },
    });
    renderPage('job_empty');
    await waitFor(() => expect(screen.getByText('暂无事件')).toBeTruthy());
  });
});