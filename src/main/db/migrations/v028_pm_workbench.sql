-- ============================================================================
-- Migration v028: PM Workbench
-- ============================================================================
-- Adds six new tables for the PM (Project Manager) workbench, supporting
-- project planning, position decomposition, staffing plans, candidate
-- matching, and per-PM candidate notes.
--
-- New tables:
--   1. projects                   — PM-owned projects with target/budget/dates/status
--   2. project_positions          — positions within a project (headcount, salary, status)
--   3. staffing_plans             — staffing scenarios per project (selected vs draft)
--   4. position_decompositions    — AI/heuristic-driven text→positions decomposition history
--   5. matches                    — scored candidate↔position matches with reasons/gaps
--   6. pm_notes                   — per-PM private notes on candidates (starred + free text)
--
-- Foreign-key notes:
--   - projects.pm_user_id → users(id)            (no ON DELETE — soft-delete semantics)
--   - project_positions.project_id → projects(id) ON DELETE CASCADE
--   - staffing_plans.project_id → projects(id)   ON DELETE CASCADE
--   - matches.position_id → project_positions(id) ON DELETE CASCADE
--   - matches.candidate_user_id → users(id)
--   - pm_notes.{pm_user_id,candidate_user_id} → users(id)
--
-- pm_notes is included in this migration per the v028 plan; future code will
-- expose CRUD endpoints on it (star / unstar / edit note).
--
-- (runMigrations wraps this file in BEGIN/COMMIT, so do NOT add them here.)
-- ============================================================================

CREATE TABLE projects (
  id              TEXT PRIMARY KEY,
  pm_user_id      TEXT NOT NULL,
  name            TEXT NOT NULL,
  target          TEXT,
  budget_total    INTEGER,
  start_at        INTEGER,
  end_at          INTEGER,
  current_team    TEXT,
  status          TEXT NOT NULL DEFAULT 'planning',
  -- status: 'planning' | 'active' | 'paused' | 'completed' | 'cancelled'
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (pm_user_id) REFERENCES users(id)
);
CREATE INDEX idx_projects_pm ON projects(pm_user_id, status);

CREATE TABLE project_positions (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  required_skills_json TEXT,
  title_level     TEXT,
  industry        TEXT,
  salary_min      INTEGER,
  salary_max      INTEGER,
  status          TEXT NOT NULL DEFAULT 'open',
  -- status: 'open' | 'paused' | 'filled' | 'cancelled'
  headcount_planned INTEGER NOT NULL DEFAULT 1,
  headcount_filled INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX idx_project_positions_project ON project_positions(project_id, status);

CREATE TABLE staffing_plans (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  total_headcount INTEGER NOT NULL,
  estimated_cost  INTEGER,
  positions_json  TEXT NOT NULL,
  is_selected     INTEGER NOT NULL DEFAULT 0,
  -- 0 = draft/archived, 1 = currently selected plan for the project
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX idx_staffing_plans_project ON staffing_plans(project_id, is_selected);

CREATE TABLE position_decompositions (
  id              TEXT PRIMARY KEY,
  source_text     TEXT NOT NULL,
  positions_json  TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'ai_heuristic',
  -- source: 'ai_heuristic' | 'ai_llm' | 'manual'
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE matches (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id     TEXT NOT NULL,
  candidate_user_id TEXT NOT NULL,
  score           INTEGER NOT NULL,
  reasons_json    TEXT,
  gaps_json       TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (position_id) REFERENCES project_positions(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_user_id) REFERENCES users(id),
  UNIQUE(position_id, candidate_user_id)
);
CREATE INDEX idx_matches_position ON matches(position_id, score DESC);

CREATE TABLE pm_notes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pm_user_id      TEXT NOT NULL,
  candidate_user_id TEXT NOT NULL,
  starred         INTEGER NOT NULL DEFAULT 0,
  note_text       TEXT,
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (pm_user_id) REFERENCES users(id),
  FOREIGN KEY (candidate_user_id) REFERENCES users(id),
  UNIQUE(pm_user_id, candidate_user_id)
);