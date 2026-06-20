import type { Request, Response, NextFunction } from 'express';
import { ROUTE_VIEW_MAP, type ViewMapping } from './route-view-map.js';
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

function findMapping(method: string, routePath: string): ViewMapping | undefined {
  for (const [pattern, m] of Object.entries(ROUTE_VIEW_MAP)) {
    if (matchRoute(method, routePath, pattern)) {
      return m;
    }
  }
  return undefined;
}

export function createViewUrlInjector(db: DB, baseUrl: string) {
  const repo = createViewTokenRepo(db);

  return function viewUrlInjector(req: Request, res: Response, next: NextFunction): void {
    // Capture res.json to mutate the body before sending
    const originalJson = res.json.bind(res);
    // Capture method + path NOW: Express rewrites req.path as the request traverses
    // sub-routers (e.g. "/candidates" instead of "/v1/headhunter/candidates"). At
    // res.json time the path is the sub-route path, which won't match the map.
    const reqMethod = req.method;
    const reqPath = req.path;
    res.json = (body: unknown) => {
      try {
        // Only inject on 2xx (also accept 3xx redirects)
        if (res.statusCode >= 200 && res.statusCode < 400 && body && typeof body === 'object') {
          const b = body as { data?: unknown };
          if (b.data) {
            // CASE 1: object response — inject one view_url
            if (typeof b.data === 'object' && !Array.isArray(b.data)) {
              const mapping = findMapping(reqMethod, reqPath);
              if (mapping) {
                const isParams = mapping.idFrom.startsWith('params.');
                const idSource: unknown = isParams ? req.params : body;
                const lookupPath = isParams ? mapping.idFrom.slice('params.'.length) : mapping.idFrom;
                const viewId = lookup(idSource, lookupPath) as string | undefined;
                const authedReq = req as RequestWithUser;
                if (viewId && authedReq.user) {
                  const userId = authedReq.user.id;
                  const { url } = generateViewUrl(repo, baseUrl, userId, mapping.type as ViewType, viewId);
                  (b.data as Record<string, unknown>).view_url = url;
                }
              }
            }
            // CASE 2: array response — inject view_url per element
            // (Was previously skipped: the comment cited JSON.stringify dropping named
            // properties on arrays. But we inject on ELEMENTS, not on the array itself,
            // so each element keeps its view_url.)
            else if (Array.isArray(b.data)) {
              const mapping = findMapping(reqMethod, reqPath);
              if (mapping && mapping.idFrom.startsWith('data[*].')) {
                const fieldName = mapping.idFrom.slice('data[*].'.length);
                const authedReq = req as RequestWithUser;
                if (authedReq.user) {
                  const userId = authedReq.user.id;
                  for (const item of b.data) {
                    if (item && typeof item === 'object') {
                      const viewId = (item as Record<string, unknown>)[fieldName] as string | undefined;
                      if (viewId) {
                        const { url } = generateViewUrl(repo, baseUrl, userId, mapping.type as ViewType, viewId);
                        (item as Record<string, unknown>).view_url = url;
                      }
                    }
                  }
                }
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
export { matchRoute, findMapping };
