import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import JobsPage from '../../src/pages/JobsPage';

vi.mock('../../src/api/jobs', () => ({
  listJobs: vi.fn(),
}));

import { listJobs } from '../../src/api/jobs';

const renderPage = () => render(<MemoryRouter><JobsPage /></MemoryRouter>);

const renderPageWithUrl = (initialUrl: string) => render(
  <MemoryRouter initialEntries={[initialUrl]}>
    <JobsPage />
  </MemoryRouter>
);

describe('JobsPage (Sub-C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listJobs as any).mockResolvedValue({
      data: [
        { id: 'job_1', employer_id: 'u_1', employer_name: 'Acme', title: 'Engineer', status: 'open', created_at: '2026-06-24T00:00:00Z', updated_at: '2026-06-24T00:00:00Z' },
      ],
      pagination: { total: 1, page: 1, pageSize: 20, has_more: false },
    });
  });

  it('1. mount calls listJobs and renders rows', async () => {
    renderPage();
    await waitFor(() => expect(listJobs).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.getByText('Engineer')).toBeTruthy();
  });

  it('2. SearchBar search passes keyword + status to listJobs', async () => {
    renderPage();
    await waitFor(() => expect(listJobs).toHaveBeenCalledTimes(1));
    const input = screen.getByPlaceholderText(/搜索职位/);
    fireEvent.change(input, { target: { value: 'engineer' } });
    fireEvent.click(screen.getByText('搜索'));
    await waitFor(() => expect(listJobs).toHaveBeenCalledWith(expect.objectContaining({ keyword: 'engineer' })));
  });

  it('3. pagination click triggers new fetch', async () => {
    (listJobs as any).mockResolvedValueOnce({
      data: [{ id: 'job_1', employer_id: 'u_1', employer_name: 'A', title: 'T', status: 'open', created_at: '', updated_at: '' }],
      pagination: { total: 100, page: 1, pageSize: 20, has_more: true },
    });
    renderPage();
    await waitFor(() => screen.getByText('下一页'));
    fireEvent.click(screen.getByText('下一页'));
    await waitFor(() => expect(listJobs).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
  });

  it('4. clicking 详情 navigates to detail page (Sub-D4 update)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('detail-link-job_1')).toBeTruthy());
    expect(screen.getByTestId('detail-link-job_1').getAttribute('href')).toBe('/jobs/job_1');
  });

  it('5. CSV button renders', async () => {
    renderPage();
    await waitFor(() => screen.getByText(/导出 CSV/));
  });

  it('6. empty state shown when no data', async () => {
    (listJobs as any).mockResolvedValue({ data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } });
    renderPage();
    await waitFor(() => expect(screen.getByText('未找到职位')).toBeTruthy());
  });

  it('7. mount reads filter from URL (useUrlParam)', async () => {
    (listJobs as any).mockResolvedValue({ data: [], pagination: { total: 0, page: 3, pageSize: 20, has_more: false } });
    renderPageWithUrl('/jobs?status=open&keyword=sen&page=3');
    await waitFor(() => expect(listJobs).toHaveBeenCalledWith(expect.objectContaining({
      page: 3,
      keyword: 'sen',
      status: 'open',
    })));
  });

  it('8. changing filter input updates list via useUrlParam', async () => {
    (listJobs as any).mockResolvedValue({ data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } });
    renderPage();
    await waitFor(() => expect(listJobs).toHaveBeenCalledTimes(1));
    const select = document.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'open' } });
    fireEvent.click(screen.getByText('搜索'));
    await waitFor(() => expect(listJobs).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'open' })
    ));
  });
});;