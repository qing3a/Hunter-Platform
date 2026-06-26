import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listConfig, updateConfig } from '../../src/api/config';

vi.mock('../../src/api/raw', () => ({ apiFetchRaw: vi.fn() }));
import { apiFetchRaw } from '../../src/api/raw';

describe('config api (Sub-E)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. listConfig calls /config', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: [] });
    await listConfig();
    expect(apiFetchRaw).toHaveBeenCalledWith('config');
  });

  it('2. updateConfig PUTs with key + value + reason', async () => {
    (apiFetchRaw as any).mockResolvedValue({
      ok: true, data: { key: 'platform_fee_pct', value: 5, updated_at: '2026-06-25', updated_by_admin_user_id: 'adm_1' },
    });
    await updateConfig('platform_fee_pct', 5, 'test reason');
    expect(apiFetchRaw).toHaveBeenCalledWith('config/platform_fee_pct', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ value: 5, reason: 'test reason' }),
    }));
  });
});
