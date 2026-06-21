import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { startTelemetry, shutdownTelemetry, traceContextMiddleware } from './telemetry.js';
import { capabilityResolverMiddleware } from './middleware/capability-resolver.js';
import { openDb } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import { loadEnv } from './env.js';
import { MAX_BODY_SIZE, BODY_LIMIT_LARGE } from '../shared/constants.js';
import { ApiError } from './errors.js';
import { createAuthRouter } from './routes/auth.js';
import { createHeadhunterRouter } from './routes/headhunter.js';
import { createEmployerRouter } from './routes/employer.js';
import { createCandidateRouter } from './routes/candidate.js';
import { createUsersRouter } from './routes/users.js';
import { createConfigRouter } from './routes/config.js';
import { createMarketRouter } from './routes/market.js';
import { createWebhookWorker } from './modules/webhook/worker.js';
import { metricsMiddleware } from './modules/metrics/middleware.js';
import { getRegistry } from './modules/metrics/registry.js';
import { startMetricsRefresh, stopMetricsRefresh } from './modules/metrics/refresh.js';
import { startScheduler, stopScheduler } from './modules/cron/scheduler.js';
import { createActionHistoryMiddleware } from './modules/audit/action-history-middleware.js';
import { createActionHistoryRepo } from './db/repositories/action-history.js';
import { createCandidatesAnonymizedRepo } from './db/repositories/candidates-anonymized.js';
import { createRecommendationsRepo } from './db/repositories/recommendations.js';
import { createUsersRepo } from './db/repositories/users.js';
import { createViewTokenRepo } from './modules/view/view-token-repo.js';
import { createViewHandlers } from './modules/view/handler.js';
import { createViewUrlInjector } from './modules/view/injector.js';
import { createViewsRouter } from './modules/view/views-endpoint.js';
import { createLandingRouter } from './routes/landing.js';
import { createUtf8OnlyMiddleware } from './modules/encoding/index.js';
import { createAdminAuthMiddleware } from './modules/admin/auth.js';
import { createAdminRouter } from './routes/admin.js';
import { createCapabilitiesRouter } from './routes/capabilities.js';
import type { DB } from './db/connection.js';

/**
 * Build the Express app from an already-opened DB + env.
 * Shared by createApp() and startApiServer().
 */
