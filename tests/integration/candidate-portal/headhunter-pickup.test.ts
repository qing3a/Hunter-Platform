// tests/integration/candidate-portal/headhunter-pickup.test.ts
//
// Integration tests for the Candidate Portal Phase 1 headhunter pickup
// endpoints (Task 9):
//   - GET  /v1/headhunter/recommendations/pending-pickup
//   - POST /v1/headhunter/recommendations/:id/pickup
//
// Spins up the full app via `createAppFromDb` against a temp-file SQLite DB
// (same pattern as action-history-middleware.test.ts) so we can:
//   1. Drive real HTTP requests through authMiddleware + the real router
//   2. Seed the DB directly with a `pending_pickup` recommendation row to
//      exercise the pickup flow end-to-end (the candidate-portal apply
//      flow is covered by applications.test.ts; here we just need the
//      DB state, not the OTP round-trip).

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Express } from 'express';
import type { DB } from '../../../src/main/db/connection.js';
import type { User } from '../../../src/shared/types.js';

// ---------------------------------------------------------------------------
// Test app + DB
// ---------------------------------------------------------------------------

const testDb = path.join(__dirname, '../../tmp/headhunter-pickup.db');

let app: Express;
let db: DB;

async function bootApp(): Promise<void> {
  // Required env so the full app boots.
  process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
  process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
  process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
  process.env.NODE_ENV = 'test';

  // Re-open the DB fresh for each test.
  try { db.close(); } catch { /* first call */ }
  try { fs.unlinkSync(testDb); } catch { /* first call */ }
  try { fs.unlinkSync(testDb + '-wal'); } catch { /* first call */ }
  try { fs.unlinkSync(testDb + '-shm'); } catch { /* first call */ }

  const { openDb } = await import('../../../src/main/db/connection.js');
  const { runMigrations } = await import('../../../src/main/db/migrations.js');
  const { loadEnv } = await import('../../../src/main/env.js');
  const { createAppFromDb } = await import('../../../src/main/server.js');

  db = openDb(testDb);
  runMigrations(db);
  app = createAppFromDb(db, loadEnv());
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/** Insert a user row with a known API key. api_key_prefix must be 12 chars. */
function seedUser(opts: {
  id: string;
  userType: 'hr' | 'pm' | 'candidate';
  apiKey: string;
  name?: string;
  contact?: string | null;
}): void {
  const now = new Date().toISOString();
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  db.prepare(`
    INSERT INTO users (id, user_type, name, contact, agent_endpoint,
                       api_key_hash, api_key_prefix, api_key_expires_at,
                       prev_api_key_hash, prev_api_key_prefix, prev_api_key_expires_at,
                       quota_per_day, quota_used, quota_reset_at, reputation,
                       status, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL,
            ?, ?, NULL,
            NULL, NULL, NULL,
            200, 0, ?, 50,
            'active', ?, ?)
  `).run(
    opts.id,
    opts.userType,
    opts.name ?? `Test ${opts.userType}`,
    opts.contact ?? `${opts.userType}_${opts.id}@x.com`,
    bcrypt.hashSync(opts.apiKey, 4),
    opts.apiKey.slice(0, 12),
    tomorrow,
    now,
    now,
  );
}

/** Seed a headhunter + an employer + a job (the minimum to make a self-apply valid). */
function seedJob(opts: {
  jobId: string;
  employerId: string;
  employerApiKey: string;
  headhunterId?: string;
  title?: string;
}): void {
  seedUser({ id: opts.employerId, userType: 'pm', apiKey: opts.employerApiKey });
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO jobs (id, employer_id, title, description, requirements,
                      salary_min, salary_max, status, priority, deadline, industry,
                      required_skills_json, created_at, updated_at)
    VALUES (?, ?, ?, NULL, NULL, NULL, NULL, 'open', 'normal', NULL, '互联网', NULL, ?, ?)
  `).run(opts.jobId, opts.employerId, opts.title ?? 'Senior Engineer', now, now);
}

/** Seed a fully-onboarded candidate (users + private + anonymized). */
function seedCandidate(opts: {
  userId: string;
  anonId: string;
  privateId: string;
  headhunterId: string;
}): void {
  // The candidate_user_id column on candidates_private has an FK to users.id
  // (v001), so we must insert the candidate user row too. Insert with
  // INSERT OR IGNORE so callers that have already seeded the user (e.g. via
  // makeCandidate) don't trip a UNIQUE constraint.
  db.prepare(`
    INSERT OR IGNORE INTO users (id, user_type, name, contact, agent_endpoint,
                                 api_key_hash, api_key_prefix, api_key_expires_at,
                                 prev_api_key_hash, prev_api_key_prefix, prev_api_key_expires_at,
                                 quota_per_day, quota_used, quota_reset_at, reputation,
                                 status, created_at, updated_at)
    VALUES (?, 'candidate', ?, ?, NULL,
            ?, ?, NULL,
            NULL, NULL, NULL,
            50, 0, ?, 50,
            'active', ?, ?)
  `).run(
    opts.userId,
    `Cand ${opts.userId}`,
    `${opts.userId}@x.com`,
    `placeholder_${opts.userId}`,
    'cand_prefix',
    new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    new Date().toISOString(),
    new Date().toISOString(),
  );
  seedUser({ id: opts.headhunterId, userType: 'hr', apiKey: `hp_live_${opts.headhunterId}` });
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO candidates_private (id, headhunter_id, candidate_user_id, name_enc, phone_enc, email_enc,
                                     current_company_raw, current_title_raw, expected_salary, years_experience,
                                     education_school, resume_url, skills_json, raw_payload_json,
                                     created_at, updated_at)
    VALUES (?, ?, ?, 'n', 'p', 'e', NULL, NULL, NULL, NULL, NULL, NULL, '[]', NULL, ?, ?)
  `).run(opts.privateId, opts.headhunterId, opts.userId, now, now);
  db.prepare(`
    INSERT INTO candidates_anonymized (id, source_private_id, source_headhunter_id,
                                       industry, title_level, years_experience, salary_range, education_tier,
                                       skills_json, is_public_pool, unlock_status, visibility, expectations_json,
                                       created_at, updated_at)
    VALUES (?, ?, ?, '互联网', 'P6', 5, '30-50万', '985', '[]', 1, 'locked', 'public', NULL, ?, ?)
  `).run(opts.anonId, opts.privateId, opts.headhunterId, now, now);
}

