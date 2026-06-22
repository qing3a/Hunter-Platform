// tests/integration/admin-strict-mode.test.ts
//
// Verifies that the 8 admin list endpoints in Phase 6 scope have `strict: true`
// on their `respond()` calls. Single-item admin endpoints (suspend, ping, etc.)
// are out of Phase 6 scope per the plan.
//
// Two angles:
//   1. Source-code contract: every LIST endpoint's `respond()` call passes
//      `{ strict: true }`. This guards against accidental removal during
//      future edits.
//   2. End-to-end smoke: clean rows return 200 (column projection prevents
//      leakage, so strict mode never needs to throw). The response shape
//      matches the schema (no PII, no secrets).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { freshApp, cleanupDb, ConformanceClient, adminAuthHeader } from './skill-md-conformance/_setup';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

// The 8 Phase 6 endpoints. Each must have { strict: true } on its respond().
const LIST_ENDPOINTS = [
  'dashboard/stats',
  'users',           // GET /v1/admin/users
  'candidates',
  'audit',
  'webhooks/dead-letter',
  'rate-limit/buckets',
  'placements',
  'admin-log',
];

describe('admin strict-mode contract (Phase 6 list endpoints)', () => {
  let app: import('express').Express;
  let dbPath: string;
  let client: ConformanceClient;
  let db: InstanceType<typeof DatabaseSync>;

  beforeAll(async () => {
    const f = await freshApp('strict-mode');
    app = f.app;
    dbPath = f.dbPath;
    client = new ConformanceClient(app);
    db = new DatabaseSync(dbPath);
  });
  afterAll(() => {
    db.close();
    cleanupDb('strict-mode');
  });

  it('every Phase 6 list-endpoint respond() call passes { strict: true }', () => {
    const adminRoutePath = path.join(__dirname, '..', '..', 'src', 'main', 'routes', 'admin.ts');
    const src = fs.readFileSync(adminRoutePath, 'utf8');
    // Find the router.get() block for each endpoint and verify its respond() has strict:true.
    const violations: string[] = [];
    for (const ep of LIST_ENDPOINTS) {
      // Pattern: router.METHOD('/endpoint', ... { ... respond(res, ..., { strict: true }) ... });
      const epEsc = ep.replace(/\//g, '\\/');
      const re = new RegExp(
        `router\\.\\w+\\(['"]\\/${epEsc}['"],[\\s\\S]*?respond\\(res,[\\s\\S]*?\\}\\s*,\\s*\\{\\s*strict:\\s*true\\s*\\}\\s*\\)`,
      );
      if (!re.test(src)) {
        violations.push(ep);
      }
    }
    expect(violations).toEqual([]);
  });

  it('clean users list returns 200 with the UserPublicSchema shape (no PII, no secrets)', async () => {
    db.prepare("INSERT OR IGNORE INTO users (id, user_type, name, api_key_hash, api_key_prefix, quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at) VALUES ('strict_clean_user', 'candidate', 'CleanT', 'hash2', 'prefix2', 100, 0, '2026-06-22T00:00:00Z', 50, 'active', '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z')").run();
    const r = await client.request({ method: 'GET', path: '/v1/admin/users', auth: adminAuthHeader() });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.data)).toBe(true);
    const first = r.data.data[0];
    if (first) {
      expect(Object.keys(first).sort()).toEqual([
        'created_at', 'id', 'name', 'quota_per_day', 'quota_reset_at',
        'quota_used', 'reputation', 'status', 'user_type',
      ]);
    }
  });
});


