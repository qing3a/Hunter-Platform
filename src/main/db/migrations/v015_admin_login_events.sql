-- ============================================================================
-- Migration v015: admin_login_events table — Sub-D1 of Task #3 (Audit UI)
-- ============================================================================
-- Records every admin login attempt (success and failure) for security
-- auditing. auth.ts login handler writes a row on every attempt.
-- admin_user_id is nullable because failed logins may have unknown email.
-- ============================================================================

CREATE TABLE admin_login_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id   TEXT,
  email           TEXT NOT NULL,
  success         INTEGER NOT NULL CHECK (success IN (0, 1)),
  failure_reason  TEXT,
  ip              TEXT,
  user_agent      TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_admin_login_events_admin ON admin_login_events(admin_user_id);
CREATE INDEX idx_admin_login_events_created ON admin_login_events(created_at DESC);
CREATE INDEX idx_admin_login_events_success ON admin_login_events(success, created_at DESC);