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
  ],
});