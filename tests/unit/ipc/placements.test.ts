import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('admin:placements', () => {
  const testDb = path.join(__dirname, '../../../tmp/place-ipc.db');
  let db: any, ipc: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { openDb } = await import('../../../src/main/db/connection');
    const { runMigrations } = await import('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    const { createPlacementsIpc } = await import('../../../src/main/ipc/placements');
    const { createPlacementsRepo } = await import('../../../src/main/db/repositories/placements');
    const { createAdminActionLogRepo } = await import('../../../src/main/db/repositories/admin-action-log');
    const { createUsersRepo } = await import('../../../src/main/db/repositories/users');
    ipc = createPlacementsIpc(db);
    const places = createPlacementsRepo(db);
    const adminLog = createAdminActionLogRepo(db);
    const users = createUsersRepo(db);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'c1', user_type: 'candidate', name: 'C', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'h1', user_type: 'headhunter', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h3', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    db.exec("INSERT INTO candidates_private (id, headhunter_id, candidate_user_id, name_enc, phone_enc, email_enc, current_company_raw, current_title_raw, expected_salary, years_experience, education_school, resume_url, skills_json, raw_payload_json, created_at, updated_at) VALUES ('cp_1', 'h1', 'c1', 'n', 'p', 'e', null, null, null, null, null, null, null, null, '2026-06-17T00:00:00Z', '2026-06-17T00:00:00Z')");
    db.exec("INSERT INTO candidates_anonymized (id, source_private_id, source_headhunter_id, industry, title_level, years_experience, salary_range, education_tier, skills_json, is_public_pool, unlock_status, created_at, updated_at) VALUES ('ca_1', 'cp_1', 'h1', '互联网', 'P6', 8, '60-80万', '985', '[]', 0, 'unlocked', '2026-06-17T00:00:00Z', '2026-06-17T00:00:00Z')");
    db.exec("INSERT INTO jobs (id, employer_id, title, description, requirements, salary_min, salary_max, status, priority, deadline, industry, created_at, updated_at) VALUES ('j1', 'e1', 'A', null, null, null, null, 'open', 'normal', null, '互联网', '2026-06-17T00:00:00Z', '2026-06-17T00:00:00Z')");
    places.insert({ id: 'p1', job_id: 'j1', candidate_user_id: 'c1', primary_headhunter_id: 'h1', referrer_headhunter_id: null, anonymized_candidate_id: 'ca_1', annual_salary: 600000, platform_fee: 120000, primary_share: 120000, referrer_share: 0, candidate_bonus: 0, status: 'pending_payment', created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('list returns placements', () => {
    const list = ipc.list({});
    expect(list.length).toBe(1);
  });

  it('markPaid updates status and logs admin action', async () => {
    const result = ipc.markPaid('admin', 'p1');
    expect(result.status).toBe('paid');
    const { createAdminActionLogRepo } = await import('../../../src/main/db/repositories/admin-action-log');
    const log = createAdminActionLogRepo(db);
    const entries = log.listByTarget('placement', 'p1', {});
    expect(entries.length).toBe(1);
    expect((entries[0] as any).action).toBe('mark_paid');
  });
});