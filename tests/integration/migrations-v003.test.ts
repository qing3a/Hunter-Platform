import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('migrations v003', () => {
  const testDb = path.join(__dirname, '../../tmp/mig3.db');

  beforeEach(() => { try { fs.unlinkSync(testDb); } catch {} });
  afterEach(() => { try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('creates v003 tables and records migration', async () => {
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const db = openDb(testDb);
    runMigrations(db);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('placements');
    expect(names).toContain('admin_action_log');
    const migs = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    // Pre-v032 the test asserted [1..24] exactly. C3 added v025 webhook
    // inbox; v040+ may add more. Assert monotonic 1..N.
    expect(migs.map((m: any) => m.version)).toEqual(
      Array.from({ length: migs.length }, (_, i) => i + 1),
    );
    expect(migs.length).toBeGreaterThanOrEqual(24);
    db.close();
  });
});