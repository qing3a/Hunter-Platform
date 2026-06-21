// Regression test for Bug 1: rotate-key must invalidate old API key immediately.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

describe('POST /v1/auth/rotate-key', () => {
  const testDb = path.join(__dirname, '../../tmp/rotate-key.db');
  let app: any;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuv';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../../src/main/server');
    app = createApp();
  });
  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} });

  beforeEach(() => {
    // best-effort cleanup between tests
    try { fs.unlinkSync(testDb); } catch {}
    try { fs.unlinkSync(testDb + '-wal'); } catch {}
    try { fs.unlinkSync(testDb + '-shm'); } catch {}
  });

  it('returns a new api_key and immediately invalidates the old one (regression: Bug 1)', async () => {
    // register a headhunter
    const reg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'RotateTester', contact: 'rt@x.com' });
    expect(reg.status).toBe(200);
    const oldKey = reg.body.data.api_key;
    const userId = reg.body.data.id;

    // sanity: old key works
    const before = await request(app).get(`/v1/users/${userId}/status`)
      .set('Authorization', `Bearer ${oldKey}`);
    expect(before.status).toBe(200);

    // rotate
    const rot = await request(app).post('/v1/auth/rotate-key')
      .set('Authorization', `Bearer ${oldKey}`);
    expect(rot.status).toBe(200);
    expect(rot.body.ok).toBe(true);
    expect(rot.body.data.new_api_key).toMatch(/^hp_live_/);
    expect(rot.body.data.new_prefix).toBeDefined();
    // old_key_expires_at is intentionally absent — there is no grace period
    expect(rot.body.data.old_key_expires_at).toBeUndefined();

    const newKey = rot.body.data.new_api_key;

    // old key must be rejected immediately
    const oldAfter = await request(app).get(`/v1/users/${userId}/status`)
      .set('Authorization', `Bearer ${oldKey}`);
    expect(oldAfter.status).toBe(401);
    expect(oldAfter.body.error.code).toBe('UNAUTHORIZED');

    // new key must work
    const newAfter = await request(app).get(`/v1/users/${userId}/status`)
      .set('Authorization', `Bearer ${newKey}`);
    expect(newAfter.status).toBe(200);
  });
});