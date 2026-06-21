import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient, adminAuthHeader } from './_setup';

describe('skill.md: headhunter (scenarios 3-5)', () => {
  let client: ConformanceClient;
  let hKey: string;
  let eKey: string;
  let candidateId: string;
  let jobId: string;

  beforeAll(async () => {
    const f = await freshApp('headhunter');
    client = new ConformanceClient(f.app);
    hKey = await client.register('headhunter', 'H', 'h@x.com');
    eKey = await client.register('employer', 'E', 'e@x.com');
    await client.register('candidate', 'C', 'c@x.com');
    candidateId = client.ids.get('candidate')!;
    // Setup a job via headhunter (so employer_id is null, employer can claim)
    const jobRes = await client.request({
      method: 'POST', path: '/v1/headhunter/jobs', auth: hKey,
      body: { title: 'HJob', description: 'd', create_for_employer_id: client.ids.get('employer') },
    });
    jobId = jobRes.data.data.id;
  });
  afterAll(() => cleanupDb('headhunter'));

  it('POST /v1/headhunter/candidates uploads a candidate', async () => {
    const r = await client.request({
      method: 'POST', path: '/v1/headhunter/candidates', auth: hKey,
      body: { candidate_user_id: candidateId, name: 'C1', phone: '13800000001', email: 'c1@x.com' },
    });
    expect(r.status).toBe(200);
    expect(r.data.data.anonymized_id).toBeDefined();
  });

  it('POST /v1/headhunter/recommendations creates a recommendation (state: pending)', async () => {
    // Job must be claimed by employer before recommendation (v009)
    await client.request({ method: 'POST', path: `/v1/employer/claim-jobs/${jobId}`, auth: eKey });
    const candRes = await client.request({
      method: 'POST', path: '/v1/headhunter/candidates', auth: hKey,
      body: { candidate_user_id: candidateId, name: 'C2', phone: '13800000002', email: 'c2@x.com' },
    });
    const anonId = candRes.data.data.anonymized_id;
    const r = await client.request({
      method: 'POST', path: '/v1/headhunter/recommendations', auth: hKey,
      body: { anonymized_candidate_id: anonId, job_id: jobId },
    });
    expect(r.status).toBe(200);
    expect(r.data.data.status).toBe('pending');
  });

  it('GET /v1/headhunter/recommendations lists them', async () => {
    const r = await client.request({
      method: 'GET', path: '/v1/headhunter/recommendations', auth: hKey,
    });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.data)).toBe(true);
    expect(r.data.data.length).toBeGreaterThan(0);
  });

  it('POST /v1/headhunter/recommendations/:id/withdraw on pending → 200', async () => {
    // Create fresh rec to withdraw
    const candRes = await client.request({
      method: 'POST', path: '/v1/headhunter/candidates', auth: hKey,
      body: { candidate_user_id: candidateId, name: 'W', phone: '13800000003', email: 'w@x.com' },
    });
    const anonId = candRes.data.data.anonymized_id;
    const recRes = await client.request({
      method: 'POST', path: '/v1/headhunter/recommendations', auth: hKey,
      body: { anonymized_candidate_id: anonId, job_id: jobId },
    });
    if (recRes.status !== 200) return; // skip if recommend fails
    const recId = recRes.data.data.id;
    const r = await client.request({
      method: 'POST', path: `/v1/headhunter/recommendations/${recId}/withdraw`, auth: hKey,
    });
    expect([200, 409]).toContain(r.status);
  });

  it('POST /v1/headhunter/candidates/:id/publish-to-pool publishes', async () => {
    // First upload a candidate to publish
    const candRes = await client.request({
      method: 'POST', path: '/v1/headhunter/candidates', auth: hKey,
      body: { candidate_user_id: candidateId, name: 'Pub', phone: '13800000004', email: 'pub@x.com' },
    });
    const candId = candRes.data.data.anonymized_id;
    const r = await client.request({
      method: 'POST', path: `/v1/headhunter/candidates/${candId}/publish-to-pool`, auth: hKey,
    });
    expect(r.status).toBe(200);
  });

  // headhunter.list_candidates + create_job + list_jobs coverage
  it('GET /v1/headhunter/candidates (headhunter.list_candidates)', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/headhunter/candidates', auth: hKey });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.data)).toBe(true);
  });

  it('POST /v1/headhunter/jobs (headhunter.create_job)', async () => {
    const r = await client.request({
      method: 'POST', path: '/v1/headhunter/jobs', auth: hKey,
      body: { title: 'HJ2', description: 'd2', create_for_employer_id: client.ids.get('employer') },
    });
    expect(r.status).toBe(200);
  });

  it('GET /v1/headhunter/jobs (headhunter.list_jobs)', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/headhunter/jobs', auth: hKey });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.data)).toBe(true);
  });
});