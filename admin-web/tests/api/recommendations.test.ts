import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/lib/auth', () => ({
  getToken: () => 'test-token-abc',
  clearToken: vi.fn(),
}));

const fetchMock = vi.fn();
(globalThis as any).fetch = fetchMock;

import { listRecommendations } from '../../src/api/recommendations';

describe('listRecommendations (Sub-C)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } }),
    });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('1. fetches /v1/admin/recommendations with no params', async () => {
    await listRecommendations();
    expect(fetchMock).toHaveBeenCalledWith('/v1/admin/recommendations', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer test-token-abc' }),
    }));
  });

  it('2. includes status + keyword + from + until + page params', async () => {
    await listRecommendations({
      page: 1,
      status: 'pending',
      keyword: 'eng',
      from: '2026-06-01T00:00:00Z',
      until: '2026-06-30T23:59:59Z',
    });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('status=pending');
    expect(url).toContain('keyword=eng');
    expect(url).toContain('from=2026-06-01T00');
    expect(url).toContain('until=2026-06-30T23');
  });

  it('3. throws Error when response is not ok', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 400,
      json: async () => ({ ok: false, error: { code: 'INVALID_PARAMS', message: 'bad from' } }),
    });
    await expect(listRecommendations()).rejects.toThrow('bad from');
  });
});