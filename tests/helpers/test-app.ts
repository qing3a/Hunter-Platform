// Test helper for integration tests.
//
// Provides a minimal Express app with:
//  - In-memory or temp-file SQLite DB
//  - Migrations applied
//  - /v1/candidate-portal/auth/otp/{request,verify} routes mounted (createTestApp)
//  - /v1/headhunter-workspace/* routes mounted (createHeadhunterWorkspaceTestApp)
//  - Optional OTP env overrides (otpTtlSeconds, otpMaxAttempts, otpLength, consoleOnly)
//
// Each router helper uses its own DB singleton so tests that mount different
// routers don't step on each other's state.
//
// Other task-specific helpers (test factories, mocks) can extend this file.

import express, { type Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { openDb, type DB } from '../../src/main/db/connection.js';
import { runMigrations } from '../../src/main/db/migrations.js';
import { createUtf8OnlyMiddleware } from '../../src/main/modules/encoding/index.js';
import { createCandidatePortalRouter } from '../../src/main/routes/candidate-portal.js';
import { createHeadhunterWorkspaceRouter } from '../../src/main/routes/headhunter-workspace.js';
import { ApiError } from '../../src/main/errors.js';
import { MAX_BODY_SIZE } from '../../src/shared/constants.js';
import { __resetRateLimits } from '../../src/main/lib/rate-limit-portal.js';
import { createUsersRepo } from '../../src/main/db/repositories/users.js';
import { createCandidateOtpRepo } from '../../src/main/db/repositories/candidate-otp.js';

export interface TestAppOptions {
  /** Override OTP_TTL_SECONDS. 0 = already expired on next verify. */
  otpTtlSeconds?: number;
  /** Override OTP_MAX_ATTEMPTS. */
  otpMaxAttempts?: number;
  /** Override OTP_LENGTH. */
  otpLength?: number;
  /** Force console mode (default: true in tests). */
  consoleOnly?: boolean;
}

// Re-export so tests can call reset() directly between cases.
export { __resetRateLimits };

// ----- candidate-portal test app (DB singleton #1) -----

let _db: DB | null = null;
let _dbPath: string | null = null;

/**
 * Build a fresh Express app with a freshly-migrated DB. Each call returns a
 * new app instance — DB state is shared across calls (use resetDb() to wipe).
 */
export function createTestApp(opts: TestAppOptions = {}): Express {
  if (!_db) {
    _dbPath = path.join(process.cwd(), 'tmp', 'candidate-portal-test.db');
    try { fs.unlinkSync(_dbPath); } catch {}
    try { fs.unlinkSync(_dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(_dbPath + '-shm'); } catch {}
    _db = openDb(_dbPath);
    runMigrations(_db);
  }

  // Required env so the test app boots consistently.
  process.env.PLATFORM_ENCRYPTION_KEY = process.env.PLATFORM_ENCRYPTION_KEY
    ?? Buffer.alloc(32).toString('base64');
  process.env.WEBHOOK_HMAC_SECRET = process.env.WEBHOOK_HMAC_SECRET ?? 'test-secret-1234567890';
  process.env.NODE_ENV = 'test';

  const app = express();
  app.use(
    '/v1/candidate-portal',
    createUtf8OnlyMiddleware(),
    express.json({ limit: MAX_BODY_SIZE }),
    createCandidatePortalRouter(_db, {
      otpLength: opts.otpLength ?? 6,
      otpTtlSeconds: opts.otpTtlSeconds ?? 300,
      otpMaxAttempts: opts.otpMaxAttempts ?? 5,
      consoleOnly: opts.consoleOnly ?? true,
    })
  );

  // 404 fallback
  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'No route matched' } });
  });

  // Error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({
        ok: false,
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    // eslint-disable-next-line no-console
    console.error('Unhandled test error:', err);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal error' } });
  });

  return app;
}

// ----- headhunter-workspace test app (DB singleton #2) -----

let _hunterDb: DB | null = null;
let _hunterDbPath: string | null = null;

/**
 * Build a fresh Express app for the hunter workspace, with a freshly-migrated
 * DB. Each call returns a new app instance — DB state is shared across calls
 * (use resetHunterDb() to wipe).
 *
 * Uses a SEPARATE DB singleton (`_hunterDb`) so tests that mount the hunter
 * workspace router don't share state with candidate-portal tests (which use
 * `_db`). The two router mounts differ in their middleware stack (hunter
 * workspace is auth-only, candidate-portal has public OTP routes first).
 */
