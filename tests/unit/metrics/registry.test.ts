import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('metrics registry', () => {
  beforeEach(async () => {
    // Reset module cache between tests to allow re-import
    const reg = await import('../../../src/main/modules/metrics/registry');
    reg.resetMetrics();
  });
  afterEach(async () => {
    const reg = await import('../../../src/main/modules/metrics/registry');
    reg.resetMetrics();
  });

  it('exposes standard Node.js process metrics', async () => {
    const { getRegistry } = await import('../../../src/main/modules/metrics/registry');
    const reg = getRegistry();
    const text = await reg.metrics();
    expect(text).toContain('process_cpu_user_seconds_total');
    expect(text).toContain('nodejs_heap_size_total_bytes');
  });

  it('includes custom hunter-platform metrics with HELP text', async () => {
    const { getRegistry, getHunterMetrics } = await import('../../../src/main/modules/metrics/registry');
    const m = getHunterMetrics();
    m.webhookPendingCount.set(5);
    m.webhookDeadLetterCount.set(2);
    const text = await getRegistry().metrics();
    expect(text).toContain('hunter_webhook_queue_pending_count 5');
    expect(text).toContain('hunter_webhook_dead_letter_count 2');
  });

  it('quota_used gauge updates per user_type', async () => {
    const { getRegistry, getHunterMetrics } = await import('../../../src/main/modules/metrics/registry');
    const m = getHunterMetrics();
    m.quotaUsed.labels('headhunter').set(150);
    const text = await getRegistry().metrics();
    expect(text).toMatch(/hunter_quota_used\{[^}]*user_type="headhunter"[^}]*\} 150/);
  });
});
