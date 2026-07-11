-- ============================================================================
-- Migration v013: rename action_history.action_type → capability_name
-- ============================================================================
-- Rationale: Phase 4 introduced the capability declaration system, which
-- uses dotted names like 'headhunter.upload_candidate'. The legacy
-- action_type column used short names like 'upload_candidate' from a
-- separate static map. This migration collapses to one system: every place
-- in the system that identifies an action uses the same canonical string.
--
-- Idempotency: All UPDATEs are equality matches (already-migrated rows have
-- names that don't match any short-name WHERE clause). The column rename
-- would fail harmlessly on the second run with "duplicate column name"
-- which is fine — the DROP INDEX is guarded by IF EXISTS.
--
-- Disambiguation: The short names `create_job` and `list_my_jobs` exist in
-- BOTH headhunter and employer contexts. We JOIN on the `users` table to
-- route them to the correct role-prefixed capability name based on the
-- actor's user_type. This is the JOIN-based approach from plan Step 1.2.
-- ============================================================================

-- Rename the column
ALTER TABLE action_history RENAME COLUMN action_type TO capability_name;

-- Replace the old index with one matching the new column name
DROP INDEX IF EXISTS idx_action_history_type;
CREATE INDEX idx_action_history_capability ON action_history(capability_name, created_at);

-- Migrate all existing values to the new capability_name format.
-- Order: 30 from route-action-map + 2 from flows/user.ts + 1 hardcoded
-- ('placement_created' in dashboard.ts).
--
-- The `create_job` and `list_my_jobs` short names exist in BOTH headhunter
-- and employer contexts. We split them via a JOIN on users.user_type so
-- headhunter actors get `headhunter.*` and employer actors get `employer.*`.
UPDATE action_history SET capability_name = 'auth.register'                  WHERE capability_name = 'register';
UPDATE action_history SET capability_name = 'auth.rotate_key'               WHERE capability_name = 'rotate_api_key';
UPDATE action_history SET capability_name = 'headhunter.upload_candidate'    WHERE capability_name = 'upload_candidate';
UPDATE action_history SET capability_name = 'headhunter.list_candidates'     WHERE capability_name = 'list_my_candidates';
UPDATE action_history SET capability_name = 'headhunter.publish_to_pool'     WHERE capability_name = 'publish_to_pool';
UPDATE action_history SET capability_name = 'headhunter.recommend_candidate' WHERE capability_name = 'recommend_candidate';
UPDATE action_history SET capability_name = 'headhunter.list_recommendations' WHERE capability_name = 'list_my_recommendations';
UPDATE action_history SET capability_name = 'headhunter.withdraw_recommendation' WHERE capability_name = 'withdraw_recommendation';

-- Ambiguous: `create_job` exists for both headhunter and employer.
-- Disambiguate via JOIN on the users table (the actor's user_type).
UPDATE action_history
SET capability_name = 'headhunter.create_job'
WHERE capability_name = 'create_job'
  AND user_id IN (SELECT id FROM users WHERE user_type = 'hr');
UPDATE action_history
SET capability_name = 'employer.create_job'
WHERE capability_name = 'create_job'
  AND user_id IN (SELECT id FROM users WHERE user_type = 'pm');

-- Ambiguous: `list_my_jobs` exists for both headhunter and employer.
UPDATE action_history
SET capability_name = 'headhunter.list_jobs'
WHERE capability_name = 'list_my_jobs'
  AND user_id IN (SELECT id FROM users WHERE user_type = 'hr');
UPDATE action_history
SET capability_name = 'employer.list_jobs'
WHERE capability_name = 'list_my_jobs'
  AND user_id IN (SELECT id FROM users WHERE user_type = 'pm');

UPDATE action_history SET capability_name = 'employer.talent'                WHERE capability_name = 'browse_talent';
UPDATE action_history SET capability_name = 'employer.express_interest'     WHERE capability_name = 'express_interest';
UPDATE action_history SET capability_name = 'employer.unlock_contact'        WHERE capability_name = 'unlock_contact';
UPDATE action_history SET capability_name = 'employer.create_placement'     WHERE capability_name = 'create_placement';
UPDATE action_history SET capability_name = 'employer.list_placements'      WHERE capability_name = 'list_my_placements';
UPDATE action_history SET capability_name = 'candidate.opportunities'       WHERE capability_name = 'list_opportunities';
UPDATE action_history SET capability_name = 'candidate.access_log'          WHERE capability_name = 'view_access_log';
UPDATE action_history SET capability_name = 'candidate.approve_unlock'       WHERE capability_name = 'approve_unlock';
UPDATE action_history SET capability_name = 'candidate.reject_unlock'        WHERE capability_name = 'reject_unlock';
UPDATE action_history SET capability_name = 'candidate.export_my_data'       WHERE capability_name = 'export_my_data';
UPDATE action_history SET capability_name = 'candidate.delete_my_data'       WHERE capability_name = 'delete_my_data';
UPDATE action_history SET capability_name = 'users.get_status'               WHERE capability_name = 'get_user_status';
UPDATE action_history SET capability_name = 'users.get_history'              WHERE capability_name = 'get_user_history';
UPDATE action_history SET capability_name = 'config.get_industries'         WHERE capability_name = 'get_config_industries';
UPDATE action_history SET capability_name = 'config.get_title_levels'        WHERE capability_name = 'get_config_title_levels';
UPDATE action_history SET capability_name = 'config.get_salary_bands'        WHERE capability_name = 'get_config_salary_bands';
UPDATE action_history SET capability_name = 'market.leaderboard'             WHERE capability_name = 'get_market_leaderboard';

-- flows/user.ts values (write to admin_action_log, not action_history, but
-- migrate here too for safety in case historical data was written via a
-- different path).
UPDATE action_history SET capability_name = 'admin.suspend_user'             WHERE capability_name = 'suspend_user';
UPDATE action_history SET capability_name = 'candidate.delete_my_data'       WHERE capability_name = 'delete_user';

-- Hardcoded value in dashboard.ts query — count of placements created today.
UPDATE action_history SET capability_name = 'employer.create_placement'      WHERE capability_name = 'placement_created';