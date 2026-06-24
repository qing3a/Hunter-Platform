import { describe, it, expect } from 'vitest';

describe('cron scheduler', () => {
  it('startScheduler registers 4 jobs (quota/cleanup/audit/notifications)', async () => {
    const { startScheduler, getScheduledJobs } = await import('../../../src/main/modules/cron/scheduler');
    startScheduler();
    const jobs = getScheduledJobs();
    expect(jobs).toHaveLength(4);
    expect(jobs.map(j => j.name).sort()).toEqual(['audit-archive', 'notification-cleanup', 'quota-reset', 'rate-limit-cleanup']);
    // Cleanup so test order independence
    const { stopScheduler } = await import('../../../src/main/modules/cron/scheduler');
    stopScheduler();
  });

  it('stopScheduler clears all jobs', async () => {
    const { startScheduler, stopScheduler, getScheduledJobs } = await import('../../../src/main/modules/cron/scheduler');
    startScheduler();
    stopScheduler();
    expect(getScheduledJobs()).toHaveLength(0);
  });

  it('startScheduler is idempotent', async () => {
    const { startScheduler, getScheduledJobs, stopScheduler } = await import('../../../src/main/modules/cron/scheduler');
    startScheduler();
    startScheduler();
    expect(getScheduledJobs()).toHaveLength(4);
    stopScheduler();
  });
});
