import { describe, it, expect } from 'vitest';
import { NotificationItemSchema, ListNotificationsResponseSchema } from '../../src/main/schemas/notifications';

describe('notifications schemas', () => {
  it('NotificationItemSchema accepts valid item', () => {
    const result = NotificationItemSchema.safeParse({
      id: 'notif_x', category: 'unlock_granted', title: 't', body: null,
      payload: { foo: 1 }, read_at: null,
      created_at: '2026-06-24T10:00:00.000Z', expires_at: '2026-07-24T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('ListNotificationsResponseSchema accepts valid list', () => {
    const result = ListNotificationsResponseSchema.safeParse({
      ok: true, data: { items: [], unread_count: 0, has_more: false },
    });
    expect(result.success).toBe(true);
  });

  it('ListNotificationsResponseSchema rejects non-positive unread_count', () => {
    const result = ListNotificationsResponseSchema.safeParse({
      ok: true, data: { items: [], unread_count: -1, has_more: false },
    });
    expect(result.success).toBe(false);
  });
});
