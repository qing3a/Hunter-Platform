import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetchRaw } from '../../src/api/raw';

describe('apiFetchRaw', () => {
  const originalFetch = global.fetch;
  const originalLocation = window.location;

  beforeEach(() => {
    localStorage.clear();
    // @ts-expect-error — override for test
    delete (window as any).location;
    (window as any).location = { ...originalLocation, href: '' };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    (window as any).location = originalLocation;
  });

  function mockFetch(status: number, body: unknown) {
    global.fetch = vi.fn().mockResolvedValue({
      status,
      json: async () => body,
    } as any);
  }

  it('1. injects Bearer header from localStorage token', async () => {
    localStorage.setItem('hunter_admin_api_key', 'hp_admin_test_key');
    mockFetch(200, { ok: true, data: { id: 'x' }, pagination: { total: 1, page: 1, pageSize: 20, has_more: false } });
    await apiFetchRaw('users');
    expect(global.fetch).toHaveBeenCalledWith(
      '/v1/admin/users',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer hp_admin_test_key' }),
      })
    );
  });

  it('2. omits Authorization when no token', async () => {
    mockFetch(200, { ok: true, data: {} });
    await apiFetchRaw('auth/login', { method: 'POST', body: '{}' });
    const call = (global.fetch as any).mock.calls[0];
    expect(call[1].headers.Authorization).toBeUndefined();
  });

  it('3. on 401, clears token + redirects to /admin/login', async () => {
    localStorage.setItem('hunter_admin_api_key', 'old_key');
    mockFetch(401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'expired' } });
    await expect(apiFetchRaw('users')).rejects.toThrow('Unauthorized');
    expect(localStorage.getItem('hunter_admin_api_key')).toBeNull();
    expect(window.location.href).toBe('/admin/login');
  });

  it('4. returns full envelope including pagination', async () => {
    const envelope = { ok: true, data: [{ id: 'u1' }], pagination: { total: 5, page: 1, pageSize: 20, has_more: false } };
    mockFetch(200, envelope);
    const result = await apiFetchRaw<{ id: string }[]>('users');
    expect(result).toEqual(envelope);
    expect(result.pagination?.total).toBe(5);
  });

  it('5. throws on empty response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 500,
      json: async () => { throw new Error('parse fail'); },
    } as any);
    await expect(apiFetchRaw('users')).rejects.toThrow(/Empty response/);
  });
});