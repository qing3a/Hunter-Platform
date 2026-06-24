import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/lib/auth', () => ({
  getToken: () => 'test-token-abc',
  clearToken: vi.fn(),
}));

const fetchMock = vi.fn();
(globalThis as any).fetch = fetchMock;

import { listJobs } from '../../src/api/jobs';

describe('listJobs (Sub-C)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: [], pagination: { total: 0, page: 1, pageSize: 20, has_more: false } }),
    });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('1. fetches /v1/admin/jobs with no params', async () => {
    await listJobs();
    expect(fetchMock).toHaveBeenCalledWith('/v1/admin/jobs', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer test-token-abc' }),
    }));
  });

  it('2. includes status + keyword + page params in query string', async () => {
    await listJobs({ page: 2, pageSize: 50, status: 'open', keyword: 'engineer' });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=50');
    expect(url).toContain('status=open');
    expect(url).toContain('keyword=engineer');
  });

  it('3. throws Error when response is not ok', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 400,
      json: async () => ({ ok: false, error: { code: 'INVALID_PARAMS', message: 'bad status' } }),
    });
    await expect(listJobs()).rejects.toThrow('bad status');
  });
});