-- ============================================================================
-- Migration v025: Candidate Portal (Phase 1 of ow-recruit-saas integration)
-- ============================================================================
-- Adds:
--   1. candidate_otp_codes — 候选人 OTP 邮箱登录临时码
--   2. candidate_messages  — 候选人 ↔ 猎头/雇主消息
--   3. candidate_applications — 候选人主动发起的申请 (推荐 + 副本)
-- Modifies:
--   4. recommendations: +source_type, +pickup_headhunter_id, +candidate_note
--   5. candidates_anonymized: +visibility, +expectations_json
-- ============================================================================

CREATE TABLE candidate_otp_codes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL,
  code_hash     TEXT    NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  expires_at    INTEGER NOT NULL,
  consumed_at   INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX idx_otp_email_active ON candidate_otp_codes(email, consumed_at, expires_at);

CREATE TABLE candidate_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id  INTEGER,
  from_user_id    INTEGER NOT NULL,
  to_user_id      INTEGER NOT NULL,
  content         TEXT    NOT NULL,
  read_at         INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (application_id) REFERENCES candidate_applications(id)
);
CREATE INDEX idx_msg_to_user   ON candidate_messages(to_user_id, read_at, created_at DESC);
CREATE INDEX idx_msg_from_user ON candidate_messages(from_user_id, created_at DESC);

CREATE TABLE candidate_applications (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  recommendation_id     INTEGER NOT NULL UNIQUE,
  candidate_user_id     INTEGER NOT NULL,
  job_id                INTEGER NOT NULL,
  pickup_headhunter_id  INTEGER,
  candidate_note        TEXT,
  withdrawn_at          INTEGER,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (recommendation_id)    REFERENCES recommendations(id),
  FOREIGN KEY (candidate_user_id)    REFERENCES users(id),
  FOREIGN KEY (job_id)               REFERENCES jobs(id),
  FOREIGN KEY (pickup_headhunter_id) REFERENCES users(id)
);
CREATE INDEX idx_app_candidate ON candidate_applications(candidate_user_id, created_at DESC);
CREATE INDEX idx_app_pickup    ON candidate_applications(pickup_headhunter_id, created_at DESC);

-- ALTER existing tables
ALTER TABLE recommendations ADD COLUMN source_type TEXT NOT NULL DEFAULT 'headhunter';
  -- 'headhunter' | 'candidate_self_apply' | 'system'
ALTER TABLE recommendations ADD COLUMN pickup_headhunter_id INTEGER REFERENCES users(id);
ALTER TABLE recommendations ADD COLUMN candidate_note TEXT;

ALTER TABLE candidates_anonymized ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
  -- 'public' | 'invitation_only' | 'hidden'
ALTER TABLE candidates_anonymized ADD COLUMN expectations_json TEXT;
  -- {desired_roles: string[], expected_salary_min: number, expected_salary_max: number, open_to_remote: bool, ...}