export function createHeadhunterWorkspaceTestApp(): Express {
  if (!_hunterDb) {
    _hunterDbPath = path.join(process.cwd(), 'tmp', 'headhunter-workspace-test.db');
    try { fs.unlinkSync(_hunterDbPath); } catch {}
    try { fs.unlinkSync(_hunterDbPath + '-wal'); } catch {}
    try { fs.unlinkSync(_hunterDbPath + '-shm'); } catch {}
    _hunterDb = openDb(_hunterDbPath);
    runMigrations(_hunterDb);
  }

  // Required env so the test app boots consistently.
  process.env.PLATFORM_ENCRYPTION_KEY = process.env.PLATFORM_ENCRYPTION_KEY
    ?? Buffer.alloc(32).toString('base64');
  process.env.WEBHOOK_HMAC_SECRET = process.env.WEBHOOK_HMAC_SECRET ?? 'test-secret-1234567890';
  process.env.NODE_ENV = 'test';

  const app = express();
  app.use(
    '/v1/headhunter-workspace',
    createUtf8OnlyMiddleware(),
    express.json({ limit: MAX_BODY_SIZE }),
    createHeadhunterWorkspaceRouter(_hunterDb)
  );

  // 404 fallback
  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'No route matched' } });
  });

  // Error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({
        ok: false,
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    // eslint-disable-next-line no-console
    console.error('Unhandled test error:', err);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal error' } });
  });

  return app;
}

/**
 * Wipe mutable tables + reset in-memory rate-limit buckets between tests.
 * Schema (migrations) is preserved — only data is cleared.
 */
export function resetDb(): void {
  if (!_db) return;
  // Disable FK enforcement so the order-of-DELETEs dance is unnecessary
  // and a row referencing users can never silently block DELETE FROM users.
  // We re-enable immediately after — the test helpers below only need a
  // clean slate, not FK semantics.
  _db.exec('PRAGMA foreign_keys = OFF');
  try {
    const tables = [
      'pm_notes',
      'matches',
      'position_decompositions',
      'staffing_plans',
      'project_positions',
      'projects',
      'candidate_messages',
      'candidate_applications',
      'candidate_otp_codes',
      'candidates_anonymized',
      'candidates_private',
      'recommendations',
      'hunter_tasks',
      'kanban_columns',
      'jobs',
      'users',
      'idempotency_keys',
      'rate_limit_buckets',
      'action_history',
      'notifications',
      'placements',
      'unlock_audit_log',
      'admin_action_log',
      'admin_users',
      'admin_login_events',
      'view_tokens',
      'config',
      'webhook_delivery_queue',
    ];
    for (const t of tables) {
      try { _db.exec(`DELETE FROM ${t}`); } catch { /* table may not exist yet */ }
    }
  } finally {
    _db.exec('PRAGMA foreign_keys = ON');
  }
  __resetRateLimits();
}

/** Get the shared test DB (for direct assertions in tests). */
export function getTestDb(): DB {
  if (!_db) throw new Error('createTestApp() must be called before getTestDb()');
  return _db;
}

/** Get pre-built repo handles for assertions. */
export function getTestRepos() {
  const db = getTestDb();
  return {
    db,
    users: createUsersRepo(db),
    otps: createCandidateOtpRepo(db),
  };
}

/**
 * Close the test DB and remove the file. Call from afterAll() if you need a
 * clean teardown (most test files don't bother — vitest exits anyway).
 */
export function closeTestDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
  if (_dbPath) {
    try { fs.unlinkSync(_dbPath); } catch {}
    try { fs.unlinkSync(_dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(_dbPath + '-shm'); } catch {}
    _dbPath = null;
  }
}

// ============================================================================
// Hunter-workspace test app helpers (separate singleton from _db / _dbPath)
// ============================================================================

/**
 * Wipe mutable tables in the hunter-workspace test DB between tests. Mirrors
 * resetDb() above but targets the separate `_hunterDb` singleton.
 */
export function resetHunterDb(): void {
  if (!_hunterDb) return;
  _hunterDb.exec('PRAGMA foreign_keys = OFF');
  try {
    const tables = [
      'pm_notes',
      'matches',
      'position_decompositions',
      'staffing_plans',
      'project_positions',
      'projects',
      'candidate_messages',
      'candidate_applications',
      'candidate_otp_codes',
      'candidates_anonymized',
      'candidates_private',
      'recommendations',
      'hunter_tasks',
      'kanban_columns',
      'jobs',
      'users',
      'idempotency_keys',
      'rate_limit_buckets',
      'action_history',
      'notifications',
      'placements',
      'unlock_audit_log',
      'admin_action_log',
      'admin_users',
      'admin_login_events',
      'view_tokens',
      'config',
      'webhook_delivery_queue',
    ];
    for (const t of tables) {
      try { _hunterDb.exec(`DELETE FROM ${t}`); } catch { /* table may not exist yet */ }
    }
  } finally {
    _hunterDb.exec('PRAGMA foreign_keys = ON');
  }
  __resetRateLimits();
}

/** Get the shared hunter-workspace test DB. */
export function getHunterTestDb(): DB {
  if (!_hunterDb) throw new Error('createHeadhunterWorkspaceTestApp() must be called before getHunterTestDb()');
  return _hunterDb;
}

/** Close the hunter-workspace test DB and remove the file. */
export function closeHunterTestDb(): void {
  if (_hunterDb) {
    _hunterDb.close();
    _hunterDb = null;
  }
  if (_hunterDbPath) {
    try { fs.unlinkSync(_hunterDbPath); } catch {}
    try { fs.unlinkSync(_hunterDbPath + '-wal'); } catch {}
    try { fs.unlinkSync(_hunterDbPath + '-shm'); } catch {}
    _hunterDbPath = null;
  }
}
