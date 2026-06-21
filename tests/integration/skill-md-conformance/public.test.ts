import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient } from './_setup';

describe('skill.md: public endpoints (scenario 0)', () => {
  let app: import('express').Express;
  let client: ConformanceClient;

  beforeAll(async () => {
    const f = await freshApp('public');
    app = f.app;
    client = new ConformanceClient(app);
  });
  afterAll(() => cleanupDb('public'));

  it('GET /v1/health returns healthy', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/health' });
    expect(r.status).toBe(200);
    expect(r.data.data.status).toBe('healthy');
  });

  it('GET /v1/health response has x-trace-id header (Phase 2)', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/health' });
    expect(r.headers['x-trace-id']).toMatch(/^[0-9a-f]{32}$/);
  });

  it('GET /v1/skill.md returns skill.md content', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/skill.md' });
    expect(r.status).toBe(200);
    expect(r.raw).toContain('Hunter Platform');
  });

  it('GET /v1/openapi.json returns OpenAPI 3 spec', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/openapi.json' });
    expect(r.status).toBe(200);
    expect(r.data.openapi ?? r.data.swagger).toBeDefined();
  });

  it('GET /metrics returns Prometheus format', async () => {
    const r = await client.request({ method: 'GET', path: '/metrics' });
    expect(r.status).toBe(200);
    expect(r.raw).toContain('# HELP');
  });

  it('GET /v1/health does NOT set x-capability-name (no capability declared for it)', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/health' });
    expect(r.headers['x-capability-name']).toBeUndefined();
  });
});