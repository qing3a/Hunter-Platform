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
        user_type: 'hr',
        name: '猎头-Bob',
        contact: 'bob@example.com',
        agent_endpoint: 'https://bob.example.com/webhook',
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.id).toMatch(/^user_/);
    expect(res.body.data.api_key).toMatch(/^hp_live_/);
  });

  it('rejects duplicate contact within 24h', async () => {
    const payload = { user_type: 'candidate', name: 'A', contact: 'dup@x.com' };
    const r1 = await request(app).post('/v1/auth/register').send(payload);
    expect(r1.status).toBe(200);
    const r2 = await request(app).post('/v1/auth/register').send(payload);
    expect(r2.status).toBe(409);
    // 修复 #3: same-role 24h 内重复 contact 改用 CONTACT_TAKEN
    expect(r2.body.error.code).toBe('CONTACT_TAKEN');
  });

  it('rejects missing required fields', async () => {
    const res = await request(app).post('/v1/auth/register').send({ user_type: 'hr' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAMS');
  });

  it('rejects non-HTTPS agent_endpoint in production', async () => {
    process.env.NODE_ENV = 'production';
    const { createApp } = await import('../../src/main/server');
    const prodApp = createApp();
    const res = await request(prodApp)
      .post('/v1/auth/register')
      .send({ user_type: 'hr', name: 'A', contact: 'a@x.com', agent_endpoint: 'http://insecure.example.com' });
    expect(res.status).toBe(400);
    process.env.NODE_ENV = 'test';
  });

  // R1.C2 / T5 — every new register auto-grants all 3 roles; the registered
  // role becomes user_type, and available_roles surfaces the full set so the
  // client can render a role-switch UI after login.
  it('returns available_roles with all 3 enum values (R1.C2/T5)', async () => {
    const res = await request(app)
      .post('/v1/auth/register')
      .send({ user_type: 'pm', name: 'Mul-Role', contact: 'multi@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.data.user_type).toBe('pm');
    expect([...res.body.data.available_roles].sort()).toEqual(['candidate', 'hr', 'pm']);
  });
});
