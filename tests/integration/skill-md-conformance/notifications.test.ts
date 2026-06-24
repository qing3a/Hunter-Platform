// Conformance tests for the 4 notification capabilities (v1.9.0):
//   - notifications.list
//   - notifications.mark_read
//   - notifications.mark_all_read
//   - notifications.delete
// These are accessible to all 3 user roles (candidate, headhunter, employer).
// Tests verify HTTP shape, response envelope, and basic CRUD semantics —
// internal dedup/timing/cleanup logic is covered by tests/unit/notification/.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient } from './_setup.js';

describe('notifications conformance (v1.9.0)', () => {
  let app: any;
  let dbPath: string;
  let db: any;
  let client: ConformanceClient;
  let otherClient: ConformanceClient;
  let userKey: string;
  let otherKey: string;
  let userId: string;
  let otherId: string;
  const NOW = '2026-06-24T10:00:00.000Z';

  beforeAll(async () => {
    const ctx = await freshApp('notifications');
    app = ctx.app;
    dbPath = ctx.dbPath;
    db = ctx.db;
    client = new ConformanceClient(app);
    otherClient = new ConformanceClient(app);

    userKey = await client.register('headhunter', 'Alice', 'alice@x.com');
    otherKey = await otherClient.register('headhunter', 'Bob', 'bob@x.com');
    userId = client.ids.get('headhunter')!;
    otherId = otherClient.ids.get('headhunter')!;

    // Seed 3 notifications for Alice (mix of read/unread) and 1 for Bob.
    db.prepare(`INSERT INTO notifications (id, user_id, category, title, body, payload_json, read_at, created_at, expires_at, dedup_key)
                VALUES ('notif_a1', ?, 'unlock_granted', 'E unlocked you', NULL, NULL, NULL, ?, '2026-07-24T10:00:00.000Z', NULL)`).run(userId, NOW);
    db.prepare(`INSERT INTO notifications (id, user_id, category, title, body, payload_json, read_at, created_at, expires_at, dedup_key)
                VALUES ('notif_a2', ?, 'commission_paid', '$500 paid', NULL, NULL, ?, ?, '2026-07-24T10:00:00.000Z', NULL)`).run(userId, NOW, NOW);
    db.prepare(`INSERT INTO notifications (id, user_id, category, title, body, payload_json, read_at, created_at, expires_at, dedup_key)
                VALUES ('notif_a3', ?, 'candidate_viewed', 'Employer viewed resume', NULL, NULL, NULL, ?, '2026-07-24T10:00:00.000Z', NULL)`).run(userId, NOW);
    db.prepare(`INSERT INTO notifications (id, user_id, category, title, body, payload_json, read_at, created_at, expires_at, dedup_key)
                VALUES ('notif_b1', ?, 'unlock_granted', 'Bob unlock', NULL, NULL, NULL, ?, '2026-07-24T10:00:00.000Z', NULL)`).run(otherId, NOW);
  });

  afterAll(() => { cleanupDb('notifications'); });

  // ----- notifications.list -----

  it('notifications.list: GET /v1/notifications returns only own rows + unread_count', async () => {
    const res = await client.request({ method: 'GET', path: '/v1/notifications', auth: userKey });
    expect(res.status).toBe(200);
    expect(res.data.ok).toBe(true);
    expect(Array.isArray(res.data.data.items)).toBe(true);
    expect(res.data.data.items.length).toBe(3);
    for (const item of res.data.data.items) {
      expect(['notif_a1', 'notif_a2', 'notif_a3']).toContain(item.id);
    }
    // Alice has 2 unread (a1, a3); a2 is read
    expect(res.data.data.unread_count).toBe(2);
  });

  it('notifications.list: unread=true filters out read rows', async () => {
    const res = await client.request({ method: 'GET', path: '/v1/notifications?unread=true', auth: userKey });
    expect(res.status).toBe(200);
    expect(res.data.data.items.length).toBe(2);
    expect(res.data.data.items.map((i: any) => i.id).sort()).toEqual(['notif_a1', 'notif_a3']);
  });

  it('notifications.list: 401 without auth', async () => {
    const res = await client.request({ method: 'GET', path: '/v1/notifications' });
    expect(res.status).toBe(401);
  });

  // ----- notifications.mark_read -----

  it('notifications.mark_read: POST /v1/notifications/:id/read marks own notification as read', async () => {
    const res = await client.request({ method: 'POST', path: '/v1/notifications/notif_a1/read', auth: userKey });
    expect(res.status).toBe(200);
    expect(res.data.data.id).toBe('notif_a1');
    expect(res.data.data.read_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('notifications.mark_read: 404 for other user notification (no cross-user write)', async () => {
    const res = await client.request({ method: 'POST', path: '/v1/notifications/notif_b1/read', auth: userKey });
    expect(res.status).toBe(404);
  });

  it('notifications.mark_read: idempotent — second call returns same read_at', async () => {
    const r1 = await client.request({ method: 'POST', path: '/v1/notifications/notif_a3/read', auth: userKey });
    const r2 = await client.request({ method: 'POST', path: '/v1/notifications/notif_a3/read', auth: userKey });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.data.data.read_at).toBe(r2.data.data.read_at);
  });

  // ----- notifications.mark_all_read -----

  it('notifications.mark_all_read: POST /v1/notifications/read-all marks all unread', async () => {
    // Insert a fresh unread row to make the count non-zero
    db.prepare(`INSERT INTO notifications (id, user_id, category, title, body, payload_json, read_at, created_at, expires_at, dedup_key)
                VALUES ('notif_a4', ?, 'unlock_granted', 'E2', NULL, NULL, NULL, ?, '2026-07-24T10:00:00.000Z', NULL)`).run(userId, NOW);
    const res = await client.request({ method: 'POST', path: '/v1/notifications/read-all', auth: userKey });
    expect(res.status).toBe(200);
    expect(res.data.data.marked).toBeGreaterThanOrEqual(1);
  });

  // ----- notifications.delete -----

  it('notifications.delete: DELETE /v1/notifications/:id removes own notification', async () => {
    const res = await client.request({ method: 'DELETE', path: '/v1/notifications/notif_a2', auth: userKey });
    expect(res.status).toBe(200);
    expect(res.data.data.id).toBe('notif_a2');
  });

  it('notifications.delete: 404 for other user notification (no cross-user delete)', async () => {
    const res = await client.request({ method: 'DELETE', path: '/v1/notifications/notif_b1', auth: userKey });
    expect(res.status).toBe(404);
  });
});
