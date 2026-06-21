import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient } from './_setup';

describe('skill.md: config public endpoints (scenario 0b)', () => {
  let client: ConformanceClient;

  beforeAll(async () => {
    const f = await freshApp('config');
    client = new ConformanceClient(f.app);
  });
  afterAll(() => cleanupDb('config'));

  it('GET /v1/config/industries returns industry list (public)', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/config/industries' });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.data) || typeof r.data.data === 'object').toBe(true);
  });

  it('GET /v1/config/title_levels returns title levels (public)', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/config/title_levels' });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.data) || typeof r.data.data === 'object').toBe(true);
  });

  it('GET /v1/config/salary_bands returns salary ranges (public)', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/config/salary_bands' });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.data) || typeof r.data.data === 'object').toBe(true);
  });
});