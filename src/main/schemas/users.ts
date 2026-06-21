import { z } from 'zod';
import { EnvelopeSchema, ISODateTime, IdString, UserPublicSchema } from './common.js';

export const UserStatusResponseSchema = EnvelopeSchema(UserPublicSchema);

export const ActionHistoryItemSchema = z.object({
  id: z.number().int(),
  user_id: IdString,
  action_type: z.string(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  request_summary_json: z.string().nullable(),
  error_code: z.string().nullable(),
  status: z.enum(['success', 'error']),
  duration_ms: z.number().int().nullable(),
  created_at: ISODateTime,
});

export const UserHistoryResponseSchema = EnvelopeSchema(
  z.array(ActionHistoryItemSchema)
);