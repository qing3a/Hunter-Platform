-- v024: Cleanup + Config table
-- 1) Drop unused webhook_subscriptions table (added in original v024, never wired to worker)
-- 2) Create config table (DB-backed, replaces JSON file storage)

DROP TABLE IF EXISTS webhook_subscriptions;

CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_admin_user_id TEXT
);
CREATE INDEX idx_config_updated ON config(updated_at);
