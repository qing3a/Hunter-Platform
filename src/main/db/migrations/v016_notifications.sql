-- v016: 站内信 / 系统通知
-- 范围：单向系统通知；30 天过期；客户端通过轮询拉取
-- 不需要 IMAP、不需要附件解析、不需要 webhook 推送

CREATE TABLE notifications (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  category      TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT,
  payload_json  TEXT,
  read_at       TEXT,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  dedup_key     TEXT
);

CREATE INDEX idx_notifications_user_unread
  ON notifications(user_id, read_at, created_at DESC);

CREATE INDEX idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

CREATE INDEX idx_notifications_expires
  ON notifications(expires_at);

CREATE UNIQUE INDEX idx_notifications_dedup
  ON notifications(user_id, category, dedup_key)
  WHERE dedup_key IS NOT NULL;
