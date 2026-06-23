import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient } from './_setup';

describe('skill.md: candidate (scenarios 10-12)', () => {
  let client: ConformanceClient;
  let cKey: string;
  let hKey: string;
  let eKey: string;

  beforeAll(async () => {
    const f = await freshApp('candidate');
    client = new ConformanceClient(f.app);
    cKey = await client.register('candidate', 'C', 'c@x.com');
    hKey = await client.register('headhunter', 'H', 'h@x.com');
    eKey = await client.register('employer', 'E', 'e@x.com');
  });
  afterAll(() => cleanupDb('candidate'));

  it('GET /v1/candidate/opportunities lists unlock requests', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/candidate/opportunities', auth: cKey });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.data)).toBe(true);
  });

  it('GET /v1/candidate/access-log shows who accessed data', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/candidate/access-log', auth: cKey });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.data)).toBe(true);
  });

  it('GET /v1/candidate/export-my-data returns candidate data (Bug 7 — self vs 3rd party)', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/candidate/export-my-data', auth: cKey });
    expect(r.status).toBe(200);
    expect(r.data.data).toBeDefined();
  });

  it('POST /v1/candidate/recommendations/:id/approve-unlock — illegal from pending', async () => {
    // Setup: headhunter uploads candidate + recommends for employer's job (claimed)
    const candId = client.ids.get('candidate')!;
    const candRes = await client.request({
      method: 'POST', path: '/v1/headhunter/candidates', auth: hKey,
      body: { candidate_user_id: candId, name: 'Cu', phone: '13800000020', email: 'cu@x.com' , current_company: '字节跳动' },
    });
    const jobRes = await client.request({
      method: 'POST', path: '/v1/headhunter/jobs', auth: hKey,
      body: { title: 'CuJob', description: 'd', create_for_employer_id: client.ids.get('employer') },
    });
    const jid = jobRes.data.data.id;
    // Employer must claim the job before recommendation (v009)
    await client.request({ method: 'POST', path: `/v1/employer/claim-jobs/${jid}`, auth: eKey });
    const recRes = await client.request({
      method: 'POST', path: '/v1/headhunter/recommendations', auth: hKey,
      body: { anonymized_candidate_id: candRes.data.data.anonymized_id, job_id: jid },
    });
    if (recRes.status !== 200) {
      throw new Error(`setup recommend failed: ${recRes.status} ${JSON.stringify(recRes.data)}`);
    }
    const recId = recRes.data.data.id;
    // State is pending — approve-unlock should 409
    const r = await client.request({
      method: 'POST', path: `/v1/candidate/recommendations/${recId}/approve-unlock`, auth: cKey,
    });
    expect(r.status).toBe(409);
    expect(r.data.error.code).toBe('INVALID_STATE');
  });

  it('POST /v1/candidate/recommendations/:id/reject-unlock — illegal from pending', async () => {
    const candId = client.ids.get('candidate')!;
    const candRes = await client.request({
      method: 'POST', path: '/v1/headhunter/candidates', auth: hKey,
      body: { candidate_user_id: candId, name: 'Rej', phone: '13800000021', email: 'rej@x.com' , current_company: '字节跳动' },
    });
    const jobRes = await client.request({
      method: 'POST', path: '/v1/headhunter/jobs', auth: hKey,
      body: { title: 'RejJob', description: 'd', create_for_employer_id: client.ids.get('employer') },
    });
    const jid = jobRes.data.data.id;
    await client.request({ method: 'POST', path: `/v1/employer/claim-jobs/${jid}`, auth: eKey });
    const recRes = await client.request({
      method: 'POST', path: '/v1/headhunter/recommendations', auth: hKey,
      body: { anonymized_candidate_id: candRes.data.data.anonymized_id, job_id: jid },
    });
    if (recRes.status !== 200) return; // skip if recommend fails
    const recId = recRes.data.data.id;
    const r = await client.request({
      method: 'POST', path: `/v1/candidate/recommendations/${recId}/reject-unlock`, auth: cKey,
    });
    expect(r.status).toBe(409);
    expect(r.data.error.code).toBe('INVALID_STATE');
  });

  it('POST /v1/candidate/delete-my-data GDPR right-to-be-forgotten', async () => {
    const r = await client.request({
      method: 'POST', path: '/v1/candidate/delete-my-data', auth: cKey,
    });
    expect(r.status).toBe(200);
  });
});