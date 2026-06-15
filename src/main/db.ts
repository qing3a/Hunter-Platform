// Deviation from plan: using Node 22+ built-in `node:sqlite` (DatabaseSync)
// instead of `better-sqlite3`. Same synchronous API and SQL semantics;
// avoids native compilation. Plan ref: spec §4 "better-sqlite3" was a
// recommendation, not a hard requirement.

import { DatabaseSync } from 'node:sqlite';
import { dbPath } from './paths';

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (_db) return _db;
  const db = new DatabaseSync(dbPath());
  // WAL: better concurrent read/write; foreign_keys: enforce cascades
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  _db = db;
  return db;
}

export function closeDb(): void {
  _db?.close();
  _db = null;
}
