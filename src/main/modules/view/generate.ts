import { randomBytes } from 'node:crypto';
import type { createViewTokenRepo } from './view-token-repo.js';

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export type ViewType = 'candidate' | 'recommendation' | 'user-quota' | 'audit';

export interface GenerateViewUrlResult {
  url: string;
  token: string;
}

export function generateViewUrl(
  repo: ReturnType<typeof createViewTokenRepo>,
  baseUrl: string,
  userId: string,
  viewType: ViewType,
  viewId: string,
): GenerateViewUrlResult {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  repo.create({ token, userId, viewType, viewId, expiresAt });
  const url = `${baseUrl}/view/${viewType}/${viewId}?t=${token}`;
  return { url, token };
}