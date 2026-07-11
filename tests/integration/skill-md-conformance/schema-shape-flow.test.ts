// tests/integration/skill-md-conformance/schema-shape-flow.test.ts
//
// Tests for capabilities that require a multi-step state machine
// (pending → employer_interested → candidate_approved). Shared beforeAll
// registers users; each test creates a fresh recommendation in beforeEach
// and calls the endpoint under test with the right precondition.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient } from './_setup';
import {
  ExpressInterestResponseSchema,
  UnlockContactResponseSchema,
  ClaimJobResponseSchema,
  RejectJobResponseSchema,
  ApproveUnlockResponseSchema,
  RejectUnlockResponseSchema,
  CreatePlacementResponseSchema,
} from '../../../src/main/schemas/employer';
import {
  ApproveUnlockResponseSchema as CandApproveUnlockResponseSchema,
  RejectUnlockResponseSchema as CandRejectUnlockResponseSchema,
} from '../../../src/main/schemas/candidate';
import { EnvelopeSchema } from '../../../src/main/schemas/common';

// CreatePlacementResponseSchema is already envelope-wrapped (EnvelopeSchema(PlacementSchema)).
// Use it directly — do NOT wrap in EnvelopeSchema again.

describe('schema-shape: multi-step flow (per-test fresh recommendation)', () => {
  let client: ConformanceClient;
  let hKey: string, eKey: string, cKey: string;

  beforeAll(async () => {
    const f = await freshApp('shape-flow');
    client = new ConformanceClient(f.app);
    hKey = await client.register('hr', 'FlowH', 'fh@x.com');
    eKey = await client.register('pm', 'FlowE', 'fe@x.com');
    cKey = await client.register('candidate', 'FlowC', 'fc@x.com');
  });
  afterAll(() => cleanupDb('shape-flow'));

  // Helper: each test creates a fresh candidate + job pair. This is needed
  // because the recommendations table has UNIQUE(anonymized_candidate_id, job_id)
  // — reusing the same pair across tests would 409 on duplicate.
  let recId: string;
  let recAnonymizedId: string;
  let recJobId: string;
  beforeEach(async () => {
    const ts = Date.now();
    const candRes = await client.request({
      method: 'POST', path: '/v1/headhunter/candidates', auth: hKey,
      body: { candidate_user_id: client.ids.get('candidate'), name: `FlowCand${ts}`, phone: '13800000010', email: `fc-${ts}@x.com`, current_company: '字节跳动' },
    });
    recAnonymizedId = candRes.data.data.anonymized_id;
    const eJobRes = await client.request({
      method: 'POST', path: '/v1/employer/jobs', auth: eKey,
      body: { title: `FlowJob${ts}`, description: 'd' },
    });
    recJobId = eJobRes.data.data.id;
    const recRes = await client.request({
      method: 'POST', path: '/v1/headhunter/recommendations', auth: hKey,
      body: { anonymized_candidate_id: recAnonymizedId, job_id: recJobId },
    });
    recId = recRes.data.data.id;
  });

  it('employer.express_interest: POST /v1/employer/recommendations/:id/express-interest (pending → employer_interested)', async () => {
    const r = await client.request({
      method: 'POST', path: `/v1/employer/recommendations/${recId}/express-interest`,
      auth: eKey,
      schema: ExpressInterestResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.status).toBe('employer_interested');
  });

  it('employer.reject_jobs/:id: POST (on pending job → closed)', async () => {
    const j = await client.request({
      method: 'POST', path: '/v1/employer/jobs', auth: eKey,
      body: { title: `RejectJob${Date.now()}`, description: 'd' },
    });
    const r = await client.request({
      method: 'POST', path: `/v1/employer/reject-jobs/${j.data.data.id}`,
      auth: eKey, body: { reason: 'not a fit' },
      schema: RejectJobResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.status).toBe('closed');
  });

  it('employer.claim_jobs/:id: POST (headhunter-created job → claimed)', async () => {
    // claim_jobs only works for headhunter-created jobs (where employer_id IS NULL).
    // The headhunter creates a job for this employer, then the employer claims it.
    const ts = Date.now();
    const j = await client.request({
      method: 'POST', path: '/v1/headhunter/jobs', auth: hKey,
      body: { title: `ClaimJob${ts}`, description: 'd', created_for_employer_id: client.ids.get('pm') },
    });
    const r = await client.request({
      method: 'POST', path: `/v1/employer/claim-jobs/${j.data.data.id}`, auth: eKey,
      schema: ClaimJobResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.id).toBe(j.data.data.id);
  });

  it('candidate.approve_unlock: POST /v1/candidate/recommendations/:id/approve-unlock (employer_interested → candidate_approved)', async () => {
    await client.request({
      method: 'POST', path: `/v1/employer/recommendations/${recId}/express-interest`,
      auth: eKey,
    });
    const r = await client.request({
      method: 'POST', path: `/v1/candidate/recommendations/${recId}/approve-unlock`,
      auth: cKey,
      schema: CandApproveUnlockResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.status).toBe('candidate_approved');
  });

  it('candidate.reject_unlock: POST /v1/candidate/recommendations/:id/reject-unlock (employer_interested → rejected_candidate)', async () => {
    await client.request({
      method: 'POST', path: `/v1/employer/recommendations/${recId}/express-interest`,
      auth: eKey,
    });
    const r = await client.request({
      method: 'POST', path: `/v1/candidate/recommendations/${recId}/reject-unlock`,
      auth: cKey,
      schema: CandRejectUnlockResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.status).toBe('rejected_candidate');
  });

  it('employer.unlock_contact: POST /v1/employer/recommendations/:id/unlock-contact (after candidate_approved)', async () => {
    await client.request({
      method: 'POST', path: `/v1/employer/recommendations/${recId}/express-interest`,
      auth: eKey,
    });
    await client.request({
      method: 'POST', path: `/v1/candidate/recommendations/${recId}/approve-unlock`,
      auth: cKey,
    });
    const r = await client.request({
      method: 'POST', path: `/v1/employer/recommendations/${recId}/unlock-contact`,
      auth: eKey,
      schema: UnlockContactResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.status).toBe('unlocked');
  });

  it('employer.create_placement: POST /v1/employer/placements (after unlock)', async () => {
    await client.request({
      method: 'POST', path: `/v1/employer/recommendations/${recId}/express-interest`,
      auth: eKey,
    });
    await client.request({
      method: 'POST', path: `/v1/candidate/recommendations/${recId}/approve-unlock`,
      auth: cKey,
    });
    await client.request({
      method: 'POST', path: `/v1/employer/recommendations/${recId}/unlock-contact`,
      auth: eKey,
    });
    const r = await client.request({
      method: 'POST', path: '/v1/employer/placements', auth: eKey,
      body: { anonymized_candidate_id: recAnonymizedId, job_id: recJobId, annual_salary: 1000000 },
      schema: CreatePlacementResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.id).toBeDefined();
  });
});
