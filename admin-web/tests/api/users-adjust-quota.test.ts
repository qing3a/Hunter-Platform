import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/auth', () => ({
  getToken: () => 'test-token-abc',
  clearToken: vi.fn(),
}));

const fetchMock = vi.fn();
(globalThis as any).fetch = fetchMock;

import { adjustQuota } from '../../src/api/users';

describe('adjustQuota (Sub-C Plan 2)', () => {
  beforeEach(() => fetchMock.mockReset());

  it('1. POSTs to users/:id/adjust-quota with new_quota + reason', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ ok: true, data: { user_id: 'u_1', previous_quota: 100, new_quota: 50, reason: 'test' } }),
    });
    await adjustQuota('u_1', 50, 'test');
    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/admin/users/u_1/adjust-quota',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ new_quota: 50, reason: 'test' }),
      }),
    );
  });

  it('2. returns response data on success', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ ok: true, data: { user_id: 'u_1', previous_quota: 100, new_quota: 50, reason: 'test' } }),
    });
    const r = await adjustQuota('u_1', 50, 'test');
    expect(r).toEqual({ user_id: 'u_1', previous_quota: 100, new_quota: 50, reason: 'test' });
  });

  it('3. throws Error with backend message on failure', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 400,
      json: async () => ({ ok: false, error: { code: 'INVALID_PARAMS', message: 'reason is required' } }),
    });
    await expect(adjustQuota('u_1', 50, '')).rejects.toThrow('reason is required');
  });
});