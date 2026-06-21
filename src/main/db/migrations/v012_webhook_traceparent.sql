-- v012: webhook_delivery_queue gets traceparent column for cross-system tracing
--
-- When a user action triggers a webhook (e.g. notify_unlock_request), the
-- outgoing HTTP call carries the originating trace_id via the W3C
-- `traceparent` header. This lets the recipient's Agent join their
-- trace timeline to ours — a single `traceparent` value is the join key.

ALTER TABLE webhook_delivery_queue ADD COLUMN traceparent TEXT;
