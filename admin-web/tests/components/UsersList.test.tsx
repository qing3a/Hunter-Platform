import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../src/api/users', () => ({
  listUsers: vi.fn(),
}));

import { listUsers } from '../../src/api/users';
import UsersPage from '../../src/pages/UsersPage';

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
  });

  it('renders rows + pagination from API response', async () => {
    (listUsers as any).mockResolvedValue({
      data: mockRows,
      pagination: { total: 47, page: 1, pageSize: 20, has_more: true },
    });
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
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
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
    await waitFor(() => screen.getByText('Alice Hunter'));
    fireEvent.click(screen.getByText('下一页'));
    await waitFor(() => {
      expect(listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, pageSize: 20 })
      );
    });
  });
});