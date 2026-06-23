/**
 * Candidate tools: view_opportunities, approve_unlock, reject_unlock.
 */
import { z } from 'zod';
import { formatToolError } from '../client.js';
import type { ToolDef } from '../types.js';

const ViewOpportunitiesInput = z.object({
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
});

const ApproveUnlockInput = z.object({
  recommendation_id: z.string()
    .describe('The rec_xxx id from the notify_unlock_request webhook payload.'),
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
});

const RejectUnlockInput = z.object({
  recommendation_id: z.string(),
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
});

export const candidateTools: ToolDef[] = [
  {
    tool: {
      name: 'candidate_view_opportunities',
      description:
        'List all recommendations where an employer has expressed interest (state = employer_interested). ' +
        'Each entry corresponds to a notify_unlock_request webhook event. ' +
        'Use this when the candidate wants to audit pending unlock requests. ' +
        'Cost: 1 quota.',
      inputSchema: {
        type: 'object',
        properties: { api_key: { type: 'string' }, base_url: { type: 'string' } },
      },
    },
    schema: ViewOpportunitiesInput,
    handler: async (args, ctx) => {
      try {
        const data = await ctx.client.get('/v1/candidate/opportunities');
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, data }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: formatToolError(err) }], isError: true };
      }
    },
  },

  {
    tool: {
      name: 'candidate_approve_unlock',
      description:
        'Step 3 of the 4-step unlock flow: candidate approves the employer\'s unlock request. ' +
        'Transitions employer_interested → candidate_approved. Sends notify_unlock_approved webhook to the employer. ' +
        'After this, the employer can call employer_unlock_contact to receive PII via deliver_contact webhook. ' +
        'Before calling, agents SHOULD check the employer\'s fulfillment rate (placements / unlocks) via ' +
        'GET /v1/users/{employer_id}/history. Cost: 3 quota.',
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
    schema: ApproveUnlockInput,
    handler: async (args, ctx) => {
      try {
        const data = await ctx.client.post(
          `/v1/candidate/recommendations/${args.recommendation_id}/approve-unlock`,
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
      name: 'candidate_reject_unlock',
      description:
        'Step 3-alternative: candidate rejects the employer\'s unlock request. ' +
        'Transitions employer_interested → rejected_candidate (terminal state). ' +
        'The same (candidate, job) pair cannot be recommended again — must switch job or candidate. ' +
        'Cost: 1 quota.',
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
    schema: RejectUnlockInput,
    handler: async (args, ctx) => {
      try {
        const data = await ctx.client.post(
          `/v1/candidate/recommendations/${args.recommendation_id}/reject-unlock`,
          {},
        );
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, data }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: formatToolError(err) }], isError: true };
      }
    },
  },
];