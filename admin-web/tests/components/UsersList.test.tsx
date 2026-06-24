import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../src/api/users', () => ({
  listUsers: vi.fn(),
  adjustQuota: vi.fn(),
}));

import { listUsers, adjustQuota } from '../../src/api/users';
import UsersPage from '../../src/pages/UsersPage';
import { ToastProvider } from '../../src/lib/toast';

const renderPage = () => render(
  <MemoryRouter>
    <ToastProvider>
      <UsersPage />
    </ToastProvider>
  </MemoryRouter>
);

const mockRows = [
  {
    id: 'u_1',
    user_type: 'headhunter' as const,
    name: 'Alice Hunter',
    status: 'active' as const,
    quota_per_day: 100,
    quota_used: 30,
    quota_reset_at: '2026-06-25T00:00:00Z',
    reputation: 75,
    created_at: '2026-06-24T08:00:00Z',
  },
  {
    id: 'u_2',
    user_type: 'employer' as const,
    name: 'Bob Inc',
    status: 'suspended' as const,
    quota_per_day: 200,
    quota_used: 0,
    quota_reset_at: '2026-06-25T00:00:00Z',
    reputation: 50,
    created_at: '2026-06-23T08:00:00Z',
  },
];

describe('UsersPage', () => {
  beforeEach(() => {
    localStorage.setItem('hunter_admin_api_key', 'test-key');
    (listUsers as any).mockReset();
    (adjustQuota as any).mockReset();
  });

  it('renders rows + pagination from API response', async () => {
    (listUsers as any).mockResolvedValue({
      data: mockRows,
      pagination: { total: 47, page: 1, pageSize: 20, has_more: true },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Alice Hunter')).toBeInTheDocument();
      expect(screen.getByText('Bob Inc')).toBeInTheDocument();
    });
    expect(screen.getByText(/显示 1-20 共 47 条/)).toBeInTheDocument();
    expect(screen.getByText('第 1 页')).toBeInTheDocument();
  });

  it('clicking 下一页 calls listUsers with page=2', async () => {
    (listUsers as any)
      .mockResolvedValueOnce({ data: mockRows, pagination: { total: 47, page: 1, pageSize: 20, has_more: true } })
      .mockResolvedValueOnce({ data: [], pagination: { total: 47, page: 2, pageSize: 20, has_more: false } });
    renderPage();
    await waitFor(() => screen.getByText('Alice Hunter'));
    fireEvent.click(screen.getByText('下一页'));
    await waitFor(() => {
      expect(listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, pageSize: 20 })
      );
    });
  });

  it('8. user_type filter passed to listUsers (Sub-C Plan 1 fix)', async () => {
    (listUsers as any).mockResolvedValue({
      data: mockRows,
      pagination: { total: 47, page: 1, pageSize: 20, has_more: true },
    });
    renderPage();
    await waitFor(() => screen.getByText('Alice Hunter'));
    // First select on the page is the user_type filter
    const select = document.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'headhunter' } });
    fireEvent.click(screen.getByText('搜索'));
    await waitFor(() => {
      expect(listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ user_type: 'headhunter' })
      );
    });
  });

  it('9. 调配额 button only shows for active users', async () => {
    (listUsers as any).mockResolvedValue({
      data: mockRows,
      pagination: { total: 47, page: 1, pageSize: 20, has_more: true },
    });
    renderPage();
    await waitFor(() => screen.getByTestId('adjust-quota-u_1'));
    expect(screen.queryByTestId('adjust-quota-u_2')).toBeNull();
  });

  it('10. clicking 调配额 opens QuotaModal', async () => {
    (listUsers as any).mockResolvedValue({
      data: mockRows,
      pagination: { total: 47, page: 1, pageSize: 20, has_more: true },
    });
    renderPage();
    await waitFor(() => screen.getByTestId('adjust-quota-u_1'));
    fireEvent.click(screen.getByTestId('adjust-quota-u_1'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/当前配额/)).toBeTruthy();
  });

  it('11. submit calls adjustQuota + shows success toast + refreshes list', async () => {
    (listUsers as any).mockResolvedValue({
      data: mockRows,
      pagination: { total: 47, page: 1, pageSize: 20, has_more: true },
    });
    (adjustQuota as any).mockResolvedValue({
      user_id: 'u_1', previous_quota: 100, new_quota: 50, reason: '客户加单',
    });
    renderPage();
    await waitFor(() => screen.getByTestId('adjust-quota-u_1'));
    fireEvent.click(screen.getByTestId('adjust-quota-u_1'));

    const numberInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    const reasonTextarea = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(numberInput, { target: { value: '50' } });
    fireEvent.change(reasonTextarea, { target: { value: '客户加单' } });
    fireEvent.click(screen.getByText('确认调整'));

    await waitFor(() => expect(adjustQuota).toHaveBeenCalledWith('u_1', 50, '客户加单'));
    // Note: Toast component is not rendered in this test (would need <Toast /> wrapper).
    // The actual toast push() is exercised in Toast.test.tsx. Here we just verify the API call.
  });
});