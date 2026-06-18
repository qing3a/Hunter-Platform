import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 0: Public endpoints';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);

  let res = await client.request({ method: 'GET', path: '/v1/health' });
  r.record({ name: 'health', method: 'GET', path: '/v1/health', status: res.status, ok: res.status === 200 && res.data?.data?.status === 'healthy', expected: 200 });

  res = await client.request({ method: 'GET', path: '/v1/skill.md' });
  r.record({ name: 'skill.md', method: 'GET', path: '/v1/skill.md', status: res.status, ok: res.status === 200 && res.raw.includes('# Hunter Platform'), expected: 200 });

  res = await client.request({ method: 'GET', path: '/v1/openapi.json' });
  r.record({ name: 'openapi', method: 'GET', path: '/v1/openapi.json', status: res.status, ok: res.status === 200 && (res.data?.openapi ?? res.data?.swagger) !== undefined, expected: 200 });

  res = await client.request({ method: 'GET', path: '/metrics' });
  r.record({ name: 'metrics', method: 'GET', path: '/metrics', status: res.status, ok: res.status === 200 && res.raw.includes('# HELP'), expected: 200 });
}
