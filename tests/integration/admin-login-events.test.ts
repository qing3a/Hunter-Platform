import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { createAdminLoginEventsRepo } from '../../src/main/db/repositories/admin-login-events';

describe('admin login events', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-login-events-test.db');
  let app: any;
  let db: any;
  let loginEventsRepo: ReturnType<typeof createAdminLoginEventsRepo>;
  let adminApiKey = '';
  const ADMIN_PWD = 'login-test-pwd-12345';
  const ADMIN_EMAIL = 'login-test@default.com';

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
    loginEventsRepo = createAdminLoginEventsRepo(db);

    // Seed one active admin
    const pwdHash = bcrypt.hashSync(ADMIN_PWD, 4);
    const keyHash = bcrypt.hashSync('hp_admin_login_test_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_login', 'Login Admin', ADMIN_EMAIL, pwdHash, keyHash, 'hp_admin_login', 'admin', 'active',
      '2026-06-24T00:00:00Z', '2026-06-24T00:00:00Z'
    );

    // Login to obtain a valid api_key for later API tests
    const loginResp = await request(app).post('/v1/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PWD });
    adminApiKey = loginResp.body.data.api_key;
  });

  afterAll(() => { if (db) db.close(); });

  it('records login_event row on successful login', async () => {
    const before = loginEventsRepo.list({}).total;
    const res = await request(app).post('/v1/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PWD });
    expect(res.status).toBe(200);
    const after = loginEventsRepo.list({}).total;
    expect(after).toBe(before + 1);
    const latest = loginEventsRepo.list({}).rows[0];
    expect(latest.email).toBe(ADMIN_EMAIL);
    expect(latest.success).toBe(1);
    expect(latest.admin_user_id).toBe('adm_login');
    expect(latest.failure_reason).toBeNull();
    // Update adminApiKey — login rotates it, so subsequent API tests must use the fresh key
    adminApiKey = res.body.data.api_key;
  });

  it('records login_event on failed login (wrong password)', async () => {
    const before = loginEventsRepo.list({}).total;
    const res = await request(app).post('/v1/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'WRONG-PWD' });
    expect(res.status).toBe(401);
    const after = loginEventsRepo.list({}).total;
    expect(after).toBe(before + 1);
    const latest = loginEventsRepo.list({ success: 0 }).rows[0];
    expect(latest.email).toBe(ADMIN_EMAIL);
    expect(latest.success).toBe(0);
    expect(latest.failure_reason).toBe('invalid_password');
  });

  it('records login_event on unknown email', async () => {
    const before = loginEventsRepo.list({}).total;
    const res = await request(app).post('/v1/admin/auth/login')
      .send({ email: 'unknown@nowhere.com', password: 'anything' });
    expect(res.status).toBe(401);
    const after = loginEventsRepo.list({}).total;
    expect(after).toBe(before + 1);
    const latest = loginEventsRepo.list({}).rows[0];
    expect(latest.email).toBe('unknown@nowhere.com');
    expect(latest.success).toBe(0);
    expect(latest.failure_reason).toBe('unknown_email');
    expect(latest.admin_user_id).toBeNull();
  });

  it('GET /v1/admin/login-events returns all events when no filter', async () => {
    const res = await request(app).get('/v1/admin/login-events')
      .set('Authorization', `Bearer ${adminApiKey}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.total).toBeGreaterThan(0);
  });

  it('GET /v1/admin/login-events?success=0 returns only failed events', async () => {
    const res = await request(app).get('/v1/admin/login-events?success=0')
      .set('Authorization', `Bearer ${adminApiKey}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((e: any) => e.success === 0)).toBe(true);
  });
});