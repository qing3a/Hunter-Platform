import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('GET /v1/admin/timeline/:type/:id (Sub-D2)', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-subd2-test.db');
  let app: any;
  let db: any;
  let adminAuth = '';

  beforeAll(async () => {
    for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(testDb + s); } catch { /* ignore */ }
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = 'DEPRECATED';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createAppFromDb } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { loadEnv } = await import('../../src/main/env');
    db = openDb(testDb);
    runMigrations(db);
    app = createAppFromDb(db, loadEnv());

    // Seed admin
    const pwdHash = bcrypt.hashSync('admin-pwd', 4);
    const keyHash = bcrypt.hashSync('hp_admin_subd2test_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_subd2', 'SubD2 Admin', 'subd2@test.com', pwdHash, keyHash, 'hp_admin_subd2te', 'super', 'active',
      '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z'
    );
    const lr = await request(app).post('/v1/admin/auth/login')
      .send({ email: 'subd2@test.com', password: 'admin-pwd' });
    adminAuth = `Bearer ${lr.body.data.api_key}`;

    // Seed test users
    db.prepare(`INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
      quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
      VALUES ('u_t1', 'candidate', 'Test User', 'u1@t.com', 'h1', 'hp_u1', 100, 0,
      datetime('now', '+1 day'), 50, 'active', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run();

    // Seed 1 admin_action_log row (target_id=u_t1)
    db.prepare(`INSERT INTO admin_action_log
      (admin_user_id, action, target_type, target_id, details_json, created_at)
      VALUES ('adm_subd2', 'adjust_user_quota', 'user', 'u_t1',
        '{"previous_quota":100,"new_quota":50,"reason":"test"}',
        '2026-06-25T10:00:00Z')`).run();

    // Seed 1 action_history row (user_id=u_t1)
    db.prepare(`INSERT INTO action_history
      (user_id, capability_name, target_type, target_id, status, duration_ms, created_at)
      VALUES ('u_t1', 'candidate.upload_resume', 'candidate', 'c_1', 'success', 100, '2026-06-25T11:00:00Z')`).run();
  });

  afterAll(() => { if (db) db.close(); });

  it('1. type=user — admin + user actions merged, sorted DESC', async () => {
    const r = await request(app).get('/v1/admin/timeline/user/u_t1').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.data).toHaveLength(2);
    expect(r.body.pagination.total).toBe(2);
    // Sorted DESC: action_history (11:00) should be first
    expect(r.body.data[0].source).toBe('user');
    expect(r.body.data[0].action).toBe('candidate.upload_resume');
    expect(r.body.data[1].source).toBe('admin');
    expect(r.body.data[1].action).toBe('adjust_user_quota');
    expect(r.body.data[1].details).toBe('{"previous_quota":100,"new_quota":50,"reason":"test"}');
  });

  it('2. type=candidate — uses anonymized_id lookup', async () => {
    // Seed candidates_private + anonymized row linked to u_t1
    db.prepare(`INSERT INTO candidates_private
      (id, headhunter_id, candidate_user_id, name_enc, phone_enc, email_enc,
       current_company_raw, current_title_raw, expected_salary, years_experience,
       education_school, created_at, updated_at)
      VALUES ('c_p_1', 'u_t1', 'u_t1', 'x', 'x', 'x',
       'X', 'T', 100000, 1, 'S',
       '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run();
    db.prepare(`INSERT INTO candidates_anonymized
      (id, source_private_id, source_headhunter_id, industry, title_level, is_public_pool, unlock_status,
       created_at, updated_at)
      VALUES ('canon_1', 'c_p_1', 'u_t1', 'tech', 'mid', 1, 'locked',
       '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run();

    // Test by passing candidates_private.id (handler subquery uses candidates_private.id = ?)
    const r = await request(app).get('/v1/admin/timeline/candidate/c_p_1').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    // admin_action_log + action_history for u_t1 (candidate_user_id of c_p_1) = 2 rows
    expect(r.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('3. type=job — empty for non-existent job', async () => {
    const r = await request(app).get('/v1/admin/timeline/job/nonexistent_job').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
    expect(r.body.pagination.total).toBe(0);
  });

  it('4. type=recommendation — empty for non-existent rec', async () => {
    const r = await request(app).get('/v1/admin/timeline/recommendation/nonexistent_rec').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });
});

describe('source filter', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-subd2-srctest.db');
  let app: any;
  let db: any;
  let adminAuth = '';

  beforeAll(async () => {
    for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(testDb + s); } catch { /* ignore */ }
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = 'DEPRECATED';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createAppFromDb } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { loadEnv } = await import('../../src/main/env');
    db = openDb(testDb);
    runMigrations(db);
    app = createAppFromDb(db, loadEnv());

    const pwdHash = bcrypt.hashSync('admin-pwd', 4);
    const keyHash = bcrypt.hashSync('hp_admin_subd2src_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_src', 'Src Admin', 'src@test.com', pwdHash, keyHash, 'hp_admin_subd2sr', 'super', 'active',
      '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z'
    );
    const lr = await request(app).post('/v1/admin/auth/login')
      .send({ email: 'src@test.com', password: 'admin-pwd' });
    adminAuth = `Bearer ${lr.body.data.api_key}`;

    db.prepare(`INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
      quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
      VALUES ('u_src', 'candidate', 'Src User', 's@t.com', 'h', 'hp', 100, 0,
      datetime('now', '+1 day'), 50, 'active', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run();
    db.prepare(`INSERT INTO admin_action_log (admin_user_id, action, target_type, target_id, details_json, created_at)
      VALUES ('adm_src', 'adjust_user_quota', 'user', 'u_src', '{}', '2026-06-25T10:00:00Z')`).run();
    db.prepare(`INSERT INTO action_history (user_id, capability_name, status, duration_ms, created_at)
      VALUES ('u_src', 'test.action', 'success', 50, '2026-06-25T11:00:00Z')`).run();
  });

  afterAll(() => { if (db) db.close(); });

  it('5. source=admin — only admin rows', async () => {
    const r = await request(app).get('/v1/admin/timeline/user/u_src?source=admin').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data.every((row: any) => row.source === 'admin')).toBe(true);
    expect(r.body.pagination.total).toBe(1);
  });

  it('6. source=user — only user action_history rows', async () => {
    const r = await request(app).get('/v1/admin/timeline/user/u_src?source=user').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data.every((row: any) => row.source === 'user')).toBe(true);
    expect(r.body.pagination.total).toBe(1);
  });

  it('7. source=invalid → 400', async () => {
    const r = await request(app).get('/v1/admin/timeline/user/u_src?source=foo').set('Authorization', adminAuth);
    expect(r.status).toBe(400);
  });
});

