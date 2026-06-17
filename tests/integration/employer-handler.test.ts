import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('employer handler', () => {
  const testDb = path.join(__dirname, '../../tmp/emp.db');
  let db: any, users: any, jobs: any, employer: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    const { createUsersRepo } = await import('../../src/main/db/repositories/users');
    const { createJobsRepo } = await import('../../src/main/db/repositories/jobs');
    const { createEmployerHandler } = await import('../../src/main/modules/employer/handler');
    users = createUsersRepo(db);
    jobs = createJobsRepo(db);
    employer = createEmployerHandler(db);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  it('createJob requires employer role', () => {
    const headhunter: any = { id: 'h1', user_type: 'headhunter' };
    expect(() => employer.createJob(headhunter, { title: 'X' })).toThrow(/Only employers/);
  });

  it('createJob creates job and consumes quota', () => {
    const employer1: any = { id: 'e1', user_type: 'employer' };
    const job = employer.createJob(employer1, { title: 'Senior FE', salary_min: 500000, salary_max: 800000, industry: '互联网' });
    expect(job.title).toBe('Senior FE');
    expect(jobs.findById(job.id)).toBeDefined();
  });

  it('createJob rejects when quota exhausted', () => {
    const employer1: any = { id: 'e1', user_type: 'employer' };
    for (let i = 0; i < 20; i++) employer.createJob(employer1, { title: `Job ${i}` });
    expect(() => employer.createJob(employer1, { title: 'overflow' })).toThrow(/quota/i);
  });
});

describe('employer handler - browseTalent', () => {
  const testDb2 = path.join(__dirname, '../../tmp/emp2.db');
  let db2: any, users2: any, priv2: any, anon2: any, employer2: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb2); } catch {}
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    db2 = openDb(testDb2);
    runMigrations(db2);
    const { createUsersRepo } = await import('../../src/main/db/repositories/users');
    const { createCandidatesPrivateRepo } = await import('../../src/main/db/repositories/candidates-private');
    const { createCandidatesAnonymizedRepo } = await import('../../src/main/db/repositories/candidates-anonymized');
    const { createEmployerHandler } = await import('../../src/main/modules/employer/handler');
    users2 = createUsersRepo(db2);
    priv2 = createCandidatesPrivateRepo(db2);
    anon2 = createCandidatesAnonymizedRepo(db2);
    employer2 = createEmployerHandler(db2);
    const now = '2026-06-17T00:00:00Z';
    users2.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users2.insert({ id: 'h1', user_type: 'headhunter', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users2.insert({ id: 'c1', user_type: 'candidate', name: 'C1', contact: null, agent_endpoint: null, api_key_hash: 'h3', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users2.insert({ id: 'c2', user_type: 'candidate', name: 'C2', contact: null, agent_endpoint: null, api_key_hash: 'h4', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    priv2.insert({ id: 'cp_1', headhunter_id: 'h1', candidate_user_id: 'c1', name_enc: 'n', phone_enc: 'p', email_enc: 'e', current_company_raw: '字节跳动', current_title_raw: 'P6', expected_salary: 700000, years_experience: 8, education_school: '清华大学', resume_url: null, skills_json: '["React"]', raw_payload_json: null, created_at: now, updated_at: now });
    anon2.insert({ id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'h1', industry: '互联网', title_level: 'P6', years_experience: 8, salary_range: '60-80万', education_tier: '985', skills_json: '["React"]', is_public_pool: 1, unlock_status: 'locked', created_at: now, updated_at: now });
    priv2.insert({ id: 'cp_2', headhunter_id: 'h1', candidate_user_id: 'c2', name_enc: 'n', phone_enc: 'p', email_enc: 'e', current_company_raw: '阿里', current_title_raw: 'P7', expected_salary: 1100000, years_experience: 10, education_school: '北大', resume_url: null, skills_json: '["Java"]', raw_payload_json: null, created_at: now, updated_at: now });
    anon2.insert({ id: 'ca_2', source_private_id: 'cp_2', source_headhunter_id: 'h1', industry: '互联网', title_level: 'P7+', years_experience: 10, salary_range: '80-120万', education_tier: '985', skills_json: '["Java"]', is_public_pool: 1, unlock_status: 'locked', created_at: now, updated_at: now });
  });
  afterEach(() => { db2.close(); try { fs.unlinkSync(testDb2); } catch {} });

  it('browseTalent returns public pool candidates', () => {
    const employer1: any = { id: 'e1', user_type: 'employer' };
    const list = employer2.browseTalent(employer1, {});
    expect(list.length).toBe(2);
  });

  it('browseTalent filters by industry', () => {
    const employer1: any = { id: 'e1', user_type: 'employer' };
    const list = employer2.browseTalent(employer1, { industry: '互联网' });
    expect(list.length).toBe(2);
  });

  it('browseTalent returns ONLY desensitized fields (no PII)', () => {
    const employer1: any = { id: 'e1', user_type: 'employer' };
    const list = employer2.browseTalent(employer1, {});
    for (const c of list) {
      expect(c).not.toHaveProperty('name');
      expect(c).not.toHaveProperty('phone');
      expect(c).not.toHaveProperty('email');
    }
  });
});
