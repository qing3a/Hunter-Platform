import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listWebhookSubscriptions,
  createWebhookSubscription,
  updateWebhookSubscription,
  deleteWebhookSubscription,
} from '../../src/api/webhook-subscriptions';

vi.mock('../../src/api/raw', () => ({ apiFetchRaw: vi.fn() }));
import { apiFetchRaw } from '../../src/api/raw';

describe('webhook subscriptions api (Sub-E)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. listWebhookSubscriptions calls GET', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: [] });
    await listWebhookSubscriptions();
    expect(apiFetchRaw).toHaveBeenCalledWith('webhook-subscriptions');
  });

  it('2. createWebhookSubscription POSTs with body', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: { id: 1 } });
    await createWebhookSubscription({ target_url: 'https://x.com', event_types: ['y'] });
    expect(apiFetchRaw).toHaveBeenCalledWith('webhook-subscriptions', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ target_url: 'https://x.com', event_types: ['y'] }),
    }));
  });

  it('3. updateWebhookSubscription PUTs to /:id', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: { id: 5 } });
    await updateWebhookSubscription(5, { enabled: false });
    expect(apiFetchRaw).toHaveBeenCalledWith('webhook-subscriptions/5', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ enabled: false }),
    }));
  });

  it('4. deleteWebhookSubscription DELETEs /:id', async () => {
    (apiFetchRaw as any).mockResolvedValue({ ok: true, data: null });
    await deleteWebhookSubscription(5);
    expect(apiFetchRaw).toHaveBeenCalledWith('webhook-subscriptions/5', expect.objectContaining({ method: 'DELETE' }));
  });
});
