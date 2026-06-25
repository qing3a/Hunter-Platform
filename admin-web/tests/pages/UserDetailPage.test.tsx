import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from '../../src/lib/toast';
import UserDetailPage from '../../src/pages/UserDetailPage';

vi.mock('../../src/api/users', () => ({ getUser: vi.fn(), suspendUser: vi.fn(), unsuspendUser: vi.fn() }));
import { getUser, suspendUser, unsuspendUser } from '../../src/api/users';

const renderPage = (id = 'u_1') => render(
  <MemoryRouter initialEntries={[`/users/${id}`]}>
    <ToastProvider>
      <Routes>
        <Route path="/users/:id" element={<UserDetailPage />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>
);

const mockUser = {
  id: 'u_1', user_type: 'candidate' as const, name: 'Alice',
  quota_per_day: 100, quota_used: 30, quota_reset_at: '2026-06-25T00:00:00Z',
  reputation: 75, status: 'active' as const, created_at: '2026-06-24T08:00:00Z',
};

describe('UserDetailPage (Sub-D4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getUser as any).mockResolvedValue(mockUser);
  });

  it('1. mount calls getUser with id from URL', async () => {
    renderPage('u_42');
    await waitFor(() => expect(getUser).toHaveBeenCalledWith('u_42'));
  });

  it('2. renders user name + status badge', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
  });

  it('3. error state shows error + back link', async () => {
    (getUser as any).mockRejectedValueOnce(new Error('not found'));
    renderPage('u_missing');
    await waitFor(() => {
      const el = document.querySelector('[data-testid="user-error-state"]');
      return el !== null;
    });
    const link = document.querySelector('a[href*="/users"]') as HTMLElement;
    expect(link).toBeTruthy();
  });

  it('5. active user shows 暂停账号 button', async () => {
    (getUser as any).mockResolvedValue({
      id: 'u_a', user_type: 'candidate', name: 'Active', contact: 'a@x',
      status: 'active', quota_per_day: 100, quota_used: 0,
      reputation: 50, created_at: '2026-06-25T00:00:00Z',
    });
    renderPage('u_a');
    await waitFor(() => expect(screen.getByTestId('user-suspend-toggle')).toBeTruthy());
    expect(screen.getByText('暂停账号')).toBeTruthy();
  });

  it('6. suspended user shows 恢复账号 button', async () => {
    (getUser as any).mockResolvedValue({
      id: 'u_s', user_type: 'candidate', name: 'Susp', contact: 's@x',
      status: 'suspended', quota_per_day: 100, quota_used: 0,
      reputation: 50, created_at: '2026-06-25T00:00:00Z',
    });
    renderPage('u_s');
    await waitFor(() => expect(screen.getByTestId('user-suspend-toggle')).toBeTruthy());
    expect(screen.getByText('恢复账号')).toBeTruthy();
  });

  it('7. deleted user shows no button', async () => {
    (getUser as any).mockResolvedValue({
      id: 'u_d', user_type: 'candidate', name: 'Del', contact: 'd@x',
      status: 'deleted', quota_per_day: 100, quota_used: 0,
      reputation: 50, created_at: '2026-06-25T00:00:00Z',
    });
    renderPage('u_d');
    await waitFor(() => expect(screen.getByTestId('user-detail')).toBeTruthy());
    expect(screen.queryByTestId('user-suspend-toggle')).toBeNull();
  });

  it('8. clicking 暂停账号 opens ConfirmModal with reason textarea', async () => {
    (getUser as any).mockResolvedValue({
      id: 'u_a', user_type: 'candidate', name: 'Active', contact: 'a@x',
      status: 'active', quota_per_day: 100, quota_used: 0,
      reputation: 50, created_at: '2026-06-25T00:00:00Z',
    });
    renderPage('u_a');
    await waitFor(() => screen.getByTestId('user-suspend-toggle'));
    fireEvent.click(screen.getByTestId('user-suspend-toggle'));
    await waitFor(() => expect(screen.getByTestId('confirm-modal-reason')).toBeTruthy());
    fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
    expect(suspendUser).not.toHaveBeenCalled();
  });
});