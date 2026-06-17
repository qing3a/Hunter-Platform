import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('users repository', () => {
  const testDb = path.join(__dirname, '../../../tmp/users.db');

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = await import('../../../src/main/db/connection');
    const { runMigrations } = await import('../../../src/main/db/migrations');
    const db = openDb(testDb);
    runMigrations(db);
    const { createUsersRepo } = await import('../../../src/main/db/repositories/users');
    (globalThis as any).__usersTestDb = db;
    (globalThis as any).__usersTestRepo = createUsersRepo(db);
  });
  afterEach(() => {
    const db = (globalThis as any).__usersTestDb;
    db.close();
    try { fs.unlinkSync(testDb); } catch {}
  });

  it('inserts and finds by id', () => {
    const users = (globalThis as any).__usersTestRepo;
    users.insert({
      id: 'user_1', user_type: 'headhunter', name: 'Bob', contact: 'b@x.com',
      agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_',
      quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z',
      reputation: 50, status: 'active',
      created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z',
    });
    const u = users.findById('user_1');
    expect(u?.name).toBe('Bob');
  });

  it('finds by api key hash', () => {
    const users = (globalThis as any).__usersTestRepo;
    users.insert({
      id: 'user_2', user_type: 'candidate', name: 'A', contact: null,
      agent_endpoint: null, api_key_hash: 'unique-hash-2', api_key_prefix: 'hp_live_',
      quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z',
      reputation: 50, status: 'active',
      created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z',
    });
    const u = users.findByApiKeyHash('unique-hash-2');
    expect(u?.id).toBe('user_2');
  });
});
