import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRequire } from 'node:module';
import bcrypt from 'bcryptjs';

// node:sqlite via createRequire (matches the pattern used by tests/unit/sessions.test.ts
// and tests/unit/user-roles.test.ts — the codebase loads node:sqlite through CJS
// to avoid ESM-only resolution issues with the in-tree test loader).
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

import { authMiddleware, type AuthedUser } from '../../src/main/modules/auth/middleware.js';
import { generateApiKey } from '../../src/main/modules/auth/api-key.js';
import { createUsersRepo } from '../../src/main/db/repositories/users.js';
import { sessionService } from '../../src/main/modules/auth/session.js';

/**
 * Dual-track authMiddleware integration tests (R1.C2 / Task 4)
 *
 * Verifies that `authMiddleware` correctly dispatches on token prefix:
 *   - `sess_…` → session lookup (sessionService.resolve)
 *   - `hp_live_…` → legacy apikey lookup (unchanged behavior)
 *   - anything else → 401
 *
 * Uses an in-memory SQLite DB with the minimal schema required by both
 * paths (users, user_role, session). Migrations are NOT applied — we build
 * the schema by hand to keep the test isolated from the rest of the
 * migration chain (v031 introduces session + user_role; we mimic its shape).
 */
describe('dual-track authMiddleware', () => {
  let db: InstanceType<typeof DatabaseSync>;
  let app: express.Express;

  beforeAll(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE users (
        id              TEXT PRIMARY KEY,
        user_type       TEXT NOT NULL CHECK (user_type IN ('candidate','hr','pm')),
        name            TEXT NOT NULL,
        contact         TEXT,
        agent_endpoint  TEXT,
        api_key_hash    TEXT NOT NULL,
        api_key_prefix  TEXT NOT NULL,
        api_key_expires_at TEXT,
        prev_api_key_hash TEXT,
        prev_api_key_prefix TEXT,
        prev_api_key_expires_at TEXT,
        quota_per_day   INTEGER NOT NULL DEFAULT 100,
        quota_used      INTEGER NOT NULL DEFAULT 0,
        quota_reset_at  TEXT NOT NULL,
        reputation      INTEGER NOT NULL DEFAULT 50,
        status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );
    `);
    db.exec(`
      CREATE TABLE user_role (
        user_id    TEXT NOT NULL,
        role       TEXT NOT NULL CHECK (role IN ('pm','hr','candidate')),
        granted_at TEXT NOT NULL,
        PRIMARY KEY (user_id, role)
      );
    `);
    db.exec(`
      CREATE TABLE session (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL,
        active_role  TEXT NOT NULL CHECK (active_role IN ('pm','hr','candidate')),
        created_at   TEXT NOT NULL,
        expires_at   TEXT NOT NULL,
        last_used_at TEXT NOT NULL,
        revoked_at   TEXT,
        ip_address   TEXT,
        user_agent   TEXT
      );
    `);

    // Insert Alice with all 3 roles + a real apikey (generated via the
    // production helper to keep prefix/hash shape consistent).
    const { key, hash, prefix } = generateApiKey();
    db.prepare(
      `INSERT INTO users (id, user_type, name, contact, agent_endpoint,
                          api_key_hash, api_key_prefix, api_key_expires_at,
                          prev_api_key_hash, prev_api_key_prefix, prev_api_key_expires_at,
                          quota_per_day, quota_used, quota_reset_at, reputation,
                          status, created_at, updated_at)
       VALUES (?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, NULL, NULL, 100, 0, ?, 50, 'active', ?, ?)`,
    ).run('u1', 'pm', 'Alice', hash, prefix, '2026-12-31T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

    db.exec(`INSERT INTO user_role VALUES ('u1','pm','2026-01-01'),('u1','hr','2026-01-01'),('u1','candidate','2026-01-01');`);

    // Stash the plaintext apikey for the apikey-path tests. We do NOT use a
    // second generated key (would collide on the `api_key_prefix` UNIQUE in
    // production but this in-memory schema doesn't enforce uniqueness on
    // prefix, and we want a stable plaintext the test file controls).
    (globalThis as any).__aliceApiKey = key;

    const usersRepo = createUsersRepo(db);
    app = express();
    app.get('/whoami', authMiddleware(db, usersRepo), (req, res) => {
      res.json(req.user as AuthedUser);
    });
  });

  afterAll(() => {
    db.close();
  });

  it('rejects when no Authorization header', async () => {
    const r = await request(app).get('/whoami');
    expect(r.status).toBe(401);
  });

  it('rejects unknown token format', async () => {
    const r = await request(app).get('/whoami').set('Authorization', 'Bearer garbage_xxx');
    expect(r.status).toBe(401);
  });

  it('resolves session token and exposes active_role', async () => {
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    const r = await request(app).get('/whoami').set('Authorization', `Bearer ${s.id}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      id: 'u1',
      name: 'Alice',
      active_role: 'pm',
      auth_method: 'session',
      roles: expect.arrayContaining(['pm', 'hr', 'candidate']),
    });
    expect(r.body.session_id).toBe(s.id);
  });

  it('switches active_role via X-Active-Role header (session)', async () => {
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    const r = await request(app)
      .get('/whoami')
      .set('Authorization', `Bearer ${s.id}`)
      .set('X-Active-Role', 'hr');
    expect(r.status).toBe(200);
    expect(r.body.active_role).toBe('hr');
  });

  it('rejects X-Active-Role not in available_roles', async () => {
    // Revoke hr from u1; then request X-Active-Role: hr → sessionService
    // resolve returns null → middleware returns 401.
    db.prepare(`DELETE FROM user_role WHERE user_id = 'u1' AND role = 'hr'`).run();
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    const r = await request(app)
      .get('/whoami')
      .set('Authorization', `Bearer ${s.id}`)
      .set('X-Active-Role', 'hr');
    expect(r.status).toBe(401);
    // Restore for downstream tests.
    db.prepare(`INSERT INTO user_role VALUES ('u1','hr','2026-01-01')`).run();
  });

  it('resolves apikey token and sets auth_method=apikey', async () => {
    const apiKey = (globalThis as any).__aliceApiKey as string;
    const r = await request(app).get('/whoami').set('Authorization', `Bearer ${apiKey}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      id: 'u1',
      active_role: 'pm',
      auth_method: 'apikey',
    });
    // Apikey path does NOT set session_id.
    expect(r.body.session_id).toBeUndefined();
  });

  it('legacy req.user.user_type still returns remapped value (back-compat)', async () => {
    // For session auth:
    const s = sessionService.create(db, 'u1', 'pm', null, null);
    const r = await request(app).get('/whoami').set('Authorization', `Bearer ${s.id}`);
    expect(r.status).toBe(200);
    // user_type is the remapped value (pm/hr/candidate), never the legacy
    // 'headhunter' or 'employer' strings.
    expect(r.body.user_type).toBe('pm');
    expect(r.body.user_type).not.toBe('headhunter');
    expect(r.body.user_type).not.toBe('employer');
  });

  it('X-Active-Role header is ignored on apikey auth path', async () => {
    // Apikey auth doesn't support role switching; the header is harmless
    // and the active_role is always the user's primary user_type.
    const apiKey = (globalThis as any).__aliceApiKey as string;
    const r = await request(app)
      .get('/whoami')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-Active-Role', 'hr');
    expect(r.status).toBe(200);
    expect(r.body.auth_method).toBe('apikey');
    expect(r.body.active_role).toBe('pm');  // user's primary role, NOT 'hr'
  });
});