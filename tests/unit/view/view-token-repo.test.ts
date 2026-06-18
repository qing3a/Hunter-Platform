import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, type DB } from '../../../src/main/db/connection';
import { runMigrations } from '../../../src/main/db/migrations';
import {
  createViewTokenRepo,
  type ViewTokenRow,
} from '../../../src/main/modules/view/view-token-repo';

describe('view-token-repo', () => {
  let db: DB;
  let repo: ReturnType<typeof createViewTokenRepo>;

  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
    repo = createViewTokenRepo(db);
  });

  afterEach(() => db.close());

  it('create inserts a row with all fields', () => {
    const expiresAt = '2026-06-18T13:00:00.000Z';
    repo.create({
      token: 'a'.repeat(64),
      userId: 'user_1',
      viewType: 'candidate',
      viewId: 'cand_abc',
      expiresAt,
    });
    const row = db.prepare(`SELECT * FROM view_tokens WHERE token = ?`).get('a'.repeat(64)) as ViewTokenRow;
    expect(row.user_id).toBe('user_1');
    expect(row.view_type).toBe('candidate');
    expect(row.view_id).toBe('cand_abc');
    expect(row.expires_at).toBe(expiresAt);
    expect(row.consumed_at).toBeNull();
  });

  it('findValid returns row when token exists, not consumed, not expired', () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    repo.create({ token: 'b'.repeat(64), userId: 'u', viewType: 'candidate', viewId: 'c', expiresAt: future });
    const row = repo.findValid('b'.repeat(64));
    expect(row).not.toBeNull();
    expect(row!.view_id).toBe('c');
  });

  it('findValid returns null for expired token', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    repo.create({ token: 'c'.repeat(64), userId: 'u', viewType: 'candidate', viewId: 'c', expiresAt: past });
    expect(repo.findValid('c'.repeat(64))).toBeNull();
  });

  it('findValid returns null for already-consumed token', () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    repo.create({ token: 'd'.repeat(64), userId: 'u', viewType: 'candidate', viewId: 'c', expiresAt: future });
    repo.markConsumed('d'.repeat(64), new Date().toISOString());
    expect(repo.findValid('d'.repeat(64))).toBeNull();
  });

  it('findValid returns null for unknown token', () => {
    expect(repo.findValid('z'.repeat(64))).toBeNull();
  });

  it('markConsumed returns true on first call, false on second (atomicity)', () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    repo.create({ token: 'e'.repeat(64), userId: 'u', viewType: 'candidate', viewId: 'c', expiresAt: future });
    const first = repo.markConsumed('e'.repeat(64), new Date().toISOString());
    const second = repo.markConsumed('e'.repeat(64), new Date().toISOString());
    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});