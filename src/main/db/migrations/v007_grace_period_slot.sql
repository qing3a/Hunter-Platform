-- v007: grace period slot for rotated API keys
-- When a user rotates their API key, the OLD hash moves to a "previous" slot
-- with an expires_at = now + 24h. The auth middleware checks BOTH slots:
-- current (api_key_hash) OR previous (prev_api_key_hash) if prev_expires_at > now.
--
-- Only one grace slot (no chains). Rotating twice in 24h overwrites the grace slot.

ALTER TABLE users ADD COLUMN prev_api_key_hash TEXT;
ALTER TABLE users ADD COLUMN prev_api_key_prefix TEXT;
ALTER TABLE users ADD COLUMN prev_api_key_expires_at TEXT;
CREATE INDEX idx_users_prev_api_key_prefix ON users(prev_api_key_prefix);