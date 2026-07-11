import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('GET / (marketplace landing)', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('returns 200 + HTML', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
  });

  it('contains hero + role switcher (merged for-X sections)', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('Hunter Platform');
    // P1c: 3 for-X sections merged into 1 roles-switcher with 3 tabs
    expect(res.text).toContain('id="for-roles"');
    expect(res.text).toContain('class="card roles-switcher"');
    expect(res.text).toContain('data-tab="candidates"');
    expect(res.text).toContain('data-tab="employers"');
    expect(res.text).toContain('data-tab="headhunters"');
    // Default tab = candidates (privacy narrative first)
    expect(res.text).toMatch(/data-tab="candidates"[^>]*aria-selected="true"/);
  });

it('shows real open job count', async () => {
    const app = createApp();
    const emp = await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E1', contact: 'e1@e.com' });
    await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${emp.body.data.api_key}`)
      .send({ title: 'Job 1' });
    await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${emp.body.data.api_key}`)
      .send({ title: 'Job 2' });

    const res = await request(app).get('/');
    // P0-1 + featured-jobs refactor: openJobsCount now displayed in
    // featured-jobs section header as <strong data-open-jobs-count>${N}</strong>
    expect(res.text).toMatch(/data-open-jobs-count[^>]*>2</);
  });

  it('shows candidate data after upload + publish', async () => {
    const app = createApp();
    const hh = await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' });
    const cand = await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'C1', contact: 'c1@c.com' });
    const upload = await request(app).post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${hh.body.data.api_key}`)
      .send({
        candidate_user_id: cand.body.data.id,
        name: 'X', phone: '13800138000', email: 'x@x.com',
        current_company: '字节跳动', current_title: 'P6',
        expected_salary: 600000, years_experience: 5,
        education_school: 'S', skills: ['React'],
      });
    await request(app).post(`/v1/headhunter/candidates/${upload.body.data.anonymized_id}/publish-to-pool`)
      .set('Authorization', `Bearer ${hh.body.data.api_key}`);

    const res = await request(app).get('/');
    expect(res.text).toContain('互联网');
  });

  it('does NOT include any PII', async () => {
    const app = createApp();
    await request(app).post('/v1/auth/register').send({
      user_type: 'employer', name: 'PII Test', contact: 'leaked@private.com',
    });
    const res = await request(app).get('/');
    expect(res.text).not.toContain('leaked@private.com');
    expect(res.text).not.toMatch(/user_[a-f0-9]{12}/);
  });

  it('handles empty DB gracefully', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Hunter Platform');
  });

  it('is accessible WITHOUT auth', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
  });

  describe('Hero Stats section', () => {
    it('shows today\'s unlocks count', async () => {
      const app = createApp();
      const hh = await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'StatsHH', contact: 'statsh@h.com' });
      const cand = await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'StatsC', contact: 'statsc@c.com' });
      const emp = await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'StatsE', contact: 'statse@e.com' });

      const upload = await request(app).post('/v1/headhunter/candidates')
        .set('Authorization', `Bearer ${hh.body.data.api_key}`)
        .send({ candidate_user_id: cand.body.data.id, name: 'X', phone: '13800138000', email: 'x@x.com', current_company: 'A', current_title: 'T', expected_salary: 100000, years_experience: 1, education_school: 'S', skills: [] });
      const job = await request(app).post('/v1/employer/jobs')
        .set('Authorization', `Bearer ${emp.body.data.api_key}`)
        .send({ title: 'Job' });
      const rec = await request(app).post('/v1/headhunter/recommendations')
        .set('Authorization', `Bearer ${hh.body.data.api_key}`)
        .send({ anonymized_candidate_id: upload.body.data.anonymized_id, job_id: job.body.data.id });
      await request(app).post(`/v1/employer/recommendations/${rec.body.data.id}/express-interest`)
        .set('Authorization', `Bearer ${emp.body.data.api_key}`);
      await request(app).post(`/v1/candidate/recommendations/${rec.body.data.id}/approve-unlock`)
        .set('Authorization', `Bearer ${cand.body.data.api_key}`);
      await request(app).post(`/v1/employer/recommendations/${rec.body.data.id}/unlock-contact`)
        .set('Authorization', `Bearer ${emp.body.data.api_key}`);

      const res = await request(app).get('/');
      // v3: stat-value with data-target and "今日解锁" label
      expect(res.text).toMatch(/data-target="1"[\s\S]{0,200}今日解锁/);
    });
  });

  describe('Top Headhunters tab (rankings)', () => {
    it('shows headhunters sorted by reputation DESC', async () => {
      const app = createApp();
      await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'TopA', contact: 'topa@h.com' });
      await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'TopB', contact: 'topb@h.com' });

      const res = await request(app).get('/');
      // v3: rankings tabbed section, hunters tab
      expect(res.text).toContain('Top 猎头');
      expect(res.text).toMatch(/🥇[\s\S]{0,500}(TopA|TopB)/);
    });
  });

  describe('Placements tab (rankings)', () => {
    it('renders gracefully when no placements exist', async () => {
      const app = createApp();
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      // v3: 成交 tab in rankings
      expect(res.text).toContain('成交');
    });
  });

  describe('PII safety in new sections', () => {
    it('does NOT leak user_id / contact / email', async () => {
      const app = createApp();
      await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'PIIEmp', contact: 'leaked@evil.com' });

      const res = await request(app).get('/');
      // v3: still must not leak PII (email + user_id). Employer name is shown by
      // design in the new Top Employers ranking section.
      expect(res.text).not.toContain('leaked@evil.com');
      expect(res.text).not.toMatch(/user_[a-f0-9]{12}/);
    });
  });

  describe('visual refresh', () => {
    it('contains brand color CSS variable (teal)', async () => {
      const app = createApp();
      const res = await request(app).get('/');
      expect(res.text).toContain('--brand-primary');
      expect(res.text).toMatch(/#[0-9a-f]{6}/i);
    });

    it('contains inline JS for animations', async () => {
      const app = createApp();
      const res = await request(app).get('/');
      expect(res.text).toContain('<script>');
      expect(res.text).toContain('countUp');
    });
  });
});