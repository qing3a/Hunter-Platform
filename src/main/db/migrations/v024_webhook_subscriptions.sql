-- v024: Webhook subscriptions (Sub-E)
-- Stores admin-configured webhook endpoints that should receive event notifications.
-- Worker (not in this migration) currently does NOT read this table — see Sub-F
-- (Sub-E+) for worker integration. This Sub-E only adds the management UI/API.

CREATE TABLE webhook_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_url TEXT NOT NULL,
  event_types TEXT NOT NULL,        -- JSON array, e.g. '["placement.paid","candidate.unlocked"]'
  hmac_secret TEXT,                -- nullable; if NULL, uses global WEBHOOK_HMAC_SECRET
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_admin_user_id TEXT
);

CREATE INDEX idx_webhook_subs_enabled ON webhook_subscriptions(enabled);
