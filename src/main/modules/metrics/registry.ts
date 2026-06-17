import promClient from 'prom-client';

let registry: promClient.Registry | null = null;
let hunterMetrics: ReturnType<typeof createHunterMetrics> | null = null;

function createHunterMetrics(reg: promClient.Registry) {
  return {
    httpRequestDuration: new promClient.Histogram({
      name: 'hunter_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['route', 'method', 'status'] as const,
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2.5, 5],
      registers: [reg],
    }),
    httpRequestsTotal: new promClient.Counter({
      name: 'hunter_http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['route', 'method', 'status'] as const,
      registers: [reg],
    }),
    quotaUsed: new promClient.Gauge({
      name: 'hunter_quota_used',
      help: 'Current quota_used for users',
      labelNames: ['user_type'] as const,
      registers: [reg],
    }),
    webhookPendingCount: new promClient.Gauge({
      name: 'hunter_webhook_queue_pending_count',
      help: 'Number of webhooks in pending/in_flight state',
      registers: [reg],
    }),
    webhookDeadLetterCount: new promClient.Gauge({
      name: 'hunter_webhook_dead_letter_count',
      help: 'Number of webhooks in dead_letter state',
      registers: [reg],
    }),
    dbWriteDuration: new promClient.Histogram({
      name: 'hunter_db_write_duration_seconds',
      help: 'Database write operation duration',
      labelNames: ['operation'] as const,
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
      registers: [reg],
    }),
    cryptoDecryptDuration: new promClient.Histogram({
      name: 'hunter_crypto_decrypt_duration_seconds',
      help: 'AES-GCM decrypt operation duration',
      buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05],
      registers: [reg],
    }),
  };
}

export type HunterMetrics = ReturnType<typeof createHunterMetrics>;

export function getRegistry(): promClient.Registry {
  if (!registry) {
    registry = new promClient.Registry();
    promClient.collectDefaultMetrics({ register: registry });
    hunterMetrics = createHunterMetrics(registry);
  }
  return registry;
}

export function getHunterMetrics(): HunterMetrics {
  if (!hunterMetrics) {
    getRegistry();
  }
  return hunterMetrics!;
}

/** Reset for tests — clears the singleton so each test gets a fresh registry. */
export function resetMetrics(): void {
  registry = null;
  hunterMetrics = null;
}
