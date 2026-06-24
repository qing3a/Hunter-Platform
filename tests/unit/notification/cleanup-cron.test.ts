import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('notification cleanup cron', () => {
  const testDb = path.join(__dirname, '../../../tmp/notif_cron.db');
  let localDb: any;
  let repo: any;
  const NOW = '2026-06-24T10:00:00.000Z';

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    try { fs.unlinkSync(testDb + '-wal'); } catch {}
    try { fs.unlinkSync(testDb + '-shm'); } catch {}
    const { openDb } = await import('../../../src/main/db/connection');
    const { runMigrations } = await import('../../../src/main/db/migrations');
    const { createNotificationsRepo } = await import('../../../src/main/db/repositories/notifications');
    const { createUsersRepo } = await import('../../../src/main/db/repositories/users');
    localDb = openDb(testDb);
    runMigrations(localDb);
    repo = createNotificationsRepo(localDb);
    const users = createUsersRepo(localDb);
    users.insert({ id: 'u1', user_type: 'headhunter', name: 'u1', contact: null, agent_endpoint: null, api_key_hash: 'h_cron', api_key_prefix: 'p_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-25T00:00:00.000Z', reputation: 50, status: 'active', created_at: NOW, updated_at: NOW });
  });
  afterEach(() => {
    try { if (localDb) localDb.close(); } catch {}
    try { fs.unlinkSync(testDb); } catch {}
    try { fs.unlinkSync(testDb + '-wal'); } catch {}
    try { fs.unlinkSync(testDb + '-shm'); } catch {}
  });

  it('deletes rows where expires_at < now', () => {
    repo.insert({ user_id: 'u1', category: 'a', title: 'expired', created_at: '2026-05-01T00:00:00.000Z', expires_at: '2026-05-31T00:00:00.000Z' });
    const deleted = repo.deleteExpired(NOW);
    expect(deleted).toBe(1);
  });

  it('keeps rows where expires_at > now', () => {
    repo.insert({ user_id: 'u1', category: 'a', title: 'alive', created_at: NOW, expires_at: '2026-07-24T00:00:00.000Z' });
    const deleted = repo.deleteExpired(NOW);
    expect(deleted).toBe(0);
  });
});
