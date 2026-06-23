-- ============================================================================
-- Migration v014: admin_users table — Sub-A of Task #3 (Web Admin)
-- ============================================================================
-- Rationale: Replaces the legacy shared ADMIN_PASSWORD_HASH env var with a
-- proper admin_users table supporting multi-admin identities. Each admin has:
--   - password_hash (bcrypt, for POST /v1/admin/auth/login)
--   - api_key_hash + api_key_prefix (bcrypt, for Bearer auth on all other
--     /v1/admin/* endpoints)
--
-- See docs/superpowers/specs/2026-06-23-web-admin-sub-A-design.md §3.1
--
-- No FK constraint is added on admin_action_log.admin_user_id; the existing
-- admin_action_log table (v003) keeps its TEXT column without FK so this
-- migration is non-breaking. Logical consistency is enforced at the
-- application layer (admin middleware loads row from this table before any
-- admin endpoint runs).
-- ============================================================================

CREATE TABLE admin_users (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  api_key_hash      TEXT NOT NULL,
  api_key_prefix    TEXT NOT NULL UNIQUE,
  role              TEXT NOT NULL DEFAULT 'admin'
                          CHECK (role IN ('admin', 'super')),
  status            TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'suspended')),
  last_login_at     TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_admin_users_email ON admin_users(email);
CREATE INDEX idx_admin_users_prefix ON admin_users(api_key_prefix);
