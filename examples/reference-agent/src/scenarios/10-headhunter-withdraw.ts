import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 10: Headhunter withdraws (new recommendation)';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);
  if (!client.ctx.resources.anonymized_id) return;

  // Create a fresh job so this scenario doesn't conflict with earlier recommend
  const jobRes = await client.request({
    method: 'POST', path: '/v1/employer/jobs', asUser: 'employer',
    body: { title: 'Backend Engineer (Withdraw)', description: 'For withdraw test', requirements: 'Go', required_skills: ['Go'] },
  });
  const newJobId = jobRes.data?.data?.id;
  if (!newJobId) {
    r.record({ name: 'setup job for withdraw', method: 'POST', path: '/v1/employer/jobs', status: jobRes.status, ok: false, error: 'setup failed' });
    return;
  }

  const createRes = await client.request({
    method: 'POST', path: '/v1/headhunter/recommendations', asUser: 'headhunter',
    body: { anonymized_candidate_id: client.ctx.resources.anonymized_id, job_id: newJobId },
  });
  const newRecId = createRes.data?.data?.id;
  if (!newRecId) {
    r.record({ name: 'setup for withdraw', method: 'POST', path: '/v1/headhunter/recommendations', status: createRes.status, ok: false, error: 'setup failed' });
    return;
  }

  const res = await client.request({
    method: 'POST', path: `/v1/headhunter/recommendations/${newRecId}/withdraw`, asUser: 'headhunter',
  });
  r.record({
    name: 'withdraw recommendation', method: 'POST', path: '/v1/headhunter/recommendations/{id}/withdraw',
    status: res.status, ok: res.status === 200, expected: 200,
  });
}
