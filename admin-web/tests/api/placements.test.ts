import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listPlacements, markPaid, cancelPlacement } from '../../src/api/placements';

vi.mock('../../src/api/raw', () => ({ apiFetchRaw: vi.fn() }));
import { apiFetchRaw } from '../../src/api/raw';

describe('placements api (Sub-D3 Plan 2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. listPlacements calls correct endpoint with no params', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } });
    await listPlacements();
    expect(apiFetchRaw).toHaveBeenCalledWith('placements');
  });

  it('2. listPlacements with status=paid includes param', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } });
    await listPlacements({ status: 'paid' });
    const call = (apiFetchRaw as any).mock.calls[0][0];
    expect(call).toContain('status=paid');
  });

  it('3. listPlacements with from + until', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } });
    await listPlacements({ from: '2026-06-01T00:00:00Z', until: '2026-06-30T23:59:59Z' });
    const call = (apiFetchRaw as any).mock.calls[0][0];
    expect(call).toContain('from=2026-06-01');
    expect(call).toContain('until=2026-06-30');
  });

  it('4. markPaid POSTs to /:id/mark-paid', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: { id: 'p_1', status: 'paid' as const } });
    await markPaid('p_1');
    expect(apiFetchRaw).toHaveBeenCalledWith('placements/p_1/mark-paid', expect.objectContaining({ method: 'POST' }));
  });

  it('5. cancelPlacement throws on error', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: false, error: { code: 'INVALID_STATE', message: 'already paid' } });
    await expect(cancelPlacement('p_x')).rejects.toThrow('already paid');
  });
});