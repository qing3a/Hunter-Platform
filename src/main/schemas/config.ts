import { z } from 'zod';
import { EnvelopeSchema } from './common.js';

export const IndustrySchema = z.object({
  id: z.string(),
  companies_count: z.number().int().nonnegative(),
});
export const IndustriesResponseSchema = EnvelopeSchema(z.array(IndustrySchema));

export const TitleLevelSchema = z.object({
  code: z.string(),
  match: z.string(),
});
export const TitleLevelsResponseSchema = EnvelopeSchema(z.array(TitleLevelSchema));

export const SalaryBandSchema = z.object({
  label: z.string(),
  min: z.number().int().nullable(),
  max: z.number().int().nullable(),
});
export const SalaryBandsResponseSchema = EnvelopeSchema(z.array(SalaryBandSchema));