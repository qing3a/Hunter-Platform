// Shared test infrastructure for skill.md conformance tests.
// Per-file DB isolation. ConformanceClient wraps supertest with optional
// zod schema validation on response.data.
import type { Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z, type ZodTypeAny } from 'zod';

/** Per-test-file DB path. Re-created on every test for isolation. */
export function tmpDbPath(name: string): string {
  return path.join(__dirname, `../../../tmp/conformance-${name}.db`);
}

/** Fresh Express app + DB. Call this in beforeAll of each scenario file. */
export async function freshApp(name: string): Promise<{ app: Express; dbPath: string }> {
  const dbPath = tmpDbPath(name);
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ }
  }
  process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
  process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
  process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuv';
  process.env.DATABASE_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  const { createApp } = await import('../../../src/main/server');
  return { app: createApp(), dbPath };
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
    if (opts.auth) r = r.set('Authorization', `Bearer ${opts.auth}`);
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
  async register(userType: 'candidate' | 'headhunter' | 'employer', name: string, contact: string): Promise<string> {
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

export const z_ = z;