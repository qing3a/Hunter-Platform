import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('env', () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = originalEnv; });

  it('loads required env vars', async () => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuv';
    process.env.DATABASE_PATH = './data/test.db';
    process.env.NODE_ENV = 'test';

    const { loadEnv } = await import('../../src/main/env');
    const env = loadEnv();
    expect(env.PLATFORM_ENCRYPTION_KEY).toBeInstanceOf(Buffer);
    expect(env.PLATFORM_ENCRYPTION_KEY.length).toBe(32);
  });

  it('throws when PLATFORM_ENCRYPTION_KEY missing', async () => {
    delete process.env.PLATFORM_ENCRYPTION_KEY;
    const { loadEnv } = await import('../../src/main/env');
    expect(() => loadEnv()).toThrow(/PLATFORM_ENCRYPTION_KEY/);
  });
});
