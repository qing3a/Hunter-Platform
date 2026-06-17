-- ============================================================
-- v002: M2 (jobs, recommendations, unlock_audit_log, webhooks)
-- ============================================================

CREATE TABLE jobs (
  id              TEXT PRIMARY KEY,
  employer_id     TEXT NOT NULL REFERENCES users(id),
  title           TEXT NOT NULL,
  description     TEXT,
  requirements    TEXT,
  salary_min      INTEGER,
  salary_max      INTEGER,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paused', 'closed', 'filled')),
  priority        TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  deadline        TEXT,
  industry        TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_jobs_employer ON jobs(employer_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_industry ON jobs(industry);
CREATE INDEX idx_jobs_employer_status ON jobs(employer_id, status, created_at DESC);

CREATE TABLE recommendations (
  id                          TEXT PRIMARY KEY,
  headhunter_id               TEXT NOT NULL REFERENCES users(id),
  employer_id                 TEXT NOT NULL REFERENCES users(id),
  anonymized_candidate_id     TEXT NOT NULL REFERENCES candidates_anonymized(id),
  job_id                      TEXT NOT NULL REFERENCES jobs(id),
  status                      TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN (
                                'pending',
                                'employer_interested',
                                'candidate_approved',
                                'unlocked',
                                'rejected_employer',
                                'rejected_candidate',
                                'withdrawn',
                                'placed'
                              )),
  commission_split_json       TEXT,
  referrer_headhunter_id      TEXT REFERENCES users(id),
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  UNIQUE(anonymized_candidate_id, job_id)
);
CREATE INDEX idx_recommendations_headhunter ON recommendations(headhunter_id);
CREATE INDEX idx_recommendations_employer ON recommendations(employer_id);
CREATE INDEX idx_recommendations_status ON recommendations(status);
CREATE INDEX idx_recommendations_candidate ON recommendations(anonymized_candidate_id, status);
CREATE INDEX idx_recommendations_headhunter_status ON recommendations(headhunter_id, status, created_at DESC);
CREATE INDEX idx_recommendations_employer_status ON recommendations(employer_id, status, created_at DESC);

CREATE TABLE unlock_audit_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  recommendation_id   TEXT NOT NULL REFERENCES recommendations(id),
  actor_user_id       TEXT NOT NULL REFERENCES users(id),
  action              TEXT NOT NULL CHECK (action IN (
                        'express_interest', 'approve_unlock', 'reject_unlock',
                        'unlock_delivery', 'revoke_unlock'
                      )),
  ip_address          TEXT,
  user_agent          TEXT,
  created_at          TEXT NOT NULL
);
CREATE INDEX idx_unlock_audit_recommendation ON unlock_audit_log(recommendation_id);
CREATE INDEX idx_unlock_audit_actor ON unlock_audit_log(actor_user_id);
CREATE INDEX idx_unlock_audit_created ON unlock_audit_log(created_at);

CREATE TABLE webhook_delivery_queue (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  target_user_id      TEXT NOT NULL REFERENCES users(id),
  event_type          TEXT NOT NULL,
  payload_enc         TEXT NOT NULL,
  contains_pii        INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'in_flight', 'success', 'failed', 'dead_letter')),
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  max_attempts        INTEGER NOT NULL DEFAULT 3,
  next_retry_at       TEXT,
  last_error          TEXT,
  delivered_at        TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_webhook_pending ON webhook_delivery_queue(status, next_retry_at);
CREATE INDEX idx_webhook_target_user ON webhook_delivery_queue(target_user_id, created_at);
