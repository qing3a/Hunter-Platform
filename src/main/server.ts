import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { openDb } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import { loadEnv } from './env.js';
import { ApiError } from './errors.js';
import { createAuthRouter } from './routes/auth.js';
import { createHeadhunterRouter } from './routes/headhunter.js';

export function createApp(): Express {
  const env = loadEnv();
  const db = openDb(env.DATABASE_PATH);
  runMigrations(db);

  const app = express();
  app.use(express.json({ limit: '4kb' }));

  // Routes
  app.get('/v1/health', (_req, res) => {
    res.json({ ok: true, data: { status: 'healthy', timestamp: new Date().toISOString() } });
  });

  app.use('/v1/auth', createAuthRouter(db, env.NODE_ENV === 'production'));
  app.use('/v1/headhunter', createHeadhunterRouter(db, env.PLATFORM_ENCRYPTION_KEY));

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
