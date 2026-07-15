import { defineCapabilitySet } from './types.js';
import { RegisterResponseSchema, RotateKeyResponseSchema } from '../schemas/auth.js';
import { QUOTA_COSTS } from '../../shared/constants.js';

export const authCapabilities = defineCapabilitySet({
  role: 'auth',
  capabilities: [
    {
      name: 'auth.register',
      description: '注册新账号(返回 api_key,只此一次)。',
      method: 'POST', path: '/v1/auth/register',
      response_schema: RegisterResponseSchema,
      quota_cost: QUOTA_COSTS.register,
      preconditions: [],
      effects: ['db.users.insert', 'issue_api_key'],
    },
    {
      name: 'auth.rotate_key',
      description: '轮换 api_key(旧 key 立即失效,无 grace period)。',
      method: 'POST', path: '/v1/auth/rotate-key',
      response_schema: RotateKeyResponseSchema,
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.users.update(api_key_hash)'],
    },
    {
      name: 'auth.login',
      description: '用 api_key 换 168h session token (R1.C2 长会话)。',
      method: 'POST', path: '/v1/auth/login',
      quota_cost: 0,
      preconditions: [],
      effects: ['db.sessions.insert', 'session.bind_active_role'],
    },
    {
      name: 'auth.refresh',
      description: '刷新 session 过期时间 (滑动 TTL)。',
      method: 'POST', path: '/v1/auth/refresh',
      quota_cost: 0,
      preconditions: [],
      effects: ['db.sessions.update(expires_at)'],
    },
    {
      name: 'auth.logout',
      description: '撤销 session (idempotent — 缺失/无效 session 也返回 ok)。',
      method: 'POST', path: '/v1/auth/logout',
      quota_cost: 0,
      preconditions: [],
      effects: ['db.sessions.delete'],
    },
  ],
});