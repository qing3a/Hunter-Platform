import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../../src/main/db/connection';

describe('migrations v020', () => {
  const testDb = path.join(__dirname, '../../tmp/mig20.db');
  let db: DB | undefined;

  beforeEach(() => {
    try { fs.unlinkSync(testDb); } catch {}
    try { fs.unlinkSync(testDb + '-wal'); } catch {}
    try { fs.unlinkSync(testDb + '-shm'); } catch {}
  });

  afterEach(() => {
    if (db) {
      try { db.close(); } catch {}
      db = undefined;
    }
    try { fs.unlinkSync(testDb); } catch {}
    try { fs.unlinkSync(testDb + '-wal'); } catch {}
    try { fs.unlinkSync(testDb + '-shm'); } catch {}
  });

  it('creates v027 tables and records migration', async () => {
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('hunter_tasks');
    expect(names).toContain('kanban_columns');

    // hunter_tasks column check
    const taskCols = db.prepare(`PRAGMA table_info(hunter_tasks)`).all() as Array<{ name: string }>;
    const taskColNames = taskCols.map(c => c.name).sort();
    expect(taskColNames).toEqual([
      'completed_at',
      'created_at',
      'description',
      'due_at',
      'hunter_user_id',
      'id',
      'priority',
      'related_candidate_user_id',
      'related_recommendation_id',
      'title',
      'updated_at',
    ]);

    // kanban_columns column check
    const kanbanCols = db.prepare(`PRAGMA table_info(kanban_columns)`).all() as Array<{ name: string }>;
    const kanbanColNames = kanbanCols.map(c => c.name).sort();
    expect(kanbanColNames).toEqual([
      'created_at',
      'hunter_user_id',
      'id',
      'name',
      'pipeline_stage',
      'position',
    ]);

    // recommendations: new columns
    const recCols = db.prepare(`PRAGMA table_info(recommendations)`).all() as Array<{ name: string }>;
    const recColNames = recCols.map(c => c.name);
    expect(recColNames).toContain('pipeline_stage');
    expect(recColNames).toContain('kanban_position');

    const migs = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    expect(migs.map((m: any) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
  });

  it('hunter_tasks defaults: priority=normal and timestamps set via unixepoch()*1000', async () => {
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);

    // Insert a user to satisfy FK
    db.prepare(
      `INSERT INTO users (id, user_type, name, api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
       VALUES ('u-t1', 'headhunter', 'h1', 'k-t1', 'pre-t1', '2026-01-01', '2026-01-01', '2026-01-01')`
    ).run();

    // unixepoch() returns seconds, * 1000 = ms at second precision,
    // so the default can be up to ~999ms in the past. Tolerate 1s window.
    const before = Date.now();
    db.prepare(
      `INSERT INTO hunter_tasks (id, hunter_user_id, title) VALUES ('t-1', 'u-t1', 'follow up')`
    ).run();
    const after = Date.now();

    const row = db.prepare(`SELECT priority, created_at, updated_at FROM hunter_tasks WHERE id = 't-1'`).get() as {
      priority: string;
      created_at: number;
      updated_at: number;
    };
    expect(row.priority).toBe('normal');
    expect(row.created_at).toBeGreaterThanOrEqual(before - 1000);
    expect(row.created_at).toBeLessThanOrEqual(after);
    expect(row.updated_at).toBe(row.created_at);
  });

  it('recommendations.pipeline_stage defaults to "submitted" on new rows', async () => {
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);

    // Build a minimal valid recommendation: need users (employer + headhunter),
    // a candidate_anonymized row, and a job.
    db.prepare(
      `INSERT INTO users (id, user_type, name, api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
       VALUES ('u-t2h', 'headhunter', 'h', 'k-t2h', 'p-t2h', '2026-01-01', '2026-01-01', '2026-01-01'),
              ('u-t2e', 'employer',   'e', 'k-t2e', 'p-t2e', '2026-01-01', '2026-01-01', '2026-01-01')`
    ).run();

    db.prepare(
      `INSERT INTO candidates_private (id, headhunter_id, candidate_user_id, name_enc, phone_enc, email_enc, created_at, updated_at)
       VALUES ('cp-t2', 'u-t2h', 'u-t2h', 'n', 'ph', 'em', '2026-01-01', '2026-01-01')`
    ).run();
    db.prepare(
      `INSERT INTO candidates_anonymized (id, source_private_id, source_headhunter_id, created_at, updated_at)
       VALUES ('ca-t2', 'cp-t2', 'u-t2h', '2026-01-01', '2026-01-01')`
    ).run();
    db.prepare(
      `INSERT INTO jobs (id, employer_id, title, created_at, updated_at)
       VALUES ('j-t2', 'u-t2e', 'Role', '2026-01-01', '2026-01-01')`
    ).run();

    db.prepare(
      `INSERT INTO recommendations (id, headhunter_id, employer_id, anonymized_candidate_id, job_id, created_at, updated_at)
       VALUES ('r-t2', 'u-t2h', 'u-t2e', 'ca-t2', 'j-t2', '2026-01-01', '2026-01-01')`
    ).run();

    const row = db.prepare(`SELECT pipeline_stage, kanban_position FROM recommendations WHERE id = 'r-t2'`).get() as {
      pipeline_stage: string;
      kanban_position: number | null;
    };
    expect(row.pipeline_stage).toBe('submitted');
    expect(row.kanban_position).toBeNull();
  });
});