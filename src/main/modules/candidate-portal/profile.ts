// Candidate Portal: profile view/edit/audit-log handler
//
// Public-facing methods called from the router layer (Task 12). This module
// only enforces authz (user must be a candidate) and field-level guards
// (visibility enum); the router enforces payload-shape strictness via Zod.
//
// PII protection contract:
//   - The candidate sees their PII (name, current_company, education_tier) as
//     a READ-ONLY mirror under `pii`. They cannot edit it via this endpoint.
//   - The repo's update methods only touch public columns (skills_json,
//     expectations_json, visibility) on candidates_anonymized — there is no
//     path through this handler that writes to candidates_private or users.

import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import {
  createCandidatePortalProfileRepo,
  type CandidateProfileView,
  type CandidateAuditEntry,
} from '../../db/repositories/candidate-portal-profile.js';
import { Errors } from '../../errors.js';

export type Visibility = 'public' | 'invitation_only' | 'hidden';

const VALID_VISIBILITIES: readonly Visibility[] = ['public', 'invitation_only', 'hidden'] as const;

export interface ProfileUpdateInput {
  skills?: string[];
  expectations?: object;
  visibility?: Visibility;
}

export interface AuditLogQuery {
  limit?: number;
  offset?: number;
}

export interface ProfileModule {
  getProfile(user: User): CandidateProfileView;
  updateProfile(user: User, input: ProfileUpdateInput): void;
  listAuditLog(user: User, opts?: AuditLogQuery): CandidateAuditEntry[];
}

export function createCandidatePortalProfile(db: DB): ProfileModule {
  const repo = createCandidatePortalProfileRepo(db);

  return {
    /**
     * Return the candidate's public profile + read-only PII mirror.
     * Throws 404 when no anonymized record exists yet (candidate hasn't
     * completed onboarding).
     */
    getProfile(user: User): CandidateProfileView {
      if (user.user_type !== 'candidate') {
        throw Errors.forbidden('Only candidates can view profile');
      }
      const profile = repo.getProfile(user.id);
      if (!profile) {
        throw Errors.notFound('Profile not found — complete onboarding first');
      }
      return profile;
    },

    /**
     * Apply a partial update. Only the public columns (skills, expectations,
     * visibility) can be modified; PII columns are deliberately not writable
     * here. The Zod schema in the router layer (Task 12) rejects unknown
     * fields, so a PII field sent by the client would never reach this
     * method — defense-in-depth: we still touch no private fields below.
     */
    updateProfile(user: User, input: ProfileUpdateInput): void {
      if (user.user_type !== 'candidate') {
        throw Errors.forbidden('Only candidates can edit profile');
      }
      const profile = repo.getProfile(user.id);
      if (!profile) {
        throw Errors.notFound('Profile not found — complete onboarding first');
      }

      if (input.skills !== undefined) {
        if (!Array.isArray(input.skills)) {
          throw Errors.invalidParams('skills must be an array of strings');
        }
        const sanitized = input.skills.map(String).map((s) => s.trim()).filter((s) => s.length > 0);
        repo.updateSkills(profile.id, sanitized);
      }
      if (input.expectations !== undefined) {
        if (!input.expectations || typeof input.expectations !== 'object' || Array.isArray(input.expectations)) {
          throw Errors.invalidParams('expectations must be an object');
        }
        repo.updateExpectations(profile.id, input.expectations);
      }
      if (input.visibility !== undefined) {
        if (!VALID_VISIBILITIES.includes(input.visibility)) {
          throw Errors.invalidParams(
            `Invalid visibility value: must be one of ${VALID_VISIBILITIES.join(', ')}`,
          );
        }
        repo.updateVisibility(profile.id, input.visibility);
      }
    },

    /**
     * List audit-log entries that touched this candidate's anonymized record
     * (express-interest / approve / reject / unlock / revoke by headhunters
     * and employers). Returns [] when no recommendations exist yet.
     */
    listAuditLog(user: User, opts: AuditLogQuery = {}): CandidateAuditEntry[] {
      if (user.user_type !== 'candidate') {
        throw Errors.forbidden('Only candidates can view audit log');
      }
      const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
      const offset = Math.max(opts.offset ?? 0, 0);
      return repo.listAuditLog(user.id, limit, offset);
    },
  };
}