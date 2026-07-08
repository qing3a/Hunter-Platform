import { randomUUID } from 'node:crypto';
import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import { createCandidateOtpRepo } from '../../db/repositories/candidate-otp.js';
import { createUsersRepo } from '../../db/repositories/users.js';
import { generateOtp, hashOtp, verifyOtp } from '../../lib/otp.js';
import { createEmailService, type EmailService } from '../../lib/email.js';
import { checkOtpRequestLimit } from '../../lib/rate-limit-portal.js';
import { Errors } from '../../errors.js';

/**
 * User-type discriminator accepted by the OTP endpoints. The candidate-portal
 * router historically only handled `candidate`; Phase 3a (Task 11) extends it
 * to also authenticate headhunters so the hunter portal can reuse the same
 * `/v1/candidate-portal/auth/otp/*` endpoints without spinning up a separate
 * router.
 *
 * `employer` is intentionally absent — the employer portal uses a different
 * auth path (admin login). If a caller passes anything outside this union,
 * the request schema rejects it with a 400.
 */
export type OtpUserType = 'candidate' | 'headhunter';

export interface OtpRequestInput {
  email: string;
  user_type?: OtpUserType;  // default: 'candidate'
  ip?: string;
}

export interface OtpVerifyInput {
  email: string;
  code: string;
  user_type?: OtpUserType;  // default: 'candidate'
}

export interface OtpRequestResult {
  expires_in: number;
  dev_code?: string;
}

export interface OtpVerifyResult {
  api_key: string;
  user_id: string;
  /** Always false for headhunters (no portal-side onboarding flow). */
  profile_complete: boolean;
  /** Echo of the resolved user_type so the client can pick the right portal. */
  user_type: OtpUserType;
}

export function createCandidatePortalAuth(
  db: DB,
  opts: {
    otpLength: number;
    otpTtlSeconds: number;
    otpMaxAttempts: number;
    consoleOnly: boolean;
  }
) {
  const otpRepo = createCandidateOtpRepo(db);
  const users = createUsersRepo(db);
  const email: EmailService = createEmailService({ consoleOnly: opts.consoleOnly });

  return {
    /**
     * Request an OTP for the given email. Generates a new code, stores its
     * bcrypt hash, and dispatches the plain code via the email service.
     *
     * Rate-limited per-IP and per-email via checkOtpRequestLimit.
     * In console mode the plain code is returned as dev_code for local testing.
     *
     * `user_type` only changes the user-creation step inside `verifyOtp` —
     * the OTP itself is just an email-keyed token, so the same rate-limit
     * bucket / code hash / TTL applies regardless of destination portal.
     */
    async requestOtp(input: OtpRequestInput): Promise<OtpRequestResult> {
      const ip = input.ip ?? 'unknown';
      const limit = checkOtpRequestLimit(ip, input.email);
      if (!limit.ok) {
        const seconds = Math.ceil((limit.retryAfterMs ?? 0) / 1000);
        throw Errors.rateLimited(`${limit.reason}: retry after ${seconds}s`, {
          retry_after_seconds: seconds,
        });
      }

      const code = generateOtp(opts.otpLength);
      const codeHash = hashOtp(code);
      const expiresAt = Date.now() + opts.otpTtlSeconds * 1000;
      otpRepo.insert({ email: input.email, code_hash: codeHash, expires_at: expiresAt });

      await email.sendOtp(input.email, code, opts.otpTtlSeconds);

      const result: OtpRequestResult = {
        expires_in: opts.otpTtlSeconds,
      };
      if (opts.consoleOnly) result.dev_code = code;
      return result;
    },

    /**
     * Verify an OTP for the given email. On success:
     *  - find or auto-create the user (candidate OR headhunter, keyed by contact = email)
     *  - issue a fresh hp_live_ API key (overwriting any prior one)
     *  - return { api_key, user_id, profile_complete, user_type }
     *
     * `user_type` defaults to 'candidate' so legacy callers (and the existing
     * candidate-portal tests that don't set it) keep working unchanged. The
     * returned `user_type` is what the client uses to decide which portal
     * (`/candidate/home` vs `/hunter/workspace`) to redirect to.
     *
     * profile_complete semantics:
     *  - candidate: true when the user has a candidates_anonymized row whose
     *    skills_json is a non-empty array (onboarding done).
     *  - headhunter: always false — the hunter portal has no portal-side
     *    onboarding step to gate the redirect on.
     */
    async verifyOtp(input: OtpVerifyInput): Promise<OtpVerifyResult> {
      const userType: OtpUserType = input.user_type ?? 'candidate';
      const active = otpRepo.findActive(input.email);
      if (!active) {
        throw Errors.notFound('OTP_EXPIRED: No active OTP for this email');
      }

      // Increment attempts BEFORE verification so failed attempts count even
      // if the caller crashes mid-request.
      otpRepo.incrementAttempts(active.id);
      if (active.attempts + 1 > opts.otpMaxAttempts) {
        throw Errors.rateLimited('OTP_TOO_MANY_ATTEMPTS', {
          attempts: active.attempts + 1,
          max: opts.otpMaxAttempts,
        });
      }
      if (!verifyOtp(input.code, active.code_hash)) {
        throw Errors.unauthorized('OTP_INVALID: Code does not match');
      }
      otpRepo.markConsumed(active.id);

      // Find or auto-create the user, keyed by (contact = email, user_type).
      // We deliberately do NOT treat "this email exists as a candidate" as
      // "this email exists as a headhunter" — the two portals must remain
      // disjoint so a candidate who later becomes a hunter gets two distinct
      // accounts (api_keys / quotas / role differ).
      let user: User | null;
      let profileComplete = false;

      if (userType === 'headhunter') {
        user = users.findHeadhunterByEmail(input.email);
        if (!user) {
          const id = `hunter_${randomUUID().slice(0, 12)}`;
          users.createHeadhunter(id, input.email);
          user = users.findHeadhunterByEmail(input.email);
          if (!user) {
            // Should never happen — the createHeadhunter call above must have
            // inserted the row. Surface as 500 (internal) so the client retries.
            throw Errors.internal('Failed to create headhunter user');
          }
        }
        // Hunters skip the portal-side profile-completion gate.
        profileComplete = false;
      } else {
        user = users.findCandidateByEmail(input.email);
        if (!user) {
          const id = `cand_${randomUUID().slice(0, 12)}`;
          users.createCandidate(id, input.email);
          user = users.findCandidateByEmail(input.email);
          if (!user) {
            // Should never happen — the createCandidate call above must have
            // inserted the row. Surface as 500 (internal) so the client retries.
            throw Errors.internal('Failed to create candidate user');
          }
        }
        // profile_complete: candidate has filled in skills via the portal.
        const profileRow = db.prepare(`
          SELECT ca.id, ca.skills_json
          FROM candidates_anonymized ca
          JOIN candidates_private cp ON cp.id = ca.source_private_id
          WHERE cp.candidate_user_id = ?
        `).get(user.id) as { id: string; skills_json: string | null } | undefined;
        profileComplete =
          !!profileRow && !!profileRow.skills_json && profileRow.skills_json !== '[]';
      }

      // Issue a fresh API key (24 random bytes base64url, prefix `hp_live_`).
      // We generate the key inline (instead of using generateApiKey()) so the
      // helper only has to bcrypt-hash once, inside setApiKey().
      const random = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
      const apiKey = `hp_live_${random.slice(0, 32)}`;
      users.setApiKey(user.id, apiKey);

      return {
        api_key: apiKey,
        user_id: user.id,
        profile_complete: profileComplete,
        user_type: userType,
      };
    },
  };
}
