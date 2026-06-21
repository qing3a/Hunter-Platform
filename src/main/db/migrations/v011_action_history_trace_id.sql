-- v011: add trace_id column to action_history for distributed-trace correlation
--
-- A row in action_history is the audit record of one user action. We now
-- stamp it with the OTel trace_id of the request that caused the action,
-- so an external Agent can report a failure (with x-trace-id from the
-- response header) and we can join straight from action_history to the
-- OTel backend to reconstruct the full timeline.
--
-- trace_id is nullable: pre-existing rows (and rows from non-HTTP code
-- paths) will have NULL. New rows are stamped by actionHistoryMiddleware.

ALTER TABLE action_history ADD COLUMN trace_id TEXT;

CREATE INDEX idx_action_history_trace_id ON action_history(trace_id)
  WHERE trace_id IS NOT NULL;
