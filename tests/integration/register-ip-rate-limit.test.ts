import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

const testDb = path.join(__dirname, '../../tmp/reg-rl.db');
let app: any;

describe('POST /v1/auth/register — IP rate limiting', () => {
  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    // 默认开启限流（与 production 一致）
    delete process.env.RATE_LIMIT_ENABLED;
    const { createApp } = await import('../../src/main/server');
    app = createApp();
  });
  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} });
  beforeEach(async () => {
    const { openDb } = await import('../../src/main/db/connection');
    const db = openDb(testDb);
    db.exec("DELETE FROM rate_limit_buckets");
    db.close();
  });

  it('allows first 5 registrations from the same IP', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/v1/auth/register')
        .set('X-Forwarded-For', '10.0.0.1')
        .send({ user_type: 'candidate', name: `n${i}`, contact: `c${i}@x.com` });
      expect(res.status).toBe(200);
    }
  });

  it('6th registration from same IP returns 429', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/v1/auth/register')
        .set('X-Forwarded-For', '10.0.0.2')
        .send({ user_type: 'candidate', name: `n${i}`, contact: `c${i}@x.com` });
    }
    const sixth = await request(app).post('/v1/auth/register')
      .set('X-Forwarded-For', '10.0.0.2')
      .send({ user_type: 'candidate', name: 'overflow', contact: 'over@x.com' });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('RATE_LIMITED');
  });

  it('different IPs are isolated', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/v1/auth/register')
        .set('X-Forwarded-For', '10.0.0.3')
        .send({ user_type: 'candidate', name: `a${i}`, contact: `a${i}@x.com` });
    }
    // Different IP should NOT be blocked
    const other = await request(app).post('/v1/auth/register')
      .set('X-Forwarded-For', '10.0.0.4')
      .send({ user_type: 'candidate', name: 'b', contact: 'b@x.com' });
    expect(other.status).toBe(200);
  });
});