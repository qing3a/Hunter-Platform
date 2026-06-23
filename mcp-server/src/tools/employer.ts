/**
 * Employer tools: post_job, list_talent, express_interest, unlock_contact.
 */
import { z } from 'zod';
import { formatToolError } from '../client.js';
import type { ToolDef } from '../types.js';

const PostJobInput = z.object({
  title: z.string().min(1).describe('Job title.'),
  description: z.string().min(1).describe('Job description / responsibilities.'),
  required_skills: z.array(z.string()).describe('Core skills required (3-5 recommended).'),
  salary_min: z.number().int().min(0).describe('Minimum annual salary in CNY.'),
  salary_max: z.number().int().min(0).describe('Maximum annual salary in CNY.'),
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
});

const ListTalentInput = z.object({
  industry: z.string().optional()
    .describe('Exact match on candidates_anonymized.industry (e.g. 互联网).'),
  title_level: z.string().optional()
    .describe('Exact match (e.g. P6, P7+, M1).'),
  min_years: z.number().int().min(0).optional()
    .describe('years_experience >= N.'),
  max_years: z.number().int().min(0).optional()
    .describe('years_experience <= N.'),
  skills: z.string().optional()
    .describe('Comma-separated, OR-matched (e.g. "React,TypeScript").'),
  min_salary: z.number().int().optional()
    .describe('Annual salary lower bound (intersected with SALARY_BANDS).'),
  max_salary: z.number().int().optional()
    .describe('Annual salary upper bound.'),
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
});

const ExpressInterestInput = z.object({
  recommendation_id: z.string()
    .describe('The rec_xxx id from headhunter_recommend_candidate.'),
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
});

const UnlockContactInput = z.object({
  recommendation_id: z.string()
    .describe('The rec_xxx id (must be in candidate_approved state — candidate must have approved first).'),
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
});

export const employerTools: ToolDef[] = [
  {
    tool: {
      name: 'employer_post_job',
      description:
        'Create a new job posting (JD). The JD becomes visible to headhunters via GET /v1/market/jobs. ' +
        '`required_skills` and salary range directly drive employer_list_talent hit rate. ' +
        'Cost: 5 quota.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          required_skills: { type: 'array', items: { type: 'string' } },
          salary_min: { type: 'number' },
          salary_max: { type: 'number' },
          api_key: { type: 'string' },
          base_url: { type: 'string' },
        },
        required: ['title', 'description', 'required_skills', 'salary_min', 'salary_max'],
      },
    },
    schema: PostJobInput,
    handler: async (args, ctx) => {
      try {
        const { api_key, base_url, ...body } = args;
        const data = await ctx.client.post('/v1/employer/jobs', body);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, data }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: formatToolError(err) }], isError: true };
      }
    },
  },

  {
    tool: {
      name: 'employer_list_talent',
      description:
        'Browse the public talent pool of anonymized candidates. All 7 query parameters are optional and AND-combined. ' +
        'Each result includes a 7-day-multi-use view_url for preview. ' +
        'Tip: use 2-3 query params (industry + title_level + min_years) for the best hit rate. ' +
        'Cost: 1 quota.',
      inputSchema: {
        type: 'object',
        properties: {
          industry: { type: 'string', description: 'e.g. 互联网' },
          title_level: { type: 'string', description: 'e.g. P6, P7+' },
          min_years: { type: 'number' },
          max_years: { type: 'number' },
          skills: { type: 'string', description: 'CSV: React,TypeScript' },
          min_salary: { type: 'number' },
          max_salary: { type: 'number' },
          api_key: { type: 'string' },
          base_url: { type: 'string' },
        },
      },
    },
    schema: ListTalentInput,
    handler: async (args, ctx) => {
      try {
        const data = await ctx.client.get('/v1/employer/talent', {
          industry: args.industry,
          title_level: args.title_level,
          min_years: args.min_years,
          max_years: args.max_years,
          skills: args.skills,
          min_salary: args.min_salary,
          max_salary: args.max_salary,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, data }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: formatToolError(err) }], isError: true };
      }
    },
  },

  {
    tool: {
      name: 'employer_express_interest',
      description:
        'Step 2 of the 4-step unlock flow: employer expresses interest in a recommendation. ' +
        'Transitions pending → employer_interested. Sends notify_unlock_request webhook to the candidate. ' +
        'After this, the candidate must call candidate_approve_unlock before you can call employer_unlock_contact. ' +
        'Cost: 3 quota.',
      inputSchema: {
        type: 'object',
        properties: {
          recommendation_id: { type: 'string' },
          api_key: { type: 'string' },
          base_url: { type: 'string' },
        },
        required: ['recommendation_id'],
      },
    },
    schema: ExpressInterestInput,
    handler: async (args, ctx) => {
      try {
        const data = await ctx.client.post(
          `/v1/employer/recommendations/${args.recommendation_id}/express-interest`,
          {},
        );
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, data }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: formatToolError(err) }], isError: true };
      }
    },
  },

  {
    tool: {
      name: 'employer_unlock_contact',
      description:
        'Step 4 of the 4-step unlock flow: request the candidate\'s decrypted contact info. ' +
        'ONLY works after candidate_approve_unlock has been called (state = candidate_approved). ' +
        'Returns the recommendation transitioned to "unlocked" state. ' +
        'NOTE: the PII (name/phone/email) is NOT in this response — it is delivered asynchronously via ' +
        'the deliver_contact webhook to the candidate\'s agent_endpoint. ' +
        'Cost: 5 quota.',
      inputSchema: {
        type: 'object',
        properties: {
          recommendation_id: { type: 'string' },
          api_key: { type: 'string' },
          base_url: { type: 'string' },
        },
        required: ['recommendation_id'],
      },
    },
    schema: UnlockContactInput,
    handler: async (args, ctx) => {
      try {
        const data = await ctx.client.post(
          `/v1/employer/recommendations/${args.recommendation_id}/unlock-contact`,
          {},
        );
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              ok: true,
              data,
              notice: 'Status is now unlocked. PII (name/phone/email) is delivered to the candidate\'s agent_endpoint via deliver_contact webhook — NOT in this response.',
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: formatToolError(err) }], isError: true };
      }
    },
  },
];