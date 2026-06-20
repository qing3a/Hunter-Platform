import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../../../src/main/db/connection';
import { runMigrations } from '../../../src/main/db/migrations';
import { createCandidateHandler } from '../../../src/main/modules/candidate/handler';

describe('candidate approveUnlock webhook', () => {
  const testDb = path.join(__dirname, '../../../tmp/approve-webhook.db');
  let db: any, candidate: any, webhooks: any, recs: any;
  const now = '2026-06-19T00:00:00Z';

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    db = openDb(testDb);
    runMigrations(db);
    const { createUsersRepo } = await import('../../../src/main/db/repositories/users');
    const { createCandidatesPrivateRepo } = await import('../../../src/main/db/repositories/candidates-private');
    const { createCandidatesAnonymizedRepo } = await import('../../../src/main/db/repositories/candidates-anonymized');
    const { createJobsRepo } = await import('../../../src/main/db/repositories/jobs');
    const { createRecommendationsRepo } = await import('../../../src/main/db/repositories/recommendations');
    const { createUnlockAuditLogRepo } = await import('../../../src/main/db/repositories/unlock-audit-log');
    const { createWebhookQueueRepo } = await import('../../../src/main/db/repositories/webhook-delivery-queue');
    const users = createUsersRepo(db);
    const priv = createCandidatesPrivateRepo(db);
    const anon = createCandidatesAnonymizedRepo(db);
    const jobsRepo = createJobsRepo(db);
    recs = createRecommendationsRepo(db);
    const audit = createUnlockAuditLogRepo(db);
    webhooks = createWebhookQueueRepo(db);
    candidate = createCandidateHandler(db, Buffer.alloc(32, 1));

    users.insert({ id: 'emp_1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: 'https://e.example.com/wh', api_key_hash: 'h', api_key_prefix: 'hp_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-20T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'hh_1', user_type: 'headhunter', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-20T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'cand_1', user_type: 'candidate', name: 'C', contact: null, agent_endpoint: null, api_key_hash: 'h3', api_key_prefix: 'hp_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-20T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    jobsRepo.insert({ id: 'job_x', employer_id: 'emp_1', title: 'Job', description: null, requirements: null, required_skills: [], salary_min: null, salary_max: null, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
    priv.insert({ id: 'cp_1', headhunter_id: 'hh_1', candidate_user_id: 'cand_1', name_enc: 'n', phone_enc: 'p', email_enc: 'e', current_company_raw: null, current_title_raw: null, expected_salary: null, years_experience: null, education_school: null, resume_url: null, skills_json: null, raw_payload_json: null, created_at: now, updated_at: now });
    anon.insert({ id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'hh_1', industry: '互联网', title_level: 'P6', years_experience: 8, salary_range: '60-80万', education_tier: '985', skills_json: '[]', is_public_pool: 1, unlock_status: 'locked', created_at: now, updated_at: now });
    recs.insert({ id: 'rec_1', headhunter_id: 'hh_1', employer_id: 'emp_1', anonymized_candidate_id: 'ca_1', job_id: 'job_x', status: 'employer_interested', commission_split_json: null, referrer_headhunter_id: null, created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  it('enqueues notify_unlock_approved webhook to employer after approveUnlock', () => {
    const c: any = { id: 'cand_1', user_type: 'candidate' };
    candidate.approveUnlock(c, { recommendation_id: 'rec_1' });
    const pending = webhooks.fetchPending(new Date().toISOString());
    expect(pending.length).toBe(1);
    expect(pending[0].event_type).toBe('notify_unlock_approved');
    expect(pending[0].target_user_id).toBe('emp_1');
    expect(pending[0].contains_pii).toBe(0);
  });
});