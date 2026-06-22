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
    const expiresAt = '2026-06-30T13:00:00.000Z';
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
    expect(row.consumed_at).toBeNull();  // never written (multi-use)
  });

  it('lookupRaw returns row when token exists (regardless of consumed/expired)', () => {
    const future = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
    repo.create({ token: 'b'.repeat(64), userId: 'u', viewType: 'candidate', viewId: 'c', expiresAt: future });
    const row = repo.lookupRaw('b'.repeat(64));
    expect(row).not.toBeNull();
    expect(row!.view_id).toBe('c');
  });

  it('lookupRaw returns null for unknown token', () => {
    expect(repo.lookupRaw('z'.repeat(64))).toBeNull();
  });

  // Note: findValid and markConsumed were removed in the multi-use refactor.
  // lookupRaw is now the only read method (validate.ts handles expiration check).
});
