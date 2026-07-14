-- ============================================================================
-- v029: PM Workbench — extend users.user_type CHECK to allow 'pm'
-- ============================================================================
-- Phase 2 of the PM Workbench plan: unblock PM user creation. Task 2
-- (Projects Repository) inserts rows via `INSERT INTO users (..., 'pm', ...)`;
-- the v008 user_type CHECK (`'candidate' | 'hr' | 'pm'`) would
-- reject those with a CHECK constraint violation.
--
-- Pattern: SQLite cannot drop a CHECK constraint without rebuilding the
-- table (no ALTER COLUMN ... DROP CONSTRAINT). We use the same 12-step
-- rename/copy/drop/rename recipe as v008 (https://sqlite.org/lang_altertable.html).
--
-- Column shape: must mirror all columns from v001 (base) + v006
-- (api_key_expires_at) + v007 (prev_api_key_*) + v008 (name/contact
-- nullable). v027 (hunter workspace) and v028 (PM tables) added NEW tables
-- but did not touch the users table, so the column list is unchanged from v008.
--
-- (runMigrations wraps this file in BEGIN/COMMIT, so do NOT add them here.)
-- ============================================================================

PRAGMA foreign_keys = OFF;

-- Rebuild users with the extended user_type CHECK. Every other column is
-- preserved byte-for-byte from v008.
--
-- Note: the original commit 4b565eb rewrite turned this CHECK into
-- ('candidate', 'hr', 'pm', 'pm') — pm listed twice. SQLite dedupes IN-list
-- values at evaluation time (the constraint is semantically equivalent to
-- ('candidate', 'hr', 'pm')), so the duplicate didn't break anything, but
-- it was visually misleading and tripped up grep audits. R1.C2 followup
-- trims it back to the canonical 3-value set.
CREATE TABLE users_new (
  id                       TEXT PRIMARY KEY,
  user_type                TEXT NOT NULL CHECK (user_type IN ('candidate', 'hr', 'pm')),
  name                     TEXT,
  contact                  TEXT,
  agent_endpoint           TEXT,
  api_key_hash             TEXT NOT NULL UNIQUE,
  api_key_prefix           TEXT NOT NULL,
  api_key_expires_at       TEXT,  -- v006
  prev_api_key_hash        TEXT,  -- v007
  prev_api_key_prefix      TEXT,  -- v007
  prev_api_key_expires_at  TEXT,  -- v007
  quota_per_day            INTEGER NOT NULL DEFAULT 100,
  quota_used               INTEGER NOT NULL DEFAULT 0,
  quota_reset_at           TEXT NOT NULL,
  reputation               INTEGER NOT NULL DEFAULT 50,
  status                   TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);
INSERT INTO users_new SELECT * FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX idx_users_api_key_hash ON users(api_key_hash);
CREATE INDEX idx_users_user_type ON users(user_type);

PRAGMA foreign_keys = ON;