export function createAppFromDb(db: DB, env: ReturnType<typeof loadEnv>): Express {
  const app = express();
  // utf8-only and express.json() body limits are attached PER-ROUTER below.
  // Rationale: a global 4KB limit makes the zod `description: max(5000)` check on
  // /v1/employer/jobs unreachable (5000 UTF-8 chars ≈ 15KB → 413). Each router
  // mounts with the smallest viable limit; only /v1/employer needs BODY_LIMIT_LARGE.

  // Render layer: view_url injector (wraps res.json to inject view_url on 2xx responses)
  // Mounted early so all downstream routers inherit the wrapped res.json.
  const baseUrl = `http://localhost:${env.PORT}`;
  app.use(createViewUrlInjector(db, baseUrl));

  // Telemetry: create a root span per request and set it as the active context.
  // Mounted BEFORE action-history middleware so the trace_id written to
  // action_history matches the x-trace-id response header. Safe to use when
  // no SDK is started (becomes a no-op via OTel's NoopSpan).
  app.use(traceContextMiddleware());

  // Capability resolver (Phase 4): attaches req._capability so respond()
  // can stamp x-capability-name response header. Mounted after trace so
  // any future capability-aware spans can correlate with x-trace-id.
  app.use(capabilityResolverMiddleware());

  // Render layer: /view/* HTML routes (public — token IS the auth)
  const viewRepo = createViewTokenRepo(db);
  const viewHandlers = createViewHandlers(viewRepo, baseUrl, {
    // Real data sources wired here. Implementations use existing repos.
    getCandidate: async (id) => {
      const repo = createCandidatesAnonymizedRepo(db);
      const c = repo.findById(id);
      if (!c) return null;
      let skills: string[] = [];
      if (c.skills_json) {
        try { skills = JSON.parse(c.skills_json) as string[]; } catch { skills = []; }
      }
      return {
        anonymizedId: c.id,
        industry: c.industry ?? '',
        titleLevel: c.title_level ?? '',
        salaryRange: c.salary_range ?? '',
        educationTier: c.education_tier ?? '',
        yearsExperience: c.years_experience ?? 0,
        skills,
      };
    },
    getRecommendation: async (id) => {
      const repo = createRecommendationsRepo(db);
      const r = repo.findById(id);
      if (!r) return null;
      return {
        recommendationId: r.id,
        candidateAnonymizedId: r.anonymized_candidate_id,
        jobTitle: null,  // Recommendation row has job_id, not job_title (would need join)
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    },
    getUserQuota: async (id) => {
      const usersRepo = createUsersRepo(db);
      const u = usersRepo.findById(id);
      if (!u) return null;
      return {
        userId: u.id,
        userType: u.user_type,
        name: u.name,
        quotaPerDay: u.quota_per_day,
        quotaUsed: u.quota_used,
        quotaResetAt: u.quota_reset_at,
        rateLimits: [],   // not stored in users row; reserved for future
        recentActions: [], // not stored in users row; reserved for future
      };
    },
    getAudit: async (userId) => {
      const repo = createActionHistoryRepo(db);
      const rows = repo.listByUser(userId, { limit: 50 });
      return rows.map((r) => {
        // action_history doesn't currently record method/path; parse request_summary_json
        // for them if a future middleware populates it. status_code is approximated
        // from the success/error status (action_history doesn't store HTTP code).
        let method: string | null = null;
        let path: string | null = null;
        if (r.request_summary_json) {
          try {
            const parsed = JSON.parse(r.request_summary_json) as { method?: string; path?: string };
            method = parsed.method ?? null;
            path = parsed.path ?? null;
          } catch { /* leave null */ }
        }
        return {
          at: r.created_at,
          action_type: r.action_type,
          method,
          path,
          status_code: r.status === 'success' ? 200 : null,
          error_code: r.error_code,
          duration_ms: r.duration_ms,
        };
      });
    },
  });
  app.use('/view', viewHandlers.router);
  app.use('/v1/views', createViewsRouter(db, baseUrl));

  // action_history middleware MUST be mounted BEFORE business routers so it can
  // register res.on('finish') at request entry. If mounted after, the response
  // has already been sent by the time the listener is added and finish never fires.
  const actionHistoryRepo = createActionHistoryRepo(db);
  const actionHistoryMW = createActionHistoryMiddleware(actionHistoryRepo);

  const AUDITED_PREFIXES = ['/v1/auth', '/v1/users', '/v1/headhunter', '/v1/employer', '/v1/candidate'];
  app.use((req, res, next) => {
    if (!AUDITED_PREFIXES.some(p => req.path === p || req.path.startsWith(p + '/'))) {
      return next();
    }
    return actionHistoryMW(req, res, next);
  });

  // Metrics: HTTP request duration + count (M5)
  app.use(metricsMiddleware);
  app.get('/metrics', async (_req, res) => {
    const text = await getRegistry().metrics();
    res.type('text/plain; version=0.0.4').send(text);
  });
  app.get('/v1/metrics', async (_req, res) => {
    const text = await getRegistry().metrics();
    res.type('text/plain; version=0.0.4').send(text);
  });

  // Routes
  app.get('/v1/health', (_req, res) => {
    res.json({ ok: true, data: { status: 'healthy', timestamp: new Date().toISOString() } });
  });

  // skill.md (public)
  const skillPath = path.join(process.cwd(), 'docs/superpowers/skill.md');
  app.get('/v1/skill.md', (_req, res) => {
    try {
      const content = fs.readFileSync(skillPath, 'utf8');
      res.type('text/markdown').send(content);
    } catch {
      res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'skill.md not found' } });
    }
  });
  app.get('/skill.md', (_req, res) => {
    res.redirect(301, '/v1/skill.md');
  });

  // OpenAPI 3.0 spec (public)
  const openapiPath = path.join(process.cwd(), 'docs/superpowers/openapi.json');
  app.get('/v1/openapi.json', (_req, res) => {
    try {
      const content = fs.readFileSync(openapiPath, 'utf8');
      res.type('application/json').send(content);
    } catch {
      res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'openapi.json not found' } });
    }
  });

  // Per-router body limits. Default 4KB is enough for nearly all routes; only
  // /v1/employer/* needs BODY_LIMIT_LARGE because POST /v1/employer/jobs accepts
  // a description up to z.string().max(5000) (≈ 15KB UTF-8 Chinese).
  // utf8-only is mounted alongside express.json because both gate body size.
  // NOTE: Admin routes take only small POST bodies (placement status changes);
  // keeping 4KB is appropriate.
  app.use('/v1/auth',       createUtf8OnlyMiddleware(), express.json({ limit: MAX_BODY_SIZE }),    createAuthRouter(db, env.NODE_ENV === 'production'));
  app.use('/v1/users',      createUtf8OnlyMiddleware(), express.json({ limit: MAX_BODY_SIZE }),    createUsersRouter(db));
  app.use('/v1/config',     createUtf8OnlyMiddleware(), express.json({ limit: MAX_BODY_SIZE }),    createConfigRouter(db));
  app.use('/v1/market',     createUtf8OnlyMiddleware(), express.json({ limit: MAX_BODY_SIZE }),    createMarketRouter(db));
  app.use('/v1/headhunter', createUtf8OnlyMiddleware(), express.json({ limit: MAX_BODY_SIZE }),    createHeadhunterRouter(db, env.PLATFORM_ENCRYPTION_KEY));
  app.use('/v1/employer',   createUtf8OnlyMiddleware(64 * 1024), express.json({ limit: BODY_LIMIT_LARGE }), createEmployerRouter(db, env.PLATFORM_ENCRYPTION_KEY));
  app.use('/v1/candidate',  createUtf8OnlyMiddleware(), express.json({ limit: MAX_BODY_SIZE }),    createCandidateRouter(db, env.PLATFORM_ENCRYPTION_KEY));
  // /v1/admin/* — all routes (including /ping) require the admin bearer token.
  // The admin auth middleware rejects unauthenticated and non-admin requests
  // with 401 UNAUTHORIZED.
  app.use('/v1/admin', createUtf8OnlyMiddleware(), express.json({ limit: MAX_BODY_SIZE }), createAdminAuthMiddleware(), createAdminRouter(db, env.PLATFORM_ENCRYPTION_KEY));

  // Public marketplace landing page (GET /) — no auth, no quota, no PII.
  app.use(createLandingRouter(db));

  // Capabilities discovery endpoint (Phase 4). Public /v1/capabilities + auth /v1/capabilities/me.
  app.use(createCapabilitiesRouter(db));

