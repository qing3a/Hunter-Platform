import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('notification handler', () => {
  const testDb = path.join(__dirname, '../../../tmp/notif_handler.db');
  let localDb: any;
  let handler: any;
  let repo: any;
  let users: any;
  const NOW = '2026-06-24T10:00:00.000Z';

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    try { fs.unlinkSync(testDb + '-wal'); } catch {}
    try { fs.unlinkSync(testDb + '-shm'); } catch {}
    const { openDb } = await import('../../../src/main/db/connection');
    const { runMigrations } = await import('../../../src/main/db/migrations');
    const { createNotificationHandler } = await import('../../../src/main/modules/notification/handler');
    const { createNotificationsRepo } = await import('../../../src/main/db/repositories/notifications');
    const { createUsersRepo } = await import('../../../src/main/db/repositories/users');
    localDb = openDb(testDb);
    runMigrations(localDb);
    handler = createNotificationHandler(localDb);
    repo = createNotificationsRepo(localDb);
    users = createUsersRepo(localDb);
    users.insert({ id: 'u1', user_type: 'hr', name: 'u1', contact: null, agent_endpoint: null, api_key_hash: 'h_u1', api_key_prefix: 'p_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-25T00:00:00.000Z', reputation: 50, status: 'active', created_at: NOW, updated_at: NOW });
  });
  afterEach(() => {
    try { if (localDb) localDb.close(); } catch {}
    try { fs.unlinkSync(testDb); } catch {}
    try { fs.unlinkSync(testDb + '-wal'); } catch {}
    try { fs.unlinkSync(testDb + '-shm'); } catch {}
  });

  it('send() persists a notification with expires_at = created_at + 30 days', () => {
    const id = handler.send({ userId: 'u1', category: 'unlock_granted', title: 't' });
    const row = repo.findById(id);
    const createdMs = new Date(row.created_at).getTime();
    const expiresMs = new Date(row.expires_at).getTime();
    expect(expiresMs - createdMs).toBe(30 * 24 * 3600 * 1000);
  });

  it('send() with dedupKey uses upsert', () => {
    const id1 = handler.send({ userId: 'u1', category: 'a', title: 'first', dedupKey: 'k' });
    const id2 = handler.send({ userId: 'u1', category: 'a', title: 'second', dedupKey: 'k' });
    expect(id1).toBe(id2);
  });

  it('send() JSON-serializes payload', () => {
    const id = handler.send({ userId: 'u1', category: 'a', title: 't', payload: { foo: 'bar', n: 42 } });
    const row = repo.findById(id);
    expect(JSON.parse(row.payload_json)).toEqual({ foo: 'bar', n: 42 });
  });

  it('list() returns user rows + unread count', () => {
    handler.send({ userId: 'u1', category: 'a', title: 't1' });
    handler.send({ userId: 'u1', category: 'a', title: 't2' });
    const { rows, unread_count } = handler.list({ userId: 'u1' });
    expect(rows.length).toBe(2);
    expect(unread_count).toBe(2);
  });

  it('markRead() returns ISO string on success, idempotent on second call, null on missing', () => {
    const id = handler.send({ userId: 'u1', category: 'a', title: 't' });
    const first = handler.markRead(id, 'u1');
    expect(first).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Idempotent: calling again returns the same read_at (not null)
    const second = handler.markRead(id, 'u1');
    expect(second).toBe(first);
    expect(handler.markRead('notif_does_not_exist', 'u1')).toBeNull();
  });

  it('markRead() for other user returns null', () => {
    users.insert({ id: 'u2', user_type: 'hr', name: 'u2', contact: null, agent_endpoint: null, api_key_hash: 'h_u2', api_key_prefix: 'p_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-25T00:00:00.000Z', reputation: 50, status: 'active', created_at: NOW, updated_at: NOW });
    const id = handler.send({ userId: 'u1', category: 'a', title: 't' });
    expect(handler.markRead(id, 'u2')).toBeNull();
  });

  it('markAllRead() marks all unread for user', () => {
    handler.send({ userId: 'u1', category: 'a', title: 't1' });
    handler.send({ userId: 'u1', category: 'a', title: 't2' });
    const n = handler.markAllRead('u1');
    expect(n).toBe(2);
    expect(handler.list({ userId: 'u1' }).unread_count).toBe(0);
  });

  it('delete() returns true on own, false on other', () => {
    const id = handler.send({ userId: 'u1', category: 'a', title: 't' });
    expect(handler.delete(id, 'u2')).toBe(false);
    expect(handler.delete(id, 'u1')).toBe(true);
  });
});
