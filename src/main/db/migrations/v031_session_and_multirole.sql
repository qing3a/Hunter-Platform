-- Migration v031: session token + multi-role (R1.C2)
-- See docs/superpowers/specs/2026-07-11-session-and-multirole-design.md §3

CREATE TABLE user_role (
  user_id    TEXT NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL CHECK (role IN ('pm','hr','candidate')),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, role)
);
CREATE INDEX idx_user_role_user ON user_role(user_id);

CREATE TABLE session (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  active_role  TEXT NOT NULL CHECK (active_role IN ('pm','hr','candidate')),
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  revoked_at   TEXT,
  ip_address   TEXT,
  user_agent   TEXT
);
CREATE INDEX idx_session_user    ON session(user_id);
CREATE INDEX idx_session_expires ON session(expires_at);

-- Remap legacy user_type values
UPDATE users SET user_type = 'hr' WHERE user_type = 'headhunter';
UPDATE users SET user_type = 'pm' WHERE user_type = 'employer';

-- Backfill: every existing user gets all 3 roles
INSERT INTO user_role (user_id, role, granted_at)
SELECT id, 'pm',        datetime('now') FROM users;
INSERT INTO user_role (user_id, role, granted_at)
SELECT id, 'hr',        datetime('now') FROM users;
INSERT INTO user_role (user_id, role, granted_at)
SELECT id, 'candidate', datetime('now') FROM users;
