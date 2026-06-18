import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

describe('rate-limit headers (integration)', () => {
  const testDb = path.join(__dirname, '../../tmp/rl-headers.db');
  let app: any;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch { /* ignore */ }
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuv';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../../src/main/server');
    app = createApp();
  });
  afterAll(() => { try { fs.unlinkSync(testDb); } catch { /* ignore */ } });

  /** Register a fresh headhunter and return { userId, apiKey }. Each test uses a unique user
   *  so rate-limit state doesn't bleed between tests. */
  async function registerHeadhunter(name: string): Promise<{ userId: string; apiKey: string }> {
    const reg = await request(app)
      .post('/v1/auth/register')
      .send({ user_type: 'headhunter', name, contact: `${name}@test.com` });
    expect(reg.status).toBe(200);
    return { userId: reg.body.data.id, apiKey: reg.body.data.api_key };
  }

  it('protected endpoint returns RateLimit-* headers on 200', async () => {
    const { userId, apiKey } = await registerHeadhunter('RL1');
    const res = await request(app)
      .get(`/v1/users/${userId}/status`)
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('20, 100, 750');        // headhunter limits
    expect(res.headers['ratelimit-remaining']).toBeDefined();
    expect(res.headers['ratelimit-reset']).toBeDefined();
    expect(res.headers['retry-after']).toBeUndefined();                  // 200, not 429
  });

  it('public endpoint (skill.md) does NOT have rate-limit headers', async () => {
    const res = await request(app).get('/v1/skill.md');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBeUndefined();
  });

  it('RateLimit-Remaining decrements across successive requests', async () => {
    const { userId, apiKey } = await registerHeadhunter('RL2');
    const r1 = await request(app).get(`/v1/users/${userId}/status`).set('Authorization', `Bearer ${apiKey}`);
    const r2 = await request(app).get(`/v1/users/${userId}/status`).set('Authorization', `Bearer ${apiKey}`);
    const r1Rem = Number(r1.headers['ratelimit-remaining'].split(',')[0]);
    const r2Rem = Number(r2.headers['ratelimit-remaining'].split(',')[0]);
    expect(r2Rem).toBe(r1Rem - 1);   // 1s window: each request consumes 1
  });

  it('returns 429 with Retry-After when 1s limit exceeded', async () => {
    const { userId, apiKey } = await registerHeadhunter('RL3');
    // headhunter 1s limit = 20 → fire 20 requests then expect 21st to be 429
    for (let i = 0; i < 20; i++) {
      await request(app).get(`/v1/users/${userId}/status`).set('Authorization', `Bearer ${apiKey}`);
    }
    const r = await request(app).get(`/v1/users/${userId}/status`).set('Authorization', `Bearer ${apiKey}`);
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBeDefined();
    expect(r.body.error.code).toBe('RATE_LIMITED');
    expect(r.body.error.details.violated_window).toBe('second');
  });
});