/**
 * Seed a complete pending_pickup application: candidate + job + recommendation
 * + candidate_applications row. Returns the recommendation id.
 */
function seedPendingPickupApplication(opts: {
  candidateUserId: string;
  jobId: string;
  employerId: string;
  anonId: string;
  recommendationId?: string;
}): string {
  const recId = opts.recommendationId ?? `rec_pp_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO recommendations (id, headhunter_id, employer_id, anonymized_candidate_id, job_id,
                                 status, source_type, pickup_headhunter_id, candidate_note,
                                 commission_split_json, referrer_headhunter_id,
                                 created_at, updated_at)
    VALUES (?, NULL, ?, ?, ?, 'pending_pickup', 'candidate_self_apply', NULL, 'note', NULL, NULL, ?, ?)
  `).run(recId, opts.employerId, opts.anonId, opts.jobId, now, now);
  db.prepare(`
    INSERT INTO candidate_applications (recommendation_id, candidate_user_id, job_id, candidate_note)
    VALUES (?, ?, ?, 'note')
  `).run(recId, opts.candidateUserId, opts.jobId);
  return recId;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /v1/headhunter/recommendations/pending-pickup', () => {
  beforeEach(async () => { await bootApp(); });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/v1/headhunter/recommendations/pending-pickup');
    expect(res.status).toBe(401);
  });

  it('returns the pickup queue for an authenticated headhunter', async () => {
    seedUser({ id: 'h_a', userType: 'hr', apiKey: 'hp_live_h_a_long' });
    seedUser({ id: 'h_b', userType: 'hr', apiKey: 'hp_live_h_b_long' });
    seedJob({ jobId: 'job_ppu_1', employerId: 'emp_ppu_1', employerApiKey: 'hp_live_emp_ppu_1' });
    seedJob({ jobId: 'job_ppu_2', employerId: 'emp_ppu_2', employerApiKey: 'hp_live_emp_ppu_2' });
    seedCandidate({ userId: 'cand_1', anonId: 'anon_1', privateId: 'priv_1', headhunterId: 'h_anon_1' });
    seedCandidate({ userId: 'cand_2', anonId: 'anon_2', privateId: 'priv_2', headhunterId: 'h_anon_2' });

    // Two pending_pickup applications.
    seedPendingPickupApplication({
      candidateUserId: 'cand_1', jobId: 'job_ppu_1', employerId: 'emp_ppu_1', anonId: 'anon_1',
    });
    seedPendingPickupApplication({
      candidateUserId: 'cand_2', jobId: 'job_ppu_2', employerId: 'emp_ppu_2', anonId: 'anon_2',
    });

    const res = await request(app)
      .get('/v1/headhunter/recommendations/pending-pickup')
      .set('Authorization', 'Bearer hp_live_h_a_long');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.next_cursor).toBeNull();
    for (const item of res.body.data.items) {
      expect(item.recommendation_status).toBe('pending_pickup');
      expect(item.pickup_headhunter_id).toBeNull();
    }
  });

  it('returns empty list when no applications are awaiting pickup', async () => {
    seedUser({ id: 'h_empty', userType: 'hr', apiKey: 'hp_live_h_empty' });
    const res = await request(app)
      .get('/v1/headhunter/recommendations/pending-pickup')
      .set('Authorization', 'Bearer hp_live_h_empty');
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
  });

  it('excludes applications that have already been picked up', async () => {
    seedUser({ id: 'h_filt', userType: 'hr', apiKey: 'hp_live_h_filt_a' });
    seedJob({ jobId: 'job_filt_1', employerId: 'emp_filt_1', employerApiKey: 'hp_live_emp_filt_1' });
    seedJob({ jobId: 'job_filt_2', employerId: 'emp_filt_2', employerApiKey: 'hp_live_emp_filt_2' });
    seedCandidate({ userId: 'cand_filt_1', anonId: 'anon_filt_1', privateId: 'priv_filt_1', headhunterId: 'h_afilt_1' });
    seedCandidate({ userId: 'cand_filt_2', anonId: 'anon_filt_2', privateId: 'priv_filt_2', headhunterId: 'h_afilt_2' });

    // First app: still pending_pickup — should appear in queue.
    seedPendingPickupApplication({
      candidateUserId: 'cand_filt_1', jobId: 'job_filt_1', employerId: 'emp_filt_1', anonId: 'anon_filt_1',
    });
    // Second app: already picked up — should NOT appear in queue.
    const recPicked = seedPendingPickupApplication({
      candidateUserId: 'cand_filt_2', jobId: 'job_filt_2', employerId: 'emp_filt_2', anonId: 'anon_filt_2',
    });
    db.prepare("UPDATE recommendations SET status = 'pending', pickup_headhunter_id = ? WHERE id = ?").run('h_filt', recPicked);
    db.prepare("UPDATE candidate_applications SET pickup_headhunter_id = ? WHERE recommendation_id = ?").run('h_filt', recPicked);

    const res = await request(app)
      .get('/v1/headhunter/recommendations/pending-pickup')
      .set('Authorization', 'Bearer hp_live_h_filt_a');
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].recommendation_id).not.toBe(recPicked);
  });
});

