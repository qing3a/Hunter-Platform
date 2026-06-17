import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('admin:users', () => {
  const testDb = path.join(__dirname, '../../../tmp/users-ipc.db');
  let db: any, usersIpc: any, users: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { openDb } = await import('../../../src/main/db/connection');
    const { runMigrations } = await import('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    const { createUsersRepo } = await import('../../../src/main/db/repositories/users');
    const { createUsersIpc } = await import('../../../src/main/ipc/users');
    users = createUsersRepo(db);
    usersIpc = createUsersIpc(db);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('list returns all active users', () => {
    const list = usersIpc.list({});
    expect(list.length).toBe(1);
  });

  it('suspend changes status to suspended', () => {
    usersIpc.suspend('e1', 'Test suspend');
    expect(users.findById('e1')?.status).toBe('suspended');
  });

  it('unsuspend restores active', () => {
    db.prepare("UPDATE users SET status = 'suspended' WHERE id = 'e1'").run();
    usersIpc.unsuspend('e1');
    expect(users.findById('e1')?.status).toBe('active');
  });

  it('adjustQuota updates quota_per_day', () => {
    usersIpc.adjustQuota('e1', 500);
    expect(users.findById('e1')?.quota_per_day).toBe(500);
  });
});