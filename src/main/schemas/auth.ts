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

export const RotateKeyResponseSchema = EnvelopeSchema(
  z.object({
    new_api_key: z.string().regex(/^hp_live_/),
    new_prefix: z.string().length(12),
  })
);