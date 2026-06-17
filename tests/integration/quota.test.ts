import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('quota manager', () => {
  const testDb = path.join(__dirname, '../../tmp/quota.db');

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const db = openDb(testDb);
    runMigrations(db);
    const { createUsersRepo } = await import('../../src/main/db/repositories/users');
    const { createQuotaManager } = await import('../../src/main/modules/quota/manager');
    (globalThis as any).__quotaTestDb = db;
    (globalThis as any).__quotaTestUsers = createUsersRepo(db);
    (globalThis as any).__quotaTestManager = createQuotaManager(db);
  });
  afterEach(() => {
    const db = (globalThis as any).__quotaTestDb;
    db.close();
    try { fs.unlinkSync(testDb); } catch {}
  });

  function seedUser(id: string, used: number, perDay: number) {
    const users = (globalThis as any).__quotaTestUsers;
    users.insert({
      id, user_type: 'headhunter', name: id, contact: null, agent_endpoint: null,
      api_key_hash: `h-${id}`, api_key_prefix: 'hp_live_', quota_per_day: perDay,
      quota_used: used, quota_reset_at: '2026-06-18T00:00:00Z',
      reputation: 50, status: 'active',
      created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z',
    });
  }

  it('decrements quota atomically', () => {
    seedUser('u1', 0, 100);
    const quota = (globalThis as any).__quotaTestManager;
    const result = quota.tryConsume('u1', 5);
    expect(result.ok).toBe(true);
    expect(result.quota_used).toBe(5);
  });

  it('rejects when quota would be exceeded', () => {
    seedUser('u2', 98, 100);
    const quota = (globalThis as any).__quotaTestManager;
    const result = quota.tryConsume('u2', 5);  // 98+5=103 > 100
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_QUOTA');
  });

  it('rejects suspended user', () => {
    seedUser('u3', 0, 100);
    const db = (globalThis as any).__quotaTestDb;
    db.exec("UPDATE users SET status='suspended' WHERE id='u3'");
    const quota = (globalThis as any).__quotaTestManager;
    const result = quota.tryConsume('u3', 5);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('FORBIDDEN');
  });

  it('handles concurrent decrements correctly (race condition test)', () => {
    seedUser('u4', 0, 10);
    const quota = (globalThis as any).__quotaTestManager;
    // 模拟 20 个并发请求，每个消耗 1
    const results = Array.from({ length: 20 }, () => quota.tryConsume('u4', 1));
    const successCount = results.filter((r: any) => r.ok).length;
    // 只应有 10 次成功（quota=10）
    expect(successCount).toBe(10);
  });
});
