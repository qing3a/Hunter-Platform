import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('admin_users repository', () => {
  const testDb = path.join(__dirname, '../../../tmp/au-test.db');
  let repo: any;
  let db: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {}
    const { openDb } = await import('../../../src/main/db/connection');
    const { runMigrations } = await import('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    const { createAdminUsersRepo } = await import('../../../src/main/db/repositories/admin-users');
    repo = createAdminUsersRepo(db);
  });
  afterEach(() => {
    if (db) db.close();
    try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {}
  });

  const sampleRow = () => ({
    id: 'adm_test1',
    name: 'Test Admin',
    email: 'admin@test.com',
    password_hash: 'pwd_hash',
    api_key_hash: 'key_hash',
    api_key_prefix: 'hp_admin_aaa',
    role: 'admin' as const,
    status: 'active' as const,
    created_at: '2026-06-23T00:00:00Z',
    updated_at: '2026-06-23T00:00:00Z',
  });

  it('insert + findByEmail returns row', () => {
    repo.insert(sampleRow());
    const row = repo.findByEmail('admin@test.com');
    expect(row?.id).toBe('adm_test1');
    expect(row?.role).toBe('admin');
  });

  it('findByApiKeyPrefix returns row', () => {
    repo.insert(sampleRow());
    const row = repo.findByApiKeyPrefix('hp_admin_aaa');
    expect(row?.email).toBe('admin@test.com');
  });

  it('findById returns row', () => {
    repo.insert(sampleRow());
    expect(repo.findById('adm_test1')?.email).toBe('admin@test.com');
    expect(repo.findById('nonexistent')).toBeUndefined();
  });

  it('updateLastLogin sets ts', () => {
    repo.insert(sampleRow());
    repo.updateLastLogin('adm_test1', '2026-06-23T12:34:56Z');
    expect(repo.findById('adm_test1')?.last_login_at).toBe('2026-06-23T12:34:56Z');
  });

  it('updateApiKey replaces hash + prefix + updated_at', () => {
    repo.insert(sampleRow());
    repo.updateApiKey('adm_test1', 'new_hash', 'hp_admin_zzz', '2026-06-23T99:99:99Z');
    const row = repo.findById('adm_test1');
    expect(row?.api_key_hash).toBe('new_hash');
    expect(row?.api_key_prefix).toBe('hp_admin_zzz');
    expect(row?.updated_at).toBe('2026-06-23T99:99:99Z');
    expect(repo.findByApiKeyPrefix('hp_admin_aaa')).toBeUndefined();
  });

  it('count returns 0 then 1 after insert', () => {
    expect(repo.count()).toBe(0);
    repo.insert(sampleRow());
    expect(repo.count()).toBe(1);
  });

  it('email uniqueness enforced at DB level', () => {
    repo.insert(sampleRow());
    expect(() => repo.insert({ ...sampleRow(), id: 'adm_test2' })).toThrow(/UNIQUE/);
  });
});
