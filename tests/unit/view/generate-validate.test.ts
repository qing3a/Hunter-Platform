import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, type DB } from '../../../src/main/db/connection';
import { runMigrations } from '../../../src/main/db/migrations';
import { createViewTokenRepo } from '../../../src/main/modules/view/view-token-repo';
import { generateViewUrl } from '../../../src/main/modules/view/generate';
import { validate } from '../../../src/main/modules/view/validate';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe('generate / validate', () => {
  let db: DB;
  let repo: ReturnType<typeof createViewTokenRepo>;
  const BASE_URL = 'http://localhost:3000';

  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
    repo = createViewTokenRepo(db);
  });

  afterEach(() => db.close());

  it('generate returns URL with 64-char hex token and correct path', () => {
    const { url, token } = generateViewUrl(repo, BASE_URL, 'user_1', 'candidate', 'cand_x');
    expect(url).toMatch(/^http:\/\/localhost:3000\/view\/candidate\/cand_x\?t=[a-f0-9]{64}$/);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('generate stores row in DB with 7-day expiry', () => {
    const before = Date.now();
    const { token } = generateViewUrl(repo, BASE_URL, 'user_1', 'candidate', 'cand_x');
    const row = repo.lookupRaw(token);
    expect(row).not.toBeNull();
    const expiryMs = new Date(row!.expires_at).getTime();
    // Allow 10s jitter for test timing
    expect(expiryMs).toBeGreaterThanOrEqual(before + SEVEN_DAYS_MS - 10_000);
    expect(expiryMs).toBeLessThanOrEqual(before + SEVEN_DAYS_MS + 10_000);
  });

  it('validate returns ok=true with resourceId and userId', () => {
    const { token } = generateViewUrl(repo, BASE_URL, 'user_1', 'candidate', 'cand_x');
    const result = validate(repo, token, 'candidate');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resourceId).toBe('cand_x');
      expect(result.userId).toBe('user_1');
    }
  });

  // Multi-use: token can be validated multiple times until expires_at.
  it('validate returns ok=true on repeated calls (multi-use within TTL)', () => {
    const { token } = generateViewUrl(repo, BASE_URL, 'user_1', 'candidate', 'cand_x');
    for (let i = 0; i < 5; i++) {
      const r = validate(repo, token, 'candidate');
      expect(r.ok).toBe(true);
    }
  });

  it('validate returns ok=false reason=type_mismatch when view_type differs', () => {
    const { token } = generateViewUrl(repo, BASE_URL, 'user_1', 'candidate', 'cand_x');
    const result = validate(repo, token, 'recommendation');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('type_mismatch');
  });

  it('validate returns ok=false reason=invalid for unknown token', () => {
    const result = validate(repo, 'z'.repeat(64), 'candidate');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
  });

  it('validate returns ok=false reason=expired for token past expires_at', () => {
    // Manually insert a row with past expiry
    db.prepare(
      `INSERT INTO view_tokens (token, user_id, view_type, view_id, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      'a'.repeat(64),
      'user_1',
      'candidate',
      'cand_x',
      new Date(Date.now() - 60_000).toISOString(),  // 1 min ago
    );
    const result = validate(repo, 'a'.repeat(64), 'candidate');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });
});
