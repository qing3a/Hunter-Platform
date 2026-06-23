/**
 * Headhunter tools: upload_candidate, recommend_candidate, list_candidates, list_recommendations.
 */
import { z } from 'zod';
import { formatToolError } from '../client.js';
import type { ToolDef } from '../types.js';

const UploadCandidateInput = z.object({
  candidate_user_id: z.string()
    .describe('The candidate user_id (from candidate auth_register).'),
  name: z.string().describe('Candidate full name.'),
  phone: z.string().describe('Candidate phone.'),
  email: z.string().email().describe('Candidate email.'),
  current_company: z.string().describe('Current employer name (will be anonymized to industry).'),
  current_title: z.string().describe('Current job title (will be mapped to title_level like P6/P7+/M1).'),
  expected_salary: z.number().int().min(1)
    .describe('Expected annual salary in CNY. Will be mapped to a salary_range band.'),
  years_experience: z.number().int().min(0)
    .describe('Years of relevant experience.'),
  education_school: z.string()
    .describe('University name. Will be mapped to education_tier (985/211/普通/海外名校).'),
  skills: z.array(z.string())
    .describe('Skill tags, e.g. ["React", "TypeScript"]. Matched against JD required_skills.'),
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
});

const RecommendCandidateInput = z.object({
  anonymized_candidate_id: z.string()
    .describe('The ca_xxx id from headhunter_upload_candidate (response.data.anonymized_id).'),
  job_id: z.string()
    .describe('The job_xxx id from employer_post_job (or GET /v1/employer/jobs for own jobs).'),
  referrer_headhunter_id: z.string().optional()
    .describe('Optional second headhunter for commission split. Omit for single-headhunter recommendations.'),
  commission_split: z.object({
    hunter: z.number().min(0).max(1),
    referrer: z.number().min(0).max(1),
  }).optional()
    .describe('Optional split ratios; default {hunter: 1.0, referrer: 0.0}. Must sum to 1.0.'),
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
});

const ListCandidatesInput = z.object({
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
});

const ListRecommendationsInput = z.object({
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
});

export const headhunterTools: ToolDef[] = [
  {
    tool: {
      name: 'headhunter_upload_candidate',
      description:
        'Upload a candidate resume. The candidate_user_id must already be registered. ' +
        'Server automatically desensitizes: company → industry, title → title_level, school → education_tier, ' +
        'salary → salary_range. Returns anonymized_id and a 7-day-multi-use view_url for preview. ' +
        'Cost: 5 quota.',
      inputSchema: {
        type: 'object',
        properties: {
          candidate_user_id: { type: 'string', description: 'Candidate user_id.' },
          name: { type: 'string', description: 'Full name.' },
          phone: { type: 'string', description: 'Phone.' },
          email: { type: 'string', description: 'Email.' },
          current_company: { type: 'string', description: 'Employer name (e.g. 字节跳动).' },
          current_title: { type: 'string', description: 'Job title (e.g. 高级前端工程师).' },
          expected_salary: { type: 'number', description: 'Annual CNY.' },
          years_experience: { type: 'number', description: 'Years.' },
          education_school: { type: 'string', description: 'University name.' },
          skills: { type: 'array', items: { type: 'string' }, description: 'Skill tags.' },
          api_key: { type: 'string' },
          base_url: { type: 'string' },
        },
        required: ['candidate_user_id', 'name', 'phone', 'email', 'current_company',
                   'current_title', 'expected_salary', 'years_experience',
                   'education_school', 'skills'],
      },
    },
    schema: UploadCandidateInput,
    handler: async (args, ctx) => {
      try {
        const { api_key, base_url, ...body } = args;
        const data = await ctx.client.post('/v1/headhunter/candidates', body);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, data }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: formatToolError(err) }], isError: true };
      }
    },
  },

  {
    tool: {
      name: 'headhunter_recommend_candidate',
      description:
        'Recommend an uploaded candidate to a job. Creates a recommendation in `pending` state. ' +
        'After this, the employer can call employer_express_interest to trigger the 4-step unlock flow. ' +
        'Cost: 5 quota. Same (anonymized_candidate_id, job_id) pair cannot be recommended twice — 409 DUPLICATE_REQUEST.',
      inputSchema: {
        type: 'object',
        properties: {
          anonymized_candidate_id: { type: 'string', description: 'ca_xxx id.' },
          job_id: { type: 'string', description: 'job_xxx id.' },
          referrer_headhunter_id: { type: 'string', description: 'Optional co-headhunter.' },
          commission_split: {
            type: 'object',
            properties: {
              hunter: { type: 'number' },
              referrer: { type: 'number' },
            },
            description: 'Optional split; must sum to 1.0.',
          },
          api_key: { type: 'string' },
          base_url: { type: 'string' },
        },
        required: ['anonymized_candidate_id', 'job_id'],
      },
    },
    schema: RecommendCandidateInput,
    handler: async (args, ctx) => {
      try {
        const { api_key, base_url, ...body } = args;
        const data = await ctx.client.post('/v1/headhunter/recommendations', body);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, data }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: formatToolError(err) }], isError: true };
      }
    },
  },

  {
    tool: {
      name: 'headhunter_list_candidates',
      description:
        'List all candidates uploaded by the current headhunter (anonymized preview only — no PII). ' +
        'Cost: 0 quota. Use this to find an existing anonymized_id before re-uploading (avoid duplicates).',
      inputSchema: {
        type: 'object',
        properties: { api_key: { type: 'string' }, base_url: { type: 'string' } },
      },
    },
    schema: ListCandidatesInput,
    handler: async (args, ctx) => {
      try {
        const data = await ctx.client.get('/v1/headhunter/candidates');
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, data }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: formatToolError(err) }], isError: true };
      }
    },
  },

  {
    tool: {
      name: 'headhunter_list_recommendations',
      description:
        'List all recommendations created by the current headhunter. Use this to check existing (anonymized_candidate_id, job_id) pairs before recommending again. ' +
        'Cost: 0 quota.',
      inputSchema: {
        type: 'object',
        properties: { api_key: { type: 'string' }, base_url: { type: 'string' } },
      },
    },
    schema: ListRecommendationsInput,
    handler: async (args, ctx) => {
      try {
        const data = await ctx.client.get('/v1/headhunter/recommendations');
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, data }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: formatToolError(err) }], isError: true };
      }
    },
  },
];