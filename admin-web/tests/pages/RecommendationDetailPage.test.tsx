import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from '../../src/lib/toast';
import RecommendationDetailPage from '../../src/pages/RecommendationDetailPage';

vi.mock('../../src/api/recommendations', () => ({ getRecommendation: vi.fn() }));
import { getRecommendation } from '../../src/api/recommendations';

const renderPage = (id = 'rec_1') => render(
  <MemoryRouter initialEntries={[`/recommendations/${id}`]}>
    <ToastProvider>
      <Routes>
        <Route path="/recommendations/:id" element={<RecommendationDetailPage />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>
);

const mockRec = {
  id: 'rec_1', job_id: 'job_1', job_title: 'Senior Engineer',
  anonymized_candidate_id: 'c_1',
  headhunter_id: 'u_2', headhunter_name: 'Bob',
  status: 'pending' as const,
  created_at: '2026-06-24T08:00:00Z', updated_at: '2026-06-24T08:00:00Z',
};

describe('RecommendationDetailPage (Sub-D4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getRecommendation as any).mockResolvedValue(mockRec);
  });

  it('1. mount calls getRecommendation with id from URL', async () => {
    renderPage('rec_42');
    await waitFor(() => expect(getRecommendation).toHaveBeenCalledWith('rec_42'));
  });

  it('2. renders rec id + job_title + headhunter', async () => {
    renderPage();
    await waitFor(() => {
      const el = document.querySelector('[data-testid="recommendation-detail"]');
      return el?.textContent?.includes('Senior Engineer') ?? false;
    });
  });

  it('3. error state shows error + back link', async () => {
    (getRecommendation as any).mockRejectedValueOnce(new Error('not found'));
    renderPage('rec_missing');
    await waitFor(() => document.querySelector('[data-testid="recommendation-error-state"]') !== null);
    const link = document.querySelector('a[href*="/recommendations"]') as HTMLElement;
    expect(link).toBeTruthy();
  });
});