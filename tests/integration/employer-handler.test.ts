import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('employer handler', () => {
  const testDb = path.join(__dirname, '../../tmp/emp.db');
  let db: any, users: any, jobs: any, employer: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    const { createUsersRepo } = await import('../../src/main/db/repositories/users');
    const { createJobsRepo } = await import('../../src/main/db/repositories/jobs');
    const { createEmployerHandler } = await import('../../src/main/modules/employer/handler');
    users = createUsersRepo(db);
    jobs = createJobsRepo(db);
    employer = createEmployerHandler(db);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  it('createJob requires employer role', () => {
    const headhunter: any = { id: 'h1', user_type: 'headhunter' };
    expect(() => employer.createJob(headhunter, { title: 'X' })).toThrow(/Only employers/);
  });

  it('createJob creates job and consumes quota', () => {
    const employer1: any = { id: 'e1', user_type: 'employer' };
    const job = employer.createJob(employer1, { title: 'Senior FE', salary_min: 500000, salary_max: 800000, industry: '互联网' });
    expect(job.title).toBe('Senior FE');
    expect(jobs.findById(job.id)).toBeDefined();
  });

  it('createJob rejects when quota exhausted', () => {
    const employer1: any = { id: 'e1', user_type: 'employer' };
    for (let i = 0; i < 20; i++) employer.createJob(employer1, { title: `Job ${i}` });
    expect(() => employer.createJob(employer1, { title: 'overflow' })).toThrow(/quota/i);
  });
});
