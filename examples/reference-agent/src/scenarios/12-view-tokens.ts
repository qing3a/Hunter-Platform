import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 12: View tokens (v2 render layer)';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);
  if (!client.ctx.userIds.candidate) return;

  let res = await client.request({
    method: 'POST', path: `/v1/views/audit/${client.ctx.userIds.candidate}`, asUser: 'candidate',
  });
  r.record({
    name: 'audit view token', method: 'POST', path: '/v1/views/audit/{user_id}',
    status: res.status, ok: res.status === 200 && !!res.data?.data?.view_url, expected: 200,
  });
  const auditUrl = res.data?.data?.view_url as string | undefined;
  if (auditUrl) {
    const path = auditUrl.replace(client.ctx.baseUrl, '');
    const viewRes = await client.request({ method: 'GET', path });
    r.record({
      name: 'audit view HTML', method: 'GET', path: '/view/audit/{id}?t=...',
      status: viewRes.status, ok: viewRes.status === 200 && viewRes.raw.includes('审计日志'), expected: 200,
    });
  }

  if (client.ctx.resources.recommendation_id) {
    res = await client.request({
      method: 'POST', path: `/v1/views/recommendation/${client.ctx.resources.recommendation_id}`, asUser: 'headhunter',
    });
    r.record({
      name: 'recommendation view token', method: 'POST', path: '/v1/views/recommendation/{rec_id}',
      status: res.status, ok: res.status === 200 && !!res.data?.data?.view_url, expected: 200,
    });
  }
}
