import { describe, it, expect, vi, beforeEach } from 'vitest';
import { suspendUser, unsuspendUser } from '../../src/api/users';

vi.mock('../../src/api/raw', () => ({ apiFetchRaw: vi.fn() }));
import { apiFetchRaw } from '../../src/api/raw';

describe('suspend/unsuspend user API (Sub-D5)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. suspendUser POSTs with reason', async () => {
    (apiFetchRaw as any).mockResolvedValue({
      ok: true, data: { user_id: 'u_1', status: 'suspended', reason: '客户投诉' },
    });
    await suspendUser('u_1', '客户投诉');
    expect(apiFetchRaw).toHaveBeenCalledWith('users/u_1/suspend', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ reason: '客户投诉' }),
    }));
  });

  it('2. unsuspendUser POSTs without body', async () => {
    (apiFetchRaw as any).mockResolvedValue({
      ok: true, data: { user_id: 'u_1', status: 'active' },
    });
    await unsuspendUser('u_1');
    expect(apiFetchRaw).toHaveBeenCalledWith('users/u_1/unsuspend', expect.objectContaining({ method: 'POST' }));
  });

  it('3. suspendUser throws on non-ok', async () => {
    (apiFetchRaw as any).mockResolvedValue({
      ok: false, error: { code: 'INVALID_STATE', message: 'already suspended' },
    });
    await expect(suspendUser('u_1', 'reason')).rejects.toThrow('already suspended');
  });
});
