import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('candidate handler', () => {
  const testDb = path.join(__dirname, '../../tmp/cand-handler.db');
  let db: any, users: any, priv: any, anon: any, jobs: any, recs: any, audit: any, candidate: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    const { createUsersRepo } = await import('../../src/main/db/repositories/users');
    const { createCandidatesPrivateRepo } = await import('../../src/main/db/repositories/candidates-private');
    const { createCandidatesAnonymizedRepo } = await import('../../src/main/db/repositories/candidates-anonymized');
    const { createJobsRepo } = await import('../../src/main/db/repositories/jobs');
    const { createRecommendationsRepo } = await import('../../src/main/db/repositories/recommendations');
    const { createUnlockAuditLogRepo } = await import('../../src/main/db/repositories/unlock-audit-log');
    const { createCandidateHandler } = await import('../../src/main/modules/candidate/handler');
    users = createUsersRepo(db);
    priv = createCandidatesPrivateRepo(db);
    anon = createCandidatesAnonymizedRepo(db);
    jobs = createJobsRepo(db);
    recs = createRecommendationsRepo(db);
    audit = createUnlockAuditLogRepo(db);
    candidate = createCandidateHandler(db);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: 'https://e.example.com/wh', api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'h1', user_type: 'headhunter', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'c1', user_type: 'candidate', name: 'C', contact: null, agent_endpoint: 'https://c.example.com/wh', api_key_hash: 'h3', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    priv.insert({ id: 'cp_1', headhunter_id: 'h1', candidate_user_id: 'c1', name_enc: 'n', phone_enc: 'p', email_enc: 'e', current_company_raw: null, current_title_raw: null, expected_salary: null, years_experience: null, education_school: null, resume_url: null, skills_json: null, raw_payload_json: null, created_at: now, updated_at: now });
    anon.insert({ id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'h1', industry: '互联网', title_level: 'P6', years_experience: 8, salary_range: '60-80万', education_tier: '985', skills_json: '[]', is_public_pool: 1, unlock_status: 'locked', created_at: now, updated_at: now });
    jobs.insert({ id: 'job_1', employer_id: 'e1', title: 'FE', description: null, requirements: null, salary_min: 500000, salary_max: 800000, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
    recs.insert({ id: 'rec_1', headhunter_id: 'h1', employer_id: 'e1', anonymized_candidate_id: 'ca_1', job_id: 'job_1', status: 'employer_interested', commission_split_json: null, referrer_headhunter_id: null, created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  it('viewOpportunities returns only visible recs for this candidate', () => {
    const c: any = { id: 'c1', user_type: 'candidate' };
    const opps = candidate.viewOpportunities(c, {});
    expect(opps.length).toBe(1);
    expect(opps[0].status).toBe('employer_interested');
  });

  it('approveUnlock transitions employer_interested → candidate_approved + audit', () => {
    const c: any = { id: 'c1', user_type: 'candidate' };
    candidate.approveUnlock(c, { recommendation_id: 'rec_1' });
    expect(recs.findById('rec_1')?.status).toBe('candidate_approved');
    const entries = audit.listByRecommendation('rec_1');
    expect(entries.some((e: any) => e.action === 'approve_unlock')).toBe(true);
  });

  it('approveUnlock rejects when not candidate owner', () => {
    users.insert({ id: 'c2', user_type: 'candidate', name: 'C2', contact: null, agent_endpoint: null, api_key_hash: 'h4', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z' });
    const c2: any = { id: 'c2', user_type: 'candidate' };
    expect(() => candidate.approveUnlock(c2, { recommendation_id: 'rec_1' })).toThrow();
  });

  it('rejectUnlock transitions to rejected_candidate', () => {
    const c: any = { id: 'c1', user_type: 'candidate' };
    candidate.rejectUnlock(c, { recommendation_id: 'rec_1' });
    expect(recs.findById('rec_1')?.status).toBe('rejected_candidate');
  });
});
