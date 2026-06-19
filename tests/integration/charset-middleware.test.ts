import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

describe('utf8-only middleware (integration)', () => {
  const testDb = path.join(__dirname, '../../tmp/charset-mw.db');
  let app: any;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../../src/main/server');
    app = createApp();
  });
  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} });

  it('accepts register without charset (application/json defaults to UTF-8 per RFC 8259)', async () => {
    const r = await request(app)
      .post('/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send({ user_type: 'candidate', name: 'X', contact: 'x@x.com' });
    expect(r.status).toBe(200);
  });

  it('returns 400 on register with charset=gbk', async () => {
    const r = await request(app)
      .post('/v1/auth/register')
      .set('Content-Type', 'application/json; charset=gbk')
      .send({ user_type: 'candidate', name: 'X', contact: 'x@x.com' });
    expect(r.status).toBe(400);
  });

  it('accepts register with explicit charset=utf-8', async () => {
    const r = await request(app)
      .post('/v1/auth/register')
      .set('Content-Type', 'application/json; charset=utf-8')
      .send({ user_type: 'candidate', name: 'X', contact: 'x@y.com' });
    expect(r.status).toBe(200);
    expect(r.body.data.id).toMatch(/^user_/);
  });

  it('returns 400 on register with non-JSON Content-Type', async () => {
    const r = await request(app)
      .post('/v1/auth/register')
      .set('Content-Type', 'text/plain')
      .send('not json');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_CHARSET');
  });

  it('does not affect GET requests (no Content-Type required)', async () => {
    const r = await request(app).get('/v1/health');
    expect(r.status).toBe(200);
  });
});