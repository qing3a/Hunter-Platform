import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('admin:dashboard:getStats', () => {
  const testDb = path.join(__dirname, '../../../tmp/dash.db');
  let db: any, users: any, jobs: any, webhooks: any;
  let getStats: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { openDb } = await import('../../../src/main/db/connection');
    const { runMigrations } = await import('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    users = (await import('../../../src/main/db/repositories/users')).createUsersRepo(db);
    jobs = (await import('../../../src/main/db/repositories/jobs')).createJobsRepo(db);
    webhooks = (await import('../../../src/main/db/repositories/webhook-delivery-queue')).createWebhookQueueRepo(db);
    const { makeDashboardIpc } = await import('../../../src/main/ipc/dashboard');
    ({ getStats } = makeDashboardIpc(db));

    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'h1', user_type: 'headhunter', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 5, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    jobs.insert({ id: 'j1', employer_id: 'e1', title: 'A', description: null, requirements: null, salary_min: null, salary_max: null, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
    webhooks.enqueue({ target_user_id: 'e1', event_type: 'deliver_contact', payload_enc: 'x', contains_pii: 0, max_attempts: 1 });
    db.prepare("UPDATE webhook_delivery_queue SET status = 'dead_letter', attempt_count = 1, next_retry_at = NULL WHERE id = 1").run();
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('returns aggregate stats', () => {
    const stats = getStats();
    expect(stats.users.total).toBe(2);
    expect(stats.users.headhunter).toBe(1);
    expect(stats.users.employer).toBe(1);
    expect(stats.jobs.open).toBe(1);
    expect(stats.webhooks.dead_letter).toBe(1);
  });
});