/**
 * Filesystem path helpers for the API server.
 *
 * API-only mode: paths come from the environment (`DATABASE_PATH` etc.),
 * not from Electron's `app.getPath('userData')`. The server is the single
 * owner of on-disk state; CLI tools and tests should pass paths explicitly
 * to `openDb()` instead of relying on this module.
 */
import path from 'node:path';

const DEFAULT_DB_PATH = './tmp/hunter.db';

export function dbPath(): string {
  return process.env.DATABASE_PATH || DEFAULT_DB_PATH;
}

export function attachmentsDir(): string {
  return path.join(path.dirname(dbPath()), 'attachments');
}

export function logsDir(): string {
  return path.join(path.dirname(dbPath()), 'logs');
}