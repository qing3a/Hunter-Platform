// tests/unit/gather-landing-data.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { gatherLandingData } from '../../src/main/modules/view/gather-landing-data';
import { openDb } from '../../src/main/db/connection';
import { runMigrations } from '../../src/main/db/migrations';

describe('gatherLandingData - basic fields', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
  });

  it('returns zeros and empty arrays for empty DB', () => {
    const data = gatherLandingData(db);
    expect(data.openJobsCount).toBe(0);
    expect(data.publicCandidatesCount).toBe(0);
    expect(data.industryGroups).toEqual([]);
    expect(data.recentJobs).toEqual([]);
    expect(data.topHeadhunters).toEqual([]);
    expect(data.latestPlacements).toEqual([]);
    expect(data.todayUnlocks).toBe(0);
    expect(data.todayPlacements).toBe(0);
    expect(data.totalCandidates).toBe(0);
    expect(data.activeEmployerCount).toBe(0);
    expect(data.activeHeadhunterCount).toBe(0);
    expect(data.uptimePercent).toBe(99.9);
    expect(data.healthStatus).toBe('healthy');
    expect(data.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});