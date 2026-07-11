// R1.C2 / T10 — roleGate middleware end-to-end test.
//
// Validates that the layered defense (authMiddleware → roleGate → handler)
// properly rejects mismatched roles. The actual per-router coverage is
// inherited from the existing handlers via their assertPm/assertEmployer/etc.
// guards; here we exercise roleGate itself with a synthetic /v1/rbac-test
// route registered on a throwaway Express app.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import type { DB } from '../../src/main/db/connection.js';
import { createUsersRepo } from '../../src/main/db/repositories/users.js';
import { userRolesRepo } from '../../src/main/db/repositories/user-roles.js';
import { sessionService } from '../../src/main/modules/auth/session.js';
import { authMiddleware } from '../../src/main/modules/auth/middleware.js';
import { roleGate } from '../../src/main/modules/auth/role-gate.js';
import { generateApiKey } from '../../src/main/modules/auth/api-key.js';

describe('roleGate middleware (R1.C2/T10)', () => {
  const testDb = path.join(__dirname, '../../tmp/rbac-gate.db');
  let db: DB;
  let app: express.Express;
  let pmApiKey: string;
  let hrApiKey: string;
  let pmSession: string;
  let hrSession: string;
  let candidateApiKey: string;

  beforeAll(async () => {
    [testDb, testDb + '-wal', testDb + '-shm'].forEach((f) => { try { fs.unlinkSync(f); } catch {} });
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuv';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);

    const users = createUsersRepo(db);
    const now = new Date().toISOString();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();

    function insertUser(id: string, userType: 'pm' | 'hr' | 'candidate'): { id: string; key: string } {
      const { key, hash, prefix } = generateApiKey();
      users.insert({
        id, user_type: userType, name: id, contact: null, agent_endpoint: null,
        api_key_hash: hash, api_key_prefix: prefix, api_key_expires_at: null,
        prev_api_key_hash: null, prev_api_key_prefix: null, prev_api_key_expires_at: null,
        quota_per_day: 100, quota_used: 0, quota_reset_at: tomorrow,
        reputation: 50, status: 'active',
        created_at: now, updated_at: now,
      });
      userRolesRepo.grantAll(db, id, now);
      return { id, key };
    }

    pmApiKey = insertUser('pm1', 'pm').key;
    hrApiKey = insertUser('hr1', 'hr').key;
    candidateApiKey = insertUser('c1', 'candidate').key;
    pmSession = sessionService.create(db, 'pm1', 'pm', null, null).id;
    hrSession = sessionService.create(db, 'hr1', 'hr', null, null).id;

    app = express();
    app.use(express.json());
    // Throwaway route guarded by roleGate('pm') — emulates a PM-only surface.
    app.get('/v1/rbac/pm-only', authMiddleware(db), roleGate('pm'), (_req, res) => {
      res.json({ ok: true, data: { hello: 'pm' } });
    });
    app.get('/v1/rbac/any-of-two', authMiddleware(db), roleGate('pm', 'hr'), (_req, res) => {
      res.json({ ok: true, data: { hello: 'two' } });
    });
    // Minimal error → envelope formatter (mirrors src/main/responses.ts).
    // Without this, an ApiError thrown by roleGate reaches the default
    // Express handler and the response body is the HTML error page.
    app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const status = err?.statusCode ?? 500;
      const code = err?.code ?? 'INTERNAL_ERROR';
      res.status(status).json({ ok: false, error: { code, message: err?.message ?? 'error' } });
    });
  });
  afterAll(() => { try { db.close(); } catch {} });

  it('apikey pm auth → 200 on pm-only route', async () => {
    const r = await request(app).get('/v1/rbac/pm-only').set('Authorization', `Bearer ${pmApiKey}`);
    expect(r.status).toBe(200);
    expect(r.body.data.hello).toBe('pm');
  });

  it('session pm auth → 200 on pm-only route', async () => {
    const r = await request(app).get('/v1/rbac/pm-only').set('Authorization', `Bearer ${pmSession}`);
    expect(r.status).toBe(200);
  });

  it('apikey hr → 403 on pm-only route', async () => {
    const r = await request(app).get('/v1/rbac/pm-only').set('Authorization', `Bearer ${hrApiKey}`);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
  });

  it('candidate → 403 on pm-only route', async () => {
    const r = await request(app).get('/v1/rbac/pm-only').set('Authorization', `Bearer ${candidateApiKey}`);
    expect(r.status).toBe(403);
  });

  it('session hr → 403 on pm-only route', async () => {
    const r = await request(app).get('/v1/rbac/pm-only').set('Authorization', `Bearer ${hrSession}`);
    expect(r.status).toBe(403);
  });

  it('no auth → 401', async () => {
    const r = await request(app).get('/v1/rbac/pm-only');
    expect(r.status).toBe(401);
  });

  it('multi-role gate (pm | hr) — both succeed, candidate rejected', async () => {
    const pmRes = await request(app).get('/v1/rbac/any-of-two').set('Authorization', `Bearer ${pmApiKey}`);
    const hrRes = await request(app).get('/v1/rbac/any-of-two').set('Authorization', `Bearer ${hrApiKey}`);
    const candRes = await request(app).get('/v1/rbac/any-of-two').set('Authorization', `Bearer ${candidateApiKey}`);
    expect(pmRes.status).toBe(200);
    expect(hrRes.status).toBe(200);
    expect(candRes.status).toBe(403);
  });
});
