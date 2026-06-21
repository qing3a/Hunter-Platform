import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient, adminAuthHeader } from './_setup';
import { PingResponseSchema, ListUsersResponseSchema } from '../../../src/main/schemas/admin';

describe('skill.md: admin endpoints', () => {
  let client: ConformanceClient;

  beforeAll(async () => {
    const f = await freshApp('admin');
    client = new ConformanceClient(f.app);
    // Register some users so admin endpoints have data
    await client.register('headhunter', 'H1', 'h1@x.com');
    await client.register('employer', 'E1', 'e1@x.com');
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
    const key = await client.register('headhunter', 'WrongUser', 'w@x.com');
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
});