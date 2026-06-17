// Deviation from M1 plan: node:sqlite doesn't have a `db.transaction()`
// wrapper like better-sqlite3. We use explicit BEGIN/COMMIT via exec().
// SQL semantics are identical.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync: _DBC } = nodeRequire('node:sqlite') as typeof import('node:sqlite');
type DB = InstanceType<typeof _DBC>;

const MIGRATIONS: { version: number; description: string; file: string }[] = [
  { version: 1, description: 'M1 baseline (users, candidates, idempotency, rate limit, action history)', file: 'schema.sql' },
];

export function runMigrations(db: DB, schemaDir: string = path.join(__dirname)): void {
  // Ensure schema_migrations table exists (for upgrade scenarios, but harmless on first run)
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[])
      .map(r => r.version)
  );

  for (const mig of MIGRATIONS) {
    if (applied.has(mig.version)) continue;
    const sql = fs.readFileSync(path.join(schemaDir, mig.file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)'
      ).run(mig.version, mig.description, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
