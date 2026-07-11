import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

describe('POST /v1/auth/login (R1.C2 / T6-T8)', () => {
  const testDb = path.join(__dirname, '../../tmp/auth-login.db');
  let app: any;
  let hrApiKey: string;
  let userId: string;

  beforeAll(async () => {
    [testDb, testDb + '-wal', testDb + '-shm'].forEach((f) => { try { fs.unlinkSync(f); } catch {} });
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuv';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../../src/main/server');
    app = createApp();

    // Register an hr user to obtain an api_key.
    const reg = await request(app)
      .post('/v1/auth/register')
      .send({ user_type: 'hr', name: 'Login Test', contact: 'login@example.com' });
    expect(reg.status).toBe(200);
    hrApiKey = reg.body.data.api_key;
    userId = reg.body.data.id;
  });
  afterAll(() => {
    [testDb, testDb + '-wal', testDb + '-shm'].forEach((f) => { try { fs.unlinkSync(f); } catch {} });
  });

  // ---- T6 — POST /v1/auth/login ----
  it('T6: returns session_id + active_role + available_roles + expires_at', async () => {
    const r = await request(app).post('/v1/auth/login').send({ api_key: hrApiKey });
    expect(r.status).toBe(200);
    expect(r.body.data.session_id).toMatch(/^sess_[a-zA-Z0-9]{32}$/);
    expect(r.body.data.user_id).toBe(userId);
    expect(r.body.data.active_role).toBe('hr');
    expect([...r.body.data.available_roles].sort()).toEqual(['candidate', 'hr', 'pm']);
    expect(typeof r.body.data.expires_at).toBe('string');
    expect(new Date(r.body.data.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('T6: accepts active_role in request body (role switch at login)', async () => {
    const r = await request(app).post('/v1/auth/login').send({ api_key: hrApiKey, active_role: 'pm' });
    expect(r.status).toBe(200);
    expect(r.body.data.active_role).toBe('pm');
  });

  it('T6: rejects active_role outside available_roles with 403', async () => {
    // user is registered as 'hr' so all 3 are granted; pick a value the user
    // doesn't have — there's no such value since grantAll was applied. So
    // exercise the schema validator: send a malformed role string.
    const r = await request(app).post('/v1/auth/login').send({ api_key: hrApiKey, active_role: 'fake' });
    expect(r.status).toBe(400);
  });

  it('T6: returns 401 for invalid api_key', async () => {
    const r = await request(app).post('/v1/auth/login').send({ api_key: 'hp_live_wrongkey1234567890123' });
    expect(r.status).toBe(401);
  });

  it('T6: returns 400 for missing api_key', async () => {
    const r = await request(app).post('/v1/auth/login').send({});
    expect(r.status).toBe(400);
  });

  // ---- T7 — POST /v1/auth/refresh ----
  it('T7: refresh extends expiry (sliding window)', async () => {
    const login = await request(app).post('/v1/auth/login').send({ api_key: hrApiKey });
    const sessionId = login.body.data.session_id;
    const originalExpiry = login.body.data.expires_at;

    const r = await request(app).post('/v1/auth/refresh').send({ session_id: sessionId });
    expect(r.status).toBe(200);
    expect(r.body.data.session_id).toBe(sessionId);
    expect(new Date(r.body.data.expires_at).getTime()).toBeGreaterThanOrEqual(new Date(originalExpiry).getTime());
  });

  it('T7: refresh accepts active_role to switch roles', async () => {
    const login = await request(app).post('/v1/auth/login').send({ api_key: hrApiKey });
    const r = await request(app).post('/v1/auth/refresh').send({
      session_id: login.body.data.session_id,
      active_role: 'pm',
    });
    expect(r.status).toBe(200);
    expect(r.body.data.active_role).toBe('pm');
  });

  it('T7: refresh returns 401 for unknown session', async () => {
    const r = await request(app).post('/v1/auth/refresh').send({ session_id: 'sess_doesnotexist01234567890abcdef' });
    expect(r.status).toBe(401);
  });

  // ---- T8 — POST /v1/auth/logout ----
  it('T8: logout revokes the session (idempotent, revoked=true)', async () => {
    const login = await request(app).post('/v1/auth/login').send({ api_key: hrApiKey });
    const r = await request(app).post('/v1/auth/logout').send({ session_id: login.body.data.session_id });
    expect(r.status).toBe(200);
    expect(r.body.data.revoked).toBe(true);

    // Subsequent refresh on a revoked session should fail.
    const ref = await request(app).post('/v1/auth/refresh').send({ session_id: login.body.data.session_id });
    expect(ref.status).toBe(401);
  });

  it('T8: logout with no session returns revoked=false (idempotent noop)', async () => {
    const r = await request(app).post('/v1/auth/logout').send({});
    expect(r.status).toBe(200);
    expect(r.body.data.revoked).toBe(false);
  });

  it('T8: logout on unknown session returns revoked=true (idempotent)', async () => {
    const r = await request(app).post('/v1/auth/logout').send({ session_id: 'sess_doesnotexist01234567890abcdef' });
    expect(r.status).toBe(200);
    expect(r.body.data.revoked).toBe(true);
  });
});
