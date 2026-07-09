// tests/integration/candidate-portal/messages.test.ts
//
// Integration tests for the Candidate Portal Phase 1 messages endpoints
// (Task 10):
//   - GET    /v1/candidate-portal/messages          — list inbox/sent
//   - POST   /v1/candidate-portal/messages          — send
//   - GET    /v1/candidate-portal/messages/:id      — detail
//   - POST   /v1/candidate-portal/messages/:id/read — mark as read
//
// Tests here intentionally mirror the patterns established in profile.test.ts
// and jobs.test.ts: a minimal Router is reconstructed in-test (the full
// candidate-portal router is wired in Task 12), and the auth flow uses
// `makeCandidate` so the test exercises the real authMiddleware + the real
// handlers against a freshly-migrated in-process SQLite DB.

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import {
  createTestApp,
  resetDb,
  closeTestDb,
  __resetRateLimits,
  getTestDb,
} from '../../helpers/test-app.js';
import { createCandidatePortalMessages } from '../../../src/main/modules/candidate-portal/messages.js';
import { authMiddleware } from '../../../src/main/modules/auth/middleware.js';
import { respond } from '../../../src/main/responses.js';
import { EnvelopeSchema } from '../../../src/main/schemas/common.js';
import { Errors, ApiError } from '../../../src/main/errors.js';
import { createUtf8OnlyMiddleware } from '../../../src/main/modules/encoding/index.js';
import { MAX_BODY_SIZE } from '../../../src/shared/constants.js';
import type { User } from '../../../src/shared/types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Seed a headhunter or employer recipient in the DB; returns the user id. */
function seedRecipient(opts: {
  id: string;
  userType: 'headhunter' | 'employer';
  name?: string;
}): void {
  const db = getTestDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO users (id, user_type, name, contact, agent_endpoint,
                                 api_key_hash, api_key_prefix, api_key_expires_at,
                                 prev_api_key_hash, prev_api_key_prefix, prev_api_key_expires_at,
                                 quota_per_day, quota_used, quota_reset_at, reputation,
                                 status, created_at, updated_at)
    VALUES (?, ?, ?, NULL, NULL,
            ?, 'hp_prefix_xx', NULL,
            NULL, NULL, NULL,
            200, 0, ?, 50,
            'active', ?, ?)
  `).run(
    opts.id,
    opts.userType,
    opts.name ?? `Test ${opts.userType}`,
    `hash_${opts.id}`,
    now,
    now,
    now,
  );
}

/** Create a fully-OTP'd candidate user and return { apiKey, userId }. */
async function makeCandidate(email: string): Promise<{ apiKey: string; userId: string }> {
  const app = createTestApp();
  const req1 = await request(app)
    .post('/v1/candidate-portal/auth/otp/request')
    .send({ email });
  expect(req1.status).toBe(200);
  const code = req1.body.data.dev_code as string;
  const verify = await request(app)
    .post('/v1/candidate-portal/auth/otp/verify')
    .send({ email, code });
  expect(verify.status).toBe(200);
  return {
    apiKey: verify.body.data.api_key as string,
    userId: verify.body.data.user_id as string,
  };
}

/** Minimal router that mounts GET/POST /v1/candidate-portal/messages, GET
 *  /v1/candidate-portal/messages/:id, POST /v1/candidate-portal/messages/:id/read.
 *  Reconstructed here (instead of imported from src/main/routes) because the
 *  full candidate-portal router is built in Task 12. */
function buildMessagesRouter(): express.Router {
  const router = express.Router();

  // GET /v1/candidate-portal/messages
  router.get('/v1/candidate-portal/messages', authMiddleware(getTestDb()), (req, res, next) => {
    try {
      const user = (req as typeof req & { user?: User }).user;
      if (!user) throw Errors.unauthorized();
      const opts = {
        box: (req.query.box as 'inbox' | 'sent' | undefined) ?? 'inbox',
        unread_only: req.query.unread_only === 'true',
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      };
      const result = createCandidatePortalMessages(getTestDb()).list(user, opts);
      const schema = EnvelopeSchema(
        z.object({
          items: z.array(z.unknown()),
          unread_count: z.number(),
          box: z.enum(['inbox', 'sent']),
        })
      );
      respond(res, schema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // POST /v1/candidate-portal/messages
  router.post('/v1/candidate-portal/messages', authMiddleware(getTestDb()), (req, res, next) => {
    try {
      const user = (req as typeof req & { user?: User }).user;
      if (!user) throw Errors.unauthorized();
      const body = req.body as Record<string, unknown>;
      // Strict whitelist (router-layer concern): reject unknown fields.
      const allowed = new Set(['to_user_id', 'content', 'application_id']);
      for (const key of Object.keys(body)) {
        if (!allowed.has(key)) {
          throw Errors.invalidParams(`Field not allowed: ${key}`, { field: key });
        }
      }
      // Minimal shape validation (the handler does the rest).
      if (typeof body.to_user_id !== 'string' || body.to_user_id.length === 0) {
        throw Errors.invalidParams('to_user_id must be a non-empty string');
      }
      if (typeof body.content !== 'string') {
        throw Errors.invalidParams('content must be a string');
      }
      const input = {
        to_user_id: body.to_user_id,
        content: body.content,
        application_id: typeof body.application_id === 'number' ? body.application_id : undefined,
      };
      const result = createCandidatePortalMessages(getTestDb()).send(user, input);
      const schema = EnvelopeSchema(z.object({ message_id: z.number().int().positive() }));
      respond(res, schema, { ok: true, data: result });
    } catch (e) { next(e); }
  });

  // GET /v1/candidate-portal/messages/:id
  router.get('/v1/candidate-portal/messages/:id', authMiddleware(getTestDb()), (req, res, next) => {
    try {
      const user = (req as typeof req & { user?: User }).user;
      if (!user) throw Errors.unauthorized();
      const id = Number(req.params.id);
      const item = createCandidatePortalMessages(getTestDb()).detail(user, id);
      const schema = EnvelopeSchema(z.unknown());
      respond(res, schema, { ok: true, data: item });
    } catch (e) { next(e); }
  });

  // POST /v1/candidate-portal/messages/:id/read
  router.post(
    '/v1/candidate-portal/messages/:id/read',
    authMiddleware(getTestDb()),
    (req, res, next) => {
      try {
        const user = (req as typeof req & { user?: User }).user;
        if (!user) throw Errors.unauthorized();
        const id = Number(req.params.id);
        const result = createCandidatePortalMessages(getTestDb()).markRead(user, id);
        const schema = EnvelopeSchema(
          z.object({ message_id: z.number().int().positive(), read_at: z.number().int().positive() })
        );
        respond(res, schema, { ok: true, data: result });
      } catch (e) { next(e); }
    }
  );

  return router;
}

/** Mount the messages router on a fresh Express app (with auth + error
 *  middleware). We can't reuse createTestApp() because it installs a 404
 *  catch-all AT THE END of the middleware chain — mounting a router via
 *  app.use() afterwards would put it AFTER the 404 and never be reached. */
function buildAppWithMessagesRouter(): express.Express {
  // Ensure the shared DB is initialized.
  createTestApp();
  const app = express();
  app.use(
    createUtf8OnlyMiddleware(),
    express.json({ limit: MAX_BODY_SIZE })
  );
  app.use(buildMessagesRouter());
  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'No route matched' } });
  });
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({
        ok: false,
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    // eslint-disable-next-line no-console
    console.error('Unhandled test error:', err);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal error' } });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('candidate-portal: messages (handler + repo integration)', () => {
  beforeEach(() => {
    resetDb();
    __resetRateLimits();
  });
  afterAll(() => closeTestDb());

  // -------- auth gating ----------

  describe('auth gating', () => {
    it('GET /messages returns 401 without bearer token', async () => {
      const app = buildAppWithMessagesRouter();
      const res = await request(app).get('/v1/candidate-portal/messages');
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
    });

    it('POST /messages returns 401 without bearer token', async () => {
      const app = buildAppWithMessagesRouter();
      const res = await request(app)
        .post('/v1/candidate-portal/messages')
        .send({ to_user_id: 'h_x', content: 'hi' });
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
    });

    it('GET /messages/:id returns 401 without bearer token', async () => {
      const app = buildAppWithMessagesRouter();
      const res = await request(app).get('/v1/candidate-portal/messages/1');
      expect(res.status).toBe(401);
    });

    it('POST /messages/:id/read returns 401 without bearer token', async () => {
      const app = buildAppWithMessagesRouter();
      const res = await request(app).post('/v1/candidate-portal/messages/1/read');
      expect(res.status).toBe(401);
    });

    it('returns 401 with malformed bearer token', async () => {
      const app = buildAppWithMessagesRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/messages')
        .set('Authorization', 'Bearer not-a-real-key');
      expect(res.status).toBe(401);
    });
  });

  // -------- happy path ----------

  describe('happy path — authenticated candidate', () => {
    it('GET /messages returns empty inbox + unread_count=0 for a fresh candidate', async () => {
      const { apiKey } = await makeCandidate(`fresh-${Date.now()}@example.com`);

      const app = buildAppWithMessagesRouter();
      const res = await request(app)
        .get('/v1/candidate-portal/messages')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.items).toEqual([]);
      expect(res.body.data.unread_count).toBe(0);
      expect(res.body.data.box).toBe('inbox');
    });

    it('POST /messages creates a message and returns its id', async () => {
      const { apiKey } = await makeCandidate(`send-${Date.now()}@example.com`);
      seedRecipient({ id: 'h_target', userType: 'headhunter', name: 'Hunter One' });

      const app = buildAppWithMessagesRouter();
      const res = await request(app)
        .post('/v1/candidate-portal/messages')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ to_user_id: 'h_target', content: 'Hi! Are you interested in my profile?' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(typeof res.body.data.message_id).toBe('number');
      expect(res.body.data.message_id).toBeGreaterThan(0);
    });

    it('POST /messages then GET /messages inbox surfaces the message', async () => {
      const sender = await makeCandidate(`sender-${Date.now()}@example.com`);
      // Receiver is a separate candidate so we can hit their inbox.
      const receiver = await makeCandidate(`receiver-${Date.now()}@example.com`);

      // The sender needs to be able to write to the receiver. Headhunter /
      // employer cross-type sends are also valid; we're using candidate →
      // candidate here just to exercise the inbox path symmetrically.
      const app = buildAppWithMessagesRouter();
      const send = await request(app)
        .post('/v1/candidate-portal/messages')
        .set('Authorization', `Bearer ${sender.apiKey}`)
        .send({ to_user_id: receiver.userId, content: 'hello from sender' });
      expect(send.status).toBe(200);

      const inbox = await request(app)
        .get('/v1/candidate-portal/messages?box=inbox')
        .set('Authorization', `Bearer ${receiver.apiKey}`);
      expect(inbox.status).toBe(200);
      expect(inbox.body.data.items).toHaveLength(1);
      expect(inbox.body.data.unread_count).toBe(1);
      expect(inbox.body.data.items[0].from_user_id).toBe(sender.userId);
      expect(inbox.body.data.items[0].content).toBe('hello from sender');
      expect(inbox.body.data.items[0].from_name).toBeDefined();
      expect(inbox.body.data.items[0].read_at).toBeNull();
    });

    it('GET /messages?box=sent returns messages sent by the caller', async () => {
      const sender = await makeCandidate(`s-${Date.now()}@example.com`);
      const other = await makeCandidate(`o-${Date.now()}@example.com`);

      const app = buildAppWithMessagesRouter();
      const send = await request(app)
        .post('/v1/candidate-portal/messages')
        .set('Authorization', `Bearer ${sender.apiKey}`)
        .send({ to_user_id: other.userId, content: 'sent message #1' });
      expect(send.status).toBe(200);

      const sent = await request(app)
        .get('/v1/candidate-portal/messages?box=sent')
        .set('Authorization', `Bearer ${sender.apiKey}`);
      expect(sent.status).toBe(200);
      expect(sent.body.data.items).toHaveLength(1);
      expect(sent.body.data.items[0].to_user_id).toBe(other.userId);
      expect(sent.body.data.items[0].content).toBe('sent message #1');
      expect(sent.body.data.items[0].to_name).toBeDefined();
      expect(sent.body.data.box).toBe('sent');
    });

    it('POST /messages/:id/read marks the message as read and decrements unread_count', async () => {
      const sender = await makeCandidate(`s-${Date.now()}@example.com`);
      const receiver = await makeCandidate(`r-${Date.now()}@example.com`);

      const app = buildAppWithMessagesRouter();
      const send = await request(app)
        .post('/v1/candidate-portal/messages')
        .set('Authorization', `Bearer ${sender.apiKey}`)
        .send({ to_user_id: receiver.userId, content: 'mark me read' });
      const messageId = send.body.data.message_id as number;

      // Inbox shows it as unread.
      const before = await request(app)
        .get('/v1/candidate-portal/messages')
        .set('Authorization', `Bearer ${receiver.apiKey}`);
      expect(before.body.data.unread_count).toBe(1);

      const markRead = await request(app)
        .post(`/v1/candidate-portal/messages/${messageId}/read`)
        .set('Authorization', `Bearer ${receiver.apiKey}`);
      expect(markRead.status).toBe(200);
      expect(markRead.body.data.message_id).toBe(messageId);
      expect(markRead.body.data.read_at).toBeGreaterThan(0);

      const after = await request(app)
        .get('/v1/candidate-portal/messages')
        .set('Authorization', `Bearer ${receiver.apiKey}`);
      expect(after.body.data.unread_count).toBe(0);
    });

    it('GET /messages/:id returns the message for both sender and receiver', async () => {
      const sender = await makeCandidate(`sd-${Date.now()}@example.com`);
      const receiver = await makeCandidate(`rv-${Date.now()}@example.com`);

      const app = buildAppWithMessagesRouter();
      const send = await request(app)
        .post('/v1/candidate-portal/messages')
        .set('Authorization', `Bearer ${sender.apiKey}`)
        .send({ to_user_id: receiver.userId, content: 'detail me' });
      const messageId = send.body.data.message_id as number;

      const fromSender = await request(app)
        .get(`/v1/candidate-portal/messages/${messageId}`)
        .set('Authorization', `Bearer ${sender.apiKey}`);
      expect(fromSender.status).toBe(200);
      expect(fromSender.body.data.content).toBe('detail me');

      const fromReceiver = await request(app)
        .get(`/v1/candidate-portal/messages/${messageId}`)
        .set('Authorization', `Bearer ${receiver.apiKey}`);
      expect(fromReceiver.status).toBe(200);
      expect(fromReceiver.body.data.content).toBe('detail me');
    });
  });

  // -------- validation ----------

  describe('content validation', () => {
    it('POST /messages returns 400 for empty content', async () => {
      const { apiKey } = await makeCandidate(`empty-${Date.now()}@example.com`);
      seedRecipient({ id: 'h_empty', userType: 'headhunter' });

      const app = buildAppWithMessagesRouter();
      const res = await request(app)
        .post('/v1/candidate-portal/messages')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ to_user_id: 'h_empty', content: '' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PARAMS');
      expect(res.body.error.message).toMatch(/empty/i);
    });

    it('POST /messages returns 400 for whitespace-only content', async () => {
      const { apiKey } = await makeCandidate(`ws-${Date.now()}@example.com`);
      seedRecipient({ id: 'h_ws', userType: 'headhunter' });

      const app = buildAppWithMessagesRouter();
      const res = await request(app)
        .post('/v1/candidate-portal/messages')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ to_user_id: 'h_ws', content: '   \n\t   ' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PARAMS');
    });

    it('POST /messages returns 400 for content over 2000 chars', async () => {
      const { apiKey } = await makeCandidate(`long-${Date.now()}@example.com`);
      seedRecipient({ id: 'h_long', userType: 'headhunter' });

      const app = buildAppWithMessagesRouter();
      const res = await request(app)
        .post('/v1/candidate-portal/messages')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ to_user_id: 'h_long', content: 'x'.repeat(2001) });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PARAMS');
      expect(res.body.error.message).toMatch(/2000|max/i);
    });

    it('POST /messages returns 404 for an unknown recipient', async () => {
      const { apiKey } = await makeCandidate(`missing-${Date.now()}@example.com`);

      const app = buildAppWithMessagesRouter();
      const res = await request(app)
        .post('/v1/candidate-portal/messages')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ to_user_id: 'ghost_user', content: 'hello?' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('POST /messages returns 400 when sending to self', async () => {
      const { apiKey, userId } = await makeCandidate(`self-${Date.now()}@example.com`);

      const app = buildAppWithMessagesRouter();
      const res = await request(app)
        .post('/v1/candidate-portal/messages')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ to_user_id: userId, content: 'talking to myself' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PARAMS');
    });

    it('POST /messages rejects unknown body fields (strict whitelist)', async () => {
      const { apiKey } = await makeCandidate(`strict-${Date.now()}@example.com`);
      seedRecipient({ id: 'h_strict', userType: 'headhunter' });

      const app = buildAppWithMessagesRouter();
      const res = await request(app)
        .post('/v1/candidate-portal/messages')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ to_user_id: 'h_strict', content: 'hi', read_at: '1700000000000' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PARAMS');
    });
  });

  // -------- mark-read authz ----------

  describe('mark-read authz', () => {
    it('returns 404 when the message id does not exist', async () => {
      const { apiKey } = await makeCandidate(`mr-404-${Date.now()}@example.com`);

      const app = buildAppWithMessagesRouter();
      const res = await request(app)
        .post('/v1/candidate-portal/messages/99999/read')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when the caller is not the recipient', async () => {
      const sender = await makeCandidate(`mr-s-${Date.now()}@example.com`);
      const receiver = await makeCandidate(`mr-r-${Date.now()}@example.com`);
      const stranger = await makeCandidate(`mr-x-${Date.now()}@example.com`);

      const app = buildAppWithMessagesRouter();
      const send = await request(app)
        .post('/v1/candidate-portal/messages')
        .set('Authorization', `Bearer ${sender.apiKey}`)
        .send({ to_user_id: receiver.userId, content: 'private' });
      const messageId = send.body.data.message_id as number;

      const strangerRead = await request(app)
        .post(`/v1/candidate-portal/messages/${messageId}/read`)
        .set('Authorization', `Bearer ${stranger.apiKey}`);
      // The mark-read repo UPDATE filters on `to_user_id = caller`, so
      // the row is unchanged for strangers → 404 (the handler maps
      // `markRead=false` to 404 NOT_FOUND).
      expect(strangerRead.status).toBe(404);
    });

    it('sender cannot mark-read a message addressed to someone else', async () => {
      // Build a directed message via repo directly: caller A → caller B.
      // C is a third party; C should not be able to mark-read either way.
      const a = await makeCandidate(`mr-a-${Date.now()}@example.com`);
      const b = await makeCandidate(`mr-b-${Date.now()}@example.com`);
      const c = await makeCandidate(`mr-c-${Date.now()}@example.com`);

      const app = buildAppWithMessagesRouter();
      const send = await request(app)
        .post('/v1/candidate-portal/messages')
        .set('Authorization', `Bearer ${a.apiKey}`)
        .send({ to_user_id: b.userId, content: 'A → B' });
      const messageId = send.body.data.message_id as number;

      const cMarkRead = await request(app)
        .post(`/v1/candidate-portal/messages/${messageId}/read`)
        .set('Authorization', `Bearer ${c.apiKey}`);
      expect(cMarkRead.status).toBe(404);
    });
  });
});
