import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 7: Candidate approves unlock';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);
  if (!client.ctx.userIds.candidate || !client.ctx.resources.recommendation_id) return;

  let res = await client.request({ method: 'GET', path: '/v1/candidate/opportunities', asUser: 'candidate' });
  r.record({
    name: 'opportunities', method: 'GET', path: '/v1/candidate/opportunities',
    status: res.status, ok: res.status === 200 && Array.isArray(res.data?.data), expected: 200,
  });

  res = await client.request({
    method: 'POST', path: `/v1/candidate/recommendations/${client.ctx.resources.recommendation_id}/approve-unlock`, asUser: 'candidate',
  });
  r.record({
    name: 'approve unlock', method: 'POST', path: '/v1/candidate/recommendations/{id}/approve-unlock',
    status: res.status, ok: res.status === 200, expected: 200,
  });
}
