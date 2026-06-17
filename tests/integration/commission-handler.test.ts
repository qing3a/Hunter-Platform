import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('commission handler', () => {
  const testDb = path.join(__dirname, '../../tmp/comm-handler.db');
  let db: any, users: any, priv: any, anon: any, jobs: any, recs: any, places: any, handler: any;

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
    const { createPlacementsRepo } = await import('../../src/main/db/repositories/placements');
    const { createCommissionHandler } = await import('../../src/main/modules/commission/handler');
    users = createUsersRepo(db);
    priv = createCandidatesPrivateRepo(db);
    anon = createCandidatesAnonymizedRepo(db);
    jobs = createJobsRepo(db);
    recs = createRecommendationsRepo(db);
    places = createPlacementsRepo(db);
    handler = createCommissionHandler(db);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'h1', user_type: 'headhunter', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'c1', user_type: 'candidate', name: 'C', contact: null, agent_endpoint: null, api_key_hash: 'h3', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    priv.insert({ id: 'cp_1', headhunter_id: 'h1', candidate_user_id: 'c1', name_enc: 'n', phone_enc: 'p', email_enc: 'e', current_company_raw: null, current_title_raw: null, expected_salary: null, years_experience: null, education_school: null, resume_url: null, skills_json: null, raw_payload_json: null, created_at: now, updated_at: now });
    anon.insert({ id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'h1', industry: '互联网', title_level: 'P6', years_experience: 8, salary_range: '60-80万', education_tier: '985', skills_json: '[]', is_public_pool: 0, unlock_status: 'unlocked', created_at: now, updated_at: now });
    jobs.insert({ id: 'j1', employer_id: 'e1', title: 'A', description: null, requirements: null, salary_min: null, salary_max: null, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
    recs.insert({ id: 'r1', headhunter_id: 'h1', employer_id: 'e1', anonymized_candidate_id: 'ca_1', job_id: 'j1', status: 'unlocked', commission_split_json: null, referrer_headhunter_id: null, created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('createPlacement requires employer role', () => {
    const h: any = { id: 'h1', user_type: 'headhunter' };
    expect(() => handler.createPlacement(h, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 600000 })).toThrow();
  });

  it('createPlacement requires recommendation in unlocked status', () => {
    db.prepare("UPDATE recommendations SET status = 'pending' WHERE id = 'r1'").run();
    const e: any = { id: 'e1', user_type: 'employer' };
    expect(() => handler.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 600000 })).toThrow(/Invalid state/);
  });

  it('createPlacement computes commission and inserts', () => {
    const e: any = { id: 'e1', user_type: 'employer' };
    const p = handler.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 1_000_000 });
    expect(p.platform_fee).toBe(200_000);
    expect(p.primary_share).toBe(200_000);  // no referrer → primary gets all
    expect(p.status).toBe('pending_payment');
  });

  it('createPlacement rejects duplicate (P1#4)', () => {
    const e: any = { id: 'e1', user_type: 'employer' };
    handler.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 1_000_000 });
    expect(() => handler.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 1_000_000 })).toThrow();
  });

  it('markPaid transitions pending_payment → paid', () => {
    const e: any = { id: 'e1', user_type: 'employer' };
    const p = handler.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 600000 });
    handler.markPaid('admin', p.id);
    expect(places.findById(p.id)?.status).toBe('paid');
  });

  it('markPaid rejects when status is not pending_payment', () => {
    const e: any = { id: 'e1', user_type: 'employer' };
    const p = handler.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 600000 });
    handler.markPaid('admin', p.id);
    expect(() => handler.markPaid('admin', p.id)).toThrow(/Invalid state/);
  });
});