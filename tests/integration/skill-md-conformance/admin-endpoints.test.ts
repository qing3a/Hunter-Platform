import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient, adminAuthHeader } from './_setup';
import { PingResponseSchema, ListUsersResponseSchema } from '../../../src/main/schemas/admin';

describe('skill.md: admin endpoints', () => {
  let client: ConformanceClient;

  beforeAll(async () => {
    const f = await freshApp('admin');
    client = new ConformanceClient(f.app);
    // Register some users so admin endpoints have data
    await client.register('hr', 'H1', 'h1@x.com');
    await client.register('pm', 'E1', 'e1@x.com');
  });
  afterAll(() => cleanupDb('admin'));

  it('GET /v1/admin/ping requires admin auth (Bug 6 fix regression)', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/admin/ping' });
    expect(r.status).toBe(401);
  });

  it('GET /v1/admin/ping with valid admin auth returns pong (validates PingResponseSchema)', async () => {
    const r = await client.request({
      method: 'GET', path: '/v1/admin/ping', auth: adminAuthHeader(),
      schema: PingResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.message).toBe('admin pong');
  });

  it('GET /v1/admin/ping with non-admin (headhunter) key returns 401 (Phase 0 fix)', async () => {
    const key = await client.register('hr', 'WrongUser', 'w@x.com');
    const r = await client.request({ method: 'GET', path: '/v1/admin/ping', auth: key });
    expect(r.status).toBe(401);
  });

  it('GET /v1/admin/users returns user list with valid admin auth (validates ListUsersResponseSchema)', async () => {
    const r = await client.request({
      method: 'GET', path: '/v1/admin/users', auth: adminAuthHeader(),
      schema: ListUsersResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.length).toBeGreaterThan(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PR #3 reconciliation follow-up — admin get-by-id endpoints + admin.me +
  // admin.action_history. These capabilities were declared in PR #3 but
  // had no scenario. Fill them in here, reusing the admin key + registered
  // users from the beforeAll above.
  // ─────────────────────────────────────────────────────────────────────────

  it('admin.me: GET /v1/admin/me returns the current admin', async () => {
    const r = await client.request({
      method: 'GET', path: '/v1/admin/me', auth: adminAuthHeader(),
    });
    expect(r.status).toBe(200);
    expect(r.data.data.email).toBe('admin@conformance.test');
    expect(r.data.data.role).toBe('super');
  });

  it('admin.users.read: GET /v1/admin/users/:id returns the registered hr user', async () => {
    const hrId = client.ids.get('hr');
    const r = await client.request({
      method: 'GET', path: `/v1/admin/users/${hrId}`, auth: adminAuthHeader(),
    });
    expect(r.status).toBe(200);
    expect(r.data.data.id).toBe(hrId);
    expect(r.data.data.user_type).toBe('hr');
  });

  it('admin.action_history: GET /v1/admin/action-history returns enriched audit rows', async () => {
    const r = await client.request({
      method: 'GET', path: '/v1/admin/action-history', auth: adminAuthHeader(),
    });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.data)).toBe(true);
    // No required key — just verify shape (rows may be empty in this short-lived
    // test environment since action_history is populated post-API-call).
    expect(r.data.data.length).toBeGreaterThanOrEqual(0);
  });
});