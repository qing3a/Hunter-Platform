-- ============================================================================
-- Migration v027: Hunter workspace (Phase 3a)
-- ============================================================================
-- Adds two new tables for the headhunter personal workspace, plus two columns
-- on recommendations to drive the kanban flow.
--
-- New tables:
--   1. hunter_tasks    — 个人待办 (per-headhunter todos with priority + due_at)
--   2. kanban_columns  — 看板列定义 (per-headhunter 5-column board)
--
-- Modified tables:
--   3. recommendations: +pipeline_stage, +kanban_position
--      pipeline_stage:  submitted|screen_passed|interview|offer|onboarded|rejected
--      kanban_position: nullable INTEGER for ordering within a column
--                       (NULL = 默认末尾)
--
-- Default kanban columns are inserted at onboarding time by the handler, not
-- here — keeps schema-only data in migrations.
--
-- (runMigrations wraps this file in BEGIN/COMMIT, so do NOT add them here.)
-- ============================================================================

CREATE TABLE hunter_tasks (
  id                          TEXT PRIMARY KEY,
  hunter_user_id              TEXT NOT NULL,
  title                       TEXT NOT NULL,
  description                 TEXT,
  related_recommendation_id   TEXT,
  related_candidate_user_id   TEXT,
  due_at                      INTEGER,
  completed_at                INTEGER,
  priority                    TEXT NOT NULL DEFAULT 'normal',
  -- priority: 'low' | 'normal' | 'high' | 'urgent'
  created_at                  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at                  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (hunter_user_id)            REFERENCES users(id),
  FOREIGN KEY (related_recommendation_id) REFERENCES recommendations(id),
  FOREIGN KEY (related_candidate_user_id) REFERENCES users(id)
);
CREATE INDEX idx_hunter_tasks_hunter ON hunter_tasks(hunter_user_id, completed_at);
CREATE INDEX idx_hunter_tasks_due ON hunter_tasks(hunter_user_id, due_at) WHERE completed_at IS NULL;

CREATE TABLE kanban_columns (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  hunter_user_id  TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  -- name: '投递' | '简历过' | '面试' | 'offer' | '到岗'
  position        INTEGER NOT NULL,
  -- 列顺序 (越小越靠左)
  pipeline_stage  TEXT    NOT NULL,
  -- 与 recommendations.pipeline_stage 对应
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (hunter_user_id) REFERENCES users(id),
  UNIQUE(hunter_user_id, name)
);
CREATE INDEX idx_kanban_columns_hunter ON kanban_columns(hunter_user_id, position);

-- ============================================================================
-- ALTER: recommendations 增加 pipeline_stage + kanban_position (用于看板)
-- ============================================================================

ALTER TABLE recommendations ADD COLUMN pipeline_stage TEXT NOT NULL DEFAULT 'submitted';
  -- pipeline_stage: 'submitted' | 'screen_passed' | 'interview' | 'offer' | 'onboarded' | 'rejected'
ALTER TABLE recommendations ADD COLUMN kanban_position INTEGER;
  -- 列内排序, NULL = 默认末尾