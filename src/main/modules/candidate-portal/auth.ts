import { randomUUID } from 'node:crypto';
import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import { createCandidateOtpRepo } from '../../db/repositories/candidate-otp.js';
import { createUsersRepo } from '../../db/repositories/users.js';
import { generateOtp, hashOtp, verifyOtp } from '../../lib/otp.js';
import { createEmailService, type EmailService } from '../../lib/email.js';
import { checkOtpRequestLimit } from '../../lib/rate-limit-portal.js';
import { Errors } from '../../errors.js';

export interface OtpRequestInput {
  email: string;
  ip?: string;
}

export interface OtpVerifyInput {
  email: string;
  code: string;
}

export interface OtpRequestResult {
  expires_in: number;
  dev_code?: string;
}

export interface OtpVerifyResult {
  api_key: string;
  user_id: string;
  profile_complete: boolean;
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
     *  - find or auto-create the candidate user (keyed by contact = email)
     *  - issue a fresh hp_live_ API key (overwriting any prior one)
     *  - return { api_key, user_id, profile_complete }
     *
     * profile_complete is true when the user has a candidates_anonymized
     * row whose skills_json is a non-empty array.
     */
    async verifyOtp(input: OtpVerifyInput): Promise<OtpVerifyResult> {
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

      // Find or auto-create the candidate user.
      let user: User | null = users.findCandidateByEmail(input.email);
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

      // Issue a fresh API key (24 random bytes base64url, prefix `hp_live_`).
      // We generate the key inline (instead of using generateApiKey()) so the
      // helper only has to bcrypt-hash once, inside setApiKey().
      const random = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
      const apiKey = `hp_live_${random.slice(0, 32)}`;
      users.setApiKey(user.id, apiKey);

      // profile_complete: candidate has filled in skills via the portal.
      const profileRow = db.prepare(`
        SELECT ca.id, ca.skills_json
        FROM candidates_anonymized ca
        JOIN candidates_private cp ON cp.id = ca.source_private_id
        WHERE cp.candidate_user_id = ?
      `).get(user.id) as { id: string; skills_json: string | null } | undefined;
      const profileComplete =
        !!profileRow && !!profileRow.skills_json && profileRow.skills_json !== '[]';

      return {
        api_key: apiKey,
        user_id: user.id,
        profile_complete: profileComplete,
      };
    },
  };
}
