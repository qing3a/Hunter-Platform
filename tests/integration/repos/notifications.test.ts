import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('notifications repo', () => {
  const testDb = path.join(__dirname, '../../../tmp/notif_repo.db');
  let localDb: any;
  let repo: ReturnType<typeof import('../../../src/main/db/repositories/notifications').createNotificationsRepo>;
  let users: ReturnType<typeof import('../../../src/main/db/repositories/users').createUsersRepo>;
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
    users = createUsersRepo(localDb);
    // fixture: 3 users
    for (const id of ['u1', 'u2', 'u3']) {
      users.insert({
        id, user_type: 'hr', name: id, contact: null, agent_endpoint: null,
        api_key_hash: `hash_${id}`, api_key_prefix: 'p_', quota_per_day: 100, quota_used: 0,
        quota_reset_at: '2026-06-25T00:00:00.000Z', reputation: 50, status: 'active',
        created_at: NOW, updated_at: NOW,
      });
    }
  });
  afterEach(() => {
    if (localDb) localDb.close();
    try { fs.unlinkSync(testDb); } catch {}
    try { fs.unlinkSync(testDb + '-wal'); } catch {}
    try { fs.unlinkSync(testDb + '-shm'); } catch {}
  });

  it('insert + findById returns the row', () => {
    const id = repo.insert({ user_id: 'u1', category: 'recommendation_accepted', title: 't1', created_at: NOW });
    const row = repo.findById(id);
    expect(row).not.toBeNull();
    expect(row!.user_id).toBe('u1');
    expect(row!.category).toBe('recommendation_accepted');
  });

  it('listByUser returns newest first', () => {
    repo.insert({ user_id: 'u1', category: 'a', title: 'older', created_at: '2026-06-24T08:00:00.000Z' });
    repo.insert({ user_id: 'u1', category: 'a', title: 'newer', created_at: '2026-06-24T09:00:00.000Z' });
    const rows = repo.listByUser({ user_id: 'u1' });
    expect(rows.map(r => r.title)).toEqual(['newer', 'older']);
  });

  it('listByUser with unread=true filters out read rows', () => {
    const id1 = repo.insert({ user_id: 'u1', category: 'a', title: 'unread', created_at: NOW });
    const id2 = repo.insert({ user_id: 'u1', category: 'a', title: 'read', created_at: NOW });
    repo.markRead(id2, 'u1', NOW);
    const rows = repo.listByUser({ user_id: 'u1', unread: true });
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(id1);
  });

  it('listByUser with since filters old rows', () => {
    repo.insert({ user_id: 'u1', category: 'a', title: 'old', created_at: '2026-06-24T08:00:00.000Z' });
    repo.insert({ user_id: 'u1', category: 'a', title: 'new', created_at: '2026-06-24T09:30:00.000Z' });
    const rows = repo.listByUser({ user_id: 'u1', since: '2026-06-24T09:00:00.000Z' });
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe('new');
  });

  it('listByUser respects limit and offset', () => {
    for (let i = 0; i < 5; i++) {
      repo.insert({ user_id: 'u1', category: 'a', title: `t${i}`, created_at: `2026-06-24T${10 + i}:00:00.000Z` });
    }
    const page1 = repo.listByUser({ user_id: 'u1', limit: 2, offset: 0 });
    const page2 = repo.listByUser({ user_id: 'u1', limit: 2, offset: 2 });
    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
    expect(page1[0].id).not.toBe(page2[0].id);
  });

  it('listByUser does not return other user rows', () => {
    repo.insert({ user_id: 'u1', category: 'a', title: 'u1', created_at: NOW });
    repo.insert({ user_id: 'u2', category: 'a', title: 'u2', created_at: NOW });
    const rows = repo.listByUser({ user_id: 'u1' });
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe('u1');
  });

  it('upsert with same dedupKey + unread → updates existing, resets created_at', () => {
    const id1 = repo.upsert({ user_id: 'u1', category: 'a', title: 'old', dedup_key: 'k1', created_at: '2026-06-24T08:00:00.000Z' });
    const id2 = repo.upsert({ user_id: 'u1', category: 'a', title: 'new', dedup_key: 'k1', created_at: '2026-06-24T10:00:00.000Z' });
    expect(id1).toBe(id2);  // same row updated
    const row = repo.findById(id1);
    expect(row!.title).toBe('new');
    expect(row!.created_at).toBe('2026-06-24T10:00:00.000Z');
  });

  it('upsert with same dedupKey + read → inserts new row', () => {
    const id1 = repo.upsert({ user_id: 'u1', category: 'a', title: 'first', dedup_key: 'k1', created_at: NOW });
    repo.markRead(id1, 'u1', NOW);
    const id2 = repo.upsert({ user_id: 'u1', category: 'a', title: 'second', dedup_key: 'k1', created_at: NOW });
    expect(id2).not.toBe(id1);  // new row
    const rows = repo.listByUser({ user_id: 'u1' });
    expect(rows.length).toBe(2);
  });

  it('upsert with NULL dedupKey → always inserts (no dedup)', () => {
    const id1 = repo.upsert({ user_id: 'u1', category: 'a', title: 't1', dedup_key: null, created_at: NOW });
    const id2 = repo.upsert({ user_id: 'u1', category: 'a', title: 't2', dedup_key: null, created_at: NOW });
    expect(id2).not.toBe(id1);
    expect(repo.listByUser({ user_id: 'u1' }).length).toBe(2);
  });

  it('markRead is a no-op for other user', () => {
    const id = repo.insert({ user_id: 'u1', category: 'a', title: 't', created_at: NOW });
    const result = repo.markRead(id, 'u2', NOW);
    expect(result).toBe(false);
    expect(repo.findById(id)!.read_at).toBeNull();
  });

  it('delete removes own row, no-op for other user', () => {
    const id = repo.insert({ user_id: 'u1', category: 'a', title: 't', created_at: NOW });
    expect(repo.delete(id, 'u2')).toBe(false);
    expect(repo.delete(id, 'u1')).toBe(true);
    expect(repo.findById(id)).toBeNull();
  });

  it('deleteExpired deletes only past-expiry rows', () => {
    repo.insert({ user_id: 'u1', category: 'a', title: 'expired', created_at: '2026-05-01T00:00:00.000Z', expires_at: '2026-05-31T00:00:00.000Z' });
    repo.insert({ user_id: 'u1', category: 'a', title: 'alive', created_at: NOW, expires_at: '2026-07-24T10:00:00.000Z' });
    const deleted = repo.deleteExpired(NOW);
    expect(deleted).toBe(1);
    expect(repo.listByUser({ user_id: 'u1' }).length).toBe(1);
    expect(repo.listByUser({ user_id: 'u1' })[0].title).toBe('alive');
  });
});
