import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 5: Headhunter recommends candidate';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);
  if (!client.ctx.resources.anonymized_id || !client.ctx.resources.job_id) return;

  let res = await client.request({
    method: 'POST', path: '/v1/headhunter/recommendations', asUser: 'headhunter',
    body: { anonymized_candidate_id: client.ctx.resources.anonymized_id, job_id: client.ctx.resources.job_id },
  });
  r.record({
    name: 'create recommendation', method: 'POST', path: '/v1/headhunter/recommendations',
    status: res.status, ok: res.status === 200 && !!res.data?.data?.id, expected: 200,
  });
  if (res.data?.data?.id) client.ctx.resources.recommendation_id = res.data.data.id;

  res = await client.request({ method: 'GET', path: '/v1/headhunter/recommendations', asUser: 'headhunter' });
  r.record({
    name: 'list recommendations', method: 'GET', path: '/v1/headhunter/recommendations',
    status: res.status, ok: res.status === 200 && Array.isArray(res.data?.data), expected: 200,
  });
}
