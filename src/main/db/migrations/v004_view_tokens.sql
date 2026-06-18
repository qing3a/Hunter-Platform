-- v004: view_tokens table for render-layer one-time access tokens

CREATE TABLE view_tokens (
  token         TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  view_type     TEXT NOT NULL,
  view_id       TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  consumed_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_view_tokens_user ON view_tokens(user_id, created_at);