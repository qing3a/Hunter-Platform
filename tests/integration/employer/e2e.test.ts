// tests/integration/employer/e2e.test.ts
//
// Employer Panel — Task 12 end-to-end test.
//
// Walks the plan's documented employer workflow at
// docs/superpowers/plans/2026-07-09-employer-panel-plan.md (lines 256-269):
//
//   employer login → dashboard → create job → browse candidates
//     → express interest → approve unlock → see placement
//
// Strategy:
//   - Drive the underlying handler modules directly so each step asserts the
//     business-rule glue (state machine, ownership, audit logs, commission
//     math) without paying the cost of HTTP for every transition.
//   - One HTTP round-trip on `GET /v1/employer-panel/dashboard` is included
//     at the end so the wiring of the wire-level endpoint is also covered.
//   - Fixtures seed users directly via SQL with a real bcrypt api-key hash so
//     the Bearer header on that final HTTP call resolves to a real user
//     record (mirrors the pattern in dashboard.test.ts).
//
// Per-endpoint coverage lives in:
//   - tests/integration/employer/dashboard.test.ts (handler + HTTP)
//   - tests/integration/employer/job-detail.test.ts (get / patch / pause / resume / close)
//   - tests/integration/employer-claim-reject.test.ts (pending-claim compat routes)
//   - tests/integration/employer-express-interest.test.ts
//   - tests/integration/employer-unlock-contact.test.ts
//   - tests/integration/employer-handler.test.ts
//   - tests/integration/employer-talent-*.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import crypto from 'node:crypto';
import {
  createTestApp,
  resetDb,
  closeTestDb,
  getTestDb,
} from '../../helpers/test-app.js';
import { createEmployerPanelRouter } from '../../../src/main/routes/employer-panel.js';
import { createEmployerHandler } from '../../../src/main/modules/employer/handler.js';
import { createCandidateHandler } from '../../../src/main/modules/candidate/handler.js';
import { createHeadhunterHandler } from '../../../src/main/modules/headhunter/handler.js';
import { createCommissionHandler } from '../../../src/main/modules/commission/handler.js';
import { createUtf8OnlyMiddleware } from '../../../src/main/modules/encoding/index.js';
import { generateApiKey } from '../../../src/main/modules/auth/api-key.js';
import { ApiError } from '../../../src/main/errors.js';
import { MAX_BODY_SIZE } from '../../../src/shared/constants.js';
import type { DB } from '../../../src/main/db/connection.js';
import type { User } from '../../../src/shared/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface SeededUser {
  user: User;
  apiKey: string;
}

