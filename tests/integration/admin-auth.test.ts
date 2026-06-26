import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('admin auth endpoints', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-auth-test.db');
  let app: any;
  let db: any;
  let adminEmail: string;
  let adminPassword: string;
  let adminApiKey: string;
  let suspendedEmail: string;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    try { fs.unlinkSync(testDb + '-wal'); } catch {}
    try { fs.unlinkSync(testDb + '-shm'); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = 'DEPRECATED'; // 故意设，确保代码不读
    process.env.SEED_ADMIN_PASSWORD = '';  // 测试不走 seed，手动 seed
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createAppFromDb } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { loadEnv } = await import('../../src/main/env');
    db = openDb(testDb);
    runMigrations(db);
    app = createAppFromDb(db, loadEnv());

    // Seed: 一个 active admin + 一个 suspended admin
    adminEmail = 'active@test.com';
    adminPassword = 'test-admin-pwd-12345';
    const pwdHash = bcrypt.hashSync(adminPassword, 4);  // 加速测试
    const keyHash = bcrypt.hashSync('hp_admin_testkey_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_active', 'Active Admin', adminEmail, pwdHash, keyHash, 'hp_admin_testkey', 'admin', 'active',
      '2026-06-23T00:00:00Z', '2026-06-23T00:00:00Z'
    );
    // Login 拿到真实 api_key（login 会 rotate）
    const loginResp = await request(app).post('/v1/admin/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    adminApiKey = loginResp.body.data.api_key;

    suspendedEmail = 'suspended@test.com';
    const spwdHash = bcrypt.hashSync('suspended-pwd', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_suspended', 'Suspended Admin', suspendedEmail, spwdHash, 'h', 'hp_admin_susp', 'admin', 'suspended',
      '2026-06-23T00:00:00Z', '2026-06-23T00:00:00Z'
    );
  });

  afterAll(() => { if (db) db.close(); });

  describe('seed admin', () => {
    it('10. seed creates admin when table empty + SEED_ADMIN_PASSWORD set', async () => {
      const freshTestDb = path.join(__dirname, '../../tmp/admin-seed-test.db');
      try { fs.unlinkSync(freshTestDb); } catch {}
      try { fs.unlinkSync(freshTestDb + '-wal'); } catch {}
      try { fs.unlinkSync(freshTestDb + '-shm'); } catch {}
      process.env.DATABASE_PATH = freshTestDb;
      process.env.SEED_ADMIN_PASSWORD = 'seed-test-pwd';
      process.env.SEED_ADMIN_EMAIL = 'seed@test.com';
      const { openDb } = await import('../../src/main/db/connection');
      const { runMigrations } = await import('../../src/main/db/migrations');
      const freshDb = openDb(freshTestDb);
      runMigrations(freshDb);
      const { seedAdminIfEmpty } = await import('../../src/main/seed/admin');
      await seedAdminIfEmpty(freshDb);
      const row = freshDb.prepare('SELECT * FROM admin_users WHERE id = ?').get('adm_default_seed') as any;
      expect(row).toBeTruthy();
      expect(row.email).toBe('seed@test.com');
      expect(row.role).toBe('super');
      freshDb.close();
    });
  });

  // ---- login ----
  it('1. POST login wrong email → 401', async () => {
    const r = await request(app).post('/v1/admin/auth/login')
      .send({ email: 'wrong@test.com', password: 'whatever' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });

  it('2. POST login wrong password → 401', async () => {
    const r = await request(app).post('/v1/admin/auth/login')
      .send({ email: adminEmail, password: 'wrong-password' });
    expect(r.status).toBe(401);
  });

  it('3. POST login suspended admin → 403', async () => {
    const r = await request(app).post('/v1/admin/auth/login')
      .send({ email: suspendedEmail, password: 'suspended-pwd' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
  });

  it('4. POST login success → 200 + api_key', async () => {
    // 重新登录（之前 login 已 rotate key 一次）— update adminApiKey so
    // subsequent bearer-auth tests use the fresh key.
    const r = await request(app).post('/v1/admin/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    expect(r.status).toBe(200);
    expect(r.body.data.api_key).toMatch(/^hp_admin_/);
    expect(r.body.data.role).toBe('admin');
    adminApiKey = r.body.data.api_key;
  });

  it('4b. POST login via mounted router (Sub-A bug regression)', async () => {
    // Sub-A bug fix: the auth middleware was using `req.path === '/auth/login'`
    // to skip auth for login, but in dev/prod (app.use('/v1/admin', ...)) the
    // path is stripped to '/auth/login' in newer express, OR stays full in
    // older — using endsWith covers both. This test mounts the app under
    // `/v1/admin` like server.ts does, so it catches the real-world bug.
    const express = (await import('express')).default;
    const { createAdminAuthMiddleware } = await import('../../src/main/modules/admin/auth');
    const { createAdminRouter } = await import('../../src/main/routes/admin');
    const mounted = express();
    mounted.use('/v1/admin', express.json(), createAdminAuthMiddleware(db), createAdminRouter(db, Buffer.alloc(32)));
    const r = await request(mounted).post('/v1/admin/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    expect(r.status).toBe(200);
    expect(r.body.data.api_key).toMatch(/^hp_admin_/);
    // Login rotates the api_key — refresh shared variable so subsequent tests use the new key.
    adminApiKey = r.body.data.api_key;
  });

  // ---- me ----
  it('5. GET /me no bearer → 401', async () => {
    const r = await request(app).get('/v1/admin/me');
    expect(r.status).toBe(401);
  });

  it('6. GET /me wrong bearer → 401', async () => {
    const r = await request(app).get('/v1/admin/me').set('Authorization', 'Bearer hp_admin_wrongkey');
    expect(r.status).toBe(401);
  });

  it('7. GET /me correct bearer → 200 + admin info', async () => {
    const r = await request(app).get('/v1/admin/me').set('Authorization', `Bearer ${adminApiKey}`);
    expect(r.status).toBe(200);
    expect(r.body.data.email).toBe(adminEmail);
    expect(r.body.data.role).toBe('admin');
  });

  // ---- rotate-key ----
  it('8. POST rotate-key no bearer → 401', async () => {
    const r = await request(app).post('/v1/admin/auth/rotate-key');
    expect(r.status).toBe(401);
  });

  it('9. POST rotate-key correct bearer → 200 + new key; old key invalidated', async () => {
    // 先记录旧 key
    const beforeResp = await request(app).get('/v1/admin/me').set('Authorization', `Bearer ${adminApiKey}`);
    expect(beforeResp.status).toBe(200);

    // rotate
    const r = await request(app).post('/v1/admin/auth/rotate-key').set('Authorization', `Bearer ${adminApiKey}`);
    expect(r.status).toBe(200);
    const newKey = r.body.data.api_key;
    expect(newKey).not.toBe(adminApiKey);

    // 旧 key 应该失效
    const oldCheck = await request(app).get('/v1/admin/me').set('Authorization', `Bearer ${adminApiKey}`);
    expect(oldCheck.status).toBe(401);

    // 新 key 应该可用
    const newCheck = await request(app).get('/v1/admin/me').set('Authorization', `Bearer ${newKey}`);
    expect(newCheck.status).toBe(200);
    adminApiKey = newKey; // 更新给后续测试用
  });
});
