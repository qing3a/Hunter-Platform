import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('candidates repositories', () => {
  const testDb = path.join(__dirname, '../../../tmp/cand.db');

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = await import('../../../src/main/db/connection');
    const { runMigrations } = await import('../../../src/main/db/migrations');
    const db = openDb(testDb);
    runMigrations(db);
    const { createUsersRepo } = await import('../../../src/main/db/repositories/users');
    const { createCandidatesPrivateRepo } = await import('../../../src/main/db/repositories/candidates-private');
    const { createCandidatesAnonymizedRepo } = await import('../../../src/main/db/repositories/candidates-anonymized');
    const users = createUsersRepo(db);
    users.insert({
      id: 'h1', user_type: 'hr', name: 'Hunter', contact: null, agent_endpoint: null,
      api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0,
      quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active',
      created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z',
    });
    users.insert({
      id: 'c1', user_type: 'candidate', name: 'Cand', contact: null, agent_endpoint: null,
      api_key_hash: 'c', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0,
      quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active',
      created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z',
    });
    (globalThis as any).__candTestDb = db;
    (globalThis as any).__candTestPriv = createCandidatesPrivateRepo(db);
    (globalThis as any).__candTestAnon = createCandidatesAnonymizedRepo(db);
  });
  afterEach(() => {
    const db = (globalThis as any).__candTestDb;
    db.close();
    try { fs.unlinkSync(testDb); } catch {}
  });

  it('inserts private and anonymized pair', () => {
    const priv = (globalThis as any).__candTestPriv;
    const anon = (globalThis as any).__candTestAnon;
    priv.insert({
      id: 'cp_1', headhunter_id: 'h1', candidate_user_id: 'c1',
      name_enc: 'n', phone_enc: 'p', email_enc: 'e',
      current_company_raw: '字节跳动', current_title_raw: '高级前端',
      expected_salary: 750000, years_experience: 8, education_school: '清华大学',
      resume_url: null, skills_json: '["React"]', raw_payload_json: null,
      created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z',
    });
    const p = priv.findById('cp_1');
    expect(p?.current_company_raw).toBe('字节跳动');

    anon.insert({
      id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'h1',
      industry: '互联网', title_level: 'P6', years_experience: 8,
      salary_range: '60-80万', education_tier: '985', skills_json: '["React"]',
      is_public_pool: 0, unlock_status: 'locked',
      created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z',
    });
    const a = anon.findById('ca_1');
    expect(a?.industry).toBe('互联网');
  });
});
