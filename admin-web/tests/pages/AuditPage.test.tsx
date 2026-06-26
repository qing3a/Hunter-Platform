import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AuditPage from '../../src/pages/AuditPage';

vi.mock('../../src/api/audit', () => ({
  listActionHistory: vi.fn(),
  listAdminLog: vi.fn(),
}));

import { listActionHistory, listAdminLog } from '../../src/api/audit';

const renderPage = () => render(
  <MemoryRouter initialEntries={['/audit']}>
    <Routes>
      <Route path="/audit" element={<AuditPage />} />
    </Routes>
  </MemoryRouter>
);

const renderPageWithUrl = (initialUrl: string) => render(
  <MemoryRouter initialEntries={[initialUrl]}>
    <Routes>
      <Route path="/audit" element={<AuditPage />} />
    </Routes>
  </MemoryRouter>
);

describe('AuditPage Admin Actions (Sub-D6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listActionHistory as any).mockResolvedValue({ data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } });
    (listAdminLog as any).mockResolvedValue({ data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } });
  });

  it('1. mount calls listAdminLog (after switching to admin tab)', async () => {
    renderPage();
    const adminTab = await screen.findByText(/管理员操作/);
    fireEvent.click(adminTab);
    await waitFor(() => expect(listAdminLog).toHaveBeenCalled());
  });

  it('2. mount reads actor + page from URL (useUrlParam)', async () => {
    renderPageWithUrl('/audit?actor=adm_test&page=3');
    const adminTab = await screen.findByText(/管理员操作/);
    fireEvent.click(adminTab);
    await waitFor(() => expect(listAdminLog).toHaveBeenCalledWith(expect.objectContaining({
      page: 3,
      actor: 'adm_test',
    })));
  });

  it('3. changing actor input updates list via useUrlParam', async () => {
    renderPage();
    const adminTab = await screen.findByText(/管理员操作/);
    fireEvent.click(adminTab);
    await waitFor(() => expect(listAdminLog).toHaveBeenCalledTimes(1));
    const input = screen.getByPlaceholderText(/按操作人/);
    fireEvent.change(input, { target: { value: 'adm_1' } });
    await waitFor(() => expect(listAdminLog).toHaveBeenCalledWith(
      expect.objectContaining({ actor: 'adm_1' })
    ));
  });
});
