import { describe, it, expect, beforeEach } from 'vitest';
import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createAdminAuthMiddleware } from '../../../src/main/modules/admin/auth';
import { ApiError } from '../../../src/main/errors';

describe('adminAuthMiddleware', () => {
  const ADMIN_PWD = 'super-secret-admin-pwd-1234';
  let app: express.Express;

  beforeEach(() => {
    process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(ADMIN_PWD, 4);
    app = express();
    app.get('/protected',
      createAdminAuthMiddleware(),
      (_req, res) => res.json({ ok: true }),
    );
    // Match server.ts error handler so ApiError → JSON response
    const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
      if (err instanceof ApiError) {
        res.status(err.statusCode).json({
          ok: false,
          error: { code: err.code, message: err.message, details: err.details },
        });
        return;
      }
      res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    };
    app.use(errorHandler);
  });

  it('rejects request without Authorization header', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects wrong password', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer wrong-password`);
    expect(res.status).toBe(401);
  });

  it('rejects non-Bearer scheme', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Basic ${Buffer.from(ADMIN_PWD).toString('base64')}`);
    expect(res.status).toBe(401);
  });

  it('accepts correct password', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${ADMIN_PWD}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejects malformed bearer (no space)', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', ADMIN_PWD);  // missing "Bearer "
    expect(res.status).toBe(401);
  });
});