import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 9: Employer creates placement';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);
  if (!client.ctx.resources.job_id || !client.ctx.userIds.candidate || !client.ctx.userIds.headhunter) return;

  let res = await client.request({
    method: 'POST', path: '/v1/employer/placements', asUser: 'employer',
    body: {
      job_id: client.ctx.resources.job_id,
      anonymized_candidate_id: client.ctx.resources.anonymized_id,
      annual_salary: 600000,
    },
  });
  r.record({
    name: 'create placement', method: 'POST', path: '/v1/employer/placements',
    status: res.status, ok: res.status === 200 || res.status === 201, expected: [200, 201],
  });

  res = await client.request({ method: 'GET', path: '/v1/employer/placements', asUser: 'employer' });
  r.record({
    name: 'list placements', method: 'GET', path: '/v1/employer/placements',
    status: res.status, ok: res.status === 200 && Array.isArray(res.data?.data), expected: 200,
  });
}
