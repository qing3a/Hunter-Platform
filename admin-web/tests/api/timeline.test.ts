import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/auth', () => ({
  getToken: () => 'test-token-abc',
  clearToken: vi.fn(),
}));

const fetchMock = vi.fn();
(globalThis as any).fetch = fetchMock;

import { getTimeline } from '../../src/api/timeline';

describe('getTimeline (Sub-D2 Plan 2)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ ok: true, data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } }),
    });
  });

  it('1. type=user — calls /v1/admin/timeline/user/:id', async () => {
    await getTimeline('user', 'usr_1');
    expect(fetchMock).toHaveBeenCalledWith('/v1/admin/timeline/user/usr_1', expect.any(Object));
  });

  it('2. type=candidate with source=admin includes source param', async () => {
    await getTimeline('candidate', 'can_1', { source: 'admin' });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('source=admin');
  });

  it('3. type=job with from + until — both params included', async () => {
    await getTimeline('job', 'job_1', {
      from: '2026-06-01T00:00:00Z',
      until: '2026-06-30T23:59:59Z',
    });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('from=2026-06-01');
    expect(url).toContain('until=2026-06-30');
  });

  it('4. type=recommendation with actor — actor param included', async () => {
    await getTimeline('recommendation', 'rec_1', { actor: 'adm_default' });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('actor=adm_default');
  });

  it('5. throws on non-ok response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 400,
      json: async () => ({ ok: false, error: { code: 'INVALID_PARAMS', message: 'invalid type' } }),
    });
    await expect(getTimeline('user', 'x')).rejects.toThrow('invalid type');
  });
});