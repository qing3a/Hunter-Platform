-- v010: Add 'claimed' status to jobs.status CHECK constraint
--
-- An employer calling POST /v1/employer/claim-jobs/{id} now flips the job from
-- 'open' to 'claimed' so subsequent state transitions (reject/close) can be
-- guarded by the state machine and external observers can see ownership change.
--
-- SQLite doesn't support ALTER ... DROP CONSTRAINT or modifying a CHECK
-- in place, so we use the same rename/copy/drop/rename pattern as v008/v009.
-- (本文件被 runMigrations 包在 BEGIN/COMMIT 里, 不要加 BEGIN/COMMIT)

PRAGMA foreign_keys = OFF;

CREATE TABLE jobs_backup AS SELECT * FROM jobs;

CREATE TABLE jobs_new (
  id                       TEXT PRIMARY KEY,
  employer_id              TEXT REFERENCES users(id),
  source_headhunter_id     TEXT REFERENCES users(id),
  created_for_employer_id  TEXT REFERENCES users(id),
  title                    TEXT NOT NULL,
  description              TEXT,
  requirements             TEXT,
  salary_min               INTEGER,
  salary_max               INTEGER,
  -- 'claimed' added between 'open' and 'paused' to reflect employer ownership
  status                   TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','claimed','paused','closed','filled')),
  priority                 TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  deadline                 TEXT,
  industry                 TEXT,
  required_skills_json     TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  CHECK (
    (source_headhunter_id IS NULL AND employer_id IS NOT NULL) OR
    (source_headhunter_id IS NOT NULL)
  )
);

INSERT INTO jobs_new (id, employer_id, source_headhunter_id, created_for_employer_id,
                      title, description, requirements, salary_min, salary_max,
                      status, priority, deadline, industry, required_skills_json,
                      created_at, updated_at)
  SELECT id, employer_id, source_headhunter_id, created_for_employer_id,
         title, description, requirements, salary_min, salary_max,
         status, priority, deadline, industry, required_skills_json,
         created_at, updated_at
  FROM jobs;

DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;

-- 重建索引
CREATE INDEX idx_jobs_employer ON jobs(employer_id);
CREATE INDEX idx_jobs_source_headhunter ON jobs(source_headhunter_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_industry ON jobs(industry);
CREATE INDEX idx_jobs_employer_status ON jobs(employer_id, status, created_at DESC);
CREATE INDEX idx_jobs_pending_claim ON jobs(created_for_employer_id, status)
  WHERE created_for_employer_id IS NOT NULL AND employer_id IS NULL;

DROP TABLE jobs_backup;

PRAGMA foreign_keys = ON;