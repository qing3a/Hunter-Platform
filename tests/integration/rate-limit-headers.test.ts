// tests/integration/rate-limit-headers.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('GET /v1/users/{id}/status — RateLimit headers (Bug 2)', () => {
  let originalEnv: string | undefined;
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
    originalEnv = process.env.RATE_LIMIT_ENABLED;
  });
  afterEach(() => {
    delete process.env.DATABASE_PATH;
    if (originalEnv === undefined) delete process.env.RATE_LIMIT_ENABLED;
    else process.env.RATE_LIMIT_ENABLED = originalEnv;
  });

  it('emits RateLimit-Limit: -1 (unlimited) when RATE_LIMIT_ENABLED=false', async () => {
    process.env.RATE_LIMIT_ENABLED = 'false';
    const app = createApp();
    const reg = await request(app)
      .post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'T', contact: 't@t.com' });
    const apiKey = reg.body.data.api_key as string;
    const userId = reg.body.data.id as string;

    const res = await request(app)
      .get(`/v1/users/${userId}/status`)
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('-1');
    expect(res.headers['ratelimit-remaining']).toBe('-1');
    expect(res.headers['ratelimit-reset']).toBe('0');
    expect(res.headers['ratelimit-policy']).toBe('unlimited');
  });

  it('emits real (non-unlimited) headers when RATE_LIMIT_ENABLED=true', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true';
    const app = createApp();
    const reg = await request(app)
      .post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'T', contact: 't@t.com' });
    const apiKey = reg.body.data.api_key as string;
    const userId = reg.body.data.id as string;

    const res = await request(app)
      .get(`/v1/users/${userId}/status`)
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).not.toBe('-1');
    expect(res.headers['ratelimit-policy']).toBeUndefined();
  });
});
