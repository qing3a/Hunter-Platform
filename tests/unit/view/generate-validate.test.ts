import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, type DB } from '../../../src/main/db/connection';
import { runMigrations } from '../../../src/main/db/migrations';
import { createViewTokenRepo } from '../../../src/main/modules/view/view-token-repo';
import { generateViewUrl } from '../../../src/main/modules/view/generate';
import { validateAndConsume } from '../../../src/main/modules/view/validate';

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

  it('generate stores row in DB with 1-hour expiry', () => {
    const before = Date.now();
    const { token } = generateViewUrl(repo, BASE_URL, 'user_1', 'candidate', 'cand_x');
    const row = repo.findValid(token);
    expect(row).not.toBeNull();
    const expiryMs = new Date(row!.expires_at).getTime();
    expect(expiryMs).toBeGreaterThanOrEqual(before + 3500_000);
    expect(expiryMs).toBeLessThanOrEqual(before + 3700_000);
  });

  it('validate returns ok=true and consumes the token', () => {
    const { token } = generateViewUrl(repo, BASE_URL, 'user_1', 'candidate', 'cand_x');
    const result = validateAndConsume(repo, token, 'candidate');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resourceId).toBe('cand_x');
      expect(result.userId).toBe('user_1');
    }
  });

  it('validate returns ok=false reason=consumed on second call', () => {
    const { token } = generateViewUrl(repo, BASE_URL, 'user_1', 'candidate', 'cand_x');
    validateAndConsume(repo, token, 'candidate');
    const second = validateAndConsume(repo, token, 'candidate');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('consumed');
  });

  it('validate returns ok=false reason=type_mismatch when view_type differs', () => {
    const { token } = generateViewUrl(repo, BASE_URL, 'user_1', 'candidate', 'cand_x');
    const result = validateAndConsume(repo, token, 'recommendation');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('type_mismatch');
  });

  it('validate returns ok=false reason=invalid for unknown token', () => {
    const result = validateAndConsume(repo, 'z'.repeat(64), 'candidate');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
  });
});