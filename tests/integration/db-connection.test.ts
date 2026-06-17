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
