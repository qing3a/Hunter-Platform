// src/main/flows/user.ts
import type { UserStatus } from '../../shared/types.js';
import { defineFlow, type Flow, type SideEffect } from './types.js';

/**
 * User account state machine.
 *
 * active → suspended → deleted
 *                  ↑       ↑
 *        unsuspend    delete (GDPR)
 *
 * Why active → deleted is not allowed: GDPR / "right to be forgotten"
 * should be a deliberate admin action after a suspension period
 * (gives the user a chance to recover / appeal). The flow makes this
 * a single-step process: admin must explicitly suspend first.
 *
 * Both 'suspend' and 'delete' transitions write an admin_action_log row
 * — the audit trail is part of the state machine's side effect, not
 * scattered through the handler.
 */

export type UserEvent = 'suspend' | 'unsuspend' | 'delete';

export const USER_TERMINAL_STATUSES = new Set<UserStatus>(['deleted']);

export const userFlow: Flow<UserStatus, UserEvent> = defineFlow<UserStatus, UserEvent>({
  initial: 'active',
  states: {
    active: {
      suspend: 'suspended',
    },
    suspended: {
      unsuspend: 'active',
      delete: 'deleted',
    },
    deleted: {},
  },
  sideEffects: {
    'active->suspended': (ctx: any) => ({
      kind: 'admin_action_log',
      action_type: 'suspend_user',
      target_id: ctx.user_id,
      reason: ctx.reason ?? '',
    }),
    'suspended->deleted': (ctx: any) => ({
      kind: 'admin_action_log',
      action_type: 'delete_user',
      target_id: ctx.user_id,
      reason: ctx.reason ?? 'GDPR delete',
    }),
  },
});