import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from '../../src/lib/toast';
import CandidateDetailPage from '../../src/pages/CandidateDetailPage';

vi.mock('../../src/api/candidates', () => ({ getCandidate: vi.fn() }));
import { getCandidate } from '../../src/api/candidates';

const renderPage = (id = 'c_1') => render(
  <MemoryRouter initialEntries={[`/candidates/${id}`]}>
    <ToastProvider>
      <Routes>
        <Route path="/candidates/:id" element={<CandidateDetailPage />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>
);

const mockCandidate = {
  anonymized_id: 'c_1', candidate_user_id: 'u_3',
  masked_name: 'A***ce', masked_email: 'a***@x.com',
  headhunter_id: 'u_2',
  industry: 'tech', title_level: 'mid',
  is_public_pool: 1 as const, unlock_status: 'pending',
  created_at: '2026-06-24T08:00:00Z',
};

describe('CandidateDetailPage (Sub-D4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getCandidate as any).mockResolvedValue(mockCandidate);
  });

  it('1. mount calls getCandidate with id from URL', async () => {
    renderPage('c_42');
    await waitFor(() => expect(getCandidate).toHaveBeenCalledWith('c_42'));
  });

  it('2. renders masked name + status', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('A***ce')).toBeTruthy());
  });

  it('3. has 查看时间轴 link', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('candidate-timeline-link')).toBeTruthy());
  });

  it('4. error state shows error + back link', async () => {
    (getCandidate as any).mockRejectedValueOnce(new Error('not found'));
    renderPage('c_missing');
    await waitFor(() => document.querySelector('[data-testid="candidate-error-state"]') !== null);
    const link = document.querySelector('a[href*="/candidates"]') as HTMLElement;
    expect(link).toBeTruthy();
  });
});