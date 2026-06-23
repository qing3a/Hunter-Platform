import { getToken, clearToken } from '../lib/auth';

export type ApiError = { code: string; message: string };

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`/v1/admin/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401) {
    clearToken();
    window.location.href = '/admin/login';
    throw new Error('Unauthorized');
  }
  if (!data?.ok) {
    throw new Error((data?.error as ApiError)?.message ?? `API error: ${res.status}`);
  }
  return data.data as T;
}
