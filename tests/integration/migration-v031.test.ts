import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

describe('migration v031: session + user_role', () => {
  let db: InstanceType<typeof DatabaseSync>;

  beforeAll(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        user_type TEXT NOT NULL CHECK (user_type IN ('pm','hr','candidate','hr','pm')),
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    db.exec(`INSERT INTO users (id, user_type, name, created_at) VALUES ('u1', 'hr', 'Alice', '2026-01-01');`);
    db.exec(`INSERT INTO users (id, user_type, name, created_at) VALUES ('u2', 'pm', 'Bob', '2026-01-01');`);
    db.exec(`INSERT INTO users (id, user_type, name, created_at) VALUES ('u3', 'candidate', 'Carol', '2026-01-01');`);
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'db', 'migrations', 'v031_session_and_multirole.sql'), 'utf8');
    db.exec(sql);
  });
  afterAll(() => db.close());

  it('remaps headhunter→hr and employer→pm', () => {
    expect(db.prepare(`SELECT user_type FROM users WHERE id='u1'`).get()).toEqual({ user_type: 'hr' });
    expect(db.prepare(`SELECT user_type FROM users WHERE id='u2'`).get()).toEqual({ user_type: 'pm' });
    expect(db.prepare(`SELECT user_type FROM users WHERE id='u3'`).get()).toEqual({ user_type: 'candidate' });
  });

  it('backfills all 3 roles for every user', () => {
    const rows = db.prepare(`SELECT user_id, role FROM user_role ORDER BY user_id, role`).all();
    expect(rows).toEqual([
      { user_id: 'u1', role: 'candidate' },
      { user_id: 'u1', role: 'hr' },
      { user_id: 'u1', role: 'pm' },
      { user_id: 'u2', role: 'candidate' },
      { user_id: 'u2', role: 'hr' },
      { user_id: 'u2', role: 'pm' },
      { user_id: 'u3', role: 'candidate' },
      { user_id: 'u3', role: 'hr' },
      { user_id: 'u3', role: 'pm' },
    ]);
  });

  it('creates session table with all expected columns', () => {
    const cols = db.prepare(`PRAGMA table_info(session)`).all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('user_id');
    expect(colNames).toContain('active_role');
    expect(colNames).toContain('expires_at');
    expect(colNames).toContain('revoked_at');
  });
});

describe('migration v031 via registry (runMigrations)', () => {
  const tmpDir = path.join(__dirname, '..', '..', 'tmp');
  const testDb = path.join(tmpDir, 'mig-registry-v031.db');

  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    try { fs.unlinkSync(testDb); } catch {}
  });
  afterAll(() => {
    try { fs.unlinkSync(testDb); } catch {}
  });

  it('runMigrations applies v031 to a fresh DB', async () => {
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const db = openDb(testDb);
    runMigrations(db);

    // v031 must be recorded as applied
    const v31 = db.prepare(`SELECT version FROM schema_migrations WHERE version = 24`).get();
    expect(v31).toBeDefined();

    // user_role + session tables must exist
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('user_role', 'session')`
    ).all() as Array<{ name: string }>;
    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('user_role');
    expect(tableNames).toContain('session');

    // session columns check
    const sessionCols = db.prepare(`PRAGMA table_info(session)`).all() as Array<{ name: string }>;
    const colNames = sessionCols.map(c => c.name);
    expect(colNames).toContain('ip_address');
    expect(colNames).toContain('user_agent');

    db.close();
  });

  it('is idempotent — second runMigrations does not re-apply', async () => {
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const db = openDb(testDb);
    const before = db.prepare(`SELECT COUNT(*) AS n FROM schema_migrations`).get() as { n: number };
    runMigrations(db);
    const after = db.prepare(`SELECT COUNT(*) AS n FROM schema_migrations`).get() as { n: number };
    expect(after.n).toBe(before.n);
    db.close();
  });
});
