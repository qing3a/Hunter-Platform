// tests/unit/gather-landing-data.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { gatherLandingData } from '../../src/main/modules/view/gather-landing-data';
import { openDb } from '../../src/main/db/connection';
import { runMigrations } from '../../src/main/db/migrations';

describe('gatherLandingData - basic fields', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
  });

  it('returns zeros and empty arrays for empty DB', () => {
    const data = gatherLandingData(db);
    expect(data.openJobsCount).toBe(0);
    expect(data.publicCandidatesCount).toBe(0);
    expect(data.industryGroups).toEqual([]);
    expect(data.recentJobs).toEqual([]);
    expect(data.topHeadhunters).toEqual([]);
    expect(data.latestPlacements).toEqual([]);
    expect(data.todayUnlocks).toBe(0);
    expect(data.todayPlacements).toBe(0);
    expect(data.totalCandidates).toBe(0);
    expect(data.activeEmployerCount).toBe(0);
    expect(data.activeHeadhunterCount).toBe(0);
    expect(data.uptimePercent).toBe(99.9);
    expect(data.healthStatus).toBe('healthy');
    expect(data.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(data.industryNav).toEqual([]);
    expect(data.featuredJobs).toEqual([]);
    expect(data.hotCompanies).toEqual([]);
  });
});

describe('gatherLandingData - topEmployers', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
  });

  it('returns empty array when no employers exist', () => {
    const data = gatherLandingData(db);
    expect(data.topEmployers).toEqual([]);
  });

  it('ranks employers by recommendation count DESC', () => {
    // Setup: create 2 employers + headhunter + job + private candidate + anonymized candidate + recommendations
    db.exec(`
      INSERT INTO users (id, user_type, name, contact, status, reputation, api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
      VALUES
        ('u_cand', 'candidate', 'C1', 'c@c.com', 'active', 50, 'hash_c1', 'prefix_c1', datetime('now'), datetime('now'), datetime('now')),
        ('u_e1', 'employer', 'Boss Inc', 'e1@e.com', 'active', 80, 'hash_e1', 'prefix_e1', datetime('now'), datetime('now'), datetime('now')),
        ('u_e2', 'employer', 'Acme', 'e2@e.com', 'active', 90, 'hash_e2', 'prefix_e2', datetime('now'), datetime('now'), datetime('now')),
        ('u_h1', 'headhunter', 'HH1', 'h@h.com', 'active', 70, 'hash_h1', 'prefix_h1', datetime('now'), datetime('now'), datetime('now'));
      INSERT INTO candidates_private (id, headhunter_id, candidate_user_id, name_enc, phone_enc, email_enc, created_at, updated_at)
      VALUES ('cp1', 'u_h1', 'u_cand', 'n', 'p', 'e', datetime('now'), datetime('now'));
      INSERT INTO candidates_anonymized (id, source_private_id, source_headhunter_id, is_public_pool, unlock_status, created_at, updated_at)
      VALUES ('c1', 'cp1', 'u_h1', 0, 'locked', datetime('now'), datetime('now'));
      INSERT INTO jobs (id, employer_id, title, status, created_at, updated_at)
      VALUES ('j1', 'u_e1', 'J1', 'open', datetime('now'), datetime('now')),
             ('j2', 'u_e2', 'J2', 'open', datetime('now'), datetime('now')),
             ('j3', 'u_e2', 'J3', 'open', datetime('now'), datetime('now'));
      INSERT INTO recommendations (id, job_id, anonymized_candidate_id, employer_id, headhunter_id, status, created_at, updated_at)
      VALUES ('r1', 'j1', 'c1', 'u_e1', 'u_h1', 'pending', datetime('now'), datetime('now')),
             ('r2', 'j2', 'c1', 'u_e2', 'u_h1', 'pending', datetime('now'), datetime('now')),
             ('r3', 'j3', 'c1', 'u_e2', 'u_h1', 'pending', datetime('now'), datetime('now'));
    `);
    const data = gatherLandingData(db);
    expect(data.topEmployers).toEqual([
      { id: 'u_e2', name: 'Acme', recCount: 2 },
      { id: 'u_e1', name: 'Boss Inc', recCount: 1 },
    ]);
  });
});

