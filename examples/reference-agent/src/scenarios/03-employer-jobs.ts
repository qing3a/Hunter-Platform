import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 3: Employer creates job';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);

  let res = await client.request({
    method: 'POST', path: '/v1/employer/jobs', asUser: 'employer',
    body: { title: 'Senior Frontend Engineer', description: 'From reference agent', requirements: '5+ years', required_skills: ['React', 'TypeScript'] },
  });
  r.record({
    name: 'employer create job', method: 'POST', path: '/v1/employer/jobs',
    status: res.status, ok: res.status === 200 && !!res.data?.data?.id, expected: 200,
  });
  if (res.data?.data?.id) client.ctx.resources.job_id = res.data.data.id;

  res = await client.request({ method: 'GET', path: '/v1/employer/jobs', asUser: 'employer' });
  r.record({
    name: 'employer list jobs', method: 'GET', path: '/v1/employer/jobs',
    status: res.status, ok: res.status === 200 && Array.isArray(res.data?.data), expected: 200,
  });
}
