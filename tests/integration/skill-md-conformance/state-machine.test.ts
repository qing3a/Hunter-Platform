import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient, adminAuthHeader } from './_setup';

describe('skill.md: state machine invalid transitions (Phase 3)', () => {
  let client: ConformanceClient;
  let hKey: string;        // headhunter
  let eKey: string;        // employer
  let cKey: string;        // candidate
  let jobId: string;
  let recId: string;

  beforeAll(async () => {
    const f = await freshApp('state-machine');
    client = new ConformanceClient(f.app);
    hKey = await client.register('headhunter', 'H', 'h@x.com');
    eKey = await client.register('employer', 'E', 'e@x.com');
    cKey = await client.register('candidate', 'C', 'c@x.com');
  });
  afterAll(() => cleanupDb('state-machine'));

  async function setupJobAndRecommendation(): Promise<void> {
    // Create job
    const jobRes = await client.request({
      method: 'POST', path: '/v1/employer/jobs', auth: eKey,
      body: { title: 'Job1', description: 'desc' },
    });
    jobId = jobRes.data.data.id;
    // Headhunter creates a candidate (needs candidate_user_id)
    const candRes = await client.request({
      method: 'POST', path: '/v1/headhunter/candidates', auth: hKey,
      body: { candidate_user_id: client.ids.get('candidate'), name: 'X', phone: '13800000001', email: 'x@x.com' },
    });
    const anonId = candRes.data.data.anonymized_id;
    // Recommend
    const recRes = await client.request({
      method: 'POST', path: '/v1/headhunter/recommendations', auth: hKey,
      body: { anonymized_candidate_id: anonId, job_id: jobId },
    });
    recId = recRes.data.data.id;
  }

  it('employer.reject-jobs/:id on a NOT-claimed (open) job → 200 (Bug 2/3)', async () => {
    // No setup needed; job is in 'open' state by default
    const jobRes = await client.request({
      method: 'POST', path: '/v1/employer/jobs', auth: eKey,
      body: { title: 'RejectTest', description: 'd' },
    });
    const jid = jobRes.data.data.id;
    const r = await client.request({
      method: 'POST', path: `/v1/employer/reject-jobs/${jid}`, auth: eKey,
      body: { reason: 'test' },
    });
    expect(r.status).toBe(200);
    expect(r.data.data.status).toBe('closed');
  });

  it('employer.reject-jobs/:id on a claimed job → 409 INVALID_STATE (Bug 2/3 regression)', async () => {
    // Setup: headhunter creates a job on employer's behalf (so employer_id
    // starts null), then employer claims it, then rejects → 409.
    const jobRes = await client.request({
      method: 'POST', path: '/v1/headhunter/jobs', auth: hKey,
      body: { title: 'ClaimTest', description: 'd', create_for_employer_id: client.ids.get('employer') },
    });
    const jid = jobRes.data.data.id;
    const claim = await client.request({
      method: 'POST', path: `/v1/employer/claim-jobs/${jid}`, auth: eKey,
    });
    expect(claim.status).toBe(200);
    // Try to reject — should fail
    const reject = await client.request({
      method: 'POST', path: `/v1/employer/reject-jobs/${jid}`, auth: eKey,
      body: { reason: 'too late' },
    });
    expect(reject.status).toBe(409);
    expect(reject.data.error.code).toBe('INVALID_STATE');
  });

  it('candidate.approve-unlock on a pending recommendation → 409 (illegal transition)', async () => {
    await setupJobAndRecommendation();
    // State is 'pending' — candidate cannot approve_unlock from this state
    const r = await client.request({
      method: 'POST', path: `/v1/candidate/recommendations/${recId}/approve-unlock`,
      auth: cKey,
    });
    expect(r.status).toBe(409);
    expect(r.data.error.code).toBe('INVALID_STATE');
  });

  it('admin.suspend on already-suspended user → 409 (Phase 3 H1 regression)', async () => {
    // Suspend once
    const suspend1 = await client.request({
      method: 'POST', path: `/v1/admin/users/${client.ids.get('candidate')}/suspend`, auth: adminAuthHeader(),
      body: { reason: 'test' },
    });
    expect(suspend1.status).toBe(200);
    // Try again — should 409
    const suspend2 = await client.request({
      method: 'POST', path: `/v1/admin/users/${client.ids.get('candidate')}/suspend`, auth: adminAuthHeader(),
      body: { reason: 'second time' },
    });
    expect(suspend2.status).toBe(409);
    expect(suspend2.data.error.code).toBe('INVALID_STATE');
  });
});