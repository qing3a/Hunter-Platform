-- v006: API key rotation grace period
-- When a user rotates their API key, the OLD key is preserved for a 24h
-- grace period so any in-flight requests / queued webhooks can still
-- complete. The middleware filters out keys whose expires_at is in the
-- past. New keys are written with expires_at = NULL (meaning "never expires").

ALTER TABLE users ADD COLUMN api_key_expires_at TEXT;
CREATE INDEX idx_users_api_key_expires ON users(api_key_expires_at);