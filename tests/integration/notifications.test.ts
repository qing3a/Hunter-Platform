import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';

describe('notifications HTTP endpoints', () => {
  const testDb = path.join(__dirname, '../../tmp/notif_http.db');
  let app: any;
  let localDb: any;
  let users: any;
  let notifs: any;
  let u1Key: string, u2Key: string;
  const NOW = '2026-06-24T10:00:00.000Z';

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    try { fs.unlinkSync(testDb + '-wal'); } catch {}
    try { fs.unlinkSync(testDb + '-shm'); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    process.env.RATE_LIMIT_ENABLED = 'false';

    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { createAppFromDb } = await import('../../src/main/server');
    const { loadEnv } = await import('../../src/main/env');
    const { createUsersRepo } = await import('../../src/main/db/repositories/users');
    const { createNotificationsRepo } = await import('../../src/main/db/repositories/notifications');
    const { generateApiKey } = await import('../../src/main/modules/auth/api-key');

    localDb = openDb(testDb);
    runMigrations(localDb);
    app = createAppFromDb(localDb, loadEnv());
    users = createUsersRepo(localDb);
    notifs = createNotificationsRepo(localDb);

    const k1 = generateApiKey();
    const k2 = generateApiKey();
    u1Key = k1.key;
    u2Key = k2.key;
    users.insert({ id: 'u1', user_type: 'headhunter', name: 'u1', contact: null, agent_endpoint: null, api_key_hash: k1.hash, api_key_prefix: k1.prefix, quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-25T00:00:00.000Z', reputation: 50, status: 'active', created_at: NOW, updated_at: NOW });
    users.insert({ id: 'u2', user_type: 'employer', name: 'u2', contact: null, agent_endpoint: null, api_key_hash: k2.hash, api_key_prefix: k2.prefix, quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-25T00:00:00.000Z', reputation: 50, status: 'active', created_at: NOW, updated_at: NOW });
  });

  afterAll(() => {
    try { if (localDb) localDb.close(); } catch {}
  });

  beforeEach(() => {
    // Clean notifications between tests (don't touch users)
    localDb.prepare('DELETE FROM notifications').run();
  });

  // --- GET /v1/notifications ---

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/v1/notifications');
    expect(res.status).toBe(401);
  });

  it('returns 200 with empty list when no notifications', async () => {
    const res = await request(app).get('/v1/notifications').set('Authorization', `Bearer ${u1Key}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.unread_count).toBe(0);
  });

  it('returns user own notifications only', async () => {
    notifs.insert({ user_id: 'u1', category: 'a', title: 'u1', created_at: NOW });
    notifs.insert({ user_id: 'u2', category: 'a', title: 'u2', created_at: NOW });
    const res = await request(app).get('/v1/notifications').set('Authorization', `Bearer ${u1Key}`);
    expect(res.body.data.items.length).toBe(1);
    expect(res.body.data.items[0].title).toBe('u1');
  });

  it('filters by unread=true', async () => {
    const id1 = notifs.insert({ user_id: 'u1', category: 'a', title: 'unread', created_at: NOW });
    const id2 = notifs.insert({ user_id: 'u1', category: 'a', title: 'read', created_at: NOW });
    notifs.markRead(id2, 'u1', NOW);
    const res = await request(app).get('/v1/notifications?unread=true').set('Authorization', `Bearer ${u1Key}`);
    expect(res.body.data.items.length).toBe(1);
    expect(res.body.data.items[0].id).toBe(id1);
  });

  it('filters by since=ISO', async () => {
    notifs.insert({ user_id: 'u1', category: 'a', title: 'old', created_at: '2026-06-24T08:00:00.000Z' });
    const id2 = notifs.insert({ user_id: 'u1', category: 'a', title: 'new', created_at: '2026-06-24T09:30:00.000Z' });
    const res = await request(app).get('/v1/notifications?since=2026-06-24T09:00:00.000Z').set('Authorization', `Bearer ${u1Key}`);
    expect(res.body.data.items.length).toBe(1);
    expect(res.body.data.items[0].id).toBe(id2);
  });

  it('filters by category', async () => {
    notifs.insert({ user_id: 'u1', category: 'a', title: 'a', created_at: NOW });
    notifs.insert({ user_id: 'u1', category: 'b', title: 'b', created_at: NOW });
    const res = await request(app).get('/v1/notifications?category=a').set('Authorization', `Bearer ${u1Key}`);
    expect(res.body.data.items.length).toBe(1);
  });

  it('caps limit at 200', async () => {
    for (let i = 0; i < 250; i++) {
      notifs.insert({ user_id: 'u1', category: 'a', title: `t${i}`, created_at: NOW });
    }
    const res = await request(app).get('/v1/notifications?limit=500').set('Authorization', `Bearer ${u1Key}`);
    expect(res.body.data.items.length).toBe(200);
  });

  // --- GET /v1/notifications/:id ---

  it('returns own notification by id', async () => {
    const id = notifs.insert({ user_id: 'u1', category: 'a', title: 't', created_at: NOW });
    const res = await request(app).get(`/v1/notifications/${id}`).set('Authorization', `Bearer ${u1Key}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(id);
  });

  it('returns 404 for non-existent id', async () => {
    const res = await request(app).get('/v1/notifications/notif_doesnotexist').set('Authorization', `Bearer ${u1Key}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for other user notification', async () => {
    const id = notifs.insert({ user_id: 'u2', category: 'a', title: 't', created_at: NOW });
    const res = await request(app).get(`/v1/notifications/${id}`).set('Authorization', `Bearer ${u1Key}`);
    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/v1/notifications/notif_x');
    expect(res.status).toBe(401);
  });

  // --- POST /v1/notifications/:id/read ---

  it('marks own notification as read', async () => {
    const id = notifs.insert({ user_id: 'u1', category: 'a', title: 't', created_at: NOW });
    const res = await request(app).post(`/v1/notifications/${id}/read`).set('Authorization', `Bearer ${u1Key}`);
    expect(res.status).toBe(200);
    expect(notifs.findById(id)!.read_at).not.toBeNull();
  });

  it('returns 404 for other user notification', async () => {
    const id = notifs.insert({ user_id: 'u2', category: 'a', title: 't', created_at: NOW });
    const res = await request(app).post(`/v1/notifications/${id}/read`).set('Authorization', `Bearer ${u1Key}`);
    expect(res.status).toBe(404);
  });

  it('is idempotent on second call', async () => {
    const id = notifs.insert({ user_id: 'u1', category: 'a', title: 't', created_at: NOW });
    const r1 = await request(app).post(`/v1/notifications/${id}/read`).set('Authorization', `Bearer ${u1Key}`);
    const r2 = await request(app).post(`/v1/notifications/${id}/read`).set('Authorization', `Bearer ${u1Key}`);
    expect(r1.body.data.read_at).toBe(r2.body.data.read_at);
  });

  // --- POST /v1/notifications/read-all ---

  it('marks all unread as read', async () => {
    notifs.insert({ user_id: 'u1', category: 'a', title: 't1', created_at: NOW });
    notifs.insert({ user_id: 'u1', category: 'a', title: 't2', created_at: NOW });
    const res = await request(app).post('/v1/notifications/read-all').set('Authorization', `Bearer ${u1Key}`);
    expect(res.body.data.marked).toBe(2);
  });

  // --- DELETE /v1/notifications/:id ---

  it('deletes own notification', async () => {
    const id = notifs.insert({ user_id: 'u1', category: 'a', title: 't', created_at: NOW });
    const res = await request(app).delete(`/v1/notifications/${id}`).set('Authorization', `Bearer ${u1Key}`);
    expect(res.status).toBe(200);
    expect(notifs.findById(id)).toBeNull();
  });

  it('returns 404 for other user notification', async () => {
    const id = notifs.insert({ user_id: 'u2', category: 'a', title: 't', created_at: NOW });
    const res = await request(app).delete(`/v1/notifications/${id}`).set('Authorization', `Bearer ${u1Key}`);
    expect(res.status).toBe(404);
  });
});
