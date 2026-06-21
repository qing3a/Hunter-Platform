import { z } from 'zod';
import { EnvelopeSchema, IdString } from './common.js';

export const LeaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  id: IdString,
  name: z.string(),
  reputation: z.number().int(),
});
export const LeaderboardResponseSchema = EnvelopeSchema(z.array(LeaderboardEntrySchema));

const PublicJobSchema = z.object({
  id: IdString,
  employer_id: IdString,
  title: z.string(),
  description: z.string().nullable(),
  required_skills: z.array(z.string()),
  salary_min: z.number().int().nullable(),
  salary_max: z.number().int().nullable(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  industry: z.string().nullable(),
  created_at: z.string(),
});
export const JobsListResponseSchema = EnvelopeSchema(z.array(PublicJobSchema));