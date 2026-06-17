import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('headhunter recommend', () => {
  const testDb = path.join(__dirname, '../../tmp/rec-handler.db');
  let db: any, users: any, priv: any, anon: any, jobs: any, recs: any, headhunter: any;

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
    const { createHeadhunterHandler } = await import('../../src/main/modules/headhunter/handler');
    users = createUsersRepo(db);
    priv = createCandidatesPrivateRepo(db);
    anon = createCandidatesAnonymizedRepo(db);
    jobs = createJobsRepo(db);
    recs = createRecommendationsRepo(db);
    headhunter = createHeadhunterHandler(db, Buffer.alloc(32));
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'h1', user_type: 'headhunter', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'c1', user_type: 'candidate', name: 'C', contact: null, agent_endpoint: null, api_key_hash: 'h3', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    priv.insert({ id: 'cp_1', headhunter_id: 'h1', candidate_user_id: 'c1', name_enc: 'n', phone_enc: 'p', email_enc: 'e', current_company_raw: null, current_title_raw: null, expected_salary: null, years_experience: null, education_school: null, resume_url: null, skills_json: null, raw_payload_json: null, created_at: now, updated_at: now });
    anon.insert({ id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'h1', industry: '互联网', title_level: 'P6', years_experience: 8, salary_range: '60-80万', education_tier: '985', skills_json: '[]', is_public_pool: 1, unlock_status: 'locked', created_at: now, updated_at: now });
    jobs.insert({ id: 'job_1', employer_id: 'e1', title: 'FE', description: null, requirements: null, salary_min: null, salary_max: null, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  it('recommends candidate for job', () => {
    const h: any = { id: 'h1', user_type: 'headhunter' };
    const rec = headhunter.recommendCandidate(h, { anonymized_candidate_id: 'ca_1', job_id: 'job_1' });
    expect(rec.status).toBe('pending');
  });

  it('rejects duplicate recommendation (UNIQUE constraint)', () => {
    const h: any = { id: 'h1', user_type: 'headhunter' };
    headhunter.recommendCandidate(h, { anonymized_candidate_id: 'ca_1', job_id: 'job_1' });
    expect(() => headhunter.recommendCandidate(h, { anonymized_candidate_id: 'ca_1', job_id: 'job_1' })).toThrow();
  });

  it('rejects job not open', () => {
    db.prepare("UPDATE jobs SET status = 'closed' WHERE id = 'job_1'").run();
    const h: any = { id: 'h1', user_type: 'headhunter' };
    expect(() => headhunter.recommendCandidate(h, { anonymized_candidate_id: 'ca_1', job_id: 'job_1' })).toThrow();
  });
});
