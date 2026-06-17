import type { DB } from '../../db/connection.js';
import { createIdempotencyRepo } from '../../db/repositories/idempotency-keys.js';
import { IDEMPOTENCY_TTL_HOURS } from '../../../shared/constants.js';

export interface ProcessResult {
  cacheHit: boolean;
  duplicate: boolean;
  statusCode: number;
  body: string;
}

export function createIdempotencyMiddleware(db: DB) {
  const repo = createIdempotencyRepo(db);

  return {
    processOrCache(
      key: string,
      userId: string,
      requestHash: string,
      statusCode: number,
      responseBody: string,
    ): ProcessResult {
      const existing = repo.findByKey(key);
      const now = new Date();

      if (existing) {
        if (existing.expires_at < now.toISOString()) {
          // 已过期，按新请求处理
        } else if (existing.request_hash !== requestHash) {
          return { cacheHit: false, duplicate: true, statusCode: 409, body: '' };
        } else {
          return { cacheHit: true, duplicate: false, statusCode: existing.status_code, body: existing.response_json };
        }
      }

      // 缓存响应（仅脱敏后的响应，含 PII 不应调用此函数）
      const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_HOURS * 3600 * 1000).toISOString();
      repo.insert({
        key, user_id: userId, request_hash: requestHash,
        response_json: responseBody, status_code: statusCode,
        expires_at: expiresAt, created_at: now.toISOString(),
      });
      return { cacheHit: false, duplicate: false, statusCode, body: responseBody };
    },
  };
}
