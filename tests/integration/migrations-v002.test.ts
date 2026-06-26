import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('migrations v002', () => {
  const testDb = path.join(__dirname, '../../tmp/mig2.db');

  beforeEach(() => { try { fs.unlinkSync(testDb); } catch {} });
  afterEach(() => { try { fs.unlinkSync(testDb); } catch {} });

  it('creates v002 tables and records migration', async () => {
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const db = openDb(testDb);
    runMigrations(db);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('jobs');
    expect(names).toContain('recommendations');
    expect(names).toContain('unlock_audit_log');
    expect(names).toContain('webhook_delivery_queue');
    const migs = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    expect(migs.map(m => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    db.close();
  });
});
