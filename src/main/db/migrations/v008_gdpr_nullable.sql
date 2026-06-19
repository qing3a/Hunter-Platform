-- v008: GDPR soft-delete support
-- F6 delete-my-data sets users.name and candidates_private PII columns to NULL
-- to honor right-to-be-forgotten. The v001 schema declared several of these
-- as NOT NULL, which caused DELETE-MY-DATA to throw
-- "NOT NULL constraint failed: users.name" (SQLITE_CONSTRAINT 1299).
--
-- Relaxing the constraints is a one-way ticket in SQLite: you cannot make a
-- NOT NULL column nullable via ALTER COLUMN. The standard SQLite recipe is
-- to recreate the table with the new shape and copy the data. Since users
-- and candidates_private are large in production, we use the
-- 12-step "rename/copy/drop/rename" pattern (https://sqlite.org/lang_altertable.html).
--
-- NOTE: This file is wrapped in BEGIN/COMMIT by the migration runner
-- (runMigrations in migrations.ts), so do NOT add BEGIN/COMMIT here —
-- that would create a nested transaction error.

PRAGMA foreign_keys = OFF;

-- ---------- users ----------
-- Note: must mirror all 18 columns added by v001/v006/v007. v006 added
-- `api_key_expires_at`; v007 added `prev_api_key_hash/prefix/expires_at`.
CREATE TABLE users_new (
  id                       TEXT PRIMARY KEY,
  user_type                TEXT NOT NULL CHECK (user_type IN ('candidate', 'headhunter', 'employer')),
  -- name and contact are now nullable so a soft-deleted account can have its
  -- PII wiped. The unique-per-role invariant for `contact` is enforced in
  -- application code (register handler) — we cannot keep the column-level
  -- UNIQUE because NULL values don't conflict under SQL UNIQUE semantics,
  -- which matches the desired "deleted contact shouldn't block new signup"
  -- behavior.
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

-- ---------- candidates_private ----------
CREATE TABLE candidates_private_new (
  id                  TEXT PRIMARY KEY,
  headhunter_id       TEXT NOT NULL REFERENCES users(id),
  candidate_user_id   TEXT NOT NULL REFERENCES users(id),
  -- PII columns now nullable so delete-my-data can wipe them.
  name_enc            TEXT,
  phone_enc           TEXT,
  email_enc           TEXT,
  current_company_raw TEXT,
  current_title_raw   TEXT,
  expected_salary     INTEGER,
  years_experience    INTEGER,
  education_school    TEXT,
  resume_url          TEXT,
  skills_json         TEXT,
  raw_payload_json    TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
INSERT INTO candidates_private_new SELECT * FROM candidates_private;
DROP TABLE candidates_private;
ALTER TABLE candidates_private_new RENAME TO candidates_private;
CREATE INDEX idx_candidates_private_headhunter ON candidates_private(headhunter_id);
CREATE INDEX idx_candidates_private_candidate_user ON candidates_private(candidate_user_id);

PRAGMA foreign_keys = ON;