describe('time range + actor filter', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-subd2-timetest.db');
  let app: any;
  let db: any;
  let adminAuth = '';

  beforeAll(async () => {
    for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(testDb + s); } catch { /* ignore */ }
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = 'DEPRECATED';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createAppFromDb } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { loadEnv } = await import('../../src/main/env');
    db = openDb(testDb);
    runMigrations(db);
    app = createAppFromDb(db, loadEnv());

    const pwdHash = bcrypt.hashSync('admin-pwd', 4);
    const keyHash = bcrypt.hashSync('hp_admin_subd2time_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_time', 'Time Admin', 'time@test.com', pwdHash, keyHash, 'hp_admin_subd2ti', 'super', 'active',
      '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z'
    );
    const lr = await request(app).post('/v1/admin/auth/login')
      .send({ email: 'time@test.com', password: 'admin-pwd' });
    adminAuth = `Bearer ${lr.body.data.api_key}`;

    db.prepare(`INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
      quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
      VALUES ('u_t2', 'candidate', 'T2 User', 't@t.com', 'h', 'hp', 100, 0,
      datetime('now', '+1 day'), 50, 'active', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run();
    db.prepare(`INSERT INTO admin_action_log (admin_user_id, action, target_type, target_id, details_json, created_at)
      VALUES ('adm_time', 'adjust_user_quota', 'user', 'u_t2', '{}', '2026-06-25T10:00:00Z')`).run();
    db.prepare(`INSERT INTO action_history (user_id, capability_name, status, duration_ms, created_at)
      VALUES ('u_t2', 'test.action', 'success', 50, '2026-06-25T11:00:00Z')`).run();
  });

  afterAll(() => { if (db) db.close(); });

  it('8. from filter — restrict to events after timestamp', async () => {
    const r = await request(app)
      .get('/v1/admin/timeline/user/u_t2?from=2026-06-25T10:30:00Z')
      .set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    // Only action_history (11:00) qualifies, admin (10:00) is excluded
    expect(r.body.pagination.total).toBe(1);
    expect(r.body.data[0].source).toBe('user');
  });

  it('9. until filter — restrict to events before timestamp', async () => {
    const r = await request(app)
      .get('/v1/admin/timeline/user/u_t2?until=2026-06-25T10:30:00Z')
      .set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.pagination.total).toBe(1);
    expect(r.body.data[0].source).toBe('admin');
  });

  it('10. actor filter — match admin_user_id by LIKE', async () => {
    const r = await request(app)
      .get('/v1/admin/timeline/user/u_t2?actor=adm_time')
      .set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data.every((row: any) => row.actor && row.actor.includes('adm_time'))).toBe(true);
  });

  it('11. from non-ISO → 400 (or 200 with empty result)', async () => {
    const r = await request(app)
      .get('/v1/admin/timeline/user/u_t2?from=not-a-date')
      .set('Authorization', adminAuth);
    expect([200, 400]).toContain(r.status);
  });
});

describe('route validation', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-subd2-vtest.db');
  let app: any;
  let db: any;
  let adminAuth = '';

  beforeAll(async () => {
    for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(testDb + s); } catch { /* ignore */ }
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = 'DEPRECATED';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createAppFromDb } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { loadEnv } = await import('../../src/main/env');
    db = openDb(testDb);
    runMigrations(db);
    app = createAppFromDb(db, loadEnv());

    const pwdHash = bcrypt.hashSync('admin-pwd', 4);
    const keyHash = bcrypt.hashSync('hp_admin_subd2val_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_val', 'Val Admin', 'val@test.com', pwdHash, keyHash, 'hp_admin_subd2va', 'super', 'active',
      '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z'
    );
    const lr = await request(app).post('/v1/admin/auth/login')
      .send({ email: 'val@test.com', password: 'admin-pwd' });
    adminAuth = `Bearer ${lr.body.data.api_key}`;
  });

  afterAll(() => { if (db) db.close(); });

  it('12. invalid type → 400', async () => {
    const r = await request(app).get('/v1/admin/timeline/foo/u_t1').set('Authorization', adminAuth);
    expect(r.status).toBe(400);
  });

  it('13. id with special chars → 400', async () => {
    const r = await request(app).get("/v1/admin/timeline/user/u't1").set('Authorization', adminAuth);
    expect(r.status).toBe(400);
  });

  it('14. pageSize > 200 → 400', async () => {
    const r = await request(app).get('/v1/admin/timeline/user/u_t1?pageSize=500').set('Authorization', adminAuth);
    expect(r.status).toBe(400);
  });

  it('15. no auth → 401', async () => {
    const r = await request(app).get('/v1/admin/timeline/user/u_t1');
    expect(r.status).toBe(401);
  });
});