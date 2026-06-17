import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('migrations', () => {
  const testDb = path.join(__dirname, '../../tmp/mig.db');

  beforeEach(() => { try { fs.unlinkSync(testDb); } catch {} });
  afterEach(() => { try { fs.unlinkSync(testDb); } catch {} });

  it('creates v001 schema and records migration', async () => {
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const db = openDb(testDb);
    runMigrations(db);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('candidates_private');
    expect(tableNames).toContain('candidates_anonymized');
    expect(tableNames).toContain('idempotency_keys');
    expect(tableNames).toContain('rate_limit_buckets');
    expect(tableNames).toContain('action_history');
    expect(tableNames).toContain('schema_migrations');
    const mig = db.prepare('SELECT version FROM schema_migrations').get() as { version: number };
    expect(mig).toEqual({ version: 1 });
    db.close();
  });

  it('is idempotent on second run', async () => {
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const db = openDb(testDb);
    runMigrations(db);
    runMigrations(db);  // 第二次不应报错
    const migs = db.prepare('SELECT * FROM schema_migrations').all();
    expect(migs.length).toBe(1);
    db.close();
  });
});
