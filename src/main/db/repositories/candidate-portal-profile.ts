// Candidate Portal: profile view/edit repository
//
// Adapts the implementation plan to the actual schema:
//   - candidates_private stores `name_enc` / `phone_enc` / `email_enc` (encrypted
//     ciphertext) but `current_company_raw` / `current_title_raw` as plaintext.
//     The plan's `cp.name` and `cp.current_company` columns do not exist; we
//     substitute `users.name` (already populated by OTP auto-create) and
//     `cp.current_company_raw`.
//   - candidates_anonymized owns the public fields the candidate can edit:
//     industry, title_level, years_experience, skills_json, visibility,
//     expectations_json. education_tier is anonymized-side but treated as
//     read-only PII (derived from the candidate's school, classified into tiers).
//   - unlock_audit_log is keyed by `recommendation_id` (not `candidate_private_id`
//     as the plan guessed). We join through `recommendations.anonymized_candidate_id`
//     to surface audit events that touched this candidate's record.

import type { DB } from '../connection.js';

export interface CandidateProfileView {
  // Public, candidate-editable fields
  id: string;
  industry: string | null;
  title_level: string | null;
  years_experience: number | null;
  skills: string[];
  visibility: 'public' | 'invitation_only' | 'hidden';
  expectations: {
    desired_roles?: string[];
    expected_salary_min?: number;
    expected_salary_max?: number;
    open_to_remote?: boolean;
  } | null;
  // PII read-only mirror (candidate sees but cannot edit via this endpoint)
  pii: {
    name: string | null;
    current_company: string | null;
    education_tier: string | null;
  };
}

export interface CandidateAuditEntry {
  created_at: string;
  action: string;
  actor_user_id: string;
  viewer_type: 'candidate' | 'hr' | 'pm' | null;
  viewer_name: string | null;
}

export function createCandidatePortalProfileRepo(db: DB) {
  // Single-statement read joining anon + private + user. Private row may not
  // exist for a freshly-OTP'd candidate (only `users` row is created); we
  // LEFT JOIN so the query still returns a row (with all anon fields NULL)
  // rather than 0 rows — caller can then decide what to do with a
  // profile-less candidate. Currently callers throw 404 in that case.
  const getProfileStmt = db.prepare(`
    SELECT
      ca.id, ca.industry, ca.title_level, ca.years_experience,
      ca.skills_json, ca.visibility, ca.expectations_json, ca.education_tier,
      u.name AS user_name,
      cp.current_company_raw
    FROM users u
    LEFT JOIN candidates_private cp ON cp.candidate_user_id = u.id
    LEFT JOIN candidates_anonymized ca ON ca.source_private_id = cp.id
    WHERE u.id = ? AND u.user_type = 'candidate'
  `);

  const updateSkillsStmt = db.prepare(
    `UPDATE candidates_anonymized SET skills_json = ?, updated_at = ? WHERE id = ?`
  );
  const updateExpectationsStmt = db.prepare(
    `UPDATE candidates_anonymized SET expectations_json = ?, updated_at = ? WHERE id = ?`
  );
  const updateVisibilityStmt = db.prepare(
    `UPDATE candidates_anonymized SET visibility = ?, updated_at = ? WHERE id = ?`
  );

  // Audit log is keyed by recommendation; join through anon_id to find all
  // audit events that touched *this* candidate's anonymized record.
  const auditLogStmt = db.prepare(`
    SELECT
      ual.created_at,
      ual.action,
      ual.actor_user_id,
      u.user_type AS viewer_type,
      u.name      AS viewer_name
    FROM unlock_audit_log ual
    JOIN recommendations r ON r.id = ual.recommendation_id
    LEFT JOIN users u ON u.id = ual.actor_user_id
    WHERE r.anonymized_candidate_id IN (
      SELECT ca.id FROM candidates_anonymized ca
      JOIN candidates_private cp ON cp.id = ca.source_private_id
      WHERE cp.candidate_user_id = ?
    )
    ORDER BY ual.created_at DESC
    LIMIT ? OFFSET ?
  `);

  return {
    /**
     * Fetch the public profile + read-only PII mirror for the candidate.
     * Returns null when no `users` row exists with that id (caller checks).
     * Returns a shape with all NULL fields when the candidate has no
     * candidates_anonymized row yet (callers typically treat this as 404).
     */
    getProfile(userId: string): CandidateProfileView | null {
      const row = getProfileStmt.get(userId) as {
        id: string | null;
        industry: string | null;
        title_level: string | null;
        years_experience: number | null;
        skills_json: string | null;
        visibility: string | null;
        expectations_json: string | null;
        education_tier: string | null;
        user_name: string | null;
        current_company_raw: string | null;
      } | undefined;
      if (!row) return null;

      // No anonymized record yet — treat as "no profile" (callers should 404).
      if (!row.id) return null;

      let skills: string[] = [];
      if (row.skills_json) {
        try {
          const parsed = JSON.parse(row.skills_json);
          if (Array.isArray(parsed)) skills = parsed.map(String);
        } catch {
          // Malformed JSON — surface as empty list rather than 500
          skills = [];
        }
      }

      let expectations: CandidateProfileView['expectations'] = null;
      if (row.expectations_json) {
        try {
          const parsed = JSON.parse(row.expectations_json);
          expectations = (parsed && typeof parsed === 'object') ? parsed as CandidateProfileView['expectations'] : null;
        } catch {
          expectations = null;
        }
      }

      const visibility = (row.visibility ?? 'public') as CandidateProfileView['visibility'];

      return {
        id: row.id,
        industry: row.industry,
        title_level: row.title_level,
        years_experience: row.years_experience,
        skills,
        visibility,
        expectations,
        pii: {
          name: row.user_name,
          current_company: row.current_company_raw,
          education_tier: row.education_tier,
        },
      };
    },

    updateSkills(anonId: string, skills: string[]): void {
      updateSkillsStmt.run(JSON.stringify(skills), new Date().toISOString(), anonId);
    },

    updateExpectations(anonId: string, expectations: object): void {
      updateExpectationsStmt.run(JSON.stringify(expectations), new Date().toISOString(), anonId);
    },

    updateVisibility(anonId: string, visibility: string): void {
      updateVisibilityStmt.run(visibility, new Date().toISOString(), anonId);
    },

    /**
     * List audit-log entries that touched this candidate's anonymized record.
     * Returns [] when the candidate has no recommendations yet (or no audit
     * entries against them).
     */
    listAuditLog(userId: string, limit: number, offset: number): CandidateAuditEntry[] {
      const rows = auditLogStmt.all(userId, limit, offset) as Array<{
        created_at: string;
        action: string;
        actor_user_id: string;
        viewer_type: 'candidate' | 'hr' | 'pm' | null;
        viewer_name: string | null;
      }>;
      return rows;
    },
  };
}