import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 0b: Config + market (authenticated)';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);
  // config/market endpoints require auth; use headhunter key registered in Scenario 1
  const role = 'headhunter' as const;

  let res = await client.request({ method: 'GET', path: '/v1/config/industries', asUser: role });
  r.record({ name: 'config industries', method: 'GET', path: '/v1/config/industries', status: res.status, ok: res.status === 200 && Array.isArray(res.data?.data), expected: 200 });

  res = await client.request({ method: 'GET', path: '/v1/config/title_levels', asUser: role });
  r.record({ name: 'config title_levels', method: 'GET', path: '/v1/config/title_levels', status: res.status, ok: res.status === 200 && Array.isArray(res.data?.data), expected: 200 });

  res = await client.request({ method: 'GET', path: '/v1/config/salary_bands', asUser: role });
  r.record({ name: 'config salary_bands', method: 'GET', path: '/v1/config/salary_bands', status: res.status, ok: res.status === 200 && Array.isArray(res.data?.data), expected: 200 });

  res = await client.request({ method: 'GET', path: '/v1/market/leaderboard', asUser: role });
  r.record({ name: 'market leaderboard', method: 'GET', path: '/v1/market/leaderboard', status: res.status, ok: res.status === 200 && Array.isArray(res.data?.data), expected: 200 });
}