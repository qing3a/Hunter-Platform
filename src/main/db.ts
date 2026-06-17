// Deviation from plan: using Node 22+ built-in `node:sqlite` (DatabaseSync)
// instead of `better-sqlite3`. Same synchronous API and SQL semantics;
// avoids native compilation. Plan ref: spec §4 "better-sqlite3" was a
// recommendation, not a hard requirement.
//
// The `createRequire` dance mirrors src/main/db/connection.ts: Vite/Vitest
// can't resolve the `node:` URL prefix in bare import specifiers, but
// `nodeRequire('node:sqlite')` works in both test and prod.

import { createRequire } from 'node:module';
import { dbPath } from './paths';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as { DatabaseSync: typeof import('node:sqlite').DatabaseSync };

let _db: import('node:sqlite').DatabaseSync | null = null;

export function getDb(): import('node:sqlite').DatabaseSync {
  if (_db) return _db;
  const db = new DatabaseSync(dbPath());
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  _db = db;
  return db;
}

export function closeDb(): void {
  _db?.close();
  _db = null;
}