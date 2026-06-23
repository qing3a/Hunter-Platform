/**
 * Shared types for MCP tool definitions.
 *
 * Each tool file exports an array of ToolDef. The main index.ts imports
 * all of them and registers with the MCP server.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import type { HunterClient } from './client.js';

export interface ToolContext {
  client: HunterClient;
}

export type ToolHandler<S extends z.ZodTypeAny> = (
  args: z.infer<S>,
  ctx: ToolContext,
) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}>;

export interface ToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  tool: Tool;
  schema: S;
  handler: ToolHandler<S>;
}