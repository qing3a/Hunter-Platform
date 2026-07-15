import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient } from './_setup';
import {
  CreateJobResponseSchema, UpdateJobResponseSchema,
} from '../../../src/main/schemas/employer';

/**
 * Skill.md §2.2.1 + §2.2.4 (R1 era additions) — employer job CRUD + lifecycle
 * scenarios (PR #3 reconciliation follow-up).
 *
 *   - employer.read_job             GET  /v1/employer/jobs/:id
 *   - employer.update_job            PATCH /v1/employer/jobs/:id
 *   - employer.pause_job             POST /v1/employer/jobs/:id/pause
 *   - employer.resume_job            POST /v1/employer/jobs/:id/resume
 *   - employer.close_job             POST /v1/employer/jobs/:id/close
 *
 * The pending-claims actions (claim-via-pending / reject-via-pending) are
 * tested separately in employer.test.ts; here we focus on the direct pm-created
 * job lifecycle because creating a headhunter-posted job requires a separate
 * post-step (employer claim) and complicates the beforeAll hook. Spec ref:
 * skill.md §2.2.4 + §3.1 (job state machine).
 */
describe('skill.md: employer job lifecycle (PR #3 reconciliation follow-up)', () => {
  let client: ConformanceClient;
  let pmKey: string;
  let jobId: string;

  beforeAll(async () => {
    const f = await freshApp('pm-lifecycle');
    client = new ConformanceClient(f.app);
    pmKey = await client.register('pm', 'PM-Lifecycle', 'pm-lifecycle@x.com');

    const create = await client.request({
      method: 'POST', path: '/v1/employer/jobs', auth: pmKey,
      body: { title: 'L-direct', description: 'd', required_skills: ['react'] },
      schema: CreateJobResponseSchema,
    });
    jobId = create.data.data.id;
  }, 30_000);

  afterAll(() => cleanupDb('pm-lifecycle'), 30_000);

  it('employer.read_job: GET /v1/employer/jobs/:id returns the job the pm owns', async () => {
    const r = await client.request({
      method: 'GET', path: `/v1/employer/jobs/${jobId}`, auth: pmKey,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.id).toBe(jobId);
    expect(r.data.data.title).toBe('L-direct');
  });

  it('employer.update_job: PATCH /v1/employer/jobs/:id updates title', async () => {
    const r = await client.request({
      method: 'PATCH', path: `/v1/employer/jobs/${jobId}`, auth: pmKey,
      body: { title: 'L-direct-renamed' },
      schema: UpdateJobResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.title).toBe('L-direct-renamed');
  });

  it('employer.pause_job + resume_job: open → paused → open (state machine)', async () => {
    let r = await client.request({
      method: 'POST', path: `/v1/employer/jobs/${jobId}/pause`, auth: pmKey,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.status).toBe('paused');

    r = await client.request({
      method: 'POST', path: `/v1/employer/jobs/${jobId}/resume`, auth: pmKey,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.status).toBe('open');
  });

  it('employer.close_job: open → closed (terminal)', async () => {
    const r = await client.request({
      method: 'POST', path: `/v1/employer/jobs/${jobId}/close`, auth: pmKey,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.status).toBe('closed');
  });
});
