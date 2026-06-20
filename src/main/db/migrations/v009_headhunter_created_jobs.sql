-- v009: 猎头代雇主建岗 - jobs.employer_id 可空 + 追踪 source_headhunter_id
--
-- SQLite 不支持直接改 NOT NULL，需要重建表。
-- 走 v008 同款 rename/copy/drop/rename 模式。
-- 加 CHECK 约束保证语义不冲突: 要么是雇主直发，要么是猎头代发。
-- (本文件被 runMigrations 包在 BEGIN/COMMIT 里, 不要加 BEGIN/COMMIT)

PRAGMA foreign_keys = OFF;

-- 备份原表 (迁移失败可回滚)
CREATE TABLE jobs_backup AS SELECT * FROM jobs;

CREATE TABLE jobs_new (
  id                       TEXT PRIMARY KEY,
  employer_id              TEXT REFERENCES users(id),     -- 改 nullable
  source_headhunter_id     TEXT REFERENCES users(id),     -- 新增
  created_for_employer_id  TEXT REFERENCES users(id),     -- 新增
  title                    TEXT NOT NULL,
  description              TEXT,
  requirements             TEXT,
  salary_min               INTEGER,
  salary_max               INTEGER,
  status                   TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paused','closed','filled')),
  priority                 TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  deadline                 TEXT,
  industry                 TEXT,
  required_skills_json     TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  -- 一致性约束: 要么是雇主直发，要么是猎头代发
  CHECK (
    (source_headhunter_id IS NULL AND employer_id IS NOT NULL) OR
    (source_headhunter_id IS NOT NULL)
  )
);

-- 从 v002/v005 演进后的 jobs 表列顺序 (15 列):
-- id, employer_id, title, description, requirements, salary_min, salary_max,
-- status, priority, deadline, industry, required_skills_json, created_at, updated_at
-- 显式列出 14 个原列 (不含 required_skills_json, 它是 v005 后才有的, 但 14 列)
INSERT INTO jobs_new (id, employer_id, source_headhunter_id, created_for_employer_id,
                      title, description, requirements, salary_min, salary_max,
                      status, priority, deadline, industry, required_skills_json,
                      created_at, updated_at)
  SELECT id, employer_id, NULL, NULL, title, description, requirements,
         salary_min, salary_max, status, priority, deadline, industry,
         required_skills_json, created_at, updated_at
  FROM jobs;

DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;

-- 重建索引
CREATE INDEX idx_jobs_employer ON jobs(employer_id);
CREATE INDEX idx_jobs_source_headhunter ON jobs(source_headhunter_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_industry ON jobs(industry);
CREATE INDEX idx_jobs_employer_status ON jobs(employer_id, status, created_at DESC);
-- 新加: 雇主"待认领"列表
CREATE INDEX idx_jobs_pending_claim ON jobs(created_for_employer_id, status)
  WHERE created_for_employer_id IS NOT NULL AND employer_id IS NULL;

-- 迁移成功, 删 backup
DROP TABLE jobs_backup;

PRAGMA foreign_keys = ON;
