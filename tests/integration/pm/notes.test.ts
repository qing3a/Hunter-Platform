// tests/integration/pm/notes.test.ts
//
// PM Workbench (Phase 3b, Task 16) — PM Private Notes repository + handler
// integration tests.
//
// Covers:
//   - createPmNotesRepo (findByPmAndCandidate, upsert idempotency, listByPm)
//   - createNotesHandler (getNote empty/exists, upsertNote create/update,
//     validation: note_text length, FORBIDDEN for non-PM, listMyNotes
//     scoping per PM, candidate_user_id validation, cross-PM isolation)
//
// Pattern mirrors tests/integration/pm/matches.test.ts: seed users via
// SQL on getTestDb(), then call the handler method directly. HTTP routing
// is wired later (no router-level tests here — see Task 17).

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  createTestApp,
  resetDb,
  closeTestDb,
  getTestDb,
} from '../../helpers/test-app.js';
import { createNotesHandler } from '../../../src/main/modules/pm/notes.js';
import { createPmNotesRepo } from '../../../src/main/db/repositories/pm-notes.js';
import { Errors, ApiError } from '../../../src/main/errors.js';
import type { User } from '../../../src/shared/types.js';

function seedUser(opts: {
  id: string;
  userType: 'pm' | 'headhunter' | 'candidate' | 'employer';
  name?: string;
  contact?: string | null;
}): User {
  const db = getTestDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, user_type, name, contact, agent_endpoint,
                       api_key_hash, api_key_prefix, api_key_expires_at,
                       prev_api_key_hash, prev_api_key_prefix, prev_api_key_expires_at,
                       quota_per_day, quota_used, quota_reset_at, reputation,
                       status, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL,
            ?, 'hp_prefix_pm', NULL,
            NULL, NULL, NULL,
            300, 0, ?, 50,
            'active', ?, ?)
  `).run(
    opts.id,
    opts.userType,
    opts.name ?? `Test ${opts.userType}`,
    opts.contact ?? null,
    `hash_${opts.id}`,
    now,
    now,
    now,
  );
  return {
    id: opts.id,
    user_type: opts.userType,
    name: opts.name ?? `Test ${opts.userType}`,
    contact: opts.contact ?? null,
    agent_endpoint: null,
    api_key_hash: `hash_${opts.id}`,
    api_key_prefix: 'hp_prefix_pm',
    api_key_expires_at: null,
    prev_api_key_hash: null,
    prev_api_key_prefix: null,
    prev_api_key_expires_at: null,
    quota_per_day: 300,
    quota_used: 0,
    quota_reset_at: now,
    reputation: 50,
    status: 'active',
    created_at: now,
    updated_at: now,
  };
}

function seedPm(id: string, name?: string): User {
  return seedUser({ id, userType: 'pm', name: name ?? `PM ${id}` });
}

function seedCandidate(id: string, name?: string): User {
  return seedUser({ id, userType: 'candidate', name: name ?? `Candidate ${id}` });
}

function expectErrorCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (e) {
    if (e instanceof ApiError) {
      expect(e.code).toBe(code);
      return;
    }
    throw e;
  }
  throw new Error(`Expected function to throw an ApiError with code ${code}, but it did not throw`);
}

// ============================================================================

describe('pm: notes (handler + repo integration)', () => {
  beforeEach(() => {
    createTestApp();
    resetDb();
  });
  afterAll(() => closeTestDb());

  // ===== repo (direct) ====================================================

  describe('repo (direct)', () => {
    it('findByPmAndCandidate returns null when no row exists', () => {
      const pm = seedPm('pm1');
      seedCandidate('c1');
      const repo = createPmNotesRepo(getTestDb());

      const row = repo.findByPmAndCandidate(pm.id, 'c1');
      expect(row).toBeNull();
    });

    it('upsert inserts a new row and returns the freshly persisted values', () => {
      const pm = seedPm('pm1');
      seedCandidate('c1');
      const repo = createPmNotesRepo(getTestDb());

      const row = repo.upsert(pm.id, 'c1', { starred: true, note_text: 'top candidate' });
      expect(row.starred).toBe(1);
      expect(row.note_text).toBe('top candidate');
      expect(row.pm_user_id).toBe(pm.id);
      expect(row.candidate_user_id).toBe('c1');
      expect(typeof row.id).toBe('number');
      expect(row.updated_at).toBeGreaterThan(0);

      const readBack = repo.findByPmAndCandidate(pm.id, 'c1');
      expect(readBack).not.toBeNull();
      expect(readBack!.starred).toBe(1);
      expect(readBack!.note_text).toBe('top candidate');
    });

    it('upsert is idempotent — re-running updates the same row, not inserts', () => {
      const pm = seedPm('pm1');
      seedCandidate('c1');
      const repo = createPmNotesRepo(getTestDb());

      const r1 = repo.upsert(pm.id, 'c1', { starred: false, note_text: 'first' });
      const r2 = repo.upsert(pm.id, 'c1', { starred: true, note_text: 'second' });
      expect(r2.id).toBe(r1.id);
      expect(r2.starred).toBe(1);
      expect(r2.note_text).toBe('second');

      const list = repo.listByPm(pm.id);
      expect(list).toHaveLength(1);
      expect(list[0].note_text).toBe('second');
    });

    it('upsert supports partial updates (starred only / note_text only)', () => {
      const pm = seedPm('pm1');
      seedCandidate('c1');
      const repo = createPmNotesRepo(getTestDb());

      repo.upsert(pm.id, 'c1', { starred: true, note_text: 'hello' });
      // Only flip the star — note_text should remain "hello".
      repo.upsert(pm.id, 'c1', { starred: false });
      const row = repo.findByPmAndCandidate(pm.id, 'c1');
      expect(row!.starred).toBe(0);
      expect(row!.note_text).toBe('hello');

      // Only change the note — starred should remain false.
      repo.upsert(pm.id, 'c1', { note_text: 'updated' });
      const row2 = repo.findByPmAndCandidate(pm.id, 'c1');
      expect(row2!.starred).toBe(0);
      expect(row2!.note_text).toBe('updated');
    });

    it('cross-PM isolation — same candidate has separate notes per PM', () => {
      const pm1 = seedPm('pm1');
      const pm2 = seedPm('pm2');
      seedCandidate('c1');
      const repo = createPmNotesRepo(getTestDb());

      repo.upsert(pm1.id, 'c1', { starred: true, note_text: 'pm1 note' });
      repo.upsert(pm2.id, 'c1', { starred: false, note_text: 'pm2 note' });

      const r1 = repo.findByPmAndCandidate(pm1.id, 'c1');
      const r2 = repo.findByPmAndCandidate(pm2.id, 'c1');
      expect(r1!.note_text).toBe('pm1 note');
      expect(r2!.note_text).toBe('pm2 note');
      expect(r1!.id).not.toBe(r2!.id);
    });

    it('listByPm returns only the calling PM\'s notes', () => {
      const pm1 = seedPm('pm1');
      const pm2 = seedPm('pm2');
      seedCandidate('a');
      seedCandidate('b');
      seedCandidate('c');
      const repo = createPmNotesRepo(getTestDb());

      repo.upsert(pm1.id, 'a', { starred: true, note_text: 'a' });
      repo.upsert(pm1.id, 'b', { starred: false, note_text: 'b' });
      repo.upsert(pm2.id, 'c', { starred: true, note_text: 'c' });

      const list1 = repo.listByPm(pm1.id);
      const list2 = repo.listByPm(pm2.id);
      expect(list1).toHaveLength(2);
      expect(list2).toHaveLength(1);
      expect(list1.map((n) => n.candidate_user_id).sort()).toEqual(['a', 'b']);
      expect(list2[0].candidate_user_id).toBe('c');
    });

    it('listByPm returns [] when the PM has no notes', () => {
      const pm = seedPm('pm1');
      const repo = createPmNotesRepo(getTestDb());
      expect(repo.listByPm(pm.id)).toEqual([]);
    });
  });

  // ===== handler: getNote =================================================

  describe('handler: getNote', () => {
    it('returns empty defaults when no note exists for the candidate', () => {
      const pm = seedPm('pm1');
      seedCandidate('c1');
      const handler = createNotesHandler(getTestDb());

      const result = handler.getNote(pm, 'c1');
      expect(result).toEqual({ starred: false, note_text: null, updated_at: 0 });
    });

    it('returns the existing note when one is present', () => {
      const pm = seedPm('pm1');
      seedCandidate('c1');
      const repo = createPmNotesRepo(getTestDb());
      repo.upsert(pm.id, 'c1', { starred: true, note_text: '已联系 · 等回复' });
      const handler = createNotesHandler(getTestDb());

      const result = handler.getNote(pm, 'c1');
      expect(result.starred).toBe(true);
      expect(result.note_text).toBe('已联系 · 等回复');
    });

    it('throws FORBIDDEN when the caller is not a PM', () => {
      seedPm('pm1');
      const candidate = seedCandidate('c1');
      const handler = createNotesHandler(getTestDb());

      expectErrorCode(() => handler.getNote(candidate, 'c1'), 'FORBIDDEN');
    });

    it('throws INVALID_PARAMS when candidate_user_id is missing', () => {
      const pm = seedPm('pm1');
      const handler = createNotesHandler(getTestDb());

      expectErrorCode(() => handler.getNote(pm, ''), 'INVALID_PARAMS');
    });

    it('cross-PM isolation — pm2 cannot see pm1\'s note', () => {
      const pm1 = seedPm('pm1');
      const pm2 = seedPm('pm2');
      seedCandidate('c1');
      const repo = createPmNotesRepo(getTestDb());
      repo.upsert(pm1.id, 'c1', { starred: true, note_text: 'secret' });

      const handler = createNotesHandler(getTestDb());
      const pm2View = handler.getNote(pm2, 'c1');
      expect(pm2View.starred).toBe(false);
      expect(pm2View.note_text).toBeNull();
    });
  });

  // ===== handler: upsertNote ==============================================

  describe('handler: upsertNote', () => {
    it('creates a new note when none exists', () => {
      const pm = seedPm('pm1');
      seedCandidate('c1');
      const handler = createNotesHandler(getTestDb());

      const result = handler.upsertNote(pm, 'c1', { starred: true, note_text: 'first' });
      expect(result.starred).toBe(true);
      expect(result.note_text).toBe('first');
      expect(typeof result.updated_at).toBe('number');

      const row = createPmNotesRepo(getTestDb()).findByPmAndCandidate(pm.id, 'c1');
      expect(row).not.toBeNull();
      expect(row!.starred).toBe(1);
      expect(row!.note_text).toBe('first');
    });

    it('updates an existing note in place (UPSERT semantics)', () => {
      const pm = seedPm('pm1');
      seedCandidate('c1');
      const handler = createNotesHandler(getTestDb());

      handler.upsertNote(pm, 'c1', { starred: false, note_text: 'old' });
      const r2 = handler.upsertNote(pm, 'c1', { starred: true, note_text: 'new' });
      expect(r2.starred).toBe(true);
      expect(r2.note_text).toBe('new');

      const list = createPmNotesRepo(getTestDb()).listByPm(pm.id);
      expect(list).toHaveLength(1);
      expect(list[0].note_text).toBe('new');
    });

    it('accepts starred-only and note_text-only partial updates', () => {
      const pm = seedPm('pm1');
      seedCandidate('c1');
      const handler = createNotesHandler(getTestDb());

      handler.upsertNote(pm, 'c1', { starred: true, note_text: 'init' });
      const r1 = handler.upsertNote(pm, 'c1', { starred: false });
      expect(r1.note_text).toBe('init');
      expect(r1.starred).toBe(false);

      const r2 = handler.upsertNote(pm, 'c1', { note_text: 'updated text' });
      expect(r2.note_text).toBe('updated text');
      expect(r2.starred).toBe(false);
    });

    it('throws INVALID_PARAMS when note_text exceeds 2000 chars', () => {
      const pm = seedPm('pm1');
      seedCandidate('c1');
      const handler = createNotesHandler(getTestDb());

      const tooLong = 'a'.repeat(2001);
      expectErrorCode(
        () => handler.upsertNote(pm, 'c1', { note_text: tooLong }),
        'INVALID_PARAMS',
      );
    });

    it('throws INVALID_PARAMS when candidate_user_id is missing', () => {
      const pm = seedPm('pm1');
      const handler = createNotesHandler(getTestDb());

      expectErrorCode(
        () => handler.upsertNote(pm, '', { note_text: 'x' }),
        'INVALID_PARAMS',
      );
    });

    it('throws FORBIDDEN when the caller is not a PM', () => {
      seedPm('pm1');
      const candidate = seedCandidate('c1');
      const handler = createNotesHandler(getTestDb());

      expectErrorCode(
        () => handler.upsertNote(candidate, 'c1', { note_text: 'x' }),
        'FORBIDDEN',
      );
    });

    it('cross-PM isolation — pm1\'s upsert does not overwrite pm2\'s note', () => {
      const pm1 = seedPm('pm1');
      const pm2 = seedPm('pm2');
      seedCandidate('c1');
      const handler = createNotesHandler(getTestDb());

      handler.upsertNote(pm1, 'c1', { starred: true, note_text: 'pm1' });
      handler.upsertNote(pm2, 'c1', { starred: false, note_text: 'pm2' });

      const repo = createPmNotesRepo(getTestDb());
      const r1 = repo.findByPmAndCandidate(pm1.id, 'c1');
      const r2 = repo.findByPmAndCandidate(pm2.id, 'c1');
      expect(r1!.note_text).toBe('pm1');
      expect(r2!.note_text).toBe('pm2');
    });

    it('updated_at moves forward across consecutive updates', async () => {
      const pm = seedPm('pm1');
      seedCandidate('c1');
      const handler = createNotesHandler(getTestDb());

      const r1 = handler.upsertNote(pm, 'c1', { note_text: 'first' });
      // Sleep one millisecond so updated_at can advance on fast clocks.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const r2 = handler.upsertNote(pm, 'c1', { note_text: 'second' });
      expect(r2.updated_at).toBeGreaterThan(r1.updated_at);
    });
  });

  // ===== handler: listMyNotes =============================================

  describe('handler: listMyNotes', () => {
    it('returns [] when the PM has no notes', () => {
      const pm = seedPm('pm1');
      const handler = createNotesHandler(getTestDb());

      const result = handler.listMyNotes(pm);
      expect(result.notes).toEqual([]);
    });

    it('returns every note belonging to the calling PM', () => {
      const pm1 = seedPm('pm1');
      const pm2 = seedPm('pm2');
      seedCandidate('a');
      seedCandidate('b');
      seedCandidate('c');
      const handler = createNotesHandler(getTestDb());

      handler.upsertNote(pm1, 'a', { starred: true, note_text: 'a' });
      handler.upsertNote(pm1, 'b', { starred: false, note_text: 'b' });
      handler.upsertNote(pm2, 'c', { starred: true, note_text: 'c' });

      const r1 = handler.listMyNotes(pm1);
      expect(r1.notes).toHaveLength(2);
      const ids = r1.notes.map((n) => n.candidate_user_id).sort();
      expect(ids).toEqual(['a', 'b']);
      expect(r1.notes.find((n) => n.candidate_user_id === 'a')!.starred).toBe(true);
      expect(r1.notes.find((n) => n.candidate_user_id === 'a')!.note_text).toBe('a');

      const r2 = handler.listMyNotes(pm2);
      expect(r2.notes).toHaveLength(1);
      expect(r2.notes[0].candidate_user_id).toBe('c');
    });

    it('throws FORBIDDEN when the caller is not a PM', () => {
      const candidate = seedCandidate('c1');
      const handler = createNotesHandler(getTestDb());

      expectErrorCode(() => handler.listMyNotes(candidate), 'FORBIDDEN');
    });
  });
});