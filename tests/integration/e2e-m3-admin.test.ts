import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

describe('M3 E2E: Admin dashboard + actions', () => {
  const testDb = path.join(__dirname, '../../tmp/e2e-m3.db');
  let db: any, dashboardIpc: any, usersIpc: any, webhooksIpc: any;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    const { makeDashboardIpc } = await import('../../src/main/ipc/dashboard');
    const { createUsersIpc } = await import('../../src/main/ipc/users');
    const { createWebhooksIpc } = await import('../../src/main/ipc/webhooks');
    dashboardIpc = makeDashboardIpc(db);
    usersIpc = createUsersIpc(db);
    webhooksIpc = createWebhooksIpc(db);
    const users = (await import('../../src/main/db/repositories/users')).createUsersRepo(db);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'h1', user_type: 'headhunter', name: 'H1', contact: null, agent_endpoint: null, api_key_hash: 'h1', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 50, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'h2', user_type: 'headhunter', name: 'H2', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    db.prepare("INSERT INTO webhook_delivery_queue (target_user_id, event_type, payload_enc, contains_pii, status, attempt_count, max_attempts, created_at, updated_at) VALUES (?, ?, ?, ?, 'dead_letter', 3, 3, ?, ?)").run('h1', 'notify_unlock_request', 'x', 0, now, now);
  });
  afterAll(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('dashboard returns aggregate stats', () => {
    const stats = dashboardIpc.getStats();
    expect(stats.users.headhunter).toBe(2);
    expect(stats.webhooks.dead_letter).toBe(1);
  });

  it('admin flow: suspend user, see in list with new status', () => {
    usersIpc.suspend('h1', 'policy violation');
    const list = usersIpc.list({ status: 'suspended' }) as any[];
    expect(list.some((u) => u.id === 'h1' && u.status === 'suspended')).toBe(true);
  });

  it('admin flow: list dead letter, retry, status → pending', () => {
    const dl = webhooksIpc.listDeadLetter() as any[];
    expect(dl.length).toBe(1);
    const target = dl[0];
    const result = webhooksIpc.retry(target.id);
    expect(result.status).toBe('pending');
  });
});