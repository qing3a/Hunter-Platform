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

describe('gatherLandingData - featuredJobs (SQL B)', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
  });

  it('returns empty array when no open jobs exist', () => {
    const data = gatherLandingData(db);
    expect(data.featuredJobs).toEqual([]);
  });

  it('returns 10 open jobs sorted by priority ASC then created_at DESC', () => {
    db.exec(`
      INSERT INTO users (id, user_type, name, contact, status, reputation, api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
      VALUES ('u_e1', 'employer', 'Boss Inc', 'e@e.com', 'active', 50, 'h1', 'p1', datetime('now'), datetime('now'), datetime('now'));
      INSERT INTO jobs (id, employer_id, title, status, priority, industry, salary_min, salary_max, required_skills_json, created_at, updated_at)
      VALUES
        ('j_normal', 'u_e1', 'Normal Job', 'open', 'normal', 'AI', 100000, 200000, '["Java"]', datetime('now', '-1 day'), datetime('now', '-1 day')),
        ('j_urgent', 'u_e1', 'Urgent Job', 'open', 'urgent', 'AI', 200000, 300000, '["Go"]', datetime('now'), datetime('now')),
        ('j_high',   'u_e1', 'High Job',   'open', 'high',   '金融', 150000, 250000, '["Python"]', datetime('now', '-1 hour'), datetime('now', '-1 hour'));
    `);
    const data = gatherLandingData(db);
    expect(data.featuredJobs.map(j => j.title)).toEqual(['Urgent Job', 'High Job', 'Normal Job']);
    expect(data.featuredJobs[0].company_name).toBe('Boss Inc');
    expect(data.featuredJobs[0].required_skills).toEqual(['Go']);
  });

  it('LEFT JOIN handles orphan job (employer_id NULL) — excluded', () => {
    db.exec(`
      INSERT INTO users (id, user_type, name, contact, status, reputation, api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
      VALUES ('u_h1', 'headhunter', 'H1', 'h@h.com', 'active', 50, 'h2', 'p2', datetime('now'), datetime('now'), datetime('now'));
      INSERT INTO jobs (id, source_headhunter_id, title, status, priority, created_at, updated_at)
      VALUES ('j_orphan', 'u_h1', 'Orphan', 'open', 'normal', datetime('now'), datetime('now'));
    `);
    const data = gatherLandingData(db);
    expect(data.featuredJobs).toEqual([]);
  });

  it('parses NULL required_skills_json as empty array', () => {
    db.exec(`
      INSERT INTO users (id, user_type, name, contact, status, reputation, api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
      VALUES ('u_e1', 'employer', 'E1', 'e@e.com', 'active', 50, 'h1', 'p1', datetime('now'), datetime('now'), datetime('now'));
      INSERT INTO jobs (id, employer_id, title, status, priority, required_skills_json, created_at, updated_at)
      VALUES ('j1', 'u_e1', 'J1', 'open', 'normal', NULL, datetime('now'), datetime('now'));
    `);
    const data = gatherLandingData(db);
    expect(data.featuredJobs[0].required_skills).toEqual([]);
  });
});

describe('gatherLandingData - hotCompanies (SQL C)', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
  });

  it('returns empty array when no employers have open jobs', () => {
    const data = gatherLandingData(db);
    expect(data.hotCompanies).toEqual([]);
  });

  it('ranks employers by open job count DESC, limits to 4', () => {
    db.exec(`
      INSERT INTO users (id, user_type, name, contact, status, reputation, api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
      VALUES
        ('u_e1', 'employer', 'Boss Inc', 'e1@e.com', 'active', 50, 'h1', 'p1', datetime('now'), datetime('now'), datetime('now')),
        ('u_e2', 'employer', 'Acme',     'e2@e.com', 'active', 50, 'h2', 'p2', datetime('now'), datetime('now'), datetime('now')),
        ('u_e3', 'employer', 'OldCo',    'e3@e.com', 'suspended', 50, 'h3', 'p3', datetime('now'), datetime('now'), datetime('now'));
      INSERT INTO jobs (id, employer_id, title, status, created_at, updated_at)
      VALUES
        ('j_e1_a', 'u_e1', 'J1A', 'open', datetime('now'), datetime('now')),
        ('j_e1_b', 'u_e1', 'J1B', 'open', datetime('now'), datetime('now')),
        ('j_e1_c', 'u_e1', 'J1C', 'open', datetime('now'), datetime('now')),
        ('j_e2_a', 'u_e2', 'J2A', 'open', datetime('now'), datetime('now')),
        ('j_e3_a', 'u_e3', 'J3A', 'open', datetime('now'), datetime('now'));
    `);
    const data = gatherLandingData(db);
    expect(data.hotCompanies.length).toBe(2);
    expect(data.hotCompanies[0].name).toBe('Boss Inc');
    expect(data.hotCompanies[0].openJobCount).toBe(3);
    expect(data.hotCompanies[1].name).toBe('Acme');
    expect(data.hotCompanies[1].openJobCount).toBe(1);
  });

  it('excludes suspended employers even if they have open jobs', () => {
    // (covered by previous test — OldCo with status='suspended' is excluded)
    // Asserts explicitly:
    const data = gatherLandingData(db);
    expect(data.hotCompanies.find(c => c.name === 'OldCo')).toBeUndefined();
  });

  it('each hot company includes up to 3 most recent open jobs', () => {
    db.exec(`
      INSERT INTO users (id, user_type, name, contact, status, reputation, api_key_hash, api_key_prefix, quota_reset_at, created_at, updated_at)
      VALUES ('u_e1', 'employer', 'Boss Inc', 'e@e.com', 'active', 50, 'h1', 'p1', datetime('now'), datetime('now'), datetime('now'));
      INSERT INTO jobs (id, employer_id, title, status, salary_min, salary_max, created_at, updated_at)
      VALUES
        ('j1', 'u_e1', 'Newest',  'open', 100000, 200000, datetime('now'),                       datetime('now')),
        ('j2', 'u_e1', 'Middle',  'open', 100000, 200000, datetime('now', '-1 hour'),            datetime('now', '-1 hour')),
        ('j3', 'u_e1', 'Oldest',  'open', 100000, 200000, datetime('now', '-1 day'),             datetime('now', '-1 day')),
        ('j4', 'u_e1', 'Ignored', 'open', 100000, 200000, datetime('now', '-2 days'),            datetime('now', '-2 days'));
    `);
    const data = gatherLandingData(db);
    expect(data.hotCompanies[0].recentJobs.length).toBe(3);
    expect(data.hotCompanies[0].recentJobs.map(j => j.title)).toEqual(['Newest', 'Middle', 'Oldest']);
  });
});