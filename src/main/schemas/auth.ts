import { z } from 'zod';
import { EnvelopeSchema, IdString } from './common.js';

export const RegisterResponseSchema = EnvelopeSchema(
  z.object({
    id: IdString,
    api_key: z.string().regex(/^hp_live_/),
    quota_per_day: z.number().int().positive(),
    user_type: z.enum(['candidate', 'hr', 'pm']),
    // R1.C2 / T5 — every new user is bootstrapped with all 3 roles; the
    // registered role becomes the default `active_role` on first login.
    available_roles: z.array(z.enum(['candidate', 'hr', 'pm'])).min(1),
  })
);

// R1.C2 / T6 — login takes an api_key + optional active_role and returns
// a session_id (bearer token). The active_role must be one of the user's
// available_roles; otherwise 403. expires_at is an absolute ISO 8601 string.
const LoginRequestSchema = z.object({
  api_key: z.string().regex(/^hp_live_/).min(8).max(128),
  active_role: z.enum(['candidate', 'hr', 'pm']).optional(),
});
export const LoginSchema = LoginRequestSchema;

const SessionInfoSchema = z.object({
  session_id: z.string().regex(/^sess_/),
  user_id: IdString,
  active_role: z.enum(['candidate', 'hr', 'pm']),
  available_roles: z.array(z.enum(['candidate', 'hr', 'pm'])).min(1),
  expires_at: z.string().datetime(),
});

export const LoginResponseSchema = EnvelopeSchema(SessionInfoSchema);

// R1.C2 / T7 — refresh: sliding-window expiry extend + optional role switch.
// Returns the same SessionInfoSchema (re-used from login) plus the new expiry.
export const RefreshResponseSchema = EnvelopeSchema(SessionInfoSchema);

// R1.C2 / T8 — logout: idempotent revoke. Returns ok=true even if the session
// was already gone (so the client can safely retry after a network blip).
export const LogoutResponseSchema = EnvelopeSchema(z.object({
  revoked: z.boolean(),
}));

export const RotateKeyResponseSchema = EnvelopeSchema(
  z.object({
    new_api_key: z.string().regex(/^hp_live_/),
    new_prefix: z.string().length(12),
  })
);