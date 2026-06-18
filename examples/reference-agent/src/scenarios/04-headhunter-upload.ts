import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 4: Headhunter uploads candidate';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);
  if (!client.ctx.userIds.candidate) return;

  let res = await client.request({
    method: 'POST', path: '/v1/headhunter/candidates', asUser: 'headhunter',
    body: {
      candidate_user_id: client.ctx.userIds.candidate,
      name: 'Test Cand Profile', phone: '13800138000', email: 'test@x.com',
      current_company: '字节跳动', current_title: 'P6',
      expected_salary: 600000, years_experience: 5,
      education_school: '清华大学', skills: ['React', 'TypeScript', 'Go'],
    },
  });
  r.record({
    name: 'upload candidate', method: 'POST', path: '/v1/headhunter/candidates',
    status: res.status, ok: res.status === 200 && !!res.data?.data?.anonymized_id, expected: 200,
  });
  if (res.data?.data?.anonymized_id) client.ctx.resources.anonymized_id = res.data.data.anonymized_id;
  if (!client.ctx.resources.anonymized_id) return;

  res = await client.request({ method: 'POST', path: `/v1/headhunter/candidates/${client.ctx.resources.anonymized_id}/publish-to-pool`, asUser: 'headhunter' });
  r.record({
    name: 'publish to pool', method: 'POST', path: '/v1/headhunter/candidates/{id}/publish-to-pool',
    status: res.status, ok: res.status === 200, expected: 200,
  });

  res = await client.request({ method: 'GET', path: '/v1/headhunter/candidates', asUser: 'headhunter' });
  r.record({
    name: 'list candidates', method: 'GET', path: '/v1/headhunter/candidates',
    status: res.status, ok: res.status === 200 && Array.isArray(res.data?.data), expected: 200,
  });
}
