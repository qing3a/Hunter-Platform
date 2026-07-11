import { Router, type Request, type Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import { createViewTokenRepo } from './view-token-repo.js';
import { generateViewUrl } from './generate.js';
import { createRecommendationsRepo } from '../../db/repositories/recommendations.js';
import { Errors } from '../../errors.js';

/**
 * Router for explicit view-token generation endpoints.
 *
 * Used when auto-injection via viewUrlInjector doesn't apply (e.g., when the
 * response body is an array — the audit history endpoint — since JSON.stringify
 * drops named properties on arrays). Clients call these endpoints to obtain a
 * one-time view URL on demand.
 */
export function createViewsRouter(db: DB, baseUrl: string): Router {
  const router = Router();
  const repo = createViewTokenRepo(db);

  router.use(authMiddleware(db));

  // POST /v1/views/audit/:user_id
  // Issues a one-time view URL for the requesting user's own audit log.
  // Users may only request their own audit; admins are out of scope for v1.
  router.post('/audit/:user_id', (req: Request, res: Response) => {
    const authedReq = req as Request & { user?: User };
    const user = authedReq.user;
    if (!user) {
      throw Errors.unauthorized();
    }

    const requestedUserId = req.params.user_id;
    if (requestedUserId !== user.id) {
      throw Errors.forbidden('You can only request audit view URLs for your own account');
    }

    const { url } = generateViewUrl(repo, baseUrl, user.id, 'audit', user.id);
    res.json({ ok: true, data: { view_url: url } });
  });

  // POST /v1/views/recommendation/:rec_id
  // Issues a one-time view URL for a specific recommendation. The requesting
  // user must be either the headhunter who created the recommendation or the
  // employer on the target job. The candidate on the recommendation is
  // intentionally NOT allowed (the recommendation is between the two parties).
  router.post('/recommendation/:rec_id', (req: Request, res: Response) => {
    const authedReq = req as Request & { user?: User };
    const user = authedReq.user;
    if (!user) {
      throw Errors.unauthorized();
    }

    const recId = req.params.rec_id;
    if (typeof recId !== 'string') {
      throw Errors.invalidParams('Invalid recommendation id');
    }
    const recsRepo = createRecommendationsRepo(db);
    const rec = recsRepo.findById(recId);
    if (!rec) {
      throw Errors.notFound('Recommendation not found');
    }

    const isHeadhunter = user.user_type === 'hr' && rec.headhunter_id === user.id;
    const isEmployer = user.user_type === 'pm' && rec.employer_id === user.id;
    if (!isHeadhunter && !isEmployer) {
      throw Errors.forbidden('You can only request view URLs for recommendations you are part of');
    }

    const { url } = generateViewUrl(repo, baseUrl, user.id, 'recommendation', recId);
    res.json({ ok: true, data: { view_url: url } });
  });

  return router;
}