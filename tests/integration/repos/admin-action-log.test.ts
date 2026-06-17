import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('admin_action_log repository', () => {
  const testDb = path.join(__dirname, '../../../tmp/admin-log.db');
  let db: any, log: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = await import('../../../src/main/db/connection');
    const { runMigrations } = await import('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    const { createAdminActionLogRepo } = await import('../../../src/main/db/repositories/admin-action-log');
    log = createAdminActionLogRepo(db);
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('inserts and lists by admin', () => {
    log.insert({ admin_user_id: 'admin', action: 'suspend_user', target_type: 'user', target_id: 'u1', details_json: '{"reason":"x"}' });
    const list = log.listByAdmin('admin', {});
    expect(list.length).toBe(1);
    expect(list[0].action).toBe('suspend_user');
  });

  it('listByTarget filters by target_type + target_id', () => {
    log.insert({ admin_user_id: 'admin', action: 'remove_candidate', target_type: 'candidate', target_id: 'c1' });
    log.insert({ admin_user_id: 'admin', action: 'mark_paid', target_type: 'placement', target_id: 'p1' });
    const forCand = log.listByTarget('candidate', 'c1', {});
    expect(forCand.length).toBe(1);
    expect(forCand[0].action).toBe('remove_candidate');
  });
});