describe('gatherLandingData - topIndustries', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
  });

  it('returns empty array when no public candidates exist', () => {
    const data = gatherLandingData(db);
    expect(data.topIndustries).toEqual([]);
  });

  it('groups public candidates by industry, sorted DESC', () => {
    db.exec(`
      INSERT INTO users (id, user_type, name, contact, status, api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
      VALUES ('u_h1', 'headhunter', 'HH1', 'h@h.com', 'active', 'hash_h1', 'prefix_h1', datetime('now'), datetime('now'), datetime('now')),
             ('u_cand', 'candidate', 'C1', 'c@c.com', 'active', 'hash_c1', 'prefix_c1', datetime('now'), datetime('now'), datetime('now'));
      INSERT INTO candidates_private (id, headhunter_id, candidate_user_id, name_enc, phone_enc, email_enc, created_at, updated_at)
      VALUES ('cp1', 'u_h1', 'u_cand', 'n', 'p', 'e', datetime('now'), datetime('now')),
             ('cp2', 'u_h1', 'u_cand', 'n', 'p', 'e', datetime('now'), datetime('now')),
             ('cp3', 'u_h1', 'u_cand', 'n', 'p', 'e', datetime('now'), datetime('now'));
      INSERT INTO candidates_anonymized (id, source_private_id, source_headhunter_id, is_public_pool, industry, unlock_status, created_at, updated_at)
      VALUES
        ('c1', 'cp1', 'u_h1', 1, '互联网', 'locked', datetime('now'), datetime('now')),
        ('c2', 'cp2', 'u_h1', 1, '互联网', 'locked', datetime('now'), datetime('now')),
        ('c3', 'cp3', 'u_h1', 1, '金融', 'locked', datetime('now'), datetime('now'));
    `);
    const data = gatherLandingData(db);
    expect(data.topIndustries).toEqual([
      { industry: '互联网', candCount: 2 },
      { industry: '金融', candCount: 1 },
    ]);
  });
});

describe('gatherLandingData - hotSkills', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
  });

  it('returns empty array when no open jobs have skills', () => {
    const data = gatherLandingData(db);
    expect(data.hotSkills).toEqual([]);
  });

  it('aggregates skills from open jobs, top 10, sorted DESC', () => {
    db.exec(`
      INSERT INTO users (id, user_type, name, contact, status, api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
      VALUES ('u_e1', 'employer', 'Boss Inc', 'e1@e.com', 'active', 'hash_e1', 'prefix_e1', datetime('now'), datetime('now'), datetime('now'));
      INSERT INTO jobs (id, employer_id, title, status, required_skills_json, created_at, updated_at)
      VALUES
        ('j1', 'u_e1', 'J1', 'open', '["React", "TypeScript"]', datetime('now'), datetime('now')),
        ('j2', 'u_e1', 'J2', 'open', '["React", "Go"]', datetime('now'), datetime('now')),
        ('j3', 'u_e1', 'J3', 'open', '["TypeScript"]', datetime('now'), datetime('now')),
        ('j4', 'u_e1', 'J4', 'closed', '["Hidden"]', datetime('now'), datetime('now'));
    `);
    const data = gatherLandingData(db);
    expect(data.hotSkills).toEqual([
      { skill: 'React', count: 2 },
      { skill: 'TypeScript', count: 2 },
      { skill: 'Go', count: 1 },
    ]);
  });
});

describe('gatherLandingData - healthStatus', () => {
  it('returns healthy for working DB', () => {
    const db = openDb(':memory:');
    runMigrations(db);
    const data = gatherLandingData(db);
    expect(data.healthStatus).toBe('healthy');
  });

  it('returns degraded when DB throws on probe', () => {
    const db = openDb(':memory:');
    runMigrations(db);
    // Override prepare to fail on `SELECT 1`
    const origPrepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      if (sql.replace(/\s+/g, ' ').trim() === 'SELECT 1') {
        throw new Error('simulated DB failure');
      }
      return origPrepare(sql);
    }) as typeof db.prepare;
    const data = gatherLandingData(db);
    expect(data.healthStatus).toBe('degraded');
  });
});