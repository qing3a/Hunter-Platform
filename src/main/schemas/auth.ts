import { z } from 'zod';
import { EnvelopeSchema, IdString } from './common.js';

export const RegisterResponseSchema = EnvelopeSchema(
  z.object({
    id: IdString,
    api_key: z.string().regex(/^hp_live_/),
    quota_per_day: z.number().int().positive(),
    user_type: z.enum(['candidate', 'headhunter', 'employer']),
  })
);

export const RotateKeyResponseSchema = EnvelopeSchema(
  z.object({
    new_api_key: z.string().regex(/^hp_live_/),
    new_prefix: z.string().length(12),
  })
);