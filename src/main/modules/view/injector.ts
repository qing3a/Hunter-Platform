import type { Request, Response, NextFunction } from 'express';
import { ROUTE_VIEW_MAP } from './route-view-map.js';
import { generateViewUrl, type ViewType } from './generate.js';
import { createViewTokenRepo } from './view-token-repo.js';
import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';

type RequestWithUser = Request & { user?: User };

function lookup(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function matchRoute(method: string, routePath: string, pattern: string): boolean {
  // pattern like 'POST /v1/headhunter/candidates' or 'GET /v1/users/{id}/status'
  // routePath is the registered Express route path
  const [pMethod, pPath] = pattern.split(' ');
  if (!pMethod || !pPath) return false;
  if (pMethod !== method) return false;
  const pParts = pPath.split('/');
  const rParts = routePath.split('/');
  if (pParts.length !== rParts.length) return false;
  return pParts.every((p, i) => p.startsWith('{') || p === rParts[i]);
}

export function createViewUrlInjector(db: DB, baseUrl: string) {
  const repo = createViewTokenRepo(db);

  return function viewUrlInjector(req: Request, res: Response, next: NextFunction): void {
    // Capture res.json to mutate the body before sending
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      try {
        // Only inject on 2xx (also accept 3xx redirects)
        if (res.statusCode >= 200 && res.statusCode < 400 && body && typeof body === 'object') {
          const b = body as { data?: unknown };
          if (b.data && typeof b.data === 'object') {
            const routeKey = `${req.method} ${req.route?.path ?? req.path}`;
            const mapping = ROUTE_VIEW_MAP[routeKey];
            if (mapping) {
              const idSource = mapping.idFrom.startsWith('params.') ? req.params : b.data;
              const viewId = lookup(idSource, mapping.idFrom.replace(/^params\./, '')) as string | undefined;
              const authedReq = req as RequestWithUser;
              if (viewId && authedReq.user) {
                const userId = authedReq.user.id;
                const { url } = generateViewUrl(repo, baseUrl, userId, mapping.type as ViewType, viewId);
                (b.data as Record<string, unknown>).view_url = url;
              }
            }
          }
        }
      } catch {
        // Never break the response on injection failure
      }
      return originalJson(body);
    };
    next();
  };
}

// Re-export for testing/utility
export { matchRoute };
