// tests/integration/role-gate-routers.test.ts
// R1.C2 / T10 — verify roleGate is applied to /v1/employer, /v1/headhunter,
// /v1/candidate. Each router accepts only its role's active_role; others
// get 403. This is the layered first-line defense (handler modules'
// assertX(user) remains the source of truth).
//
// Uses createAppFromDb (the full app) rather than createTestApp (which
// only mounts candidate-portal) so the three role-restricted routers are
// actually present.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('T10 roleGate on /v1/employer, /v1/headhunter, /v1/candidate', () => {
  const testDb = path.join(__dirname, '../../tmp/role-gate-routers-test.db');
  let app: any;
  let db: any;
  let pmKey: string;
  let hrKey: string;
  let candidateKey: string;

  beforeAll(async () => {
    [testDb, testDb + '-wal', testDb + '-shm'].forEach((f) => { try { fs.unlinkSync(f); } catch {} });
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuv';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createAppFromDb } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { loadEnv } = await import('../../src/main/env');
    db = openDb(testDb);
    runMigrations(db);
    app = createAppFromDb(db, loadEnv());

    // Seed three users — one per role. Real bcrypt hash for api_key_hash so
    // authMiddleware can verify. user_type drives the apikey path's role.
    const now = new Date().toISOString();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    function seed(id: string, type: 'pm' | 'hr' | 'candidate', apiKey: string) {
      const hash = bcrypt.hashSync(apiKey, 4);
      const prefix = apiKey.slice(0, 12);
      db.prepare(`
        INSERT INTO users (id, user_type, name, contact, agent_endpoint,
          api_key_hash, api_key_prefix, api_key_expires_at,
          prev_api_key_hash, prev_api_key_prefix, prev_api_key_expires_at,
          quota_per_day, quota_used, quota_reset_at, reputation, status,
          created_at, updated_at)
        VALUES (?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, NULL, NULL,
                100, 0, ?, 50, 'active', ?, ?)
      `).run(id, type, id, hash, prefix, tomorrow, now, now);
    }
    seed('u_pm', 'pm', 'hp_live_pm_aaaaa');
    seed('u_hr', 'hr', 'hp_live_hr_aaaaa');
    seed('u_cand', 'candidate', 'hp_live_cand_aaaa');
    pmKey = 'hp_live_pm_aaaaa';
    hrKey = 'hp_live_hr_aaaaa';
    candidateKey = 'hp_live_cand_aaaa';
  });

  afterAll(() => {
    try { db.close(); } catch {}
    [testDb, testDb + '-wal', testDb + '-shm'].forEach((f) => { try { fs.unlinkSync(f); } catch {} });
  });

  // Apikey auth path: active_role = user's user_type (single, no session).
  // roleGate checks `req.user.active_role ?? req.user.user_type` — for the
  // apikey path it's user.user_type.
  //
  // /v1/employer/jobs requires 'pm'; hr/candidate must 403.

  it('pm user can access /v1/employer routes', async () => {
    const r = await request(app).get('/v1/employer/jobs').set('Authorization', `Bearer ${pmKey}`);
    expect(r.status).not.toBe(403);
  });

  it('hr user gets 403 on /v1/employer routes (roleGate blocks)', async () => {
    const r = await request(app).get('/v1/employer/jobs').set('Authorization', `Bearer ${hrKey}`);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
  });

  it('candidate user gets 403 on /v1/employer routes', async () => {
    const r = await request(app).get('/v1/employer/jobs').set('Authorization', `Bearer ${candidateKey}`);
    expect(r.status).toBe(403);
  });

  it('hr user can access /v1/headhunter routes', async () => {
    const r = await request(app).get('/v1/headhunter/candidates').set('Authorization', `Bearer ${hrKey}`);
    expect(r.status).not.toBe(403);
  });

  it('pm user gets 403 on /v1/headhunter routes', async () => {
    const r = await request(app).get('/v1/headhunter/candidates').set('Authorization', `Bearer ${pmKey}`);
    expect(r.status).toBe(403);
  });

  it('candidate user can access /v1/candidate routes', async () => {
    const r = await request(app).get('/v1/candidate/candidates/me').set('Authorization', `Bearer ${candidateKey}`);
    expect(r.status).not.toBe(403);
  });

  it('pm user gets 403 on /v1/candidate routes', async () => {
    const r = await request(app).get('/v1/candidate/candidates/me').set('Authorization', `Bearer ${pmKey}`);
    expect(r.status).toBe(403);
  });
});
