import type { DB } from '../../../db/connection.js';
import { createAdminActionLogRepo } from '../../../db/repositories/admin-action-log.js';
import { createWebhookSubscriptionsRepo } from '../../../db/repositories/webhook-subscriptions.js';
import { Errors } from '../../../errors.js';

export type CreateSubscriptionInput = {
  target_url: string;
  event_types: string[];
  hmac_secret: string | null;
};

export type UpdateSubscriptionInput = Partial<CreateSubscriptionInput & { enabled: boolean }>;

const validateUrl = (url: string) => {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw Errors.invalidParams('target_url must be http or https');
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('invalid_params')) throw e;
    throw Errors.invalidParams('target_url is not a valid URL');
  }
};

const validateEventTypes = (types: string[]) => {
  if (!Array.isArray(types) || types.length === 0) {
    throw Errors.invalidParams('event_types must be a non-empty array');
  }
};

export function createAdminWebhookSubscriptionsHandler(db: DB) {
  const repo = createWebhookSubscriptionsRepo(db);
  const adminLog = createAdminActionLogRepo(db);

  return {
    list() {
      return repo.list();
    },
    create(adminUserId: string, input: CreateSubscriptionInput) {
      validateUrl(input.target_url);
      validateEventTypes(input.event_types);
      const sub = repo.create({ ...input, created_by_admin_user_id: adminUserId });
      adminLog.insert({
        admin_user_id: adminUserId,
        action: 'create_webhook_subscription',
        target_type: 'webhook_subscription',
        target_id: String(sub.id),
        details_json: JSON.stringify({
          target_url: sub.target_url,
          event_types: sub.event_types,
          enabled: sub.enabled,
        }),
      });
      return sub;
    },
    update(adminUserId: string, id: number, input: UpdateSubscriptionInput) {
      if (input.target_url !== undefined) validateUrl(input.target_url);
      if (input.event_types !== undefined) validateEventTypes(input.event_types);
      const existing = repo.findById(id);
      if (!existing) throw Errors.notFound('Subscription not found');
      const sub = repo.update(id, input);
      adminLog.insert({
        admin_user_id: adminUserId,
        action: 'update_webhook_subscription',
        target_type: 'webhook_subscription',
        target_id: String(id),
        details_json: JSON.stringify({
          changes: input,
          previous: existing,
        }),
      });
      return sub;
    },
    delete(adminUserId: string, id: number) {
      const existing = repo.findById(id);
      if (!existing) throw Errors.notFound('Subscription not found');
      repo.delete(id);
      adminLog.insert({
        admin_user_id: adminUserId,
        action: 'delete_webhook_subscription',
        target_type: 'webhook_subscription',
        target_id: String(id),
        details_json: JSON.stringify({ target_url: existing.target_url }),
      });
    },
  };
}
