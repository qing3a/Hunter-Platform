// src/main/routes/landing.ts
import { Router, type Request, type Response } from 'express';
import type { DB } from '../db/connection.js';
import { gatherLandingData } from '../modules/view/gather-landing-data.js';
import { renderLanding } from '../modules/view/templates/landing/index.js';

const FALLBACK_HTML = `<!DOCTYPE html><html lang="zh-CN"><body><main><h1>Hunter Platform</h1><p>暂不可用</p></main></body></html>`;

export function createLandingRouter(db: DB): Router {
  const router = Router();

  // GET / — public marketplace landing page (no auth, no quota)
  router.get('/', (_req: Request, res: Response) => {
    try {
      const data = gatherLandingData(db);
      const html = renderLanding(data);
      res.status(200).type('text/html; charset=utf-8').send(html);
    } catch (e) {
      console.error('Landing render failed:', e);
      res.status(500).type('text/html; charset=utf-8').send(FALLBACK_HTML);
    }
  });

  return router;
}