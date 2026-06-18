import type { Request, Response, RequestHandler } from 'express';
import { lookupActionType } from './route-action-map.js';
import { sanitizeSummary } from './sanitize-summary.js';
import type { ActionHistoryEntry } from '../../db/repositories/action-history.js';

interface RepoShape {
  insert(entry: Omit<ActionHistoryEntry, 'id'>): number;
}

export function createActionHistoryMiddleware(repo: RepoShape): RequestHandler {
  return function actionHistoryMW(req: Request, res: Response, next) {
    const user = (req as any).user;
    if (!user || !user.id) {
      return next();  // 未鉴权请求不写
    }

    const start = Date.now();
    const actionType = lookupActionType(req.method, req.path);

    res.on('finish', () => {
      try {
        let reqSummary: object | null = null;
        let resSummary: object | null = null;
        try {
          reqSummary = sanitizeSummary((res.locals as any).ahReqSummary);
          resSummary = sanitizeSummary((res.locals as any).ahResSummary);
        } catch {
          return;  // PII detected, skip write (security over coverage)
        }

        const status: 'success' | 'error' = res.statusCode < 400 ? 'success' : 'error';
        const errorCode = status === 'error' ? ((res.locals as any).errorCode ?? null) : null;

        repo.insert({
          user_id: user.id,
          action_type: actionType,
          target_type: (res.locals as any).ahTargetType ?? null,
          target_id: (res.locals as any).ahTargetId ?? null,
          request_summary_json: reqSummary ? JSON.stringify(reqSummary) : null,
          response_summary_json: resSummary ? JSON.stringify(resSummary) : null,
          status,
          error_code: errorCode,
          duration_ms: Date.now() - start,
          created_at: new Date().toISOString(),
        });
      } catch (e) {
        // fire-and-forget: never propagate insert failures
        console.warn('[action-history] insert failed:', (e as Error).message);
      }
    });

    next();
  };
}