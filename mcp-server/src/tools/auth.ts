/**
 * Auth tools: register, rotate_key.
 *
 * `register` returns the api_key and persists it to ~/.hunter-platform/.
 * `rotate_key` invalidates the old key and persists the new one.
 */
import { z } from 'zod';
import { saveCredentials, loadCredentials, resolveBaseUrl } from '../auth.js';
import { HunterClient, formatToolError } from '../client.js';
import type { ToolDef } from '../types.js';

const RegisterInput = z.object({
  user_type: z.enum(['candidate', 'headhunter', 'employer'])
    .describe('Role to register as. candidate / headhunter / employer.'),
  name: z.string().min(1).max(120)
    .describe('Display name shown to other users.'),
  contact: z.string().min(1).max(255)
    .describe('Email or phone for verification. Same-role collisions 24h, cross-role immediate.'),
  agent_endpoint: z.string().url().optional()
    .describe('Optional webhook URL for receiving platform events (notify_unlock_request, deliver_contact, etc.).'),
  base_url: z.string().url().optional()
    .describe('Override API base URL (default: https://qing3.top). Useful for self-hosted instances.'),
});

const RotateKeyInput = z.object({
  api_key: z.string().optional()
    .describe('Override api_key. Defaults to stored credential or HUNTER_PLATFORM_API_KEY env var.'),
  base_url: z.string().url().optional(),
});

export const authTools: ToolDef[] = [
  {
    tool: {
      name: 'auth_register',
      description:
        'Register a new account on Hunter Platform. Returns an api_key that is shown only once — store it immediately. ' +
        'Cost: 0 quota. After registration, the api_key is saved to ~/.hunter-platform/credentials.json and used by all subsequent tool calls. ' +
        'Three personas: candidate (求职者), headhunter (猎头), employer (雇主).',
      inputSchema: {
        type: 'object',
        properties: {
          user_type: {
            type: 'string',
            enum: ['candidate', 'headhunter', 'employer'],
            description: 'Role to register as.',
          },
          name: { type: 'string', description: 'Display name (1-120 chars).' },
          contact: { type: 'string', description: 'Email or phone (1-255 chars).' },
          agent_endpoint: { type: 'string', description: 'Optional webhook URL.' },
          base_url: { type: 'string', description: 'Override API base URL.' },
        },
        required: ['user_type', 'name', 'contact'],
      },
    },
    schema: RegisterInput,
    handler: async (args) => {
      try {
        const client = new HunterClient({ baseUrl: args.base_url ?? resolveBaseUrl() });
        const data = await client.post<{
          id: string;
          api_key: string;
          user_type: string;
          quota_per_day: number;
        }>('/v1/auth/register', {
          user_type: args.user_type,
          name: args.name,
          contact: args.contact,
          ...(args.agent_endpoint ? { agent_endpoint: args.agent_endpoint } : {}),
        });

        // Persist credentials for subsequent calls.
        saveCredentials({
          api_key: data.api_key,
          user_id: data.id,
          user_type: data.user_type as 'candidate' | 'headhunter' | 'employer',
          base_url: args.base_url ?? resolveBaseUrl(),
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              ok: true,
              data,
              notice: 'api_key saved to ~/.hunter-platform/credentials.json. It will be used automatically by all subsequent tool calls.',
              warning: 'api_key is shown ONLY here. If you lose it, call auth_rotate_key.',
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: formatToolError(err) }], isError: true };
      }
    },
  },

  {
    tool: {
      name: 'auth_rotate_key',
      description:
        'Rotate the api_key. The old key is invalidated IMMEDIATELY (no grace period). ' +
        'Use this if the old key is lost or compromised. Returns the new api_key and saves it.',
      inputSchema: {
        type: 'object',
        properties: {
          api_key: { type: 'string', description: 'Current api_key. Defaults to stored credential.' },
          base_url: { type: 'string', description: 'Override API base URL.' },
        },
      },
    },
    schema: RotateKeyInput,
    handler: async (args, ctx) => {
      try {
        // rotate-key requires the OLD api_key. If the caller provided one, build
        // an ad-hoc client with it. Otherwise use the context client (which already
        // has the stored api_key).
        const apiKey = args.api_key ?? ctx.client.apiKey;
        const rotateClient = apiKey
          ? new HunterClient({ apiKey, baseUrl: args.base_url })
          : ctx.client;
        const data = await rotateClient.post<{ new_api_key: string }>(
          '/v1/auth/rotate-key',
          {},
        );

        // Update stored credentials.
        const existing = loadCredentials();
        saveCredentials({
          api_key: data.new_api_key,
          user_id: existing?.user_id,
          user_type: existing?.user_type,
          base_url: existing?.base_url ?? args.base_url ?? resolveBaseUrl(),
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              ok: true,
              new_api_key: data.new_api_key,
              notice: 'Old api_key invalidated. New api_key saved to ~/.hunter-platform/credentials.json.',
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: formatToolError(err) }], isError: true };
      }
    },
  },
];