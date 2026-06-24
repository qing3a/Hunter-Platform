import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('admin endpoints integration', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-test.db');
  let app: any;
  let db: any;
  const ADMIN_PWD = 'admin-test-pwd-12345';
  const ADMIN_EMAIL = 'admin@default.com';
  let adminAuth = ''; // assigned after login in beforeAll

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    try { fs.unlinkSync(testDb + '-wal'); } catch {}
    try { fs.unlinkSync(testDb + '-shm'); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = 'DEPRECATED'; // 故意设，确保代码不读
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createAppFromDb } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { loadEnv } = await import('../../src/main/env');
    db = openDb(testDb);
    runMigrations(db);
    app = createAppFromDb(db, loadEnv());

    // Seed an admin user (Sub-A: per-admin api_key auth replaces shared password)
    const pwdHash = bcrypt.hashSync(ADMIN_PWD, 4);
    const keyHash = bcrypt.hashSync('hp_admin_legacykey_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_default', 'Default Admin', ADMIN_EMAIL, pwdHash, keyHash, 'hp_admin_legacy', 'super', 'active',
      '2026-06-23T00:00:00Z', '2026-06-23T00:00:00Z'
    );
    // Login to obtain the real api_key (login rotates the key)
    const loginResp = await request(app).post('/v1/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PWD });
    adminAuth = `Bearer ${loginResp.body.data.api_key}`;
  });

  afterAll(() => { if (db) db.close(); });

  describe('GET /v1/admin/ping', () => {
    it('returns pong with valid admin bearer', async () => {
      const res = await request(app).get('/v1/admin/ping').set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('admin pong');
    });

    it('401 without bearer (admin/ping now requires auth, was previously public)', async () => {
      const res = await request(app).get('/v1/admin/ping');
      expect(res.status).toBe(401);
    });

    it('401 with wrong password', async () => {
      const res = await request(app).get('/v1/admin/ping').set('Authorization', 'Bearer wrong');
      expect(res.status).toBe(401);
    });
  });

  describe('auth enforcement', () => {
    it('401 without bearer on protected endpoint', async () => {
      const res = await request(app).get('/v1/admin/users');
      expect(res.status).toBe(401);
    });

    it('401 with wrong password', async () => {
      const res = await request(app).get('/v1/admin/users').set('Authorization', 'Bearer wrong');
      expect(res.status).toBe(401);
    });
  });

  describe('users admin', () => {
    let testUserId: string;
    beforeEach(() => {
      const id = 'user_test_admin';
      db.prepare(`
        INSERT OR REPLACE INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
          quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
        VALUES (?, 'candidate', 'Test', 'test@test.com', 'hash', 'prefix', 100, 0,
          datetime('now', '+1 day'), 50, 'active', datetime('now'), datetime('now'))
      `).run(id);
      testUserId = id;
    });

    it('GET /v1/admin/users lists users', async () => {
      const res = await request(app).get('/v1/admin/users').set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.total).toBeGreaterThanOrEqual(0);
    });

    it('POST /v1/admin/users/:id/suspend requires reason', async () => {
      const res = await request(app)
        .post(`/v1/admin/users/${testUserId}/suspend`)
        .set('Authorization', adminAuth)
        .send({});
      expect(res.status).toBe(400);
    });

    it('POST /v1/admin/users/:id/suspend succeeds with reason', async () => {
      const res = await request(app)
        .post(`/v1/admin/users/${testUserId}/suspend`)
        .set('Authorization', adminAuth)
        .send({ reason: 'spam' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('suspended');
    });

    it('POST /v1/admin/users/:id/unsuspend restores to active', async () => {
      await request(app).post(`/v1/admin/users/${testUserId}/suspend`)
        .set('Authorization', adminAuth).send({ reason: 'test' });
      const res = await request(app)
        .post(`/v1/admin/users/${testUserId}/unsuspend`)
        .set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('active');
    });

    it('POST /v1/admin/users/:id/unsuspend on already-active user returns 409 (H1 regression)', async () => {
      // Regression: before C1+H1 fix, unsuspend on active user would 500 with
      // "Invalid state transition: cannot 'unsuspend' from 'active'".
      // After the fix, it returns 409 INVALID_STATE with a friendly message.
      const res = await request(app)
        .post(`/v1/admin/users/${testUserId}/unsuspend`)
        .set('Authorization', adminAuth);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    it('POST /v1/admin/users/:id/suspend on already-suspended user returns 409 (H1 regression)', async () => {
      await request(app).post(`/v1/admin/users/${testUserId}/suspend`)
        .set('Authorization', adminAuth).send({ reason: 'test' });
      const res = await request(app)
        .post(`/v1/admin/users/${testUserId}/suspend`)
        .set('Authorization', adminAuth)
        .send({ reason: 'second try' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    it('suspend writes an admin_action_log row (C1: sideEffect is dispatched)', async () => {
      // Regression for C1: userFlow declares an admin_action_log side effect
      // for the active->suspended transition. Before the C1 fix, the handler
      // ignored result.sideEffect, so no row was written.
      await request(app).post(`/v1/admin/users/${testUserId}/suspend`)
        .set('Authorization', adminAuth).send({ reason: 'audit-test' });

      // Query the admin_action_log table directly
      const { openDb } = await import('../../src/main/db/connection');
      const db = openDb(testDb);
      const row = db.prepare(`
        SELECT * FROM admin_action_log
        WHERE action = 'admin.suspend_user' AND target_id = ?
        ORDER BY id DESC LIMIT 1
      `).get(testUserId) as { id: number; admin_user_id: string; action: string; target_id: string; details_json: string } | undefined;
      db.close();

      expect(row).toBeDefined();
      expect(row!.admin_user_id).toBe('admin');
      expect(row!.action).toBe('admin.suspend_user');
      expect(JSON.parse(row!.details_json).reason).toBe('audit-test');
    });

    it('POST /v1/admin/users/:id/adjust-quota validates range', async () => {
      const res = await request(app)
        .post(`/v1/admin/users/${testUserId}/adjust-quota`)
        .set('Authorization', adminAuth)
        .send({ new_quota: 999999 });
      expect(res.status).toBe(400);
    });

    it('POST /v1/admin/users/:id/adjust-quota accepts valid value', async () => {
      const res = await request(app)
        .post(`/v1/admin/users/${testUserId}/adjust-quota`)
        .set('Authorization', adminAuth)
        .send({ new_quota: 50, reason: 'integration test adjustment' });
      expect(res.status).toBe(200);
      expect(res.body.data.new_quota).toBe(50);
    });
  });

  describe('config admin', () => {
    it('GET /v1/admin/config returns config object', async () => {
      const res = await request(app).get('/v1/admin/config').set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('desensitization');
    });

    it('PUT /v1/admin/config/:key rejects unknown key', async () => {
      const res = await request(app)
        .put('/v1/admin/config/unknown_key')
        .set('Authorization', adminAuth)
        .send({});
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('rate-limit admin', () => {
    it('GET /v1/admin/rate-limit/buckets returns array', async () => {
      const res = await request(app)
        .get('/v1/admin/rate-limit/buckets')
        .set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('webhooks admin', () => {
    it('GET /v1/admin/webhooks/dead-letter returns array', async () => {
      const res = await request(app)
        .get('/v1/admin/webhooks/dead-letter')
        .set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('Sub-D1 regression: admin-log endpoint unchanged', () => {
    it('GET /v1/admin/admin-log still returns array of admin actions', async () => {
      const res = await request(app).get('/v1/admin/admin-log').set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      if (res.body.data.length > 0) {
        const row = res.body.data[0];
        expect(row).toHaveProperty('id');
        expect(row).toHaveProperty('actor');
        expect(row).toHaveProperty('action_type');
        expect(row).toHaveProperty('created_at');
      }
    });
  });
});