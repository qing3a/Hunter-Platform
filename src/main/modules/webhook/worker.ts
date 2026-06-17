import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';
import type { DB } from '../../db/connection.js';
import { createWebhookQueueRepo } from '../../db/repositories/webhook-delivery-queue.js';
import { createUsersRepo } from '../../db/repositories/users.js';
import { decrypt } from '../crypto/aes-gcm.js';
import { sign } from './hmac.js';
import { WEBHOOK_DELIVERY_TIMEOUT_MS, WEBHOOK_RETRY_DELAYS_SECONDS } from '../../../shared/constants.js';

export interface WorkerOptions {
  batchSize?: number;
  hmacSecret: string;
  timeoutMs?: number;
}

export interface BatchResult {
  picked: number;
  delivered: number;
  failed: number;
  retried: number;
}

export function createWebhookWorker(db: DB, defaultOpts: { batchSize?: number } = {}) {
  const queue = createWebhookQueueRepo(db);
  const users = createUsersRepo(db);
  const batchSize = defaultOpts.batchSize ?? 10;

  return {
    async processBatch(encryptionKey: Buffer, opts: WorkerOptions): Promise<BatchResult> {
      const timeoutMs = opts.timeoutMs ?? WEBHOOK_DELIVERY_TIMEOUT_MS;
      const pending = queue.fetchPending(new Date().toISOString());
      const batch = pending.slice(0, batchSize);

      let delivered = 0, failed = 0, retried = 0;

      for (const rec of batch) {
        const user = users.findById(rec.target_user_id);
        if (!user || !user.agent_endpoint) {
          queue.markFailed(rec.id, 'No agent_endpoint', new Date(Date.now() + 60000).toISOString());
          failed++;
          continue;
        }

        try {
          const body = decrypt(encryptionKey, rec.payload_enc);
          const timestamp = String(Math.floor(Date.now() / 1000));
          const signature = sign(opts.hmacSecret, body, timestamp);

          await postJson(user.agent_endpoint, body, { 'X-Hunter-Signature': signature, 'X-Hunter-Timestamp': timestamp, 'X-Hunter-Event': rec.event_type }, timeoutMs);

          queue.markSuccess(rec.id);
          delivered++;
        } catch (err: any) {
          const nextAttempt = rec.attempt_count + 1;
          if (nextAttempt >= rec.max_attempts) {
            queue.markFailed(rec.id, err.message ?? 'unknown', new Date(Date.now() + 60000).toISOString());
          } else {
            const delayIdx = Math.min(nextAttempt - 1, WEBHOOK_RETRY_DELAYS_SECONDS.length - 1);
            const delaySec = WEBHOOK_RETRY_DELAYS_SECONDS[delayIdx] ?? 1;
            queue.markFailed(rec.id, err.message ?? 'unknown', new Date(Date.now() + delaySec * 1000).toISOString());
            retried++;
          }
          failed++;
        }
      }

      return { picked: batch.length, delivered, failed, retried };
    },

    async runOnce(encryptionKey: Buffer, opts: WorkerOptions): Promise<BatchResult> {
      return this.processBatch(encryptionKey, opts);
    },
  };
}

async function postJson(url: string, body: string, headers: Record<string, string>, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const reqFn = u.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = reqFn({
      method: 'POST',
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        res.resume();
        res.on('end', () => resolve());
      } else {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
      }
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}
