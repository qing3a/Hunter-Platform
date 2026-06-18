import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/main/db/connection';
import { runMigrations } from '../../src/main/db/migrations';

describe('v004 migration: view_tokens table', () => {
  it('creates view_tokens with expected columns', () => {
    const db = openDb(':memory:');
    runMigrations(db);
    const cols = db.prepare(`PRAGMA table_info(view_tokens)`).all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(['consumed_at', 'created_at', 'expires_at', 'token', 'user_id', 'view_id', 'view_type']);
    db.close();
  });
});