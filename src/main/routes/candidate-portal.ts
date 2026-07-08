import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/connection.js';
import { createCandidatePortalAuth } from '../modules/candidate-portal/auth.js';
import { Errors } from '../errors.js';
import { respond } from '../responses.js';
import { EnvelopeSchema } from '../schemas/common.js';

const OtpRequestSchema = z.object({
  email: z.string().email(),
});

const OtpVerifySchema = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(8),
});

const OtpRequestResponseSchema = EnvelopeSchema(
  z.object({
    // 0 is valid in test mode (e.g. otpTtlSeconds=0 means the OTP is
    // immediately expired on next verify). Production env constrains TTL to
    // 60-3600s via zod in env.ts so 0 only appears in tests.
    expires_in: z.number().int().nonnegative(),
    dev_code: z.string().optional(),
  })
);

const OtpVerifyResponseSchema = EnvelopeSchema(
  z.object({
    api_key: z.string().regex(/^hp_live_/),
    user_id: z.string().min(1),
    profile_complete: z.boolean(),
  })
);

export function createCandidatePortalRouter(
  db: DB,
  opts: {
    otpLength: number;
    otpTtlSeconds: number;
    otpMaxAttempts: number;
    consoleOnly: boolean;
  }
): Router {
  const router = Router();
  const auth = createCandidatePortalAuth(db, opts);

  // POST /v1/candidate-portal/auth/otp/request
  router.post('/v1/candidate-portal/auth/otp/request', (req, res, next) => {
    try {
      const parsed = OtpRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      const xff = req.headers['x-forwarded-for'];
      const ip =
        (typeof xff === 'string' ? xff.split(',')[0]?.trim() : undefined) ||
        req.socket.remoteAddress ||
        'unknown';

      auth
        .requestOtp({ email: parsed.data.email, ip })
        .then((result) => {
          respond(res, OtpRequestResponseSchema, { ok: true, data: result });
        })
        .catch(next);
    } catch (e) {
      next(e);
    }
  });

  // POST /v1/candidate-portal/auth/otp/verify
  router.post('/v1/candidate-portal/auth/otp/verify', (req, res, next) => {
    try {
      const parsed = OtpVerifySchema.safeParse(req.body);
      if (!parsed.success) {
        throw Errors.invalidParams('Invalid request body', { issues: parsed.error.issues });
      }
      auth
        .verifyOtp({ email: parsed.data.email, code: parsed.data.code })
        .then((result) => {
          respond(res, OtpVerifyResponseSchema, { ok: true, data: result });
        })
        .catch(next);
    } catch (e) {
      next(e);
    }
  });

  return router;
}
