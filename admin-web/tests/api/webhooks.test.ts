import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listDeadLetter, retryDeadLetter } from '../../src/api/webhooks';

vi.mock('../../src/api/raw', () => ({ apiFetchRaw: vi.fn() }));
import { apiFetchRaw } from '../../src/api/raw';

describe('webhooks api (Sub-D3 Plan 2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. listDeadLetter calls correct endpoint with no params', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } });
    await listDeadLetter();
    expect(apiFetchRaw).toHaveBeenCalledWith('webhooks/dead-letter');
  });

  it('2. listDeadLetter includes event_type + min_attempt_count + from + until', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } });
    await listDeadLetter({ event_type: 'payment.succeeded', min_attempt_count: 3, from: '2026-06-01T00:00:00Z', until: '2026-06-30T23:59:59Z' });
    const call = (apiFetchRaw as any).mock.calls[0][0];
    expect(call).toContain('event_type=payment.succeeded');
    expect(call).toContain('min_attempt_count=3');
    expect(call).toContain('from=2026-06-01');
    expect(call).toContain('until=2026-06-30');
  });

  it('3. retryDeadLetter POSTs to /:id/retry', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: { id: 5, status: 'pending' } });
    await retryDeadLetter(5);
    expect(apiFetchRaw).toHaveBeenCalledWith('webhooks/5/retry', expect.objectContaining({ method: 'POST' }));
  });

  it('4. throws on non-ok response', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: false, error: { code: 'NOT_FOUND', message: 'delivery not found' } });
    await expect(retryDeadLetter(99999)).rejects.toThrow('delivery not found');
  });
});