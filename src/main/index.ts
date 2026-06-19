/**
 * Hunter Platform — API entry point.
 *
 * API-only mode. External AI agents connect directly to the HTTP API
 * (see docs/superpowers/skill.md). No desktop client is bundled.
 *
 * Boot order:
 *  1. `loadEnv()`            — read DATABASE_PATH / ENCRYPTION_KEY / etc.
 *  2. `startApiServer()`     — bind HTTP port, start cron + webhook worker
 *  3. SIGINT/SIGTERM handler — graceful shutdown
 */
import { startApiServer } from './server.js';
import { loadEnv } from './env.js';

/**
 * Test-environment guard. When this module is imported by vitest, do NOT
 * fire side effects (port bind, cron start). Tests that need the
 * full stack should call `startApiServer()` directly with a test DB.
 */
function isTestEnv(): boolean {
  return process.env.VITEST === 'true'
      || process.env.VITEST_WORKER_ID !== undefined
      || process.env.NODE_ENV === 'test';
}

export async function main(): Promise<void> {
  if (isTestEnv()) return;

  const env = loadEnv();
  console.log('[hunter-platform] starting in API-only mode (HTTP only, no desktop client)');
  const server = await startApiServer({ port: env.PORT });
  console.log(`Hunter platform API listening on port ${env.PORT}`);

  const shutdown = (signal: string) => {
    console.log(`[hunter-platform] received ${signal}, shutting down...`);
    server.close(() => process.exit(0));
    // Hard exit if close hangs (e.g. stuck DB connection)
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Auto-run when invoked as the entry point (tsx / node). The isTestEnv
// guard above keeps side effects off when imported by vitest.
void main().catch((err) => {
  console.error('main() failed:', err);
  process.exit(1);
});