import { describe, it, expect, beforeEach } from 'vitest';
import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createAdminAuthMiddleware } from '../../../src/main/modules/admin/auth';
import { ApiError } from '../../../src/main/errors';
import { openDb } from '../../../src/main/db/connection';
import { runMigrations } from '../../../src/main/db/migrations';
import { createAdminUsersRepo } from '../../../src/main/db/repositories/admin-users';
import fs from 'node:fs';
import path from 'node:path';

describe('adminAuthMiddleware (Sub-A: per-admin api_key auth)', () => {
  const ADMIN_PWD = 'super-secret-admin-pwd-1234';
  const ADMIN_EMAIL = 'unit-test-admin@test.com';
  let app: express.Express;
  let db: any;
  const testDb = path.join(__dirname, '../../../tmp/unit-admin-auth-test.db');

  beforeEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(testDb + suffix); } catch { /* ignore */ }
    }
    db = openDb(testDb);
    runMigrations(db);
    const pwdHash = bcrypt.hashSync(ADMIN_PWD, 4);
    const apiKeyPlain = 'hp_admin_unittest_aabbccdd';
    const keyHash = bcrypt.hashSync(apiKeyPlain, 4);
    const repo = createAdminUsersRepo(db);
    repo.insert({
      id: 'adm_unit', name: 'Unit Test Admin', email: ADMIN_EMAIL,
      password_hash: pwdHash, api_key_hash: keyHash,
      // Prefix must match slice(0, 18) of the actual api_key (matches production generateAdminApiKey)
      api_key_prefix: apiKeyPlain.slice(0, 18),
      role: 'admin', status: 'active',
      created_at: '2026-06-23T00:00:00Z', updated_at: '2026-06-23T00:00:00Z',
    });
    // After insert, use the same api_key for "accepts correct password" test
    (global as any).__unitApiKey = apiKeyPlain;
    app = express();
    app.get('/protected',
      createAdminAuthMiddleware(db),
      (_req, res) => res.json({ ok: true }),
    );
    // Match server.ts error handler so ApiError → JSON response
    const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
      if (err instanceof ApiError) {
        res.status(err.statusCode).json({
          ok: false,
          error: { code: err.code, message: err.message, details: err.details },
        });
        return;
      }
      res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    };
    app.use(errorHandler);
  });

  afterEach(() => {
    if (db) db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(testDb + suffix); } catch { /* ignore */ }
    }
  });

  it('rejects request without Authorization header', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects wrong api_key', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer hp_admin_wrongkey`);
    expect(res.status).toBe(401);
  });

  it('rejects non-Bearer scheme', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Basic ${Buffer.from('hp_admin_xxx').toString('base64')}`);
    expect(res.status).toBe(401);
  });

  it('accepts correct api_key', async () => {
    const apiKey = (global as any).__unitApiKey;
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejects malformed bearer (no space)', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'hp_admin_xxx');  // missing "Bearer "
    expect(res.status).toBe(401);
  });
});
