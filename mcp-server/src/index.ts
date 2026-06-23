#!/usr/bin/env node
/**
 * Hunter Platform MCP Server
 *
 * Exposes 15 tools that wrap the Hunter Platform API for AI agents (Claude Desktop,
 * Cursor, Cline, etc.). Communicates over stdio (JSON-RPC).
 *
 * Usage:
 *   - Built binary:    node out/index.js
 *   - Dev (tsx):       tsx src/index.ts
 *   - As installed:    hunter-platform-mcp
 *
 * Credentials are loaded from one of (priority order):
 *   1. Per-call `api_key` argument
 *   2. HUNTER_PLATFORM_API_KEY env var
 *   3. ~/.hunter-platform/credentials.json
 *
 * Default base URL: https://qing3.top (override with HUNTER_PLATFORM_BASE_URL or per-call `base_url`).
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { HunterClient } from './client.js';
import { loadCredentials, resolveApiKey, resolveBaseUrl } from './auth.js';
import { authTools } from './tools/auth.js';
import { userTools } from './tools/users.js';
import { headhunterTools } from './tools/headhunter.js';
import { employerTools } from './tools/employer.js';
import { candidateTools } from './tools/candidate.js';
import type { ToolContext, ToolDef } from './types.js';

const ALL_TOOLS: ToolDef[] = [
  ...authTools,
  ...userTools,
  ...headhunterTools,
  ...employerTools,
  ...candidateTools,
];

const server = new Server(
  {
    name: 'hunter-platform',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: ALL_TOOLS.map((t) => t.tool),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;

  const tool = ALL_TOOLS.find((t) => t.tool.name === name);
  if (!tool) {
    return {
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  const args = (rawArgs ?? {}) as Record<string, unknown>;

  // Validate args
  const parseResult = tool.schema.safeParse(args);
  if (!parseResult.success) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: 'INVALID_ARGS',
          message: 'Tool arguments failed schema validation',
          issues: parseResult.error.issues,
        }, null, 2),
      }],
      isError: true,
    };
  }

  // Resolve api_key: per-call → env → stored file
  const validated = parseResult.data as Record<string, unknown>;
  const perCallApiKey = typeof validated.api_key === 'string' ? validated.api_key : undefined;
  const apiKey = resolveApiKey(perCallApiKey);
  if (!apiKey) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: 'NO_API_KEY',
          message:
            'No api_key found. Either: (a) call auth_register first to create an account, ' +
            '(b) pass api_key as a tool argument, or (c) set HUNTER_PLATFORM_API_KEY env var.',
        }, null, 2),
      }],
      isError: true,
    };
  }

  // Build a client for this call.
  const perCallBaseUrl = typeof validated.base_url === 'string' ? validated.base_url : undefined;
  const client = new HunterClient({
    apiKey,
    baseUrl: perCallBaseUrl ?? resolveBaseUrl(),
  });

  const ctx: ToolContext = { client };

  try {
    return await tool.handler(validated as never, ctx);
  } catch (err) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: 'INTERNAL_ERROR',
          message: (err as Error).message ?? String(err),
        }, null, 2),
      }],
      isError: true,
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (NOT stdout — that's reserved for MCP protocol messages)
  const creds = loadCredentials();
  const toolNames = ALL_TOOLS.map((t) => t.tool.name).join(', ');
  console.error(`[hunter-platform-mcp] started. ${ALL_TOOLS.length} tools: ${toolNames}`);
  console.error(`[hunter-platform-mcp] credentials: ${creds ? `loaded (user_type=${creds.user_type}, user_id=${creds.user_id})` : 'none — call auth_register first'}`);
  console.error(`[hunter-platform-mcp] base URL: ${resolveBaseUrl()}`);
}

main().catch((err) => {
  console.error('[hunter-platform-mcp] fatal:', err);
  process.exit(1);
});