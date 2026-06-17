-- v001: M1 baseline (users, candidates, idempotency, rate limit, action history)

CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  user_type       TEXT NOT NULL CHECK (user_type IN ('candidate', 'headhunter', 'employer')),
  name            TEXT NOT NULL,
  contact         TEXT,
  agent_endpoint  TEXT,
  api_key_hash    TEXT NOT NULL UNIQUE,
  api_key_prefix  TEXT NOT NULL,
  quota_per_day   INTEGER NOT NULL DEFAULT 100,
  quota_used      INTEGER NOT NULL DEFAULT 0,
  quota_reset_at  TEXT NOT NULL,
  reputation      INTEGER NOT NULL DEFAULT 50,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_users_api_key_hash ON users(api_key_hash);
CREATE INDEX idx_users_user_type ON users(user_type);

CREATE TABLE candidates_private (
  id                  TEXT PRIMARY KEY,
  headhunter_id       TEXT NOT NULL REFERENCES users(id),
  candidate_user_id   TEXT NOT NULL REFERENCES users(id),
  name_enc            TEXT NOT NULL,
  phone_enc           TEXT NOT NULL,
  email_enc           TEXT NOT NULL,
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
CREATE INDEX idx_candidates_private_headhunter ON candidates_private(headhunter_id);
CREATE INDEX idx_candidates_private_candidate_user ON candidates_private(candidate_user_id);

CREATE TABLE candidates_anonymized (
  id                    TEXT PRIMARY KEY,
  source_private_id     TEXT NOT NULL REFERENCES candidates_private(id),
  source_headhunter_id  TEXT NOT NULL REFERENCES users(id),
  industry              TEXT,
  title_level           TEXT,
  years_experience      INTEGER,
  salary_range          TEXT,
  education_tier        TEXT,
  skills_json           TEXT,
  is_public_pool        INTEGER NOT NULL DEFAULT 0,
  unlock_status         TEXT NOT NULL DEFAULT 'locked' CHECK (unlock_status IN ('locked', 'unlocked', 'revoked')),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX idx_candidates_anon_public ON candidates_anonymized(is_public_pool, created_at);
CREATE INDEX idx_candidates_anon_headhunter ON candidates_anonymized(source_headhunter_id);

CREATE TABLE idempotency_keys (
  key             TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  request_hash    TEXT NOT NULL,
  response_json   TEXT NOT NULL,
  status_code     INTEGER NOT NULL,
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_idempotency_user ON idempotency_keys(user_id, created_at);
CREATE INDEX idx_idempotency_expires ON idempotency_keys(expires_at);

CREATE TABLE rate_limit_buckets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL,
  window_start    TEXT NOT NULL,
  window_seconds  INTEGER NOT NULL,
  request_count   INTEGER NOT NULL DEFAULT 0,
  expires_at      TEXT NOT NULL,
  UNIQUE(user_id, window_start, window_seconds)
);
CREATE INDEX idx_rate_limit_user ON rate_limit_buckets(user_id, window_start);
CREATE INDEX idx_rate_limit_expires ON rate_limit_buckets(expires_at);

CREATE TABLE action_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL REFERENCES users(id),
  action_type     TEXT NOT NULL,
  target_type     TEXT,
  target_id       TEXT,
  request_summary_json  TEXT,
  response_summary_json TEXT,
  status          TEXT NOT NULL CHECK (status IN ('success', 'error')),
  error_code      TEXT,
  duration_ms     INTEGER,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_action_history_user ON action_history(user_id, created_at);
CREATE INDEX idx_action_history_type ON action_history(action_type, created_at);

-- schema_migrations table is created by migrations.ts (not here, to avoid
-- "table already exists" on re-runs and conflicts with the bootstrap CREATE
-- TABLE IF NOT EXISTS in the runner).
