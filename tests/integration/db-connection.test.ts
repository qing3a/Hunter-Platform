import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('db connection', () => {
  const testDb = path.join(__dirname, '../../tmp/test.db');

  beforeEach(() => { try { fs.unlinkSync(testDb); } catch {} });
  afterEach(() => { try { fs.unlinkSync(testDb); } catch {} });

  it('opens with WAL mode', async () => {
    const { openDb } = await import('../../src/main/db/connection');
    const db = openDb(testDb);
    const result = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(result.journal_mode).toBe('wal');
    db.close();
  });
});

describe('migration v016 - notifications', () => {
  it('creates notifications table with all columns and indexes', async () => {
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const testDb = path.join(__dirname, '../../tmp/mig_v016.db');
    try { fs.unlinkSync(testDb); } catch {}
    const db = openDb(testDb);
    try {
      runMigrations(db);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notifications'").all();
      expect(tables.length).toBe(1);

      const cols = db.prepare("PRAGMA table_info(notifications)").all() as { name: string }[];
      const colNames = cols.map(c => c.name);
      expect(colNames).toContain('id');
      expect(colNames).toContain('user_id');
      expect(colNames).toContain('category');
      expect(colNames).toContain('title');
      expect(colNames).toContain('body');
      expect(colNames).toContain('payload_json');
      expect(colNames).toContain('read_at');
      expect(colNames).toContain('created_at');
      expect(colNames).toContain('expires_at');
      expect(colNames).toContain('dedup_key');

      const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='notifications'").all() as { name: string }[];
      const idxNames = idx.map(i => i.name);
      expect(idxNames).toContain('idx_notifications_user_unread');
      expect(idxNames).toContain('idx_notifications_user_created');
      expect(idxNames).toContain('idx_notifications_expires');
      expect(idxNames).toContain('idx_notifications_dedup');

      // 验证 partial unique index
      const dedupRow = db.prepare("SELECT sql FROM sqlite_master WHERE name='idx_notifications_dedup'").get() as { sql: string } | undefined;
      expect(dedupRow).toBeDefined();
      expect(dedupRow!.sql).toMatch(/WHERE dedup_key IS NOT NULL/);
    } finally {
      db.close();
      try { fs.unlinkSync(testDb); } catch {}
    }
  });
});