describe('POST /v1/headhunter/recommendations/:id/pickup', () => {
  beforeEach(async () => { await bootApp(); });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/v1/headhunter/recommendations/rec_does_not_exist/pickup');
    expect(res.status).toBe(401);
  });

  it('returns 404 when the recommendation does not exist', async () => {
    seedUser({ id: 'h_404', userType: 'hr', apiKey: 'hp_live_h_404_a' });
    const res = await request(app)
      .post('/v1/headhunter/recommendations/rec_does_not_exist/pickup')
      .set('Authorization', 'Bearer hp_live_h_404_a');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 403 when called by a non-headhunter (employer)', async () => {
    seedJob({ jobId: 'job_403', employerId: 'emp_403', employerApiKey: 'hp_live_emp_403_a' });
    seedCandidate({ userId: 'cand_403', anonId: 'anon_403', privateId: 'priv_403', headhunterId: 'h_403' });
    const recId = seedPendingPickupApplication({
      candidateUserId: 'cand_403', jobId: 'job_403', employerId: 'emp_403', anonId: 'anon_403',
    });

    const res = await request(app)
      .post(`/v1/headhunter/recommendations/${recId}/pickup`)
      .set('Authorization', 'Bearer hp_live_emp_403_a');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 409 when the application is no longer awaiting pickup', async () => {
    seedUser({ id: 'h_409', userType: 'hr', apiKey: 'hp_live_h_409_a' });
    seedUser({ id: 'h_409_other', userType: 'hr', apiKey: 'hp_live_h_409_b' });
    seedJob({ jobId: 'job_409', employerId: 'emp_409', employerApiKey: 'hp_live_emp_409_a' });
    seedCandidate({ userId: 'cand_409', anonId: 'anon_409', privateId: 'priv_409', headhunterId: 'h_409a' });
    const recId = seedPendingPickupApplication({
      candidateUserId: 'cand_409', jobId: 'job_409', employerId: 'emp_409', anonId: 'anon_409',
    });

    // First hunter picks it up successfully.
    const r1 = await request(app)
      .post(`/v1/headhunter/recommendations/${recId}/pickup`)
      .set('Authorization', 'Bearer hp_live_h_409_a');
    expect(r1.status).toBe(200);

    // Second hunter is rejected because rec.status is no longer 'pending_pickup'.
    const r2 = await request(app)
      .post(`/v1/headhunter/recommendations/${recId}/pickup`)
      .set('Authorization', 'Bearer hp_live_h_409_b');
    expect(r2.status).toBe(409);
    expect(r2.body.error.code).toBe('INVALID_STATE');
    expect(r2.body.error.message).toMatch(/ALREADY_PICKED_UP/);
  });

  it('happy path: headhunter picks up a pending_pickup application', async () => {
    seedUser({ id: 'h_ok', userType: 'hr', apiKey: 'hp_live_h_ok_aaaa' });
    seedUser({ id: 'cand_ok', userType: 'candidate', apiKey: 'hp_live_cand_ok_aa', contact: 'cand_ok@x.com' });
    seedJob({ jobId: 'job_ok', employerId: 'emp_ok', employerApiKey: 'hp_live_emp_ok_aaa' });
    seedCandidate({ userId: 'cand_ok', anonId: 'anon_ok', privateId: 'priv_ok', headhunterId: 'h_aok' });
    const recId = seedPendingPickupApplication({
      candidateUserId: 'cand_ok', jobId: 'job_ok', employerId: 'emp_ok', anonId: 'anon_ok',
    });

    const res = await request(app)
      .post(`/v1/headhunter/recommendations/${recId}/pickup`)
      .set('Authorization', 'Bearer hp_live_h_ok_aaaa');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.recommendation_id).toBe(recId);
    expect(res.body.data.status).toBe('pending');

    // Verify side effects on the rec row.
    const rec = db.prepare('SELECT * FROM recommendations WHERE id = ?').get(recId) as any;
    expect(rec.status).toBe('pending');
    expect(rec.pickup_headhunter_id).toBe('h_ok');

    // Verify side effects on the candidate_applications row. Use a non-shadowing
    // name to avoid colliding with the outer Express `app` binding.
    const appRow = db.prepare('SELECT * FROM candidate_applications WHERE recommendation_id = ?').get(recId) as any;
    expect(appRow.pickup_headhunter_id).toBe('h_ok');
    expect(appRow.withdrawn_at).toBeNull();

    // Verify the candidate received a notification with the expected dedup key.
    const notifs = db.prepare(
      "SELECT * FROM notifications WHERE category = 'application_picked_up' AND user_id = ?",
    ).all('cand_ok') as any[];
    expect(notifs).toHaveLength(1);
    expect(notifs[0].dedup_key).toBe(`pickup:${recId}`);
    expect(notifs[0].title).toBe('您的申请已被认领');
  });
});

afterAll(() => {
  try { db?.close(); } catch { /* ignore */ }
  try { fs.unlinkSync(testDb); } catch { /* ignore */ }
  try { fs.unlinkSync(testDb + '-wal'); } catch { /* ignore */ }
  try { fs.unlinkSync(testDb + '-shm'); } catch { /* ignore */ }
});
