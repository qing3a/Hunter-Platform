/**
 * User self-service tools: get_status, get_history.
 */
import { z } from 'zod';
import { formatToolError } from '../client.js';
import type { ToolDef } from '../types.js';

const GetStatusInput = z.object({
  user_id: z.string().optional()
    .describe('User ID. Defaults to the user_id stored in ~/.hunter-platform/credentials.json.'),
  api_key: z.string().optional()
    .describe('Override api_key. Defaults to stored credential or HUNTER_PLATFORM_API_KEY env var.'),
  base_url: z.string().url().optional(),
});

const GetHistoryInput = z.object({
  user_id: z.string().optional(),
  api_key: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional()
    .describe('How many recent actions to return (1-200, default 50).'),
  since: z.string().optional()
    .describe('ISO 8601 timestamp; only return actions after this time.'),
  base_url: z.string().url().optional(),
});

export const userTools: ToolDef[] = [
  {
    tool: {
      name: 'users_get_status',
      description:
        'Get the current user status: user_type, quota_used, quota_per_day, quota_reset_at, reputation. ' +
        'Use this after registering or starting a new session to confirm identity and remaining quota. ' +
        'Cost: 1 quota.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'Defaults to stored user_id.' },
          api_key: { type: 'string', description: 'Defaults to stored api_key.' },
          base_url: { type: 'string', description: 'Override API base URL.' },
        },
      },
    },
    schema: GetStatusInput,
    handler: async (args, ctx) => {
      try {
        const userId = args.user_id ?? requireStoredUserId();
        const data = await ctx.client.get(`/v1/users/${userId}/status`);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, data }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: formatToolError(err) }], isError: true };
      }
    },
  },

  {
    tool: {
      name: 'users_get_history',
      description:
        'Get the recent action history for the current user. Returns up to `limit` actions (default 50, max 200), ' +
        'optionally filtered to actions since a given ISO timestamp. Useful for "where did I leave off?" recovery. ' +
        'Cost: 1 quota.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'Defaults to stored user_id.' },
          api_key: { type: 'string', description: 'Defaults to stored api_key.' },
          limit: { type: 'number', description: '1-200, default 50.' },
          since: { type: 'string', description: 'ISO 8601 timestamp.' },
          base_url: { type: 'string', description: 'Override API base URL.' },
        },
      },
    },
    schema: GetHistoryInput,
    handler: async (args, ctx) => {
      try {
        const userId = args.user_id ?? requireStoredUserId();
        const data = await ctx.client.get(`/v1/users/${userId}/history`, {
          limit: args.limit,
          since: args.since,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, data }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: formatToolError(err) }], isError: true };
      }
    },
  },
];

import { loadCredentials } from '../auth.js';

function requireStoredUserId(): string {
  const creds = loadCredentials();
  if (!creds?.user_id) {
    throw new Error('No stored user_id. Either pass user_id explicitly or run auth_register first.');
  }
  return creds.user_id;
}