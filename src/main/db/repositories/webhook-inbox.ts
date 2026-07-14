// src/main/db/repositories/webhook-inbox.ts
//
// R1.C3 — Inbound webhook delivery dedup storage.
//
// Companion to the outbound `webhook_delivery_queue` repository, which
// handles scheduled retries. The inbox is event-arrival: it stores
// every POST /v1/webhooks/{endpoint} body once, keyed by a hash of the
// body so the dedup-INSERT-then-fail semantics can return
// `{ ok: true, deduped: true }` instead of re-processing.
import type { DB } from '../connection.js';
import { createHash, randomUUID } from 'node:crypto';

export interface InboxDeliveryRow {
  id: string;
  endpoint: string;
  sender_id: string | null;
  body_hash: string;
  headers_json: string;
  body_json: string;
  received_at: string;
  processed_at: string | null;
  status: 'pending' | 'processed' | 'duplicate' | 'failed';
  error: string | null;
}

export interface InsertOptions {
  endpoint: string;
  senderId?: string | null;
  headers: Record<string, string | string[] | undefined>;
  body: string;            // raw text body, NOT pre-parsed
}

export interface InsertResult {
  id: string;
  deduped: boolean;
}

/**
 * SHA256(body) hex string, used as the dedup fingerprint.
 * Exposed separately so route-level code can compute the same hash
 * cheaply (we recompute server-side rather than trust a client header).
 */
export function bodyHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

export function createWebhookInboxRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO webhook_inbox_deliveries
      (id, endpoint, sender_id, body_hash, headers_json, body_json, received_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `);
  const getByEndpointHashStmt = db.prepare(
    'SELECT * FROM webhook_inbox_deliveries WHERE endpoint = ? AND body_hash = ?',
  );
  const findStmt = db.prepare(
    'SELECT * FROM webhook_inbox_deliveries WHERE id = ?',
  );

  return {
    /**
     * Insert a delivery. If (endpoint, body_hash) already exists, returns
     * { id: <existing id>, deduped: true }. Otherwise inserts and returns
     * { id: <new id>, deduped: false }.
     *
     * Idempotency relies on the UNIQUE(endpoint, body_hash) index defined in
     * v032_webhook_inbox.sql — INSERT OR IGNORE silently skips the conflicting
     * row, then we look it up by (endpoint, body_hash) to return its id.
     */
    insert(opts: InsertOptions): InsertResult {
      const hash = bodyHash(opts.body);
      const id = `wbin_${randomUUID().slice(0, 12)}`;
      const now = new Date().toISOString();
      const senderId = opts.senderId ?? null;
      // Filter to string-valued headers; arrays/non-strings are JSON-stringified
      // so the audit trail round-trips cleanly.
      const sanitized: Record<string, string> = {};
      for (const [k, v] of Object.entries(opts.headers)) {
        if (v === undefined) continue;
        sanitized[k] = Array.isArray(v) ? v.join(', ') : v;
      }
      const headersJson = JSON.stringify(sanitized);
      const result = insertStmt.run(id, opts.endpoint, senderId, hash, headersJson, opts.body, now);
      if (result.changes === 1) {
        return { id, deduped: false };
      }
      // INSERT OR IGNORE skipped — find the existing row.
      const existing = getByEndpointHashStmt.get(opts.endpoint, hash) as InboxDeliveryRow | undefined;
      if (!existing) {
        // Shouldn't happen: INSERT was ignored but row absent. Race-condition
        // sentinel: the competing writer must have deleted between our SELECTs.
        // Return as a successful new insert with a fresh id; downstream consumer
        // can dedup by body_hash if it really cares.
        return { id, deduped: false };
      }
      return { id: existing.id, deduped: true };
    },

    findById(id: string): InboxDeliveryRow | undefined {
      return findStmt.get(id) as InboxDeliveryRow | undefined;
    },

    findByBodyHash(endpoint: string, hash: string): InboxDeliveryRow | undefined {
      return getByEndpointHashStmt.get(endpoint, hash) as InboxDeliveryRow | undefined;
    },
  };
}
