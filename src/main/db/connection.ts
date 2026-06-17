// Deviation from M1 plan: using Node 22+ built-in `node:sqlite` (DatabaseSync)
// instead of `better-sqlite3`. Same synchronous API and SQL semantics;
// avoids native compilation. Existing Convo project also uses node:sqlite
// (commit ac0edd1). Plan ref: spec §4 "better-sqlite3" was a recommendation.
//
// The `createRequire` dance is needed because Vite/Vitest 2.x can't resolve
// the `node:` URL prefix in import specifiers; once Node's native loader runs
// (in production), a plain `import { DatabaseSync } from 'node:sqlite'` would
// also work. We standardize on createRequire for both test and prod for
// consistent behavior.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

export type DB = InstanceType<typeof DatabaseSync>;

export function openDb(dbPath: string): DB {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');  // WAL 模式下 NORMAL 安全
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}
