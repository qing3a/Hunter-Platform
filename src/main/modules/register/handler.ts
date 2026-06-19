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
  // F3: contact uniqueness is per (user_type, contact) — the same email can
  // be registered as both a candidate and an employer. We still re-use the
  // same contact within the same role for 24h (warm-up cooldown).
  const findByContactInRoleStmt = db.prepare(
    "SELECT id FROM users WHERE user_type = ? AND contact = ? AND created_at > datetime('now', '-1 day') AND status != 'deleted'"
  );
  // Cross-role collision: only meaningful when the contact is in active use
  // (i.e. recent) — old deactivated accounts shouldn't block fresh signups.
  const findActiveContactAnyRoleStmt = db.prepare(
    "SELECT user_type FROM users WHERE contact = ? AND status = 'active' LIMIT 1"
  );

  return {
    handle(userType: UserType, name: string, contact: string | undefined, agentEndpoint: string | undefined, clientIp: string, isProduction: boolean): User & { api_key: string } {
      // 1. IP 限流：1h 内同 IP 最多 5 次（除非 RATE_LIMIT_ENABLED=false）
      if (process.env.RATE_LIMIT_ENABLED !== 'false') {
        const rlResult = rl.check(`ip:${clientIp}`, [{ windowSeconds: 3600, limit: 5 }]);
        if (!rlResult.allowed) throw Errors.rateLimited('IP register rate limit exceeded');
      }

      // 2. contact uniqueness
      if (contact) {
        // 2a. Same role within 24h → CONTACT_TAKEN (was: DUPLICATE_REQUEST)
        const sameRole = findByContactInRoleStmt.get(userType, contact);
        if (sameRole) {
          throw Errors.contactTaken(
            `Contact already registered as ${userType} within last 24h. ` +
            `Wait 24h or use a different contact.`,
            { user_type: userType, scope: 'same-role', contact }
          );
        }
        // 2b. Different role but active → CONTACT_USED_BY_OTHER_ROLE (informational)
        const otherRole = findActiveContactAnyRoleStmt.get(contact) as { user_type: UserType } | undefined;
        if (otherRole && otherRole.user_type !== userType) {
          throw Errors.contactTaken(
            `Contact is already in use by an active ${otherRole.user_type} account. ` +
            `Use a different contact for this ${userType} account, or sign in to the existing ${otherRole.user_type} account.`,
            { user_type: otherRole.user_type, scope: 'cross-role', contact, requested_role: userType }
          );
        }
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
        api_key_expires_at: null,  // fresh keys never expire
        prev_api_key_hash: null,
        prev_api_key_prefix: null,
        prev_api_key_expires_at: null,
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
