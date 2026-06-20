// tests/unit/jobs-repo.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../src/main/db/connection';
import { runMigrations } from '../../src/main/db/migrations';

describe('jobs table CHECK constraints (v009)', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
    // 插入必备 user
    db.prepare(`
      INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix, quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
      VALUES
        ('u_emp_1', 'employer',   'E1', 'e@e.com', 'h1', 'p1', 100, 0, datetime('now'), 50, 'active', datetime('now'), datetime('now')),
        ('u_hh_1',  'headhunter', 'H1', 'h@h.com', 'h2', 'p2', 100, 0, datetime('now'), 50, 'active', datetime('now'), datetime('now'))
    `).run();
  });

  it('accepts 雇主直发: employer_id NOT NULL, source_headhunter_id NULL', () => {
    db.prepare(`
      INSERT INTO jobs (id, employer_id, source_headhunter_id, created_for_employer_id, title, status, priority, created_at, updated_at)
      VALUES ('j1', 'u_emp_1', NULL, NULL, 'T1', 'open', 'normal', datetime('now'), datetime('now'))
    `).run();
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get('j1') as any;
    expect(row.employer_id).toBe('u_emp_1');
    expect(row.source_headhunter_id).toBeNull();
    expect(row.created_for_employer_id).toBeNull();
  });

  it('accepts 猎头代发: source_headhunter_id NOT NULL, employer_id NULL', () => {
    db.prepare(`
      INSERT INTO jobs (id, employer_id, source_headhunter_id, created_for_employer_id, title, status, priority, created_at, updated_at)
      VALUES ('j2', NULL, 'u_hh_1', 'u_emp_1', 'T2', 'open', 'normal', datetime('now'), datetime('now'))
    `).run();
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get('j2') as any;
    expect(row.employer_id).toBeNull();
    expect(row.source_headhunter_id).toBe('u_hh_1');
    expect(row.created_for_employer_id).toBe('u_emp_1');
  });

  it('rejects 同为 NULL (无 source 也无 employer)', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO jobs (id, employer_id, source_headhunter_id, created_for_employer_id, title, status, priority, created_at, updated_at)
        VALUES ('j3', NULL, NULL, NULL, 'T3', 'open', 'normal', datetime('now'), datetime('now'))
      `).run();
    }).toThrow(/CHECK constraint/i);
  });

  it('rejects 同时 NOT NULL (雇主直发 + source_hh 也填)', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO jobs (id, employer_id, source_headhunter_id, created_for_employer_id, title, status, priority, created_at, updated_at)
        VALUES ('j4', 'u_emp_1', 'u_hh_1', NULL, 'T4', 'open', 'normal', datetime('now'), datetime('now'))
      `).run();
    }).toThrow(/CHECK constraint/i);
  });
});
