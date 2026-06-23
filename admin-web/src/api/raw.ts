// Raw envelope wrapper. Returns the full { ok, data, pagination? } envelope
// instead of extracting data like apiFetch<T> does. Use this for endpoints
// that return pagination (Sub-B's list endpoints).
//
// Why not modify Sub-A's apiFetch? Per spec review (2026-06-24): zero breaking
// change. Sub-A's apiFetch<T> remains the default for auth/profile endpoints.
// New paginated endpoints opt into this raw variant.
import { getToken, clearToken } from '../lib/auth';

export type Envelope<T> = {
  ok: boolean;
  data?: T;
  pagination?: { total: number; page: number; pageSize: number; has_more: boolean };
  error?: { code: string; message: string };
};

export async function apiFetchRaw<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const token = getToken();
  const res = await fetch(`/v1/admin/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    clearToken();
    window.location.href = '/admin/login';
    throw new Error('Unauthorized');
  }
  const env = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!env) throw new Error(`Empty response: ${res.status}`);
  return env;
}