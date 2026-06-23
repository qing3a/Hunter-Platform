import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('admin /v1/admin/action-history', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-ah-test.db');
  let app: any;
  let db: any;
  const ADMIN_PWD = 'admin-test-pwd-12345';
  const ADMIN_EMAIL = 'admin@ah-test.com';
  let adminAuth = ''; // assigned after login in beforeAll

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    try { fs.unlinkSync(testDb + '-wal'); } catch {}
    try { fs.unlinkSync(testDb + '-shm'); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = 'DEPRECATED'; // legacy — code no longer reads it
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createAppFromDb } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { loadEnv } = await import('../../src/main/env');
    db = openDb(testDb);
    runMigrations(db);
    app = createAppFromDb(db, loadEnv());

    // Seed: admin user (Sub-A per-admin api_key auth replaces shared password)
    const pwdHash = bcrypt.hashSync(ADMIN_PWD, 4);
    const keyHash = bcrypt.hashSync('hp_admin_ahtest_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_ah', 'AH Admin', ADMIN_EMAIL, pwdHash, keyHash, 'hp_admin_ahtest', 'super', 'active',
      '2026-06-17T00:00:00Z', '2026-06-17T00:00:00Z'
    );
    // Login to obtain the real api_key (login rotates it)
    const loginResp = await request(app).post('/v1/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PWD });
    adminAuth = `Bearer ${loginResp.body.data.api_key}`;

    // Seed: 2 users + 3 action_history rows
    db.prepare(`
      INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
        quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
      VALUES ('u_alice', 'employer', 'Alice', 'a@x', 'h', 'hp_live_',
        100, 0, datetime('now', '+1 day'), 50, 'active', '2026-06-17T00:00:00Z', '2026-06-17T00:00:00Z')
    `).run();
    db.prepare(`
      INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
        quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
      VALUES ('u_bob', 'headhunter', 'Bob', 'b@x', 'h2', 'hp_live_',
        200, 0, datetime('now', '+1 day'), 50, 'active', '2026-06-17T00:00:00Z', '2026-06-17T00:00:00Z')
    `).run();
    db.prepare(`INSERT INTO action_history (user_id, capability_name, target_type, target_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('u_alice', 'employer.create_job', 'job', 'j1', 'success', '2026-06-17T00:00:01Z');
    db.prepare(`INSERT INTO action_history (user_id, capability_name, target_type, target_id, status, error_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run('u_alice', 'employer.express_interest', 'recommendation', 'r1', 'error', 'RATE_LIMITED', '2026-06-17T00:00:02Z');
    db.prepare(`INSERT INTO action_history (user_id, capability_name, target_type, target_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('u_bob', 'headhunter.recommend_candidate', 'recommendation', 'r2', 'success', '2026-06-17T00:00:03Z');
  });

  afterAll(() => { if (db) db.close(); });

  // ---- 401 auth tests ----
  it('401 without bearer', async () => {
    const res = await request(app).get('/v1/admin/action-history');
    expect(res.status).toBe(401);
  });

  it('401 with wrong password', async () => {
    const res = await request(app).get('/v1/admin/action-history').set('Authorization', 'Bearer wrong');
    expect(res.status).toBe(401);
  });

  // ---- 200 happy path tests ----
  it('200 with no filter returns all 3 rows + correct pagination', async () => {
    const res = await request(app).get('/v1/admin/action-history').set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.pagination).toEqual({ total: 3, limit: 100, offset: 0, has_more: false });
    // newest first
    expect(res.body.data[0].capability_name).toBe('headhunter.recommend_candidate');
  });

  it('200 filters by user_id', async () => {
    const res = await request(app).get('/v1/admin/action-history?user_id=u_alice').set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((r: any) => r.user_id === 'u_alice')).toBe(true);
    expect(res.body.pagination.total).toBe(2);
  });

  it('200 filters by capability_name', async () => {
    const res = await request(app).get('/v1/admin/action-history?capability_name=employer.express_interest').set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].capability_name).toBe('employer.express_interest');
  });

  it('200 filters by status=error', async () => {
    const res = await request(app).get('/v1/admin/action-history?status=error').set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].error_code).toBe('RATE_LIMITED');
  });

  it('200 filters by since/until time range', async () => {
    const res = await request(app).get('/v1/admin/action-history?since=2026-06-17T00:00:02Z&until=2026-06-17T00:00:02Z').set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].capability_name).toBe('employer.express_interest');
  });

  it('200 pagination limit/offset + has_more', async () => {
    const page1 = await request(app).get('/v1/admin/action-history?limit=2&offset=0').set('Authorization', adminAuth);
    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.pagination.has_more).toBe(true);
    expect(page1.body.pagination.total).toBe(3);

    const page2 = await request(app).get('/v1/admin/action-history?limit=2&offset=2').set('Authorization', adminAuth);
    expect(page2.status).toBe(200);
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.pagination.has_more).toBe(false);
  });

  // ---- 400 invalid params ----
  it('400 when status is not success or error', async () => {
    const res = await request(app).get('/v1/admin/action-history?status=foo').set('Authorization', adminAuth);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAMS');
  });

  it('400 when limit is out of range (2000 > 1000)', async () => {
    const res = await request(app).get('/v1/admin/action-history?limit=2000').set('Authorization', adminAuth);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAMS');
  });
});
