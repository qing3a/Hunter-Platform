import type { DB } from '../../db/connection.js';
import { createUsersRepo } from '../../db/repositories/users.js';
import { createRateLimit } from '../rate-limit/bucket.js';
import { generateApiKey } from '../auth/api-key.js';
import { QUOTA_PER_DAY } from '../../../shared/constants.js';
import type { UserType, User } from '../../../shared/types.js';
import { Errors } from '../../errors.js';
import { randomUUID } from 'node:crypto';

export function createRegisterHandler(db: DB) {
  const users = createUsersRepo(db);
  const rl = createRateLimit(db);
  const findByContactStmt = db.prepare(
    "SELECT id FROM users WHERE contact = ? AND created_at > datetime('now', '-1 day') AND status != 'deleted'"
  );

  return {
    handle(userType: UserType, name: string, contact: string | undefined, agentEndpoint: string | undefined, clientIp: string, isProduction: boolean): User & { api_key: string } {
      // 1. IP 限流：1h 内同 IP 最多 5 次
      const rlResult = rl.check(`ip:${clientIp}`, [{ windowSeconds: 3600, limit: 5 }]);
      if (!rlResult.allowed) throw Errors.rateLimited('IP register rate limit exceeded');

      // 2. contact 重复检查
      if (contact && findByContactStmt.get(contact)) {
        throw Errors.duplicateRequest('Contact already registered within 24h');
      }

      // 3. agent_endpoint HTTPS 校验（生产）
      if (isProduction && agentEndpoint && !agentEndpoint.startsWith('https://')) {
        throw Errors.invalidParams('agent_endpoint must be HTTPS in production');
      }

      // 4. 生成 API key
      const { key, hash, prefix } = generateApiKey();
      const userId = `user_${randomUUID().slice(0, 12)}`;
      const now = new Date().toISOString();
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

      const user: User = {
        id: userId,
        user_type: userType,
        name,
        contact: contact ?? null,
        agent_endpoint: agentEndpoint ?? null,
        api_key_hash: hash,
        api_key_prefix: prefix,
        quota_per_day: QUOTA_PER_DAY[userType],
        quota_used: 0,
        quota_reset_at: tomorrow,
        reputation: 50,
        status: 'active',
        created_at: now,
        updated_at: now,
      };
      users.insert(user);

      return { ...user, api_key: key };
    },
  };
}
