-- ============================================================================
-- Migration v026: Recommendation flow extensions for candidate self-apply
-- ============================================================================
-- Adds two RecStatus values that the original v002 CHECK constraint doesn't
-- allow, and makes recommendations.headhunter_id nullable so a recommendation
-- can exist before any headhunter has "picked it up".
--
-- New states:
--   pending_pickup     — candidate self-applied; awaiting headhunter pickup
--   considering_offer  — candidate is reviewing the employer's interest
--
-- Schema changes:
--   1. recommendations.headhunter_id: NOT NULL → nullable
--   2. recommendations.status CHECK:   + 'pending_pickup', 'considering_offer'
--
-- We rebuild the table to apply the new CHECK + nullability because SQLite has
-- no ALTER COLUMN. We disable FK enforcement during the swap so existing
-- references in unlock_audit_log and candidate_applications stay valid; the
-- swapped-in table has identical FKs, so the integrity is preserved post-commit.
--
-- (runMigrations wraps this file in BEGIN/COMMIT, so do NOT add them here.)
-- ============================================================================

PRAGMA foreign_keys = OFF;

CREATE TABLE recommendations_new (
  id                          TEXT PRIMARY KEY,
  headhunter_id               TEXT REFERENCES users(id),  -- nullable: a self-applied rec has no hunter yet
  employer_id                 TEXT NOT NULL REFERENCES users(id),
  anonymized_candidate_id     TEXT NOT NULL REFERENCES candidates_anonymized(id),
  job_id                      TEXT NOT NULL REFERENCES jobs(id),
  status                      TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN (
                                'pending',
                                'pending_pickup',
                                'considering_offer',
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
  source_type                 TEXT NOT NULL DEFAULT 'hr',
  pickup_headhunter_id        TEXT REFERENCES users(id),
  candidate_note              TEXT,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  UNIQUE(anonymized_candidate_id, job_id)
);

INSERT INTO recommendations_new (
  id, headhunter_id, employer_id, anonymized_candidate_id, job_id, status,
  commission_split_json, referrer_headhunter_id, source_type,
  pickup_headhunter_id, candidate_note, created_at, updated_at
)
SELECT
  id, headhunter_id, employer_id, anonymized_candidate_id, job_id, status,
  commission_split_json, referrer_headhunter_id,
  COALESCE(source_type, 'hr'),
  pickup_headhunter_id, candidate_note, created_at, updated_at
FROM recommendations;

DROP TABLE recommendations;
ALTER TABLE recommendations_new RENAME TO recommendations;

-- Recreate indexes (those on the original table are dropped with the table).
CREATE INDEX idx_recommendations_headhunter ON recommendations(headhunter_id);
CREATE INDEX idx_recommendations_employer ON recommendations(employer_id);
CREATE INDEX idx_recommendations_status ON recommendations(status);
CREATE INDEX idx_recommendations_candidate ON recommendations(anonymized_candidate_id, status);
CREATE INDEX idx_recommendations_headhunter_status ON recommendations(headhunter_id, status, created_at DESC);
CREATE INDEX idx_recommendations_employer_status ON recommendations(employer_id, status, created_at DESC);

PRAGMA foreign_keys = ON;
