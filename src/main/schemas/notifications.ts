import { z } from 'zod';

export const NotificationItemSchema = z.object({
  id: z.string(),
  category: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  payload: z.record(z.unknown()).nullable(),
  read_at: z.string().nullable(),
  created_at: z.string(),
  expires_at: z.string(),
});

export const ListNotificationsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    items: z.array(NotificationItemSchema),
    unread_count: z.number().int().nonnegative(),
    has_more: z.boolean(),
  }),
});

export const GetNotificationResponseSchema = z.object({
  ok: z.literal(true),
  data: NotificationItemSchema,
});

export const MarkReadResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    id: z.string(),
    read_at: z.string(),
  }),
});

export const MarkAllReadResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    marked: z.number().int().nonnegative(),
  }),
});

export const DeleteNotificationResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    id: z.string(),
  }),
});
