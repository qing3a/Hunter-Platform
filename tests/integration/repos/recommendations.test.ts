import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('recommendations repository', () => {
  const testDb = path.join(__dirname, '../../../tmp/rec.db');
  let db: any, users: any, priv: any, anon: any, jobs: any, recs: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = await import('../../../src/main/db/connection');
    const { runMigrations } = await import('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    const { createUsersRepo } = await import('../../../src/main/db/repositories/users');
    const { createCandidatesPrivateRepo } = await import('../../../src/main/db/repositories/candidates-private');
    const { createCandidatesAnonymizedRepo } = await import('../../../src/main/db/repositories/candidates-anonymized');
    const { createJobsRepo } = await import('../../../src/main/db/repositories/jobs');
    const { createRecommendationsRepo } = await import('../../../src/main/db/repositories/recommendations');
    users = createUsersRepo(db);
    priv = createCandidatesPrivateRepo(db);
    anon = createCandidatesAnonymizedRepo(db);
    jobs = createJobsRepo(db);
    recs = createRecommendationsRepo(db);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'h1', user_type: 'headhunter', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'c1', user_type: 'candidate', name: 'C', contact: null, agent_endpoint: null, api_key_hash: 'h3', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    priv.insert({ id: 'cp_1', headhunter_id: 'h1', candidate_user_id: 'c1', name_enc: 'n', phone_enc: 'p', email_enc: 'e', current_company_raw: null, current_title_raw: null, expected_salary: null, years_experience: null, education_school: null, resume_url: null, skills_json: null, raw_payload_json: null, created_at: now, updated_at: now });
    anon.insert({ id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'h1', industry: '互联网', title_level: 'P6', years_experience: 8, salary_range: '60-80万', education_tier: '985', skills_json: '[]', is_public_pool: 0, unlock_status: 'locked', created_at: now, updated_at: now });
    jobs.insert({ id: 'j1', employer_id: 'e1', title: 'Senior FE', description: null, requirements: null, salary_min: 500000, salary_max: 800000, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  function seedRec(id: string, status: string = 'pending') {
    const now = '2026-06-17T00:00:00Z';
    recs.insert({
      id, headhunter_id: 'h1', employer_id: 'e1', anonymized_candidate_id: 'ca_1', job_id: 'j1',
      status, commission_split_json: null, referrer_headhunter_id: null,
      created_at: now, updated_at: now,
    });
  }

  it('inserts and finds by id', () => {
    seedRec('rec_1');
    const r = recs.findById('rec_1');
    expect(r?.status).toBe('pending');
  });

  it('finds by candidate + job (UNIQUE constraint target)', () => {
    seedRec('rec_1');
    const r = recs.findByCandidateAndJob('ca_1', 'j1');
    expect(r?.id).toBe('rec_1');
  });

  it('rejects duplicate (candidate, job) via UNIQUE constraint', () => {
    seedRec('rec_1');
    expect(() => seedRec('rec_2')).toThrow();
  });

  it('updates status with timestamp', () => {
    seedRec('rec_1');
    recs.updateStatus('rec_1', 'employer_interested');
    expect(recs.findById('rec_1')?.status).toBe('employer_interested');
  });

  it('lists by headhunter with status filter', () => {
    // Need a second job to avoid the (anonymized_candidate_id, job_id) UNIQUE constraint
    const now = '2026-06-17T00:00:00Z';
    jobs.insert({ id: 'j2', employer_id: 'e1', title: 'Backend', description: null, requirements: null, salary_min: null, salary_max: null, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
    seedRec('rec_1', 'pending');
    recs.insert({ id: 'rec_2', headhunter_id: 'h1', employer_id: 'e1', anonymized_candidate_id: 'ca_1', job_id: 'j2', status: 'unlocked', commission_split_json: null, referrer_headhunter_id: null, created_at: now, updated_at: now });
    const pending = recs.listByHeadhunter('h1', { status: 'pending' });
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe('rec_1');
  });

  it('lists by employer (incoming recommendations)', () => {
    seedRec('rec_1');
    const list = recs.listByEmployer('e1', {});
    expect(list.length).toBe(1);
  });

  it('lists by candidate via anonymized_candidate_id', () => {
    seedRec('rec_1');
    const list = recs.listByCandidate('ca_1', { status: 'pending' });
    expect(list.length).toBe(1);
  });
});
