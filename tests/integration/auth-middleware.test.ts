import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('auth middleware', () => {
  const testDb = path.join(__dirname, '../../tmp/auth.db');

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const db = openDb(testDb);
    runMigrations(db);
    const { createUsersRepo } = await import('../../src/main/db/repositories/users');
    (globalThis as any).__authTestDb = db;
    (globalThis as any).__authTestUsers = createUsersRepo(db);
  });
  afterEach(() => {
    const db = (globalThis as any).__authTestDb;
    db.close();
    try { fs.unlinkSync(testDb); } catch {}
  });

  function seedUser(id: string, hash: string, prefix: string) {
    const users = (globalThis as any).__authTestUsers;
    users.insert({
      id, user_type: 'hr', name: id, contact: null, agent_endpoint: null,
      api_key_hash: hash, api_key_prefix: prefix, quota_per_day: 100, quota_used: 0,
      quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active',
      created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z',
    });
  }

  it('authenticates valid key and resolves user', async () => {
    const { generateApiKey } = await import('../../src/main/modules/auth/api-key');
    const { key, hash, prefix } = generateApiKey();
    seedUser('u1', hash, prefix);
    const { authMiddleware } = await import('../../src/main/modules/auth/middleware');
    const db = (globalThis as any).__authTestDb;
    const users = (globalThis as any).__authTestUsers;
    const mw = authMiddleware(db, users);
    const req: any = { headers: { authorization: `Bearer ${key}` } };
    let resolvedUser: any = null;
    await new Promise<void>((resolve, reject) => {
      mw(req, {} as any, (err?: any) => err ? reject(err) : resolve());
    }).then(() => { resolvedUser = req.user; });
    expect(resolvedUser?.id).toBe('u1');
  });

  it('rejects missing authorization header', async () => {
    const { authMiddleware } = await import('../../src/main/modules/auth/middleware');
    const db = (globalThis as any).__authTestDb;
    const users = (globalThis as any).__authTestUsers;
    const mw = authMiddleware(db, users);
    const req: any = { headers: {} };
    let caught: any;
    await new Promise<void>((resolve) => {
      mw(req, {} as any, (err?: any) => { caught = err; resolve(); });
    });
    expect(caught).toBeDefined();
    expect(caught.code).toBe('UNAUTHORIZED');
  });
});