function seedUser(opts: {
  id: string;
  userType: 'candidate' | 'hr' | 'pm';
}): SeededUser {
  const db = getTestDb();
  const { key, hash, prefix } = generateApiKey();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, user_type, name, contact, agent_endpoint,
                       api_key_hash, api_key_prefix, api_key_expires_at,
                       prev_api_key_hash, prev_api_key_prefix, prev_api_key_expires_at,
                       quota_per_day, quota_used, quota_reset_at, reputation,
                       status, created_at, updated_at)
    VALUES (?, ?, ?, NULL, NULL,
            ?, ?, NULL,
            NULL, NULL, NULL,
            100, 0, ?, 50,
            'active', ?, ?)
  `).run(opts.id, opts.userType, `Test ${opts.userType}`, hash, prefix, now, now, now);
  return {
    apiKey: key,
    user: {
      id: opts.id,
      user_type: opts.userType,
      name: `Test ${opts.userType}`,
      contact: null,
      agent_endpoint: null,
      api_key_hash: hash,
      api_key_prefix: prefix,
      api_key_expires_at: null,
      prev_api_key_hash: null,
      prev_api_key_prefix: null,
      prev_api_key_expires_at: null,
      quota_per_day: 100,
      quota_used: 0,
      quota_reset_at: now,
      reputation: 50,
      status: 'active',
      created_at: now,
      updated_at: now,
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP test app — minimal Express mounting the employer-panel router. Built
// once in beforeAll so the final dashboard round-trip has a real surface.
// ---------------------------------------------------------------------------

function buildEmployerPanelHttpApp(db: DB): Express {
  const app = express();
  app.use(
    '/v1/employer-panel',
    createUtf8OnlyMiddleware(),
    express.json({ limit: MAX_BODY_SIZE }),
    createEmployerPanelRouter(db),
  );
  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'No route matched' } });
  });
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({
        ok: false,
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    // eslint-disable-next-line no-console
    console.error('Unhandled test error:', err);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal error' } });
  });
  return app;
}

// ---------------------------------------------------------------------------
// E2E flow
// ---------------------------------------------------------------------------

describe('employer-panel: full E2E flow', () => {
  // 32-byte key reused for crypto in handlers (uploadCandidate, unlock, etc.).
  const encryptionKey = crypto.randomBytes(32);

  // Cross-test fixtures. Each `it(...)` mutates one of these in turn.
  let employer!: SeededUser;
  let headhunter!: SeededUser;
  let candidate!: SeededUser;
  let jobId = '';
  let anonymizedId = '';
  let recId = '';
  let placementId = '';
  let app!: Express;

  beforeAll(() => {
    createTestApp();
    resetDb();

    process.env.PLATFORM_ENCRYPTION_KEY = process.env.PLATFORM_ENCRYPTION_KEY
      ?? encryptionKey.toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = process.env.WEBHOOK_HMAC_SECRET ?? 'test-secret-1234567890';
    process.env.NODE_ENV = 'test';

    // Login (register is the documented seed pattern; the bcrypt hash lets us
    // use the plaintext key as a Bearer token in the final HTTP round-trip).
    employer = seedUser({ id: 'emp_e2e', userType: 'pm' });
    headhunter = seedUser({ id: 'hun_e2e', userType: 'hr' });
    candidate = seedUser({ id: 'can_e2e', userType: 'candidate' });

    app = buildEmployerPanelHttpApp(getTestDb());
  });

  afterAll(() => closeTestDb());

  // -------------------------------------------------------------------------
  // Step 1: employer creates a job.
  // -------------------------------------------------------------------------
  it('employer createJob → returns an "open" job owned by the caller', () => {
    const handler = createEmployerHandler(getTestDb());
    const job = handler.createJob(employer.user, {
      title: 'E2E Senior Engineer',
      description: 'End-to-end test job',
      required_skills: ['typescript', 'react', 'postgres'],
      salary_min: 500_000,
      salary_max: 800_000,
      priority: 'high',
      industry: '互联网',
    });
    expect(job.id).toMatch(/^job_/);
    expect(job.status).toBe('open');
    expect(job.employer_id).toBe(employer.user.id);
    expect(job.priority).toBe('high');
    jobId = job.id;

    // Sanity: row exists in DB.
    const row = getTestDb()
      .prepare('SELECT id, status, employer_id FROM jobs WHERE id = ?')
      .get(jobId) as { id: string; status: string; employer_id: string };
    expect(row).toEqual({ id: jobId, status: 'open', employer_id: employer.user.id });
  });

  // -------------------------------------------------------------------------
  // Step 2: headhunter uploads candidate → recommends → employer browses →
  //         employer expresses interest.
  // -------------------------------------------------------------------------
  it('upload + recommend → browse → express interest drives the rec to "employer_interested"', async () => {
    const db = getTestDb();
    const hh = createHeadhunterHandler(db, encryptionKey);
    const emp = createEmployerHandler(db);

    // Upload (creates candidates_private + candidates_anonymized).
    const uploaded = await hh.uploadCandidate(headhunter.user, {
      candidate_user_id: candidate.user.id,
      name: '张三',
      phone: '13800138000',
      email: 'z@x.com',
      current_company: '字节跳动',
      current_title: 'Senior Engineer',
      expected_salary: 750_000,
      years_experience: 8,
      education_school: '清华',
      skills: ['typescript', 'react', 'postgres'],
    });
    anonymizedId = uploaded.anonymized_id;

    // Publish to the public pool so browseTalent() can see them.
    hh.publishToPool(headhunter.user, { anonymized_candidate_id: anonymizedId });

    // Recommend to the employer's job.
    const rec = hh.recommendCandidate(headhunter.user, {
      anonymized_candidate_id: anonymizedId,
      job_id: jobId,
    });
    expect(rec.status).toBe('pending');
    expect(rec.employer_id).toBe(employer.user.id);
    expect(rec.headhunter_id).toBe(headhunter.user.id);
    recId = rec.id;

    // Employer browses — should find our uploaded candidate.
    const browsed = emp.browseTalent(employer.user, { skills: ['typescript'] });
    expect(browsed.some((c) => c.anonymized_id === anonymizedId)).toBe(true);

    // Employer expresses interest — rec.status moves to 'employer_interested'.
    emp.expressInterest(employer.user, { recommendation_id: recId });
    const after = db
      .prepare('SELECT status FROM recommendations WHERE id = ?')
      .get(recId) as { status: string };
    expect(after.status).toBe('employer_interested');

    // Audit log entry must exist for the express_interest action.
    const audit = db
      .prepare(`SELECT action, actor_user_id FROM unlock_audit_log
                WHERE recommendation_id = ? AND action = 'express_interest'`)
      .get(recId) as { action: string; actor_user_id: string };
    expect(audit.actor_user_id).toBe(employer.user.id);
  });

  // -------------------------------------------------------------------------
  // Step 3: candidate approves → employer unlocks contact → employer
  //         creates placement.
  // -------------------------------------------------------------------------
  it('candidate approveUnlock → employer unlockContact → createPlacement writes a pending_payment placement', async () => {
    const db = getTestDb();
    const emp = createEmployerHandler(db);
    const cand = createCandidateHandler(db, encryptionKey);
    const commission = createCommissionHandler(db, encryptionKey);

    // Approve unlock (rec: employer_interested → candidate_approved).
    cand.approveUnlock(candidate.user, { recommendation_id: recId });
    const afterApprove = db
      .prepare('SELECT status FROM recommendations WHERE id = ?')
      .get(recId) as { status: string };
    expect(afterApprove.status).toBe('candidate_approved');

    // Employer unlocks contact (rec → unlocked, audit log writes
    // unlock_delivery, webhook enqueued).
    emp.unlockContact(
      employer.user,
      { recommendation_id: recId },
      { encryptionKey, ip: '127.0.0.1', userAgent: 'jest-e2e' },
    );
    const afterUnlock = db
      .prepare('SELECT status FROM recommendations WHERE id = ?')
      .get(recId) as { status: string };
    expect(afterUnlock.status).toBe('unlocked');

    // Employer records the placement.
    const placement = await commission.createPlacement(employer.user, {
      anonymized_candidate_id: anonymizedId,
      job_id: jobId,
      annual_salary: 1_000_000,
    });
    expect(placement.id).toMatch(/^pl_/);
    expect(placement.status).toBe('pending_payment');
    expect(placement.job_id).toBe(jobId);
    expect(placement.candidate_user_id).toBe(candidate.user.id);
    expect(placement.platform_fee + placement.primary_share + placement.referrer_share).toBeGreaterThan(0);
    placementId = placement.id;

    // Row should be persisted.
    const row = db
      .prepare('SELECT id, job_id, status FROM placements WHERE id = ?')
      .get(placementId) as { id: string; job_id: string; status: string };
    expect(row).toEqual({ id: placementId, job_id: jobId, status: 'pending_payment' });
  });

  // -------------------------------------------------------------------------
  // Step 4: HTTP round-trip — dashboard reflects the data created by the
  //         flow. By the time we get here the recommendation has moved past
  //         'employer_interested' / 'candidate_approved' into 'unlocked'
  //         (after unlock_contact), so the dashboard's
  //         interested_count / unlocked_count map it to neither bucket by
  //         design — the canonical "this employer can now act" signals are
  //         placements_count and active_jobs.
  // -------------------------------------------------------------------------
  it('GET /v1/employer-panel/dashboard surfaces the counters driven by the flow', async () => {
    const res = await request(app)
      .get('/v1/employer-panel/dashboard')
      .set('Authorization', `Bearer ${employer.apiKey}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const counters = res.body.data as {
      active_jobs: number;
      open_positions: number;
      interested_count: number;
      unlocked_count: number;
      placements_count: number;
      candidates_viewed_this_month: number;
      spend_this_month: number;
    };

    // Counters driven by the E2E flow above.
    expect(counters.active_jobs).toBe(1);
    expect(counters.open_positions).toBe(1);
    // The express_interest audit log row written in Step 2 is still in the
    // last-30d window so the viewed-this-month counter is non-zero.
    expect(counters.candidates_viewed_this_month).toBeGreaterThanOrEqual(1);
    // The placement we wrote in Step 3 — this is the canonical proof that
    // the employer saw a placement as the final step in the plan flow.
    expect(counters.placements_count).toBe(1);
    // spend_this_month sums platform_fee + primary_share + referrer_share
    // over placements in the 30d window (default platform_rate=0.1 →
    // platform_fee ≈ 100_000 for a 1M annual_salary placement).
    expect(counters.spend_this_month).toBeGreaterThan(0);

    // Sanity — the rec has flowed all the way through, so neither
    // mid-flight counter still owns it.
    expect(counters.interested_count).toBe(0);
    expect(counters.unlocked_count).toBe(0);
  });
});
