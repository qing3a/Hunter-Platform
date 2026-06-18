import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('POST /v1/auth/register — field naming convention', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });

  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('returns data.id (not data.user_id) for self-ID convention', async () => {
    const app = createApp();
    const res = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'Convention Test', contact: 'conv@c.com' });

    expect(res.status).toBe(200);
    expect(res.body.data.id).toMatch(/^user_/);
    expect(res.body.data.user_id).toBeUndefined();
  });

  it('data.id matches the id returned by GET /v1/users/{id}/status', async () => {
    const app = createApp();
    const reg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'Conv Test', contact: 'ct@c.com' });
    const { id, api_key } = reg.body.data;

    const status = await request(app).get(`/v1/users/${id}/status`)
      .set('Authorization', `Bearer ${api_key}`);

    expect(status.body.data.id).toBe(id);
  });
});
