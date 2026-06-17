import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('jobs repository', () => {
  const testDb = path.join(__dirname, '../../../tmp/jobs.db');
  let db: any, users: any, jobs: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = await import('../../../src/main/db/connection');
    const { runMigrations } = await import('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    const { createUsersRepo } = await import('../../../src/main/db/repositories/users');
    const { createJobsRepo } = await import('../../../src/main/db/repositories/jobs');
    users = createUsersRepo(db);
    jobs = createJobsRepo(db);
    users.insert({
      id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null,
      api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0,
      quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active',
      created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z',
    });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  it('inserts and finds by id', () => {
    const now = '2026-06-17T00:00:00Z';
    jobs.insert({
      id: 'job_1', employer_id: 'e1', title: 'Senior Frontend',
      description: 'React + TS', requirements: '5y+', salary_min: 500000, salary_max: 800000,
      status: 'open', priority: 'normal', deadline: null, industry: '互联网',
      created_at: now, updated_at: now,
    });
    const j = jobs.findById('job_1');
    expect(j?.title).toBe('Senior Frontend');
  });

  it('lists by employer ordered by created_at desc', () => {
    const now = '2026-06-17T00:00:00Z';
    jobs.insert({ id: 'j1', employer_id: 'e1', title: 'A', description: null, requirements: null, salary_min: null, salary_max: null, status: 'open', priority: 'normal', deadline: null, industry: null, created_at: now, updated_at: now });
    jobs.insert({ id: 'j2', employer_id: 'e1', title: 'B', description: null, requirements: null, salary_min: null, salary_max: null, status: 'open', priority: 'normal', deadline: null, industry: null, created_at: '2026-06-17T00:00:01Z', updated_at: now });
    const list = jobs.listByEmployer('e1', { status: 'open' });
    expect(list.map((j: any) => j.id)).toEqual(['j2', 'j1']);
  });

  it('lists public jobs (status=open, all employers)', () => {
    const now = '2026-06-17T00:00:00Z';
    jobs.insert({ id: 'j1', employer_id: 'e1', title: 'A', description: null, requirements: null, salary_min: null, salary_max: null, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
    const publicJobs = jobs.listPublic({ industry: '互联网' });
    expect(publicJobs.length).toBe(1);
  });

  it('updates status', () => {
    const now = '2026-06-17T00:00:00Z';
    jobs.insert({ id: 'j1', employer_id: 'e1', title: 'A', description: null, requirements: null, salary_min: null, salary_max: null, status: 'open', priority: 'normal', deadline: null, industry: null, created_at: now, updated_at: now });
    jobs.updateStatus('j1', 'closed');
    expect(jobs.findById('j1')?.status).toBe('closed');
  });
});
