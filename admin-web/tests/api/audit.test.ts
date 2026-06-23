import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/lib/auth', () => ({
  getToken: () => 'test-token-abc',
  clearToken: vi.fn(),
}));

const fetchMock = vi.fn();
(globalThis as any).fetch = fetchMock;

import { listAdminLog, listActionHistory, listLoginEvents } from '../../src/api/audit';

describe('audit api fetchers', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: [], pagination: { total: 0, page: 1, pageSize: 50, has_more: false } }),
    });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('listAdminLog hits /v1/admin/admin-log with query params', async () => {
    await listAdminLog({ page: 2, pageSize: 10, actor: 'alice' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/v1/admin/admin-log?page=2&pageSize=10&actor=alice');
    expect(init.headers.Authorization).toBe('Bearer test-token-abc');
  });

  it('listAdminLog returns { data, pagination } on success', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ ok: true, data: [{ id: 1, actor: 'a' }], pagination: { total: 1, page: 1, pageSize: 50, has_more: false } }),
    });
    const result = await listAdminLog();
    expect(result.data).toHaveLength(1);
    expect(result.pagination.total).toBe(1);
  });

  it('listActionHistory hits /v1/admin/action-history', async () => {
    await listActionHistory({ page: 1, capability_name: 'headhunter.upload_candidate', status: 'success' });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/v1/admin/action-history?page=1&capability_name=headhunter.upload_candidate&status=success');
  });

  it('listActionHistory returns { data, pagination }', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ ok: true, data: [{ id: 2, user_id: 'u_1' }], pagination: { total: 1, page: 1, pageSize: 50, has_more: false } }),
    });
    const result = await listActionHistory();
    expect(result.data).toHaveLength(1);
  });

  it('listLoginEvents hits /v1/admin/login-events with success as 0/1', async () => {
    await listLoginEvents({ success: 0, email: 'a', page: 3 });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/v1/admin/login-events?success=0&email=a&page=3');
  });

  it('listLoginEvents returns { data, pagination }', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ ok: true, data: [{ id: 3, email: 'x@y.z', success: 1 }], pagination: { total: 1, page: 1, pageSize: 50, has_more: false } }),
    });
    const result = await listLoginEvents();
    expect(result.data).toHaveLength(1);
  });
});