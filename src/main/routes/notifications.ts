import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { DB } from '../db/connection.js';
import { authMiddleware } from '../modules/auth/middleware.js';
import { createRateLimitMiddleware } from '../modules/rate-limit/middleware.js';
import { createNotificationHandler } from '../modules/notification/handler.js';
import { Errors } from '../errors.js';
import { respond } from '../responses.js';
import {
  ListNotificationsResponseSchema, GetNotificationResponseSchema, MarkReadResponseSchema,
  MarkAllReadResponseSchema, DeleteNotificationResponseSchema,
} from '../schemas/notifications.js';
import type { User } from '../../shared/types.js';

const ListQuerySchema = z.object({
  unread: z.string().optional().transform(v => v === 'true'),
  category: z.string().optional(),
  since: z.string().optional(),
  limit: z.string().optional().transform(v => v ? Math.min(200, Math.max(1, parseInt(v, 10) || 50)) : 50),
  offset: z.string().optional().transform(v => v ? Math.max(0, parseInt(v, 10) || 0) : 0),
});

export function createNotificationsRouter(db: DB): Router {
  const router = Router();
  const handler = createNotificationHandler(db);

  router.use(authMiddleware(db));
  router.use(createRateLimitMiddleware(db));

  // GET /v1/notifications (mount prefix is /v1/notifications)
  router.get('/', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user as User;
      const parsed = ListQuerySchema.safeParse(req.query);
      if (!parsed.success) throw Errors.invalidParams('Invalid query', { issues: parsed.error.issues });
      const q = parsed.data;
      const { rows, unread_count } = handler.list({
        userId: user.id,
        unread: q.unread,
        category: q.category,
        since: q.since,
        limit: q.limit,
        offset: q.offset,
      } as any);  // exactOptionalPropertyTypes: build filter with whatever was set
      const has_more = rows.length === q.limit;
      const items = rows.map(r => ({
        id: r.id, category: r.category, title: r.title, body: r.body,
        payload: r.payload_json ? JSON.parse(r.payload_json) : null,
        read_at: r.read_at, created_at: r.created_at, expires_at: r.expires_at,
      }));
      respond(res, ListNotificationsResponseSchema, { ok: true, data: { items, unread_count, has_more } });
    } catch (e) { next(e); }
  });

  // GET /v1/notifications/:id
  router.get('/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user as User;
      const id = String(req.params.id);
      const row = handler.findOne(id, user.id);
      if (!row) throw Errors.notFound('Notification not found');
      const item = {
        id: row.id, category: row.category, title: row.title, body: row.body,
        payload: row.payload_json ? JSON.parse(row.payload_json) : null,
        read_at: row.read_at, created_at: row.created_at, expires_at: row.expires_at,
      };
      respond(res, GetNotificationResponseSchema, { ok: true, data: item });
    } catch (e) { next(e); }
  });

  // POST /v1/notifications/:id/read
  router.post('/:id/read', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user as User;
      const id = String(req.params.id);
      const readAt = handler.markRead(id, user.id);
      if (readAt === null) throw Errors.notFound('Notification not found');
      respond(res, MarkReadResponseSchema, { ok: true, data: { id, read_at: readAt } });
    } catch (e) { next(e); }
  });

  // POST /v1/notifications/read-all
  router.post('/read-all', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user as User;
      const marked = handler.markAllRead(user.id);
      respond(res, MarkAllReadResponseSchema, { ok: true, data: { marked } });
    } catch (e) { next(e); }
  });

  // DELETE /v1/notifications/:id
  router.delete('/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user as User;
      const id = String(req.params.id);
      const ok = handler.delete(id, user.id);
      if (!ok) throw Errors.notFound('Notification not found');
      respond(res, DeleteNotificationResponseSchema, { ok: true, data: { id } });
    } catch (e) { next(e); }
  });

  return router;
}
