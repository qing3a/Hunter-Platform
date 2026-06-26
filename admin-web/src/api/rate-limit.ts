import { listConfig, type ConfigEntry } from './config';

export type RateLimitEntry = {
  scope: 'tier' | 'user';
  key: string;
  limit_per_minute: number;
};

export async function listRateLimits(): Promise<RateLimitEntry[]> {
  const all = await listConfig();
  return all
    .filter(c => c.key.startsWith('rate_limit.'))
    .map(c => {
      const parts = c.key.split('.');
      const scope = parts[1] as 'tier' | 'user';
      const identifier = parts[2];
      const limit = Number(c.value);
      return { scope, key: identifier, limit_per_minute: limit };
    });
}
