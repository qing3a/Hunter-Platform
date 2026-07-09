-- ============================================================================
-- Migration v030: PM Sandbox — link recommendations to project_positions
-- ============================================================================
-- Phase 3b / Task 9. The PM Sandbox page aggregates hunter-side
-- `recommendations` by pipeline_stage for a specific PM project_position.
-- Until now the recommendation ↔ position link was implicit (via the
-- `matches` table's position_id, joined through candidate_user_id ↔
-- candidates_private.candidate_user_id ↔ candidates_anonymized.source_private_id
-- ↔ recommendations.anonymized_candidate_id — a 4-hop join that's both slow
-- and easy to break with future schema changes).
--
-- Schema changes:
--   1. recommendations.position_id     — nullable TEXT FK to project_positions(id)
--                                        ON DELETE CASCADE. Existing rows are
--                                        NULL (hunter-side recommendations
--                                        don't currently know about PM
--                                        positions; only new
--                                        PM-sourced/submitted recs will set it).
--   2. recommendations.stage_entered_at — nullable INTEGER (unix ms). The
--                                        timestamp at which the recommendation
--                                        entered its current pipeline_stage.
--                                        Defaults to updated_at for existing rows
--                                        so the sandbox can still compute risk
--                                        flags without a separate backfill.
--
-- Indexes:
--   - idx_recommendations_position         for the sandbox aggregation query
--   - idx_recommendations_position_stage   composite to speed up
--                                          findByPositionAndStage
--
-- (runMigrations wraps this file in BEGIN/COMMIT, so do NOT add them here.)
-- ============================================================================

ALTER TABLE recommendations ADD COLUMN position_id TEXT REFERENCES project_positions(id) ON DELETE CASCADE;
ALTER TABLE recommendations ADD COLUMN stage_entered_at INTEGER;

-- Backfill stage_entered_at = updated_at (parsed to unix ms) for existing rows
-- so the sandbox can compute risk flags without further migrations. updated_at
-- is stored as an ISO string (TEXT); we parse it with strftime for safety.
UPDATE recommendations
   SET stage_entered_at = CAST(strftime('%s', updated_at) AS INTEGER) * 1000
 WHERE stage_entered_at IS NULL;

CREATE INDEX idx_recommendations_position ON recommendations(position_id);
CREATE INDEX idx_recommendations_position_stage ON recommendations(position_id, pipeline_stage);