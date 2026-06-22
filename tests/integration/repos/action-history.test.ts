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
    db.prepare(`INSERT INTO action_history (user_id, capability_name, target_type, target_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('u1', 'headhunter.upload_candidate', 'candidate', 'ca_1', 'success', '2026-06-17T00:00:01Z');
    db.prepare(`INSERT INTO action_history (user_id, capability_name, target_type, target_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('u1', 'employer.express_interest', 'recommendation', 'rec_1', 'success', '2026-06-17T00:00:02Z');
    db.prepare(`INSERT INTO action_history (user_id, capability_name, target_type, target_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('u2', 'headhunter.recommend_candidate', 'recommendation', 'rec_2', 'success', '2026-06-17T00:00:03Z');
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
    expect(list[0].capability_name).toBe('employer.express_interest');  // newer first
    expect(list[1].capability_name).toBe('headhunter.upload_candidate');
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

  describe('insert', () => {
    it('inserts a success entry and returns id', () => {
      const db = (globalThis as any).__ahTestDb;
      const freshRepo = (globalThis as any).__ahTestDb.__ahRepo;
      void freshRepo; // suppress unused warning
      const id = repo.insert({
        user_id: 'u1', capability_name: 'headhunter.upload_candidate',
        target_type: 'candidate', target_id: 'ca_test',
        request_summary_json: null, response_summary_json: '{"anonymized_id":"ca_test"}',
        status: 'success', error_code: null, duration_ms: 42,
        created_at: new Date().toISOString(),
      });
      void db;
      expect(typeof id).toBe('number');
      expect(id).toBeGreaterThan(0);
      const rows = repo.listByUser('u1');
      // 之前已有 2 条 (express_interest, upload_candidate)，新增 1 条
      expect(rows.length).toBeGreaterThanOrEqual(3);
      const inserted = rows.find(r => r.target_id === 'ca_test');
      expect(inserted).toBeTruthy();
      expect(inserted!.capability_name).toBe('headhunter.upload_candidate');
      expect(inserted!.duration_ms).toBe(42);
    });

    it('inserts an error entry with error_code', () => {
      repo.insert({
        user_id: 'u2', capability_name: 'auth.register',
        target_type: null, target_id: null,
        request_summary_json: null, response_summary_json: null,
        status: 'error', error_code: 'RATE_LIMITED', duration_ms: 5,
        created_at: new Date().toISOString(),
      });
      const rows = repo.listByUser('u2');
      const inserted = rows.find(r => r.capability_name === 'auth.register' && r.status === 'error');
      expect(inserted).toBeTruthy();
      expect(inserted!.error_code).toBe('RATE_LIMITED');
    });
  });
});