-- ============================================================
-- v003: M4 (placements + admin_action_log 实际使用)
-- ============================================================

-- 入职记录（商业闭环核心）
CREATE TABLE placements (
  id                      TEXT PRIMARY KEY,
  job_id                  TEXT NOT NULL REFERENCES jobs(id),
  candidate_user_id       TEXT NOT NULL REFERENCES users(id),
  primary_headhunter_id   TEXT NOT NULL REFERENCES users(id),
  referrer_headhunter_id  TEXT REFERENCES users(id),
  anonymized_candidate_id TEXT NOT NULL REFERENCES candidates_anonymized(id),
  annual_salary           INTEGER NOT NULL,
  platform_fee            INTEGER NOT NULL,
  primary_share           INTEGER NOT NULL,
  referrer_share          INTEGER NOT NULL DEFAULT 0,
  candidate_bonus         INTEGER NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'pending_payment'
                          CHECK (status IN ('pending_payment', 'paid', 'cancelled')),
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  UNIQUE(anonymized_candidate_id, job_id, primary_headhunter_id)
);
CREATE INDEX idx_placements_job ON placements(job_id);
CREATE INDEX idx_placements_candidate ON placements(candidate_user_id);
CREATE INDEX idx_placements_primary_headhunter ON placements(primary_headhunter_id);
CREATE INDEX idx_placements_status ON placements(status, created_at DESC);

-- 管理员操作日志
CREATE TABLE admin_action_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id   TEXT NOT NULL,
  action          TEXT NOT NULL,
  target_type     TEXT,
  target_id       TEXT,
  details_json    TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_admin_action_admin ON admin_action_log(admin_user_id, created_at);
CREATE INDEX idx_admin_action_target ON admin_action_log(target_type, target_id);