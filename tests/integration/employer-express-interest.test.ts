import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('employer handler - expressInterest (4-step unlock)', () => {
  const testDb3 = path.join(__dirname, '../../tmp/emp3.db');
  let localDb: any, localUsers: any, localPriv: any, localAnon: any, localJobs: any, localRecs: any, localWebhooks: any, localEmployer: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb3); } catch {}
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    localDb = openDb(testDb3);
    runMigrations(localDb);
    const { createUsersRepo } = await import('../../src/main/db/repositories/users');
    const { createCandidatesPrivateRepo } = await import('../../src/main/db/repositories/candidates-private');
    const { createCandidatesAnonymizedRepo } = await import('../../src/main/db/repositories/candidates-anonymized');
    const { createJobsRepo } = await import('../../src/main/db/repositories/jobs');
    const { createRecommendationsRepo } = await import('../../src/main/db/repositories/recommendations');
    const { createWebhookQueueRepo } = await import('../../src/main/db/repositories/webhook-delivery-queue');
    const { createEmployerHandler } = await import('../../src/main/modules/employer/handler');
    localUsers = createUsersRepo(localDb);
    localPriv = createCandidatesPrivateRepo(localDb);
    localAnon = createCandidatesAnonymizedRepo(localDb);
    localJobs = createJobsRepo(localDb);
    localRecs = createRecommendationsRepo(localDb);
    localWebhooks = createWebhookQueueRepo(localDb);
    localEmployer = createEmployerHandler(localDb);
    const now = '2026-06-17T00:00:00Z';
    localUsers.insert({ id: 'e1', user_type: 'pm', name: 'E', contact: null, agent_endpoint: 'https://e.example.com/wh', api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    localUsers.insert({ id: 'h1', user_type: 'hr', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    localUsers.insert({ id: 'c1', user_type: 'candidate', name: 'C', contact: null, agent_endpoint: 'https://c.example.com/wh', api_key_hash: 'h3', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    localPriv.insert({ id: 'cp_1', headhunter_id: 'h1', candidate_user_id: 'c1', name_enc: 'n', phone_enc: 'p', email_enc: 'e', current_company_raw: null, current_title_raw: null, expected_salary: null, years_experience: null, education_school: null, resume_url: null, skills_json: null, raw_payload_json: null, created_at: now, updated_at: now });
    localAnon.insert({ id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'h1', industry: '互联网', title_level: 'P6', years_experience: 8, salary_range: '60-80万', education_tier: '985', skills_json: '["React"]', is_public_pool: 1, unlock_status: 'locked', created_at: now, updated_at: now });
    localJobs.insert({ id: 'job_1', employer_id: 'e1', title: 'Senior FE', description: null, requirements: null, salary_min: 500000, salary_max: 800000, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
    localRecs.insert({ id: 'rec_1', headhunter_id: 'h1', employer_id: 'e1', anonymized_candidate_id: 'ca_1', job_id: 'job_1', status: 'pending', commission_split_json: null, referrer_headhunter_id: null, created_at: now, updated_at: now });
  });
  afterEach(() => { localDb.close(); try { fs.unlinkSync(testDb3); } catch {} });

  it('expressInterest transitions pending → employer_interested', () => {
    const e: any = { id: 'e1', user_type: 'pm' };
    localEmployer.expressInterest(e, { recommendation_id: 'rec_1' });
    expect(localRecs.findById('rec_1')?.status).toBe('employer_interested');
  });

  it('expressInterest enqueues webhook to candidate', () => {
    const e: any = { id: 'e1', user_type: 'pm' };
    localEmployer.expressInterest(e, { recommendation_id: 'rec_1' });
    const pending = localWebhooks.fetchPending(new Date().toISOString());
    expect(pending.length).toBe(1);
    expect(pending[0].target_user_id).toBe('c1');
    expect(pending[0].event_type).toBe('notify_unlock_request');
  });

  it('expressInterest rejects non-pending status (e.g., already unlocked)', () => {
    localRecs.updateStatus('rec_1', 'unlocked');
    const e: any = { id: 'e1', user_type: 'pm' };
    expect(() => localEmployer.expressInterest(e, { recommendation_id: 'rec_1' })).toThrow(/Invalid state/);
  });

  it('expressInterest rejects non-owner employer', () => {
    localUsers.insert({ id: 'e2', user_type: 'pm', name: 'E2', contact: null, agent_endpoint: null, api_key_hash: 'h4', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z' });
    const e2: any = { id: 'e2', user_type: 'pm' };
    expect(() => localEmployer.expressInterest(e2, { recommendation_id: 'rec_1' })).toThrow(/forbidden|not found/i);
  });
});
