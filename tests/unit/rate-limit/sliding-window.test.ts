import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bucketStart, slidingWindowEstimate, readCount, upsertCount } from '../../../src/main/modules/rate-limit/sliding-window';
import { openDb } from '../../../src/main/db/connection';
import { runMigrations } from '../../../src/main/db/migrations';

describe('bucketStart', () => {
  it('floors to the start of the current 1-second window', () => {
    // 2026-06-19T00:00:00.750Z
    const now = new Date('2026-06-19T00:00:00.750Z');
    expect(bucketStart(now, 1)).toBe('2026-06-19T00:00:00.000Z');
  });

  it('floors to the start of the current 1-minute window', () => {
    const now = new Date('2026-06-19T00:00:37.123Z');
    expect(bucketStart(now, 60)).toBe('2026-06-19T00:00:00.000Z');
  });

  it('floors to the start of the current 1-hour window', () => {
    const now = new Date('2026-06-19T05:23:45.678Z');
    expect(bucketStart(now, 3600)).toBe('2026-06-19T05:00:00.000Z');
  });
});

describe('slidingWindowEstimate', () => {
  it('returns current_count when elapsed = 0 (weight=1)', () => {
    // Just rolled over to a new window — only current counts
    const now = new Date('2026-06-19T00:00:00.000Z');
    const windowSeconds = 60;
    const previousStart = bucketStart(new Date(now.getTime() - windowSeconds * 1000), windowSeconds);
    const currentStart = bucketStart(now, windowSeconds);
    const result = slidingWindowEstimate(now, windowSeconds, previousStart, currentStart, 5, 3);
    // previous_count=5 × weight=1.0 + current_count=3 = 8
    expect(result.estimated).toBe(8);
    expect(result.elapsed).toBe(0);
    expect(result.weight).toBe(1);
  });

  it('returns previous_count when elapsed = window (weight=0)', () => {
    // At the end of the current window — only previous counts
    const now = new Date('2026-06-19T00:00:59.999Z');
    const windowSeconds = 60;
    const previousStart = bucketStart(new Date(now.getTime() - windowSeconds * 1000), windowSeconds);
    const currentStart = bucketStart(now, windowSeconds);
    const result = slidingWindowEstimate(now, windowSeconds, previousStart, currentStart, 5, 3);
    // previous_count=5 × weight≈0 + current_count=3 ≈ 3
    // (precision 3: at elapsed=59.999, weight=0.0000167, prev*weight=0.000083, so result ≈ 3.000083)
    expect(result.estimated).toBeCloseTo(3, 3);
    expect(result.elapsed).toBeCloseTo(60, 2);
    expect(result.weight).toBeCloseTo(0, 2);
  });

  it('blends at half-elapsed', () => {
    const now = new Date('2026-06-19T00:00:30.000Z');
    const windowSeconds = 60;
    const previousStart = bucketStart(new Date(now.getTime() - windowSeconds * 1000), windowSeconds);
    const currentStart = bucketStart(now, windowSeconds);
    const result = slidingWindowEstimate(now, windowSeconds, previousStart, currentStart, 100, 100);
    // weight=0.5, prev=100×0.5 + curr=100 = 150
    expect(result.estimated).toBe(150);
    expect(result.elapsed).toBe(30);
    expect(result.weight).toBe(0.5);
  });
});

describe('readCount / upsertCount', () => {
  const testDbPath = path.join(__dirname, '../../../tmp/sw-unit.db');
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    try { fs.unlinkSync(testDbPath); } catch { /* ignore */ }
    db = openDb(testDbPath);
    runMigrations(db);
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDbPath); } catch { /* ignore */ } });

  it('readCount returns 0 for a fresh user/window', () => {
    expect(readCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 60)).toBe(0);
  });

  it('upsertCount creates a row with count=1', () => {
    upsertCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 60);
    expect(readCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 60)).toBe(1);
  });

  it('upsertCount increments the existing row on conflict', () => {
    upsertCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 60);
    upsertCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 60);
    upsertCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 60);
    expect(readCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 60)).toBe(3);
  });

  it('upsertCount is scoped by user_id', () => {
    upsertCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 60);
    expect(readCount(db, 'user_2', '2026-06-19T00:00:00.000Z', 60)).toBe(0);
  });

  it('upsertCount is scoped by windowSeconds', () => {
    upsertCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 60);
    expect(readCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 3600)).toBe(0);
  });
});