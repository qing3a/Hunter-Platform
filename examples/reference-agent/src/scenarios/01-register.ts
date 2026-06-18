import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 1: Register 3 users';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);
  const ts = Date.now();

  for (const role of ['candidate', 'headhunter', 'employer'] as const) {
    const userType = role === 'candidate' ? 'candidate' : role === 'headhunter' ? 'headhunter' : 'employer';
    const emailDomain = role === 'candidate' ? 'c' : role === 'headhunter' ? 'h' : 'e';
    const res = await client.request({
      method: 'POST', path: '/v1/auth/register',
      body: { user_type: userType, name: `Agent${role}`, contact: `agent-${emailDomain}-${ts}@x.com` },
    });
    r.record({
      name: `register ${role}`,
      method: 'POST', path: '/v1/auth/register',
      status: res.status, ok: res.status === 200 && !!res.data?.data?.id,
      expected: 200,
    });
    if (res.data?.data) {
      client.ctx.userIds[role] = res.data.data.id;
      client.ctx.apiKeys[role] = res.data.data.api_key;
    }
  }
}
