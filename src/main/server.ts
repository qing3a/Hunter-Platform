import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import http from 'node:http';
import { openDb } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import { loadEnv } from './env.js';
import { ApiError } from './errors.js';
import { createAuthRouter } from './routes/auth.js';
import { createHeadhunterRouter } from './routes/headhunter.js';
import { createEmployerRouter } from './routes/employer.js';
import { createCandidateRouter } from './routes/candidate.js';
import { createWebhookWorker } from './modules/webhook/worker.js';
import type { DB } from './db/connection.js';

/**
 * Build the Express app from an already-opened DB + env.
 * Shared by createApp() and startApiServer().
 */
export function createAppFromDb(db: DB, env: ReturnType<typeof loadEnv>): Express {
  const app = express();
  app.use(express.json({ limit: '4kb' }));

  // Routes
  app.get('/v1/health', (_req, res) => {
    res.json({ ok: true, data: { status: 'healthy', timestamp: new Date().toISOString() } });
  });

  app.use('/v1/auth', createAuthRouter(db, env.NODE_ENV === 'production'));
  app.use('/v1/headhunter', createHeadhunterRouter(db, env.PLATFORM_ENCRYPTION_KEY));
  app.use('/v1/employer', createEmployerRouter(db, env.PLATFORM_ENCRYPTION_KEY));
  app.use('/v1/candidate', createCandidateRouter(db));

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({
        ok: false,
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  return app;
}

/**
 * Convenience for tests (supertest) — opens its own DB.
 */
export function createApp(): Express {
  const env = loadEnv();
  const db = openDb(env.DATABASE_PATH);
  runMigrations(db);
  return createAppFromDb(db, env);
}

/**
 * Background webhook worker — polls every 5s.
 */
function startWebhookWorkerBackground(db: DB, env: ReturnType<typeof loadEnv>): void {
  const worker = createWebhookWorker(db);
  const tick = () => {
    worker.processBatch(env.PLATFORM_ENCRYPTION_KEY, { hmacSecret: env.WEBHOOK_HMAC_SECRET })
      .catch((err) => console.error('Webhook worker error:', err));
  };
  setInterval(tick, 5_000);
  // Fire one quickly so dev mode isn't waiting 5s on first boot
  setTimeout(tick, 500).unref();
}

/**
 * Standalone API server — used by:
 * - `pnpm api:dev` (tsx src/main/index.ts → shouldStartApiStandalone() === true)
 * - Electron main (hybrid mode: API + BrowserWindow)
 */
export async function startApiServer(opts: { port?: number } = {}): Promise<http.Server> {
  const env = loadEnv();
  const db = openDb(env.DATABASE_PATH);
  runMigrations(db);

  const app = createAppFromDb(db, env);
  startWebhookWorkerBackground(db, env);

  return new Promise((resolve) => {
    const server = app.listen(opts.port ?? env.PORT, () => {
      console.log(`Hunter platform API listening on port ${opts.port ?? env.PORT}`);
      resolve(server);
    });
  });
}