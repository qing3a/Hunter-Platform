import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('notification trigger', () => {
  const testDb = path.join(__dirname, '../../../tmp/notif_trigger.db');
  let localDb: any;
  let trigger: any;
  let repo: any;
  let users: any;
  const NOW = '2026-06-24T10:00:00.000Z';

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    try { fs.unlinkSync(testDb + '-wal'); } catch {}
    try { fs.unlinkSync(testDb + '-shm'); } catch {}
    const { openDb } = await import('../../../src/main/db/connection');
    const { runMigrations } = await import('../../../src/main/db/migrations');
    const { createNotificationTrigger } = await import('../../../src/main/modules/notification/trigger');
    const { createNotificationsRepo } = await import('../../../src/main/db/repositories/notifications');
    const { createUsersRepo } = await import('../../../src/main/db/repositories/users');
    localDb = openDb(testDb);
    runMigrations(localDb);
    trigger = createNotificationTrigger(localDb);
    repo = createNotificationsRepo(localDb);
    users = createUsersRepo(localDb);
    users.insert({ id: 'u1', user_type: 'headhunter', name: 'u1', contact: null, agent_endpoint: null, api_key_hash: 'h_u1', api_key_prefix: 'p_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-25T00:00:00.000Z', reputation: 50, status: 'active', created_at: NOW, updated_at: NOW });
  });
  afterEach(() => {
    try { if (localDb) localDb.close(); } catch {}
    try { fs.unlinkSync(testDb); } catch {}
    try { fs.unlinkSync(testDb + '-wal'); } catch {}
    try { fs.unlinkSync(testDb + '-shm'); } catch {}
  });

  it('notify() writes a row', () => {
    trigger.notify({ userId: 'u1', category: 'a', title: 't' });
    expect(repo.listByUser({ user_id: 'u1' }).length).toBe(1);
  });

  it('notify() does not throw when DB is closed mid-call', () => {
    localDb.close();
    expect(() => trigger.notify({ userId: 'u1', category: 'a', title: 't' })).not.toThrow();
  });

  it('notify() logs error on failure', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    localDb.close();
    trigger.notify({ userId: 'u1', category: 'a', title: 't' });
    expect(spy).toHaveBeenCalledWith('[notification trigger] failed', expect.objectContaining({ category: 'a' }));
    spy.mockRestore();
  });

  it('notify() with dedupKey replaces unread row', () => {
    trigger.notify({ userId: 'u1', category: 'a', title: 'first', dedupKey: 'k' });
    trigger.notify({ userId: 'u1', category: 'a', title: 'second', dedupKey: 'k' });
    const rows = repo.listByUser({ user_id: 'u1' });
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe('second');
  });
});
