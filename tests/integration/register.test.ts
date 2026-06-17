import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

describe('POST /v1/auth/register', () => {
  const testDb = path.join(__dirname, '../../tmp/reg.db');
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

  it('registers a new headhunter', async () => {
    const res = await request(app)
      .post('/v1/auth/register')
      .send({
        user_type: 'headhunter',
        name: '猎头-Bob',
        contact: 'bob@example.com',
        agent_endpoint: 'https://bob.example.com/webhook',
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.user_id).toMatch(/^user_/);
    expect(res.body.data.api_key).toMatch(/^hp_live_/);
  });

  it('rejects duplicate contact within 24h', async () => {
    const payload = { user_type: 'candidate', name: 'A', contact: 'dup@x.com' };
    const r1 = await request(app).post('/v1/auth/register').send(payload);
    expect(r1.status).toBe(200);
    const r2 = await request(app).post('/v1/auth/register').send(payload);
    expect(r2.status).toBe(409);
    expect(r2.body.error.code).toBe('DUPLICATE_REQUEST');
  });

  it('rejects missing required fields', async () => {
    const res = await request(app).post('/v1/auth/register').send({ user_type: 'headhunter' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAMS');
  });

  it('rejects non-HTTPS agent_endpoint in production', async () => {
    process.env.NODE_ENV = 'production';
    const { createApp } = await import('../../src/main/server');
    const prodApp = createApp();
    const res = await request(prodApp)
      .post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'A', contact: 'a@x.com', agent_endpoint: 'http://insecure.example.com' });
    expect(res.status).toBe(400);
    process.env.NODE_ENV = 'test';
  });
});
