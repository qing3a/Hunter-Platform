// Deviation from M1 plan: node:sqlite doesn't have a `db.transaction()`
// wrapper like better-sqlite3. We use explicit BEGIN/COMMIT via exec().
// SQL semantics are identical.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type { DB } from './connection.js';

// ESM equivalent of __dirname for resolving relative migration paths.
// In dev (tsx): src/main/db/migrations.ts -> src/main/db/
// In prod (tsc):  out/main/db/migrations.js -> out/main/db/
// The .sql files must live alongside this compiled .js file (postbuild
// step copies them — see scripts/postbuild.sh or package.json scripts).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS: { version: number; description: string; file: string }[] = [
  { version: 1, description: 'M1 baseline (users, candidates, idempotency, rate limit, action history)', file: 'migrations/v001.sql' },
  { version: 2, description: 'M2 (jobs, recommendations, unlock_audit_log, webhook_delivery_queue)', file: 'migrations/v002.sql' },
  { version: 3, description: 'M4 (placements, admin_action_log)', file: 'migrations/v003.sql' },
  { version: 4, description: 'render-layer view_tokens table', file: 'migrations/v004_view_tokens.sql' },
  { version: 5, description: 'jobs.required_skills_json column for structured required_skills', file: 'migrations/v005_required_skills.sql' },
  { version: 6, description: 'users.api_key_expires_at column for rotate-key grace period', file: 'migrations/v006_api_key_grace_period.sql' },
  { version: 7, description: 'users prev_api_key_* slot for rotated-key grace period', file: 'migrations/v007_grace_period_slot.sql' },
  { version: 8, description: 'GDPR soft-delete: relax users.name/contact and candidates_private PII columns to nullable', file: 'migrations/v008_gdpr_nullable.sql' },
  { version: 9, description: 'Headhunter-created jobs: jobs.employer_id nullable + source_headhunter_id/created_for_employer_id + CHECK constraint', file: 'migrations/v009_headhunter_created_jobs.sql' },
  { version: 10, description: 'Add jobs.status = claimed (employer has accepted the job)', file: 'migrations/v010_job_status_claimed.sql' },
  { version: 11, description: 'Add trace_id to action_history (OTel correlation)', file: 'migrations/v011_action_history_trace_id.sql' },
  { version: 12, description: 'Add traceparent to webhook_delivery_queue (OTel propagation)', file: 'migrations/v012_webhook_traceparent.sql' },
  { version: 13, description: 'Rename action_history.action_type → capability_name + migrate 30 values to canonical capability names', file: 'migrations/v013_capability_name.sql' },
  { version: 14, description: 'admin_users table — per-admin api_key auth (Sub-A of Task #3)', file: 'migrations/v014_admin_users.sql' },
  { version: 15, description: 'admin_login_events (Sub-D1 audit login log)', file: 'migrations/v015_admin_login_events.sql' },
  { version: 16, description: 'in-site notifications (system messages) — 30d TTL, polling, dedup by (user_id, category, dedup_key)', file: 'migrations/v016_notifications.sql' },
];

export function runMigrations(db: DB, schemaDir: string = path.join(__dirname)): void {
  // Ensure schema_migrations table exists (for upgrade scenarios, but harmless on first run)
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[])
      .map(r => r.version)
  );

  for (const mig of MIGRATIONS) {
    if (applied.has(mig.version)) continue;
    const sql = fs.readFileSync(path.join(schemaDir, mig.file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)'
      ).run(mig.version, mig.description, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
