// tests/unit/gather-landing-data-enrichment.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { gatherLandingData } from '../../src/main/modules/view/gather-landing-data';
import { openDb } from '../../src/main/db/connection';
import { runMigrations } from '../../src/main/db/migrations';

describe('gatherLandingData - industryNav (SQL A)', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
  });

  it('returns empty array when no jobs exist', () => {
    const data = gatherLandingData(db);
    expect(data.industryNav).toEqual([]);
  });

  it('aggregates open jobs by industry, sorted DESC, limited to 20', () => {
    db.exec(`
      INSERT INTO users (id, user_type, name, contact, status, reputation, api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
      VALUES
        ('u_e1', 'employer', 'E1', 'e@e.com', 'active', 50, 'h1', 'p1', datetime('now'), datetime('now'), datetime('now')),
        ('u_h1', 'headhunter', 'H1', 'h@h.com', 'active', 50, 'h2', 'p2', datetime('now'), datetime('now'), datetime('now'));
      INSERT INTO jobs (id, employer_id, title, status, industry, created_at, updated_at)
      VALUES
        ('j1', 'u_e1', 'J1', 'open', 'AI', datetime('now'), datetime('now')),
        ('j2', 'u_e1', 'J2', 'open', 'AI', datetime('now'), datetime('now')),
        ('j3', 'u_e1', 'J3', 'open', '金融', datetime('now'), datetime('now'));
    `);
    const data = gatherLandingData(db);
    expect(data.industryNav).toEqual([
      { industry: 'AI', jobCount: 2 },
      { industry: '金融', jobCount: 1 },
    ]);
  });

  it('excludes jobs with NULL industry', () => {
    db.exec(`
      INSERT INTO users (id, user_type, name, contact, status, reputation, api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
      VALUES ('u_e1', 'employer', 'E1', 'e@e.com', 'active', 50, 'h1', 'p1', datetime('now'), datetime('now'), datetime('now'));
      INSERT INTO jobs (id, employer_id, title, status, industry, created_at, updated_at)
      VALUES ('j1', 'u_e1', 'J1', 'open', NULL, datetime('now'), datetime('now'));
    `);
    const data = gatherLandingData(db);
    expect(data.industryNav).toEqual([]);
  });

  it('excludes non-open jobs', () => {
    db.exec(`
      INSERT INTO users (id, user_type, name, contact, status, reputation, api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
      VALUES ('u_e1', 'employer', 'E1', 'e@e.com', 'active', 50, 'h1', 'p1', datetime('now'), datetime('now'), datetime('now'));
      INSERT INTO jobs (id, employer_id, title, status, industry, created_at, updated_at)
      VALUES
        ('j1', 'u_e1', 'J1', 'closed', 'AI', datetime('now'), datetime('now')),
        ('j2', 'u_e1', 'J2', 'filled', 'AI', datetime('now'), datetime('now'));
    `);
    const data = gatherLandingData(db);
    expect(data.industryNav).toEqual([]);
  });
});