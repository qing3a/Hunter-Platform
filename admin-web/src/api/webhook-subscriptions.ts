import { apiFetchRaw } from './raw';

export type WebhookSubscription = {
  id: number;
  target_url: string;
  event_types: string[];
  hmac_secret: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  created_by_admin_user_id: string | null;
};

export type CreateSubscriptionInput = {
  target_url: string;
  event_types: string[];
  hmac_secret?: string | null;
};

export type UpdateSubscriptionInput = Partial<{
  target_url: string;
  event_types: string[];
  hmac_secret: string | null;
  enabled: boolean;
}>;

export async function listWebhookSubscriptions(): Promise<WebhookSubscription[]> {
  const env = await apiFetchRaw<WebhookSubscription[]>('webhook-subscriptions');
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to list subscriptions');
  return env.data;
}

export async function createWebhookSubscription(input: CreateSubscriptionInput): Promise<WebhookSubscription> {
  const env = await apiFetchRaw<WebhookSubscription>('webhook-subscriptions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to create subscription');
  return env.data;
}

export async function updateWebhookSubscription(id: number, input: UpdateSubscriptionInput): Promise<WebhookSubscription> {
  const env = await apiFetchRaw<WebhookSubscription>(`webhook-subscriptions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  if (!env.ok || !env.data) throw new Error(env.error?.message ?? 'Failed to update subscription');
  return env.data;
}

export async function deleteWebhookSubscription(id: number): Promise<void> {
  const env = await apiFetchRaw<null>(`webhook-subscriptions/${id}`, { method: 'DELETE' });
  if (!env.ok) throw new Error(env.error?.message ?? 'Failed to delete subscription');
}