// 404 JSON fallback — never let Express's default HTML leak out.
// Skips /view/* (HTML pages render their own 404) and the well-known redirect /skill.md.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next();
    // Skip /view/* (HTML pages render their own 404 if needed)
    if (req.path === '/view' || req.path.startsWith('/view/')) {
      return next();
    }
    res.status(404).json({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: `No route matched ${req.method} ${req.path}`,
        details: { method: req.method, path: req.path },
      },
    });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      // 让 action_history 中间件在 finish 时能拿到 error_code
      res.locals.errorCode = err.code;
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
  // Initialize OTel SDK. dev → console exporter, prod → OTLP via env var.
  // In test (NODE_ENV=test), skip — tests don't need telemetry output.
  if (process.env.NODE_ENV !== 'test') {
    await startTelemetry({
      exporter: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? 'otlp' : 'console',
      serviceName: 'hunter-platform',
    });
  }

  const env = loadEnv();
  const db = openDb(env.DATABASE_PATH);
  runMigrations(db);

  const app = createAppFromDb(db, env);
  startWebhookWorkerBackground(db, env);
  startMetricsRefresh(10_000, db);
  startScheduler(db);

  return new Promise((resolve) => {
    const server = app.listen(opts.port ?? env.PORT, () => {
      console.log(`Hunter platform API listening on port ${opts.port ?? env.PORT}`);
      // Graceful shutdown — stops background loops + flushes OTel spans
      server.on('close', async () => {
        stopMetricsRefresh();
        stopScheduler();
        await shutdownTelemetry();
      });
      resolve(server);
    });
  });
}