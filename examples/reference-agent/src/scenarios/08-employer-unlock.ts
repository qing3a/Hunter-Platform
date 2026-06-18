import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 8: Employer unlocks contact';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);
  if (!client.ctx.resources.recommendation_id) return;

  const res = await client.request({
    method: 'POST', path: `/v1/employer/recommendations/${client.ctx.resources.recommendation_id}/unlock-contact`, asUser: 'employer',
  });
  r.record({
    name: 'unlock contact', method: 'POST', path: '/v1/employer/recommendations/{id}/unlock-contact',
    status: res.status, ok: res.status === 200, expected: 200,
  });
}
