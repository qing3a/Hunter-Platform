import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RecommendationsPage from '../../src/pages/RecommendationsPage';

vi.mock('../../src/api/recommendations', () => ({
  listRecommendations: vi.fn(),
}));

import { listRecommendations } from '../../src/api/recommendations';

const renderPage = () => render(<MemoryRouter><RecommendationsPage /></MemoryRouter>);

describe('RecommendationsPage (Sub-C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listRecommendations as any).mockResolvedValue({
      data: [
        { id: 'rec_1', job_id: 'job_1', job_title: 'Eng', anonymized_candidate_id: 'c_1', headhunter_id: 'u_2', headhunter_name: 'Bob', status: 'pending', created_at: '2026-06-24T00:00:00Z', updated_at: '2026-06-24T00:00:00Z' },
      ],
      pagination: { total: 1, page: 1, pageSize: 20, has_more: false },
    });
  });

  it('1. mount calls listRecommendations and renders row', async () => {
    renderPage();
    await waitFor(() => expect(listRecommendations).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Eng')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
  });

  it('2. search passes keyword + status', async () => {
    renderPage();
    await waitFor(() => expect(listRecommendations).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByPlaceholderText(/搜索/), { target: { value: 'eng' } });
    fireEvent.click(screen.getByText('搜索'));
    await waitFor(() => expect(listRecommendations).toHaveBeenCalledWith(expect.objectContaining({ keyword: 'eng' })));
  });

  it('3. date from changes triggers refetch with from param', async () => {
    renderPage();
    await waitFor(() => expect(listRecommendations).toHaveBeenCalledTimes(1));
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-06-01' } });
    await waitFor(() => expect(listRecommendations).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-06-01T00:00:00Z' })));
  });

  it('4. 详情 navigates to detail page (Sub-D4 update)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('detail-link-rec_1')).toBeTruthy());
    expect(screen.getByTestId('detail-link-rec_1').getAttribute('href')).toBe('/recommendations/rec_1');
  });

  it('5. CSV button visible', async () => {
    renderPage();
    await waitFor(() => screen.getByText(/导出 CSV/));
  });

  it('6. empty state shown', async () => {
    (listRecommendations as any).mockResolvedValue({ data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } });
    renderPage();
    await waitFor(() => expect(screen.getByText('未找到推荐')).toBeTruthy());
  });
});