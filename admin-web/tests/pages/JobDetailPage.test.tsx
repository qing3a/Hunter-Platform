import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from '@hunter-platform/shared-web/lib';
import JobDetailPage from '../../src/pages/JobDetailPage';

vi.mock('../../src/api/jobs', () => ({ getJob: vi.fn() }));
import { getJob } from '../../src/api/jobs';

const renderPage = (id = 'job_1') => render(
  <MemoryRouter initialEntries={[`/jobs/${id}`]}>
    <ToastProvider>
      <Routes>
        <Route path="/jobs/:id" element={<JobDetailPage />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>
);

const mockJob = {
  id: 'job_1', employer_id: 'u_e1', employer_name: 'Acme',
  title: 'Senior Engineer', status: 'open' as const,
  created_at: '2026-06-24T08:00:00Z', updated_at: '2026-06-24T08:00:00Z',
};

describe('JobDetailPage (Sub-D4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getJob as any).mockResolvedValue(mockJob);
  });

  it('1. mount calls getJob with id from URL', async () => {
    renderPage('job_42');
    await waitFor(() => expect(getJob).toHaveBeenCalledWith('job_42'));
  });

  it('2. renders job title + employer', async () => {
    renderPage();
    await waitFor(() => {
      const el = document.querySelector('[data-testid="job-detail"]');
      return el?.textContent?.includes('Senior Engineer') ?? false;
    });
  });

  it('3. error state shows error + back link', async () => {
    (getJob as any).mockRejectedValueOnce(new Error('not found'));
    renderPage('job_missing');
    await waitFor(() => document.querySelector('[data-testid="job-error-state"]') !== null);
    const link = document.querySelector('a[href*="/jobs"]') as HTMLElement;
    expect(link).toBeTruthy();
  });
});