import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 6: Employer browses + expresses interest';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);

  let res = await client.request({ method: 'GET', path: '/v1/employer/talent', asUser: 'employer' });
  r.record({
    name: 'browse talent', method: 'GET', path: '/v1/employer/talent',
    status: res.status, ok: res.status === 200 && Array.isArray(res.data?.data), expected: 200,
  });

  if (!client.ctx.resources.recommendation_id) return;
  res = await client.request({
    method: 'POST', path: `/v1/employer/recommendations/${client.ctx.resources.recommendation_id}/express-interest`, asUser: 'employer',
  });
  r.record({
    name: 'express interest', method: 'POST', path: '/v1/employer/recommendations/{id}/express-interest',
    status: res.status, ok: res.status === 200, expected: 200,
  });
}
