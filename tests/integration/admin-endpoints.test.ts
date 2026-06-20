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
  const adminAuth = `Bearer ${ADMIN_PWD}`;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    try { fs.unlinkSync(testDb + '-wal'); } catch {}
    try { fs.unlinkSync(testDb + '-shm'); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(ADMIN_PWD, 4);
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createAppFromDb } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { loadEnv } = await import('../../src/main/env');
    db = openDb(testDb);
    runMigrations(db);
    app = createAppFromDb(db, loadEnv());
  });

  afterAll(() => { if (db) db.close(); });

  describe('GET /v1/admin/ping', () => {
    it('returns pong (auth required for everything except /ping)', async () => {
      // Note: per design, /ping has NO auth — it's for ops monitoring
      const res = await request(app).get('/v1/admin/ping');
      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('admin pong');
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
        .send({ new_quota: 50 });
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
});