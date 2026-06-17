import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('action_history repository', () => {
  const testDb = path.join(__dirname, '../../../tmp/ah.db');
  let repo: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {}
    const { openDb } = await import('../../../src/main/db/connection');
    const { runMigrations } = await import('../../../src/main/db/migrations');
    const db = openDb(testDb);
    runMigrations(db);
    const { createUsersRepo } = await import('../../../src/main/db/repositories/users');
    const { createActionHistoryRepo } = await import('../../../src/main/db/repositories/action-history');
    const users = createUsersRepo(db);
    repo = createActionHistoryRepo(db);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'u1', user_type: 'employer', name: 'U1', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'u2', user_type: 'headhunter', name: 'U2', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    db.prepare(`INSERT INTO action_history (user_id, action_type, target_type, target_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('u1', 'upload_candidate', 'candidate', 'ca_1', 'success', '2026-06-17T00:00:01Z');
    db.prepare(`INSERT INTO action_history (user_id, action_type, target_type, target_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('u1', 'express_interest', 'recommendation', 'rec_1', 'success', '2026-06-17T00:00:02Z');
    db.prepare(`INSERT INTO action_history (user_id, action_type, target_type, target_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('u2', 'recommend_candidate', 'recommendation', 'rec_2', 'success', '2026-06-17T00:00:03Z');
    (globalThis as any).__ahTestDb = db;
  });
  afterEach(() => {
    const db = (globalThis as any).__ahTestDb;
    if (db) db.close();
    try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {}
  });

  it('listByUser returns user actions in DESC order', () => {
    const list = repo.listByUser('u1');
    expect(list.length).toBe(2);
    expect(list[0].action_type).toBe('express_interest');  // newer first
    expect(list[1].action_type).toBe('upload_candidate');
  });

  it('listByUser with limit/offset pagination', () => {
    const list = repo.listByUser('u1', { limit: 1 });
    expect(list.length).toBe(1);
  });

  it('countByUser returns correct count', () => {
    expect(repo.countByUser('u1')).toBe(2);
    expect(repo.countByUser('u2')).toBe(1);
    expect(repo.countByUser('nonexistent')).toBe(0);
  });
});
