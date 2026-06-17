import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('unlock_audit_log repository', () => {
  const testDb = path.join(__dirname, '../../../tmp/audit.db');
  let db: any, users: any, audit: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = await import('../../../src/main/db/connection');
    const { runMigrations } = await import('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    const { createUsersRepo } = await import('../../../src/main/db/repositories/users');
    const { createUnlockAuditLogRepo } = await import('../../../src/main/db/repositories/unlock-audit-log');
    const { createJobsRepo } = await import('../../../src/main/db/repositories/jobs');
    const { createCandidatesPrivateRepo } = await import('../../../src/main/db/repositories/candidates-private');
    const { createCandidatesAnonymizedRepo } = await import('../../../src/main/db/repositories/candidates-anonymized');
    const { createRecommendationsRepo } = await import('../../../src/main/db/repositories/recommendations');
    users = createUsersRepo(db);
    audit = createUnlockAuditLogRepo(db);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'u1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'h1', user_type: 'headhunter', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'c1', user_type: 'candidate', name: 'C', contact: null, agent_endpoint: null, api_key_hash: 'h3', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    const priv = createCandidatesPrivateRepo(db);
    const anon = createCandidatesAnonymizedRepo(db);
    const jobs = createJobsRepo(db);
    const recs = createRecommendationsRepo(db);
    priv.insert({ id: 'cp_1', headhunter_id: 'h1', candidate_user_id: 'c1', name_enc: 'n', phone_enc: 'p', email_enc: 'e', current_company_raw: null, current_title_raw: null, expected_salary: null, years_experience: null, education_school: null, resume_url: null, skills_json: null, raw_payload_json: null, created_at: now, updated_at: now });
    anon.insert({ id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'h1', industry: '互联网', title_level: 'P6', years_experience: 8, salary_range: '60-80万', education_tier: '985', skills_json: '[]', is_public_pool: 0, unlock_status: 'locked', created_at: now, updated_at: now });
    jobs.insert({ id: 'j1', employer_id: 'u1', title: 'FE', description: null, requirements: null, salary_min: null, salary_max: null, status: 'open', priority: 'normal', deadline: null, industry: null, created_at: now, updated_at: now });
    recs.insert({ id: 'rec_1', headhunter_id: 'h1', employer_id: 'u1', anonymized_candidate_id: 'ca_1', job_id: 'j1', status: 'pending', commission_split_json: null, referrer_headhunter_id: null, created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  it('inserts audit entry', () => {
    audit.insert({
      recommendation_id: 'rec_1', actor_user_id: 'u1', action: 'express_interest',
      ip_address: '127.0.0.1', user_agent: 'test',
    });
    const entries = audit.listByRecommendation('rec_1');
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe('express_interest');
  });

  it('lists by actor (for access log queries)', () => {
    audit.insert({ recommendation_id: 'rec_1', actor_user_id: 'u1', action: 'express_interest', ip_address: null, user_agent: null });
    const list = audit.listByActor('u1');
    expect(list.length).toBe(1);
  });
});
