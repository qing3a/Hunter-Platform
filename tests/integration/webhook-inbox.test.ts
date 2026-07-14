// tests/integration/webhook-inbox.test.ts
// R1.C3 — POST /v1/webhooks/qing3 with HMAC + body-hash dedup.
//
// Covers the happy path, dedup replay, signature/timestamp validation,
// missing/invalid JSON body, oversized body, and (extra) the repo-layer
// bodyHash invariant. Uses an in-process Express app backed by an
// isolated temp-file DB so we exercise the real route + real DB+repo.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

import { openDb } from '../../src/main/db/connection';
import { runMigrations } from '../../src/main/db/migrations';
import { createWebhooksInboxRouter } from '../../src/main/routes/webhooks-inbox';
import { sign as hmacSign } from '../../src/main/modules/webhook/hmac';
import { bodyHash, createWebhookInboxRepo } from '../../src/main/db/repositories/webhook-inbox';

describe('POST /v1/webhooks/qing3 (R1.C3)', () => {
  const testDb = path.join(__dirname, '../../tmp/webhook-inbox-test.db');
  const hmacSecret = 'test-secret-for-webhook-inbox-1234567890123456';
  let app: express.Express;
  let db: ReturnType<typeof openDb>;

  beforeAll(async () => {
    [testDb, testDb + '-wal', testDb + '-shm'].forEach((f) => { try { fs.unlinkSync(f); } catch {} });
    process.env.WEBHOOK_HMAC_SECRET = hmacSecret;
    db = openDb(testDb);
    runMigrations(db);

    app = express();
    app.use('/v1/webhooks', createWebhooksInboxRouter(db));
    // Mirror the production error-envelope formatter so r.body.error is populated.
    // Must be registered AFTER the route so it catches `next(err)` from the route.
    app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const status = err?.statusCode ?? err?.status ?? 500;
      const code = err?.code ?? 'INTERNAL_ERROR';
      res.status(status).json({ ok: false, error: { code, message: err?.message ?? 'error' } });
    });
  });

  afterAll(() => {
    try { db.close(); } catch {}
    [testDb, testDb + '-wal', testDb + '-shm'].forEach((f) => { try { fs.unlinkSync(f); } catch {} });
  });

  beforeEach(() => {
    // Reset inbox between tests so dedup doesn't leak across cases.
    db.exec('DELETE FROM webhook_inbox_deliveries');
  });

  // Build a valid signed request body. Returns status + parsed JSON.
  async function postSigned(
    body: object | string,
    opts: {
      timestamp?: string;
      signature?: string;
      omitTimestamp?: boolean;
      omitSignature?: boolean;
      senderId?: string;
      rawString?: string;        // override raw body (e.g. invalid JSON)
      big?: boolean;             // send oversized body
    } = {},
  ) {
    const bodyStr = opts.rawString ?? (typeof body === 'string' ? body : JSON.stringify(body));
    const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000).toString();
    const signature = opts.signature ?? hmacSign(hmacSecret, bodyStr, timestamp);

    const req = request(app)
      .post('/v1/webhooks/qing3')
      .set('content-type', 'application/json');
    if (!opts.omitTimestamp) req.set('x-hunter-timestamp', timestamp);
    if (!opts.omitSignature) req.set('x-hunter-signature', signature);
    if (opts.senderId !== undefined) req.set('x-hunter-sender-id', opts.senderId);
    if (opts.big) {
      const huge = JSON.stringify({ event: 'a'.repeat(80 * 1024) });
      return req.send(huge);
    }
    return req.send(bodyStr);
  }

  // ─────── happy path ───────

  it('accepts a signed delivery and returns delivery_id', async () => {
    const body = { event: 'candidate.recommendation.created', data: { id: 'rec_abc' } };
    const r = await postSigned(body);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.data.delivery_id).toMatch(/^wbin_/);
    expect(r.body.data.deduped).toBe(false);
  });

  it('persists the body verbatim — round-trips via repo', async () => {
    const body = { event: 'foo', data: { nested: [1, 2, 3] } };
    const r = await postSigned(body);
    expect(r.status).toBe(200);
    const id = r.body.data.delivery_id;
    const repo = createWebhookInboxRepo(db);
    const row = repo.findById(id);
    expect(row).toBeDefined();
    expect(row!.endpoint).toBe('qing3');
    expect(JSON.parse(row!.body_json)).toEqual(body);
    expect(row!.status).toBe('pending');
    // SHA256 of { event: 'foo', data: { nested: [1, 2, 3] } }
    expect(row!.body_hash).toBe(bodyHash(JSON.stringify(body)));
  });

  // ─────── dedup (C3 keystone) ───────

  it('returns deduped: true on exact-body retry within the replay window', async () => {
    const body = { event: 'duplicate.test', payload: { n: 1 } };
    const r1 = await postSigned(body);
    expect(r1.status).toBe(200);
    expect(r1.body.data.deduped).toBe(false);

    const r2 = await postSigned(body); // identical body
    expect(r2.status).toBe(200);
    expect(r2.body.data.deduped).toBe(true);
    // Same delivery_id reused.
    expect(r2.body.data.delivery_id).toBe(r1.body.data.delivery_id);
  });

  it('treats different bodies as distinct (no false dedup)', async () => {
    const r1 = await postSigned({ event: 'a', payload: 1 });
    const r2 = await postSigned({ event: 'a', payload: 2 });
    expect(r1.body.data.deduped).toBe(false);
    expect(r2.body.data.deduped).toBe(false);
    expect(r1.body.data.delivery_id).not.toBe(r2.body.data.delivery_id);
  });

  // ─────── auth / signature ───────

  it('rejects when X-Hunter-Timestamp header is missing', async () => {
    const r = await postSigned({}, { omitTimestamp: true });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects when X-Hunter-Signature header is missing', async () => {
    const r = await postSigned({}, { omitSignature: true });
    expect(r.status).toBe(401);
  });

  it('rejects when signature is wrong (signature mismatch)', async () => {
    const r = await postSigned({ event: 'foo' }, { signature: '00'.repeat(32) });
    expect(r.status).toBe(401);
  });

  it('rejects stale timestamps (more than 300s old)', async () => {
    const stale = (Math.floor(Date.now() / 1000) - 600).toString();
    const r = await postSigned({ event: 'stale' }, { timestamp: stale });
    expect(r.status).toBe(401);
  });

  it('rejects far-future timestamps (more than 300s ahead)', async () => {
    const future = (Math.floor(Date.now() / 1000) + 600).toString();
    const r = await postSigned({ event: 'future' }, { timestamp: future });
    expect(r.status).toBe(401);
  });

  // ─────── input validation ───────

  it('rejects an empty body', async () => {
    const r = await postSigned('', { rawString: '' });
    expect(r.status).toBe(400);
  });

  it('rejects malformed JSON body', async () => {
    const r = await postSigned('whatever', { rawString: 'not-json{' });
    expect(r.status).toBe(400);
  });

  it('rejects oversized bodies (>64 KiB)', async () => {
    const r = await postSigned({}, { big: true });
    expect(r.status).toBe(413); // Payload Too Large from express.raw default limit
  });

  // ─────── sender-id pass-through ───────

  it('accepts an X-Hunter-Sender-Id header and records it', async () => {
    const r = await postSigned({ event: 'with-sender' }, { senderId: 'relay-7' });
    expect(r.status).toBe(200);
    const repo = createWebhookInboxRepo(db);
    const row = repo.findById(r.body.data.delivery_id);
    expect(row!.sender_id).toBe('relay-7');
  });

  it('truncates a malformed sender-id (>64 chars) to NULL', async () => {
    const longId = 'x'.repeat(100);
    const r = await postSigned({ event: 'long-sender' }, { senderId: longId });
    expect(r.status).toBe(200);
    const repo = createWebhookInboxRepo(db);
    expect(repo.findById(r.body.data.delivery_id)!.sender_id).toBeNull();
  });
});
