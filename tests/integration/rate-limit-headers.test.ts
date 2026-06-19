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

  it('returns 429 with Retry-After when 1h limit exceeded', async () => {
    const { userId, apiKey } = await registerHeadhunter('RL3');
    // headhunter 1h limit = 750. Pre-fill the 1h bucket row directly to 750 so the
    // next request is denied regardless of real-time request rate (avoids 1s window
    // boundary flakiness from supertest roundtrips).
    const { openDb } = await import('../../src/main/db/connection');
    const db = openDb(testDb);
    try {
      const hourStart = (() => {
        const ms = Date.now();
        const hourMs = 3600 * 1000;
        return new Date(Math.floor(ms / hourMs) * hourMs).toISOString();
      })();
      for (let i = 0; i < 750; i++) {
        db.prepare(`
          INSERT INTO rate_limit_buckets (user_id, window_start, window_seconds, request_count, expires_at)
          VALUES (?, ?, 3600, 1, '2099-01-01T00:00:00.000Z')
          ON CONFLICT (user_id, window_start, window_seconds)
          DO UPDATE SET request_count = request_count + 1
        `).run(userId, hourStart);
      }
    } finally {
      db.close();
    }

    const r = await request(app).get(`/v1/users/${userId}/status`).set('Authorization', `Bearer ${apiKey}`);
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBeDefined();
    expect(r.body.error.code).toBe('RATE_LIMITED');
    expect(r.body.error.details.violated_window).toBe('hour');
  });
});
