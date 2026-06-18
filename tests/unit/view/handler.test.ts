import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { openDb, type DB } from '../../../src/main/db/connection';
import { runMigrations } from '../../../src/main/db/migrations';
import { createViewTokenRepo } from '../../../src/main/modules/view/view-token-repo';
import { generateViewUrl } from '../../../src/main/modules/view/generate';
import { createViewHandlers } from '../../../src/main/modules/view/handler';

describe('view handlers', () => {
  let db: DB;
  let app: express.Express;
  const BASE_URL = 'http://localhost:3000';

  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
    const repo = createViewTokenRepo(db);
    const handlers = createViewHandlers(repo, BASE_URL, {
      // Stub data sources — return canned data for each view type
      getCandidate: async (id: string) => id === 'cand_real' ? {
        anonymizedId: 'cand_real', industry: '互联网', titleLevel: 'P6',
        salaryRange: '60-80万', educationTier: '985', yearsExperience: 8, skills: ['React'],
      } : null,
      getRecommendation: async () => null,
      getUserQuota: async () => null,
      getAudit: async () => [],
    });
    app = express();
    app.use('/view', handlers.router);
  });

  afterEach(() => db.close());

  it('GET /view/candidate/:id without token returns 400', async () => {
    const r = await request(app).get('/view/candidate/cand_real');
    expect(r.status).toBe(400);
    expect(r.text).toContain('缺少访问令牌');
  });

  it('GET /view/candidate/:id with valid token returns 200 + HTML', async () => {
    const { url } = generateViewUrl(createViewTokenRepo(db), BASE_URL, 'user_1', 'candidate', 'cand_real');
    const r = await request(app).get(url.replace(BASE_URL, ''));
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/^text\/html/);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.text).toContain('候选人画像');
  });

  it('GET /view/candidate/:id with consumed token returns 410', async () => {
    const repo = createViewTokenRepo(db);
    const { url } = generateViewUrl(repo, BASE_URL, 'user_1', 'candidate', 'cand_real');
    const path = url.replace(BASE_URL, '');
    await request(app).get(path);  // consumes
    const r2 = await request(app).get(path);
    expect(r2.status).toBe(410);
    expect(r2.text).toContain('已被使用');
  });

  it('GET /view/candidate/:id with type-mismatched token returns 404', async () => {
    const repo = createViewTokenRepo(db);
    const { token } = generateViewUrl(repo, BASE_URL, 'user_1', 'recommendation', 'rec_x');
    const r = await request(app).get(`/view/candidate/cand_real?t=${token}`);
    expect(r.status).toBe(404);
  });

  it('GET /view/candidate/:id when resource not found returns 404', async () => {
    const repo = createViewTokenRepo(db);
    const { url } = generateViewUrl(repo, BASE_URL, 'user_1', 'candidate', 'cand_missing');
    const r = await request(app).get(url.replace(BASE_URL, ''));
    expect(r.status).toBe(404);
  });
});