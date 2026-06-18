import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 2: User status & history';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);

  for (const role of ['candidate', 'headhunter', 'employer'] as const) {
    const id = client.ctx.userIds[role];
    if (!id) continue;

    let res = await client.request({ method: 'GET', path: `/v1/users/${id}/status`, asUser: role });
    r.record({
      name: `${role} status`, method: 'GET', path: `/v1/users/${id}/status`,
      status: res.status, ok: res.status === 200 && res.data?.data?.id === id, expected: 200,
    });

    res = await client.request({ method: 'GET', path: `/v1/users/${id}/history`, asUser: role });
    r.record({
      name: `${role} history`, method: 'GET', path: `/v1/users/${id}/history`,
      status: res.status, ok: res.status === 200 && Array.isArray(res.data?.data), expected: 200,
    });
  }
}
