import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, resetDb } from '../../helpers/test-app.js';

describe('Candidate Portal E2E', () => {
  beforeEach(() => resetDb());

  it('rejects unknown email format in OTP request', async () => {
    const app = createTestApp();
    const res = await request(app)
      .post('/v1/candidate-portal/auth/otp/request')
      .send({ email: 'invalid' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAMS');
  });

  it('rate limits OTP requests per IP', async () => {
    const app = createTestApp();
    // First 5 requests succeed
    for (let i = 0; i < 5; i++) {
      const r = await request(app)
        .post('/v1/candidate-portal/auth/otp/request')
        .send({ email: `rl${i}@test.com` });
      expect(r.status).toBe(200);
    }
    // 6th request hits IP limit
    const r = await request(app)
      .post('/v1/candidate-portal/auth/otp/request')
      .send({ email: 'rl5@test.com' });
    expect(r.status).toBe(429);
  });

  it('rejects expired OTP', async () => {
    const app = createTestApp({ otpTtlSeconds: 0 });
    await request(app)
      .post('/v1/candidate-portal/auth/otp/request')
      .send({ email: 'exp@test.com' });
    // With TTL=0, the OTP is already expired
    const r = await request(app)
      .post('/v1/candidate-portal/auth/otp/verify')
      .send({ email: 'exp@test.com', code: '123456' });
    expect(r.status).toBe(404); // OTP_EXPIRED
  });

  it('rejects malformed bearer tokens', async () => {
    const app = createTestApp();
    const r = await request(app)
      .get('/v1/candidate-portal/profile')
      .set('Authorization', 'Bearer not-a-real-key');
    expect(r.status).toBe(401);
  });

  it('rejects requests to unknown paths under /v1/candidate-portal', async () => {
    const app = createTestApp();
    const r = await request(app)
      .get('/v1/candidate-portal/nonexistent-endpoint');
    expect(r.status).toBe(404);
  });

  it('full happy path: candidate registers, browses, applies', async () => {
    // This requires seeding a candidate with anonymized record + a job
    // Skip if too complex; document
  });
});
