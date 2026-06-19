import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('POST /v1/employer/jobs — required_skills field', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('accepts required_skills array and persists it (Chinese ok)', async () => {
    const app = createApp();
    const emp = await request(app).post('/v1/auth/register')
      .send({ user_type: 'employer', name: 'SkillEmp', contact: 'sk@emp.com' });

    const res = await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${emp.body.data.api_key}`)
      .send({
        title: '高级前端工程师',
        description: '负责核心模块开发',
        required_skills: ['React', 'TypeScript', 'Node.js'],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.required_skills).toEqual(['React', 'TypeScript', 'Node.js']);
  });

  it('ignores requirements field (removed from API) and only returns required_skills', async () => {
    const app = createApp();
    const emp = await request(app).post('/v1/auth/register')
      .send({ user_type: 'employer', name: 'SkillEmp2', contact: 'sk2@emp.com' });

    const res = await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${emp.body.data.api_key}`)
      .send({
        title: 'Backend Engineer',
        required_skills: ['Go', 'PostgreSQL'],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.required_skills).toEqual(['Go', 'PostgreSQL']);
    expect(res.body.data.requirements).toBeUndefined();
  });

  it('GET /v1/employer/jobs returns required_skills as array', async () => {
    const app = createApp();
    const emp = await request(app).post('/v1/auth/register')
      .send({ user_type: 'employer', name: 'SkillEmp3', contact: 'sk3@emp.com' });

    await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${emp.body.data.api_key}`)
      .send({ title: 'Frontend', required_skills: ['React', 'Vue'] });

    const list = await request(app).get('/v1/employer/jobs')
      .set('Authorization', `Bearer ${emp.body.data.api_key}`);
    expect(list.status).toBe(200);
    expect(list.body.data[0].required_skills).toEqual(['React', 'Vue']);
  });
});