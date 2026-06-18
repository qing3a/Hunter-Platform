import { Router, type Request, type Response } from 'express';
import { createViewTokenRepo } from './view-token-repo.js';
import { validateAndConsume, type ValidateFailureReason } from './validate.js';
import type { ViewType } from './generate.js';
import { renderCandidate, type CandidateViewData } from './templates/candidate.js';
import { renderRecommendation, type RecommendationViewData } from './templates/recommendation.js';
import { renderUserQuota, type UserQuotaViewData } from './templates/user-quota.js';
import { renderAudit, type AuditViewData, type AuditEntry } from './templates/audit.js';
import { renderErrorPage } from './templates/error.js';

export interface ViewDataSources {
  getCandidate(id: string): Promise<CandidateViewData | null>;
  getRecommendation(id: string): Promise<RecommendationViewData | null>;
  getUserQuota(id: string): Promise<UserQuotaViewData | null>;
  getAudit(userId: string): Promise<AuditEntry[]>;
}

const ERROR_PAGE_FOR_REASON: Record<ValidateFailureReason, { status: number; title: string; message: string; icon: string }> = {
  invalid:        { status: 410, title: '链接无效',         message: '链接无效或已过期。请重新发起请求以获取新链接。', icon: '🔗' },
  expired:        { status: 410, title: '链接已过期',       message: '链接无效或已过期。请重新发起请求以获取新链接。', icon: '🔗' },
  consumed:       { status: 410, title: '链接已被使用',     message: '此链接已被使用（一次性链接）。如需再次查看，请重新发起请求。', icon: '🔗' },
  type_mismatch:  { status: 404, title: '资源不存在',       message: '资源不存在或您无权访问。', icon: '🔗' },
};

export function createViewHandlers(
  repo: ReturnType<typeof createViewTokenRepo>,
  baseUrl: string,
  sources: ViewDataSources,
): { router: import('express').Router } {
  const router = Router();

  function sendError(res: Response, httpStatus: number, title: string, message: string, icon: string) {
    res.status(httpStatus).type('text/html; charset=utf-8').set('Cache-Control', 'no-store')
      .send(renderErrorPage({ httpStatus, title, message, icon }));
  }

  async function handleView(viewType: ViewType, id: string, req: Request, res: Response) {
    const token = typeof req.query.t === 'string' ? req.query.t : null;
    if (!token) {
      sendError(res, 400, '缺少访问令牌', '请通过有效的链接访问此页面。', '🔗');
      return;
    }

    const result = validateAndConsume(repo, token, viewType);
    if (!result.ok) {
      const cfg = ERROR_PAGE_FOR_REASON[result.reason];
      sendError(res, cfg.status, cfg.title, cfg.message, cfg.icon);
      return;
    }

    let html: string | null = null;
    let resourceMissing = false;

    switch (viewType) {
      case 'candidate': {
        const data = await sources.getCandidate(id);
        if (!data) resourceMissing = true; else html = renderCandidate(data);
        break;
      }
      case 'recommendation': {
        const data = await sources.getRecommendation(id);
        if (!data) resourceMissing = true; else html = renderRecommendation(data);
        break;
      }
      case 'user-quota': {
        const data = await sources.getUserQuota(id);
        if (!data) resourceMissing = true; else html = renderUserQuota(data);
        break;
      }
      case 'audit': {
        const entries = await sources.getAudit(id);
        if (entries.length === 0 && id !== result.userId) resourceMissing = true;
        const data: AuditViewData = { userId: result.userId, entries };
        html = renderAudit(data);
        break;
      }
    }

    if (resourceMissing || html === null) {
      sendError(res, 404, '资源不存在', '此资源已不存在。', '🔗');
      return;
    }

    res.status(200).type('text/html; charset=utf-8').set('Cache-Control', 'no-store').send(html);
  }

  router.get('/candidate/:id', (req, res) => handleView('candidate', req.params.id, req, res));
  router.get('/recommendation/:id', (req, res) => handleView('recommendation', req.params.id, req, res));
  router.get('/user-quota/:id', (req, res) => handleView('user-quota', req.params.id, req, res));
  router.get('/audit/:id', (req, res) => handleView('audit', req.params.id, req, res));

  return { router };
}