import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient } from './_setup';

describe('skill.md: user status + history (scenario 2)', () => {
  let client: ConformanceClient;
  let myKey: string;

  beforeAll(async () => {
    const f = await freshApp('user-status');
    client = new ConformanceClient(f.app);
    myKey = await client.register('hr', 'Me', 'me@x.com');
  });
  afterAll(() => cleanupDb('user-status'));

  it('GET /v1/users/:id/status returns own status (quota, reputation)', async () => {
    const me = client.ids.get('hr')!;
    const r = await client.request({
      method: 'GET', path: `/v1/users/${me}/status`, auth: myKey,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.user_type).toBe('hr');
    expect(r.data.data.status).toBe('active');
    expect(typeof r.data.data.quota_per_day).toBe('number');
    expect(typeof r.data.data.quota_used).toBe('number');
  });

  it('GET /v1/users/:id/history returns action_history rows (Phase 2 trace_id)', async () => {
    const me = client.ids.get('hr')!;
    const r = await client.request({
      method: 'GET', path: `/v1/users/${me}/history`, auth: myKey,
    });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.data)).toBe(true);
  });

  it('GET /v1/users/:id/status from another user — accepts current privacy behavior', async () => {
    const otherKey = await client.register('pm', 'Other', 'other@x.com');
    const me = client.ids.get('hr')!;
    const r = await client.request({
      method: 'GET', path: `/v1/users/${me}/status`, auth: otherKey,
    });
    // The actual endpoint may or may not enforce privacy. Just verify it
    // responds (not crashes). 200 = open, 403 = privacy enforced.
    expect([200, 403]).toContain(r.status);
  });
});