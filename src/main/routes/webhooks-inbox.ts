// src/main/routes/webhooks-inbox.ts
//
// R1.C3 — Inbound webhook endpoints. Pattern: a single Express Router
// that mounts every `/v1/webhooks/<endpoint>` endpoint behind HMAC
// verification + body-hash dedup. Currently we only ship one endpoint
// (`qing3` — ow-recruit relay), but the design scales to more relays
// without a router rewrite.
//
// Auth contract (mirrors src/main/modules/webhook/hmac.ts verifier):
//   X-Hunter-Timestamp: <unix-seconds, integer>
//   X-Hunter-Signature: <hex sha256 hmac over "${timestamp}.${body}">
//   ±300s timestamp skew (replay window).
//
// Idempotency contract:
//   Re-sending the same body within the replay window is deduped; the
//   route returns `{ ok: true, deduped: true, delivery_id: <existing> }`
//   without re-running downstream processing.

import express, { type Request, type Response, type NextFunction, type Router } from 'express';
import { verify } from '../modules/webhook/hmac.js';
import { createWebhookInboxRepo } from '../db/repositories/webhook-inbox.js';
import { Errors } from '../errors.js';
import { respond } from '../responses.js';
import { z } from 'zod';
import type { DB } from '../db/connection.js';

// We accept any well-formed JSON body. Schema validation of the payload
// itself is deferred to a downstream consumer (Phase 2: when
// /v1/webhooks/payload/{id} is added).
const InboxResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    delivery_id: z.string(),
    deduped: z.boolean(),
  }),
});

// Body parsing strategy:
//   We need access to the raw body string for HMAC verification.
//   express.raw() with type:'*/*' returns a Buffer; we stringify.
//   Bytes count is checked against a 64 KiB cap (matches employer
//   endpoint style; events are metadata, not bulk data).
const INBOX_MAX_BYTES = 64 * 1024;
const rawJsonParser = express.raw({
  type: '*/*',
  limit: INBOX_MAX_BYTES,
});
// Mounted as middleware per-route so the body limit only applies to
// the inbox. Other routes use their existing express.json() parsers
// with their own limits.

export function createWebhooksInboxRouter(db: DB): Router {
  const inbox = createWebhookInboxRepo(db);
  const router = express.Router();

  // POST /v1/webhooks/qing3
  // ow-recruit relay pushes events here. Signature is verified against
  // WEBHOOK_HMAC_SECRET (shared env var). On dedup, returns the existing
  // delivery_id without re-processing.
  router.post('/qing3', rawJsonParser, (req: Request, res: Response, next: NextFunction) => {
    try {
      const tsRaw = req.header('x-hunter-timestamp');
      const sigRaw = req.header('x-hunter-signature');
      if (!tsRaw || !sigRaw) {
        throw Errors.unauthorized('Missing X-Hunter-Timestamp / X-Hunter-Signature header');
      }

      // express.raw() puts the body Buffer on req.body (since we set type:'*/*').
      const raw = req.body;
      const bodyStr = Buffer.isBuffer(raw) ? raw.toString('utf8') : '';
      if (!bodyStr) {
        throw Errors.invalidParams('Empty body');
      }

      const hmacSecret = process.env.WEBHOOK_HMAC_SECRET;
      if (!hmacSecret) {
        // Operational error — server isn't configured to accept webhooks at all.
        throw Errors.invalidState('Server webhook signing key not configured');
      }

      if (!verify(hmacSecret, bodyStr, tsRaw, sigRaw)) {
        throw Errors.unauthorized('Invalid signature or stale timestamp');
      }

      // Validate the body parses as JSON (even if we don't read fields yet).
      try {
        JSON.parse(bodyStr);
      } catch {
        throw Errors.invalidParams('Body is not valid JSON');
      }

      const senderIdRaw = req.header('x-hunter-sender-id');
      const senderId = senderIdRaw && senderIdRaw.length > 0 && senderIdRaw.length <= 64
        ? senderIdRaw
        : null;

      const result = inbox.insert({
        endpoint: 'qing3',
        senderId,
        // Capture only the X-Hunter-* family of headers — keeps the audit
        // trail small without leaking unrelated request metadata.
        headers: pickHeaders(req, ['x-hunter-']),
        body: bodyStr,
      });

      respond(res, InboxResponseSchema, {
        ok: true,
        data: { delivery_id: result.id, deduped: result.deduped },
      });
    } catch (e) {
      next(e);
    }
  });

  return router;
}

function pickHeaders(req: Request, prefixes: string[]): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (prefixes.some((p) => k.toLowerCase().startsWith(p))) {
      out[k] = v as string | string[] | undefined;
    }
  }
  return out;
}
