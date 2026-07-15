// Shared test infrastructure for skill.md conformance tests.
// Per-file DB isolation. ConformanceClient wraps supertest with optional
// zod schema validation on response.data.
import type { Express } from 'express';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { z, type ZodTypeAny } from 'zod';

const nodeRequire = createRequire(import.meta.url);
const bcrypt = nodeRequire('bcryptjs') as typeof import('bcryptjs');

/** Plaintext admin password for the test environment. Used by freshApp() to
 *  seed an admin in the admin_users table and then log in to obtain a real
 *  api_key (the legacy shared ADMIN_PASSWORD_HASH is deprecated in v1.5). */
export const ADMIN_PLAINTEXT = 'admin-test-password-1234567890';
export const ADMIN_EMAIL = 'admin@conformance.test';

/** Cached admin api_key for the most recent freshApp() call. adminAuthHeader()
 *  returns `Bearer <this>`. Reset on each freshApp(). */
let cachedAdminApiKey: string | null = null;

/** Per-test-file DB path. Re-created on every test for isolation. */
export function tmpDbPath(name: string): string {
  return path.join(__dirname, `../../../tmp/conformance-${name}.db`);
}

/** Fresh Express app + open DB handle + DB path. Call this in beforeAll of each scenario file.
 *  Returned `db` is an open node:sqlite DatabaseSync — tests that simulate
 *  failures (e.g. closing the DB to provoke a 500) can use it directly. */
export async function freshApp(name: string): Promise<{ app: Express; dbPath: string; db: import('../../../src/main/db/connection.js').DB }> {
  const dbPath = tmpDbPath(name);
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ }
  }
  process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
  process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
  process.env.ADMIN_PASSWORD_HASH = 'DEPRECATED'; // legacy env var — code no longer reads it
  process.env.DATABASE_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  // Skill.md §5.6: kill switch — `RATE_LIMIT_ENABLED=false` disables BOTH the
  // per-user sliding window + the IP rate-limit on /v1/auth/register
  // (5/h). Conformance test files register multiple users in beforeAll
  // without honoring the 5/h limit; turning it off keeps the suite green.
  // Production impact: none (test-only env var).
  process.env.RATE_LIMIT_ENABLED = 'false';

  // Use the createAppFromDb pattern (matches tests/integration/admin-endpoints.test.ts).
  // Going through createApp() also works, but using the lower-level path lets us
  // keep the open DB connection so the trace.test.ts can query action_history.
  const { createAppFromDb } = await import('../../../src/main/server.js');
  const { openDb } = await import('../../../src/main/db/connection.js');
  const { runMigrations } = await import('../../../src/main/db/migrations.js');
  const { loadEnv } = await import('../../../src/main/env.js');
  const db = openDb(dbPath);
  runMigrations(db);
  const app = createAppFromDb(db, loadEnv());

  // Seed a known admin and log in to obtain the real api_key (Sub-A auth).
  // Use INSERT OR IGNORE so re-running this file (or running it after a
  // previous run left a DB handle behind) doesn't blow up on UNIQUE(email).
  const pwdHash = bcrypt.hashSync(ADMIN_PLAINTEXT, 4);
  const keyHash = bcrypt.hashSync('hp_admin_conformancekey', 4);
  db.prepare(`INSERT OR IGNORE INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'adm_conformance', 'Conformance Admin', ADMIN_EMAIL, pwdHash, keyHash, 'hp_admin_confor', 'super', 'active',
    '2026-06-23T00:00:00Z', '2026-06-23T00:00:00Z'
  );
  const supertest = (await import('supertest')).default;
  const loginResp = await supertest(app).post('/v1/admin/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PLAINTEXT });
  if (loginResp.status !== 200) {
    throw new Error(`freshApp: admin login failed: ${loginResp.status} ${JSON.stringify(loginResp.body)}`);
  }
  cachedAdminApiKey = loginResp.body.data.api_key as string;

  return { app, dbPath, db };
}

/** Clean up a DB after a test. */
export function cleanupDb(name: string): void {
  const dbPath = tmpDbPath(name);
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ }
  }
}

/**
 * Lightweight client that:
 *   - tracks all API keys registered (for cross-scenario use)
 *   - tracks all created user IDs / resources
 *   - validates response `data` field against an optional zod schema
 */
export class ConformanceClient {
  keys = new Map<string, string>();  // user_type → api_key
  ids = new Map<string, string>();    // logical name → id
  resources = new Map<string, unknown>();

  constructor(public app: Express) {}

  async request(opts: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    auth?: string;
    body?: unknown;
    schema?: ZodTypeAny;       // optional: validate response.data
  }): Promise<{ status: number; headers: Record<string, string>; data: any; raw: string }> {
    const supertest = (await import('supertest')).default;
    let r = supertest(this.app)[opts.method.toLowerCase()](opts.path);
    if (opts.auth) {
      // adminAuthHeader() already includes "Bearer " prefix; otherwise prepend it.
      const headerValue = opts.auth.startsWith('Bearer ') ? opts.auth : `Bearer ${opts.auth}`;
      r = r.set('Authorization', headerValue);
    }
    if (opts.body !== undefined) r = r.send(opts.body);
    r = r.set('Accept', 'application/json');
    const res = await r;
    const raw = res.text ?? '';
    let data: any = null;
    try { data = res.body; } catch { data = null; }

    // Schema validation — schema is the full envelope shape (e.g. EnvelopeSchema(z.object({...})))
    if (opts.schema && data && data.ok) {
      const result = opts.schema.safeParse(data);
      if (!result.success) {
        throw new Error(
          `Schema mismatch at ${opts.method} ${opts.path}:\n` +
          result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
        );
      }
      data = result.data;  // replace with parsed (strips unknown fields by default)
    }

    return {
      status: res.status,
      headers: res.headers as Record<string, string>,
      data,
      raw,
    };
  }

  /** Register a user, return api_key. */
  async register(userType: 'candidate' | 'hr' | 'pm', name: string, contact: string): Promise<string> {
    const r = await this.request({
      method: 'POST',
      path: '/v1/auth/register',
      body: { user_type: userType, name, contact },
    });
    if (r.status !== 200) throw new Error(`register failed: ${r.status} ${r.raw}`);
    const key = r.data.data.api_key as string;
    this.keys.set(userType, key);
    this.ids.set(userType, r.data.data.id);
    return key;
  }
}

/** Admin endpoints require Bearer <admin_api_key> (Sub-A: per-admin api_key
 *  auth). The api_key is obtained by logging in during freshApp() and cached
 *  for the lifetime of the test file. */
export function adminAuthHeader(): string {
  if (!cachedAdminApiKey) {
    throw new Error('adminAuthHeader: no admin api_key cached — call freshApp() first');
  }
  return `Bearer ${cachedAdminApiKey}`;
}

export const z_ = z;