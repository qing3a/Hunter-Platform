import { z } from 'zod';
import { EnvelopeSchema, ISODateTime, IdString } from './common.js';

const OpportunitySchema = z.object({
  recommendation_id: IdString,
  job_id: IdString,
  job_title: z.string(),
  job_salary_min: z.number().int().nullable(),
  job_salary_max: z.number().int().nullable(),
  employer_id: IdString,
  status: z.string(),
  requested_at: ISODateTime,
});

const UnlockAuditItemSchema = z.object({
  id: z.number().int(),
  recommendation_id: IdString,
  actor_user_id: IdString,
  action: z.enum(['express_interest', 'unlock_delivery', 'approve_unlock', 'reject_unlock']),
  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  created_at: ISODateTime,
});

const ExportedDataSchema = z.object({
  user: z.object({
    id: IdString, user_type: z.string(), name: z.string().nullable(),
    contact: z.string().nullable(), agent_endpoint: z.string().nullable(),
    reputation: z.number().int(), status: z.string(), created_at: ISODateTime,
  }),
  candidates_private: z.array(z.unknown()),
  candidates_anonymized: z.array(z.unknown()),
  recommendations: z.array(z.unknown()),
  audit_log_entries: z.array(z.unknown()),
  exported_at: ISODateTime,
  format_version: z.string(),
});

export const ListOpportunitiesResponseSchema = EnvelopeSchema(z.array(OpportunitySchema));
export const AccessLogResponseSchema = EnvelopeSchema(z.array(UnlockAuditItemSchema));
export const ExportMyDataResponseSchema = EnvelopeSchema(ExportedDataSchema);
export const ApproveUnlockResponseSchema = EnvelopeSchema(
  z.object({ status: z.literal('candidate_approved') })
);
export const RejectUnlockResponseSchema = EnvelopeSchema(
  z.object({ status: z.literal('rejected_candidate') })
);
export const DeleteMyDataResponseSchema = EnvelopeSchema(
  z.object({
    anonymized_rows_preserved: z.number().int(),
    recommendations_withdrawn: z.number().int(),
    private_pii_rows_cleared: z.number().int(),
    deleted_at: ISODateTime,
  })
);