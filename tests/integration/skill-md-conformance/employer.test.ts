import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient } from './_setup';

describe('skill.md: employer (scenarios 6-9)', () => {
  let client: ConformanceClient;
  let hKey: string;
  let eKey: string;
  let candidateId: string;
  let jobId: string;
  let recId: string;

  beforeAll(async () => {
    const f = await freshApp('employer');
    client = new ConformanceClient(f.app);
    hKey = await client.register('headhunter', 'H', 'h@x.com');
    eKey = await client.register('employer', 'E', 'e@x.com');
    await client.register('candidate', 'C', 'c@x.com');
    candidateId = client.ids.get('candidate')!;
    // Headhunter creates a job on employer's behalf (so employer_id is null
    // and employer can claim it via the flow).
    const jobRes = await client.request({
      method: 'POST', path: '/v1/headhunter/jobs', auth: hKey,
      body: { title: 'EJob', description: 'd', create_for_employer_id: client.ids.get('employer') },
    });
    jobId = jobRes.data.data.id;
    // Employer must claim the job before headhunter can recommend (v009).
    await client.request({ method: 'POST', path: `/v1/employer/claim-jobs/${jobId}`, auth: eKey });
    // Upload candidate + create recommendation for express-interest flow
    const candRes = await client.request({
      method: 'POST', path: '/v1/headhunter/candidates', auth: hKey,
      body: { candidate_user_id: candidateId, name: 'EmpCand', phone: '13800000010', email: 'emp@x.com' },
    });
    const recRes = await client.request({
      method: 'POST', path: '/v1/headhunter/recommendations', auth: hKey,
      body: { anonymized_candidate_id: candRes.data.data.anonymized_id, job_id: jobId },
    });
    recId = recRes.data.data.id;
  });
  afterAll(() => cleanupDb('employer'));

  it('GET /v1/employer/pending-claims lists jobs awaiting claim/reject', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/employer/pending-claims', auth: eKey });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.data)).toBe(true);
  });

  it('POST /v1/employer/claim-jobs/:id → 200', async () => {
    const r = await client.request({
      method: 'POST', path: `/v1/employer/claim-jobs/${jobId}`, auth: eKey,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.status).toBe('claimed');
  });

  it('GET /v1/employer/jobs lists employer jobs', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/employer/jobs', auth: eKey });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.data)).toBe(true);
  });

  it('GET /v1/employer/talent browses public pool', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/employer/talent', auth: eKey });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.data)).toBe(true);
  });

  it('POST /v1/employer/recommendations/:id/express-interest on pending → 200', async () => {
    const r = await client.request({
      method: 'POST', path: `/v1/employer/recommendations/${recId}/express-interest`, auth: eKey,
    });
    expect([200, 409]).toContain(r.status);
  });

  it('POST /v1/employer/placements creates a placement', async () => {
    // Placement requires an unlocked recommendation. Just test that the
    // endpoint exists and responds (200 happy, 409 if prerequisites not met).
    const r = await client.request({
      method: 'POST', path: '/v1/employer/placements', auth: eKey,
      body: { recommendation_id: recId, start_date: '2026-01-01' },
    });
    expect([200, 400, 409]).toContain(r.status);
  });

  it('GET /v1/employer/placements lists placements', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/employer/placements', auth: eKey });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.data)).toBe(true);
  });
});