// tests/integration/examples-agent-quickstart.test.ts
//
// Smoke test for examples/agent-quickstart.ts. Boots an in-process
// server with a fresh ephemeral DB, calls runQuickstart() with an
// explicit baseUrl, asserts happy-path completion.
//
// Skipped against a remote HUNTER_BASE — we don't want to leak
// integration state into a real deployment.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REMOTE_BASE = process.env.HUNTER_BASE;

let server: any;
let testDb: string;
let baseUrl: string;

const setupInProcess = async () => {
  testDb = path.join(__dirname, '../../tmp/quickstart-smoke.db');
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(testDb + ext); } catch {}
  }
  process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
  process.env.WEBHOOK_HMAC_SECRET    = 'test-secret-1234567890';
  process.env.NODE_ENV               = 'test';
  process.env.DATABASE_PATH          = testDb;

  const { createApp } = await import('../../src/main/server');
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as any).port;
  baseUrl = `http://localhost:${port}`;
};

const teardownInProcess = () => {
  if (server) {
    server.close();
    server = null;
  }
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(testDb + ext); } catch {}
  }
};

(REMOTE_BASE ? describe.skip : describe)('examples/agent-quickstart.ts (in-process smoke)', () => {
  beforeAll(setupInProcess, 30_000);
  afterAll(teardownInProcess);

  it('completes the 8-step happy path', async () => {
    const { runQuickstart } = await import('../../examples/agent-quickstart.js');
    await runQuickstart({ baseUrl, quiet: true });
  }, 60_000);
});


