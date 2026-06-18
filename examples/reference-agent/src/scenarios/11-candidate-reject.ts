import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 11: Candidate reject + access log';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);
  if (!client.ctx.resources.anonymized_id || !client.ctx.userIds.candidate) return;

  // Create a fresh job so this scenario doesn't conflict with earlier recommends
  const jobRes = await client.request({
    method: 'POST', path: '/v1/employer/jobs', asUser: 'employer',
    body: { title: 'Backend Engineer (Reject)', description: 'For reject test', requirements: 'Rust', required_skills: ['Rust'] },
  });
  const newJobId = jobRes.data?.data?.id;
  if (!newJobId) {
    r.record({ name: 'setup job for reject', method: 'POST', path: '/v1/employer/jobs', status: jobRes.status, ok: false, error: 'setup failed' });
    return;
  }

  // Create a fresh rec + express-interest (rejects only work on employer_interested state)
  const createRes = await client.request({
    method: 'POST', path: '/v1/headhunter/recommendations', asUser: 'headhunter',
    body: { anonymized_candidate_id: client.ctx.resources.anonymized_id, job_id: newJobId },
  });
  const newRecId = createRes.data?.data?.id;
  if (!newRecId) return;

  await client.request({ method: 'POST', path: `/v1/employer/recommendations/${newRecId}/express-interest`, asUser: 'employer' });

  let res = await client.request({
    method: 'POST', path: `/v1/candidate/recommendations/${newRecId}/reject-unlock`, asUser: 'candidate',
  });
  r.record({
    name: 'reject unlock', method: 'POST', path: '/v1/candidate/recommendations/{id}/reject-unlock',
    status: res.status, ok: res.status === 200, expected: 200,
  });

  if (client.ctx.userIds.candidate) {
    const accessRes = await client.request({ method: 'GET', path: '/v1/candidate/access-log', asUser: 'candidate' });
    r.record({
      name: 'access log', method: 'GET', path: '/v1/candidate/access-log',
      status: accessRes.status, ok: accessRes.status === 200 && Array.isArray(accessRes.data?.data), expected: 200,
    });
  }
}
