import { defineCapabilitySet } from './types.js';
import {
  ListNotificationsResponseSchema, MarkReadResponseSchema,
  MarkAllReadResponseSchema, DeleteNotificationResponseSchema,
} from '../schemas/notifications.js';

/**
 * Notifications capabilities — used by all 3 roles (candidate, headhunter, employer).
 * We register them under a synthetic 'auth' role entry (matches existing pattern
 * in capabilities/auth.ts). The capability resolver middleware accepts these for
 * any logged-in user (the user_type check lives in the route's authMiddleware).
 */
export const notificationsCapabilities = defineCapabilitySet({
  role: 'auth',  // placeholder; capabilities are exposed to all roles
  capabilities: [
    {
      name: 'notifications.list',
      description: '拉取系统通知列表(支持 unread/category/since 过滤,30 天过期)',
      method: 'GET', path: '/v1/notifications',
      response_schema: ListNotificationsResponseSchema,
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.notifications.listByUser'],
    },
    {
      name: 'notifications.mark_read',
      description: '标记单条通知为已读(幂等)',
      method: 'POST', path: '/v1/notifications/:id/read',
      response_schema: MarkReadResponseSchema,
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.notifications.update(read_at)'],
    },
    {
      name: 'notifications.mark_all_read',
      description: '标记当前用户所有未读为已读',
      method: 'POST', path: '/v1/notifications/read-all',
      response_schema: MarkAllReadResponseSchema,
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.notifications.update(read_at) WHERE unread'],
    },
    {
      name: 'notifications.delete',
      description: '删除单条通知',
      method: 'DELETE', path: '/v1/notifications/:id',
      response_schema: DeleteNotificationResponseSchema,
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.notifications.delete'],
    },
  ],
});
