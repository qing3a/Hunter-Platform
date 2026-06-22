import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

/**
 * Happy-path tests for the 4 state-change endpoints that mutate a
 * recommendation's status. Each one should:
 *  - auto-inject `view_url` in the response (already handled by viewUrlInjector)
 *  - the returned view_url must render recommendation HTML
 *  - the view_url is multi-use within 7d TTL (no consume on first use)
 */
describe('state-change endpoints — view_url injection + render', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });

  afterEach(() => { delete process.env.DATABASE_PATH; });

  /**
   * Set up: headhunter + candidate + employer + job + recommendation.
   * Returns API keys for each role and the recommendation id.
   */
  async function setupRecommendation() {
    const app = createApp();

    const hh = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'StHH', contact: 'sthh@state.com' });
    const cand = await request(app).post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'StC', contact: 'stc@state.com' });
    const emp = await request(app).post('/v1/auth/register')
      .send({ user_type: 'employer', name: 'StE', contact: 'ste@state.com' });

    const upload = await request(app).post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${hh.body.data.api_key}`)
      .send({
        candidate_user_id: cand.body.data.id,
        name: 'X', phone: '13800138000', email: 'x@x.com',
        current_company: 'A', current_title: 'T',
        expected_salary: 100000, years_experience: 1,
        education_school: 'S', skills: [],
      });

    const job = await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${emp.body.data.api_key}`)
      .send({ title: 'Senior Engineer', description: 'role' });

    const rec = await request(app).post('/v1/headhunter/recommendations')
      .set('Authorization', `Bearer ${hh.body.data.api_key}`)
      .send({ anonymized_candidate_id: upload.body.data.anonymized_id, job_id: job.body.data.id });

    return {
      app,
      hhKey: hh.body.data.api_key,
      candKey: cand.body.data.api_key,
      empKey: emp.body.data.api_key,
      recommendationId: rec.body.data.id,
    };
  }

  it('POST /v1/employer/recommendations/:id/express-interest injects view_url that renders', async () => {
    const { app, empKey, recommendationId } = await setupRecommendation();
    const res = await request(app).post(`/v1/employer/recommendations/${recommendationId}/express-interest`)
      .set('Authorization', `Bearer ${empKey}`);

    expect(res.status).toBe(200);
    expect(res.body.data.view_url).toMatch(/^http:\/\/localhost:3000\/view\/recommendation\//);

    const path = res.body.data.view_url.replace('http://localhost:3000', '');
    const viewRes = await request(app).get(path);
    expect(viewRes.status).toBe(200);
    expect(viewRes.text).toContain('推荐状态');

    // Multi-use: second fetch also 200 (not 410)
    const r2 = await request(app).get(path);
    expect(r2.status).toBe(200);
  });

  it('POST /v1/candidate/recommendations/:id/approve-unlock injects view_url that renders', async () => {
    const { app, candKey, empKey, recommendationId } = await setupRecommendation();
    // State machine: candidate can only approve after employer has expressed interest
    await request(app).post(`/v1/employer/recommendations/${recommendationId}/express-interest`)
      .set('Authorization', `Bearer ${empKey}`);

    const res = await request(app).post(`/v1/candidate/recommendations/${recommendationId}/approve-unlock`)
      .set('Authorization', `Bearer ${candKey}`);

    expect(res.status).toBe(200);
    expect(res.body.data.view_url).toMatch(/^http:\/\/localhost:3000\/view\/recommendation\//);

    const path = res.body.data.view_url.replace('http://localhost:3000', '');
    const viewRes = await request(app).get(path);
    expect(viewRes.status).toBe(200);
    expect(viewRes.text).toContain('推荐状态');
  });

  it('POST /v1/candidate/recommendations/:id/reject-unlock injects view_url that renders', async () => {
    const { app, candKey, empKey, recommendationId } = await setupRecommendation();
    // State machine: candidate can only reject after employer has expressed interest
    await request(app).post(`/v1/employer/recommendations/${recommendationId}/express-interest`)
      .set('Authorization', `Bearer ${empKey}`);

    const res = await request(app).post(`/v1/candidate/recommendations/${recommendationId}/reject-unlock`)
      .set('Authorization', `Bearer ${candKey}`);

    expect(res.status).toBe(200);
    expect(res.body.data.view_url).toMatch(/^http:\/\/localhost:3000\/view\/recommendation\//);

    const path = res.body.data.view_url.replace('http://localhost:3000', '');
    const viewRes = await request(app).get(path);
    expect(viewRes.status).toBe(200);
    expect(viewRes.text).toContain('推荐状态');
  });

  it('POST /v1/employer/recommendations/:id/unlock-contact (after approval) injects view_url', async () => {
    const { app, hhKey, empKey, candKey, recommendationId } = await setupRecommendation();

    // Drive state machine to unlockable: express-interest, then approve
    await request(app).post(`/v1/employer/recommendations/${recommendationId}/express-interest`)
      .set('Authorization', `Bearer ${empKey}`);
    await request(app).post(`/v1/candidate/recommendations/${recommendationId}/approve-unlock`)
      .set('Authorization', `Bearer ${candKey}`);

    const res = await request(app).post(`/v1/employer/recommendations/${recommendationId}/unlock-contact`)
      .set('Authorization', `Bearer ${empKey}`);

    expect(res.status).toBe(200);
    expect(res.body.data.view_url).toMatch(/^http:\/\/localhost:3000\/view\/recommendation\//);

    const path = res.body.data.view_url.replace('http://localhost:3000', '');
    const viewRes = await request(app).get(path);
    expect(viewRes.status).toBe(200);
    expect(viewRes.text).toContain('推荐状态');
  });
});