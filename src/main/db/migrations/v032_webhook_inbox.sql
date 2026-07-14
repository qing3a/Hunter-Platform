-- ============================================================================
-- Migration v032: Webhook inbox dedup + POST /v1/webhooks/qing3
-- ============================================================================
-- See docs/superpowers/specs/2026-07-11-positioning.md §4.1 (C3, R1 P0)
-- ow-recruit optionally relays events to hunter-platform via this endpoint.
--
-- Idempotency strategy:
--   - Each delivery carries an HMAC-signed body (X-Hunter-Signature) with ±5min
--     replay window (handled by src/main/modules/webhook/hmac.ts).
--   - Within the window, the same body may be retried (network blips, 502s, replay
--     attacks). We dedup on the SHA256(body) fingerprint — UNIQUE(endpoint, body_hash).
--   - The unique-index conflict on INSERT signals "duplicate"; the route returns
--     { ok: true, deduped: true } instead of re-processing the event.
--
-- Schema notes:
--   - `endpoint` is a string tag ('qing3') so the same body could legitimately be
--     re-processed under a different endpoint (future compat).
--   - `sender_id` is nullable — external relays don't always identify themselves.
--   - `headers_json` stores X-Hunter-* headers for audit replay; not authoritative.
--   - `body_json` is the raw incoming payload (TEXT, not foreign-keyed to any
--     other table — webhooks are loosely coupled until processed).
--   - `processed_at` and `status` track downstream-handler success; left NULL/'pending'
--     by the dedup endpoint itself — a separate consumer (Phase 2) flips them.
-- ============================================================================

CREATE TABLE webhook_inbox_deliveries (
  id              TEXT    PRIMARY KEY,
  endpoint        TEXT    NOT NULL,
  sender_id       TEXT,
  body_hash       TEXT    NOT NULL,            -- SHA256(body) hex
  headers_json    TEXT    NOT NULL,
  body_json       TEXT    NOT NULL,
  received_at     TEXT    NOT NULL,
  processed_at    TEXT,
  status          TEXT    NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'processed', 'duplicate', 'failed')),
  error           TEXT,
  -- Cross-table idempotency: same (endpoint, body_hash) may not appear twice.
  -- This is the keystone of C3 — replay/resend protection.
  UNIQUE (endpoint, body_hash)
);

CREATE INDEX idx_webhook_inbox_endpoint_received
  ON webhook_inbox_deliveries(endpoint, received_at DESC);
CREATE INDEX idx_webhook_inbox_status
  ON webhook_inbox_deliveries(status, received_at);
