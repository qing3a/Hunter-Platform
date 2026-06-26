import { apiFetchRaw } from './raw';

export type ConfigEntry = {
  key: string;
  value: unknown;
  updated_at: string;
  updated_by_admin_user_id: string | null;
};

export async function listConfig(): Promise<ConfigEntry[]> {
  const env = await apiFetchRaw<ConfigEntry[]>('config');
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to list config');
  return env.data;
}

export async function updateConfig(key: string, value: unknown, reason: string): Promise<ConfigEntry> {
  const env = await apiFetchRaw<ConfigEntry>(`config/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value, reason }),
  });
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to update config');
  return env.data;
}
