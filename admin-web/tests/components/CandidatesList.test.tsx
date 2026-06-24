import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock apiFetchRaw via the api/candidates module (so the page's import resolves)
vi.mock('../../src/api/candidates', () => ({
  listCandidates: vi.fn(),
}));

import { listCandidates } from '../../src/api/candidates';
import CandidatesPage from '../../src/pages/CandidatesPage';

const mockRows = [
  {
    anonymized_id: 'c_a1',
    candidate_user_id: 'u_1',
    masked_name: 'A***ce',
    masked_email: 'a***@***.com',
    headhunter_id: 'h_1',
    industry: 'tech',
    title_level: 'senior',
    is_public_pool: 1 as const,
    unlock_status: 'pending',
    created_at: '2026-06-24T10:00:00Z',
  },
  {
    anonymized_id: 'c_b2',
    candidate_user_id: 'u_2',
    masked_name: 'B**',
    masked_email: 'b***@***.io',
    headhunter_id: 'h_2',
    industry: 'finance',
    title_level: 'lead',
    is_public_pool: 0 as const,
    unlock_status: 'unlocked',
    created_at: '2026-06-23T10:00:00Z',
  },
];

describe('CandidatesPage', () => {
  beforeEach(() => {
    localStorage.setItem('hunter_admin_api_key', 'test-key');
    (listCandidates as any).mockReset();
  });

  it('renders rows + pagination from API response', async () => {
    (listCandidates as any).mockResolvedValue({
      data: mockRows,
      pagination: { total: 25, page: 1, pageSize: 20, has_more: true },
    });
    render(<MemoryRouter><CandidatesPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('A***ce')).toBeInTheDocument();
      expect(screen.getByText('B**')).toBeInTheDocument();
    });
    expect(screen.getByText(/显示 1-20 共 25 条/)).toBeInTheDocument();
    expect(screen.getByText('第 1 页')).toBeInTheDocument();
    // Next button should be enabled (has_more=true)
    const nextBtn = screen.getByText('下一页') as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(false);
  });

  it('clicking 下一页 calls listCandidates with page=2', async () => {
    (listCandidates as any)
      .mockResolvedValueOnce({ data: mockRows, pagination: { total: 25, page: 1, pageSize: 20, has_more: true } })
      .mockResolvedValueOnce({ data: [], pagination: { total: 25, page: 2, pageSize: 20, has_more: false } });
    render(<MemoryRouter><CandidatesPage /></MemoryRouter>);
    await waitFor(() => screen.getByText('A***ce'));
    fireEvent.click(screen.getByText('下一页'));
    await waitFor(() => {
      expect(listCandidates).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, pageSize: 20 })
      );
    });
  });

  it('7. unlock_status filter passed to listCandidates (Sub-C Plan 1 fix)', async () => {
    (listCandidates as any).mockResolvedValue({
      data: mockRows,
      pagination: { total: 25, page: 1, pageSize: 20, has_more: true },
    });
    render(<MemoryRouter><CandidatesPage /></MemoryRouter>);
    await waitFor(() => screen.getByText('A***ce'));
    // First select on the page is the unlock_status filter
    const select = document.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'unlocked' } });
    fireEvent.click(screen.getByText('搜索'));
    await waitFor(() => {
      expect(listCandidates).toHaveBeenCalledWith(
        expect.objectContaining({ unlock_status: 'unlocked' })
      );
    });
  });
});