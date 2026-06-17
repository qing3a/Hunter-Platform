import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('placements repository', () => {
  const testDb = path.join(__dirname, '../../../tmp/place.db');
  let db: any, users: any, priv: any, anon: any, jobs: any, places: any;

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
    const { createPlacementsRepo } = await import('../../../src/main/db/repositories/placements');
    users = createUsersRepo(db);
    priv = createCandidatesPrivateRepo(db);
    anon = createCandidatesAnonymizedRepo(db);
    jobs = createJobsRepo(db);
    places = createPlacementsRepo(db);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'h1', user_type: 'headhunter', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'c1', user_type: 'candidate', name: 'C', contact: null, agent_endpoint: null, api_key_hash: 'h3', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    priv.insert({ id: 'cp_1', headhunter_id: 'h1', candidate_user_id: 'c1', name_enc: 'n', phone_enc: 'p', email_enc: 'e', current_company_raw: null, current_title_raw: null, expected_salary: null, years_experience: null, education_school: null, resume_url: null, skills_json: null, raw_payload_json: null, created_at: now, updated_at: now });
    anon.insert({ id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'h1', industry: '互联网', title_level: 'P6', years_experience: 8, salary_range: '60-80万', education_tier: '985', skills_json: '[]', is_public_pool: 0, unlock_status: 'unlocked', created_at: now, updated_at: now });
    jobs.insert({ id: 'j1', employer_id: 'e1', title: 'A', description: null, requirements: null, salary_min: 500000, salary_max: 800000, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
    jobs.insert({ id: 'j2', employer_id: 'e1', title: 'B', description: null, requirements: null, salary_min: 500000, salary_max: 800000, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  function seedPlacement(id: string, status: string = 'pending_payment', primaryHeadhunter: string = 'h1') {
    const now = '2026-06-17T00:00:00Z';
    places.insert({
      id, job_id: 'j1', candidate_user_id: 'c1', primary_headhunter_id: primaryHeadhunter,
      referrer_headhunter_id: null, anonymized_candidate_id: 'ca_1',
      annual_salary: 600000, platform_fee: 120000, primary_share: 84000, referrer_share: 0, candidate_bonus: 0,
      status, created_at: now, updated_at: now,
    });
  }

  it('inserts and finds by id', () => {
    seedPlacement('pl_1');
    expect(places.findById('pl_1')?.annual_salary).toBe(600000);
  });

  it('rejects duplicate (P1#4 UNIQUE constraint)', () => {
    seedPlacement('pl_1');
    expect(() => seedPlacement('pl_2')).toThrow();
  });

  it('updates status (pending_payment → paid)', () => {
    seedPlacement('pl_1', 'pending_payment');
    places.updateStatus('pl_1', 'paid');
    expect(places.findById('pl_1')?.status).toBe('paid');
  });

  it('lists by employer via job', () => {
    seedPlacement('pl_1');
    const now = '2026-06-17T00:00:00Z';
    places.insert({
      id: 'pl_2', job_id: 'j2', candidate_user_id: 'c1', primary_headhunter_id: 'h1',
      referrer_headhunter_id: null, anonymized_candidate_id: 'ca_1',
      annual_salary: 700000, platform_fee: 140000, primary_share: 98000, referrer_share: 0, candidate_bonus: 0,
      status: 'pending_payment', created_at: now, updated_at: now,
    });
    const list = places.listByEmployer('e1', {});
    expect(list.length).toBe(2);
  });

  it('lists by primary_headhunter', () => {
    seedPlacement('pl_1', 'pending_payment', 'h1');
    const list = places.listByPrimaryHeadhunter('h1', {});
    expect(list.length).toBe(1);
  });

  it('sums paid amounts per headhunter (for billing)', () => {
    seedPlacement('pl_1', 'paid');
    const now = '2026-06-17T00:00:00Z';
    places.insert({
      id: 'pl_2', job_id: 'j2', candidate_user_id: 'c1', primary_headhunter_id: 'h1',
      referrer_headhunter_id: null, anonymized_candidate_id: 'ca_1',
      annual_salary: 700000, platform_fee: 140000, primary_share: 98000, referrer_share: 0, candidate_bonus: 0,
      status: 'pending_payment', created_at: now, updated_at: now,
    });
    const total = places.sumPaidByHeadhunter('h1');
    expect(total).toBe(84000);
  });
});