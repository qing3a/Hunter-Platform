import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('GET /v1/admin/{entity}/:id (Sub-D4 Plan 1)', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-subd4-test.db');
  let app: any, db: any;
  let adminAuth = '';

  beforeAll(async () => {
    for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(testDb + s); } catch { /* */ }
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
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
    const keyHash = bcrypt.hashSync('hp_admin_subd4_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_subd4', 'SubD4 Admin', 'subd4@test.com', pwdHash, keyHash, 'hp_admin_subd4_a', 'super', 'active',
      '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z'
    );
    const lr = await request(app).post('/v1/admin/auth/login').send({ email: 'subd4@test.com', password: 'admin-pwd' });
    adminAuth = `Bearer ${lr.body.data.api_key}`;

    // Seed minimal data
    db.prepare(`INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
      quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
      VALUES ('u_test_1', 'candidate', 'Test User', 'u@x', 'h_subd4_1', 'hp_test_1', 100, 0,
      datetime('now', '+1 day'), 50, 'active', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run();
  });

  afterAll(() => { if (db) db.close(); });

  it('1. GET /users/u_test_1 returns user', async () => {
    const r = await request(app).get('/v1/admin/users/u_test_1').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.data.id).toBe('u_test_1');
    expect(r.body.data.name).toBe('Test User');
  });

  it('2. GET /users/nonexistent → 404', async () => {
    const r = await request(app).get('/v1/admin/users/nonexistent').set('Authorization', adminAuth);
    expect(r.status).toBe(404);
  });

  it('3. GET /jobs/nonexistent → 404', async () => {
    const r = await request(app).get('/v1/admin/jobs/nonexistent').set('Authorization', adminAuth);
    expect(r.status).toBe(404);
  });

  it('4. GET /candidates/nonexistent → 404', async () => {
    const r = await request(app).get('/v1/admin/candidates/nonexistent').set('Authorization', adminAuth);
    expect(r.status).toBe(404);
  });

  it('5. GET /recommendations/nonexistent → 404', async () => {
    const r = await request(app).get('/v1/admin/recommendations/nonexistent').set('Authorization', adminAuth);
    expect(r.status).toBe(404);
  });

  it('6. invalid id format (special chars) → 400', async () => {
    const r = await request(app).get("/v1/admin/users/u'test").set('Authorization', adminAuth);
    expect(r.status).toBe(400);
  });

  it('7. no auth → 401', async () => {
    const r = await request(app).get('/v1/admin/users/u_test_1');
    expect(r.status).toBe(401);
  });

  it('8. happy path for jobs after seed', async () => {
    db.prepare(`INSERT INTO jobs (id, employer_id, title, status, created_at, updated_at)
      VALUES ('job_test_1', 'u_test_1', 'Test Job', 'open', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run();
    const r = await request(app).get('/v1/admin/jobs/job_test_1').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data.title).toBe('Test Job');
  });
});