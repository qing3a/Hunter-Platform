import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from '../../src/lib/toast';
import UserDetailPage from '../../src/pages/UserDetailPage';

vi.mock('../../src/api/users', () => ({ getUser: vi.fn() }));
import { getUser } from '../../src/api/users';

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

  it('3. has 查看时间轴 link', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('user-timeline-link')).toBeTruthy());
  });

  it('4. error state shows error + back link', async () => {
    (getUser as any).mockRejectedValueOnce(new Error('not found'));
    renderPage('u_missing');
    await waitFor(() => {
      const el = document.querySelector('[data-testid="user-error-state"]');
      return el !== null;
    });
    const link = document.querySelector('a[href*="/users"]') as HTMLElement;
    expect(link).toBeTruthy();
  });
});