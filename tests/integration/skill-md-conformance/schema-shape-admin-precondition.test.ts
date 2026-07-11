// tests/integration/skill-md-conformance/schema-shape-admin-precondition.test.ts
//
// Tests for admin capabilities that need pre-existing DB rows on a fresh DB.
// Shared beforeAll creates the rows via direct DB INSERT (some admin
// capabilities have no public API to set up the prerequisite state).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { freshApp, cleanupDb, ConformanceClient, adminAuthHeader } from './_setup';
import {
  RemoveFromPoolResponseSchema,
  MarkPaidResponseSchema,
  CancelPlacementResponseSchema,
  RetryWebhookResponseSchema,
  RateLimitBucketsResponseSchema,
  ClearRateLimitResponseSchema,
  PlacementsSummaryResponseSchema,
  ListConfigResponseSchema,
  GetConfigResponseSchema,
  SuspendUserResponseSchema,
  UnsuspendUserResponseSchema,
  AdjustQuotaResponseSchema,
} from '../../../src/main/schemas/admin';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

describe('schema-shape: admin endpoints needing pre-existing records', () => {
  let client: ConformanceClient;
  let db: InstanceType<typeof DatabaseSync>;
  let hKey: string, cKey: string;
  let candidateAnonId: string;
  let candidateUserId: string;
  let placementId: string;        // for mark_paid
  let placementForCancelId: string; // for cancel (separate to avoid 409 after mark_paid)
  let webhookId: number;

  beforeAll(async () => {
    const f = await freshApp('shape-admin');
    client = new ConformanceClient(f.app);
    db = new DatabaseSync(f.dbPath);

    // Register users we need IDs from
    hKey = await client.register('hr', 'AdminH', 'ah@x.com');
    cKey = await client.register('candidate', 'AdminC', 'ac@x.com');
    const meRes = await client.request({ method: 'GET', path: '/v1/capabilities/me', auth: cKey });
    candidateUserId = meRes.data.data.user_id;

    // 1. Create a public-pool candidate via public API
    const candRes = await client.request({
      method: 'POST', path: '/v1/headhunter/candidates', auth: hKey,
      body: { candidate_user_id: candidateUserId, name: 'AdminCand', phone: '13800000020', email: 'ac20@x.com' , current_company: '字节跳动' },
    });
    candidateAnonId = candRes.data.data.anonymized_id;
    db.prepare("UPDATE candidates_anonymized SET is_public_pool = 1 WHERE id = ?")
      .run(candidateAnonId);

    // 2. Create a job for the placement
    const eKey = await client.register('pm', 'AdminE', 'ae@x.com');
    const eJob = await client.request({
      method: 'POST', path: '/v1/employer/jobs', auth: eKey,
      body: { title: 'AdminJob', description: 'd' },
    });
    const jobId = eJob.data.data.id;
    const hMe = await client.request({ method: 'GET', path: '/v1/capabilities/me', auth: hKey });
    const headhunterUserId = hMe.data.data.user_id;

    // 3. Pre-create a 'pending_payment' placement (for mark_paid)
    placementId = 'placement_test_1';
    db.prepare(`
      INSERT INTO placements (id, job_id, anonymized_candidate_id, candidate_user_id,
        primary_headhunter_id, referrer_headhunter_id, annual_salary, platform_fee,
        primary_share, referrer_share, candidate_bonus, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, 1000000, 100000, 70000, 0, 0, 'pending_payment',
        '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z')
    `).run(placementId, jobId, candidateAnonId, candidateUserId, headhunterUserId);

    // 3b. Second 'pending_payment' placement (for cancel — must use a different
    // job because placements has UNIQUE(anonymized_candidate_id, job_id,
    // primary_headhunter_id), AND must be separate because mark_paid transitions
    // it to 'paid', which would 409 the cancel).
    const eJob2 = await client.request({
      method: 'POST', path: '/v1/employer/jobs', auth: eKey,
      body: { title: 'AdminJob2', description: 'd' },
    });
    const jobId2 = eJob2.data.data.id;
    placementForCancelId = 'placement_test_2';
    db.prepare(`
      INSERT INTO placements (id, job_id, anonymized_candidate_id, candidate_user_id,
        primary_headhunter_id, referrer_headhunter_id, annual_salary, platform_fee,
        primary_share, referrer_share, candidate_bonus, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, 1000000, 100000, 70000, 0, 0, 'pending_payment',
        '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z')
    `).run(placementForCancelId, jobId2, candidateAnonId, candidateUserId, headhunterUserId);

    // 4. Pre-create a 'dead_letter' webhook
    const insertWebhook = db.prepare(`
      INSERT INTO webhook_delivery_queue (target_user_id, event_type, payload_enc,
        contains_pii, status, attempt_count, max_attempts, last_error, created_at, updated_at)
      VALUES (?, 'candidate.unlocked', 'enc_blob', 1, 'dead_letter', 3, 3, 'HTTP 500',
        '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z')
    `);
    insertWebhook.run(candidateUserId);
    webhookId = Number(db.prepare('SELECT last_insert_rowid() as id').get().id);

    // 5. Pre-create a rate-limit bucket
    db.prepare(`
      INSERT INTO rate_limit_buckets (user_id, window_start, window_seconds, request_count, expires_at)
      VALUES (?, '2026-06-22T00:00:00Z', 86400, 5, '2026-06-23T00:00:00Z')
    `).run(candidateUserId);
  });
  afterAll(() => {
    db.close();
    cleanupDb('shape-admin');
  });

  // Phase 8: these 3 admin endpoints are now un-skipped (placed at end of
  // describe block so they run AFTER rate_limit_buckets / mark_paid / cancel —
  // otherwise e.g. clear_user_rate_limit would empty the buckets before the
  // rate_limit_buckets test runs).
  it('admin.mark_placement_paid: POST /v1/admin/placements/:id/mark-paid', async () => {
    const r = await client.request({
      method: 'POST', path: `/v1/admin/placements/${placementId}/mark-paid`,
      auth: adminAuthHeader(),
      schema: MarkPaidResponseSchema,
    });
    expect(r.status).toBe(200);
  });

  it('admin.cancel_placement: POST /v1/admin/placements/:id/cancel', async () => {
    const r = await client.request({
      method: 'POST', path: `/v1/admin/placements/${placementForCancelId}/cancel`,
      auth: adminAuthHeader(),
      schema: CancelPlacementResponseSchema,
    });
    expect(r.status).toBe(200);
  });

  it('admin.retry_webhook: POST /v1/admin/webhooks/:id/retry', async () => {
    const r = await client.request({
      method: 'POST', path: `/v1/admin/webhooks/${webhookId}/retry`,
      auth: adminAuthHeader(),
      schema: RetryWebhookResponseSchema,
    });
    expect(r.status).toBe(200);
  });

  it('admin.rate_limit_buckets: GET /v1/admin/rate-limit/buckets', async () => {
    const r = await client.request({
      method: 'GET', path: '/v1/admin/rate-limit/buckets',
      auth: adminAuthHeader(),
      schema: RateLimitBucketsResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.length).toBeGreaterThan(0);
  });

  it('admin.get_config: GET /v1/admin/config', async () => {
    // Sub-E: config is DB-backed. Empty DB → empty array (not the old file-based map).
    const r = await client.request({
      method: 'GET', path: '/v1/admin/config',
      auth: adminAuthHeader(),
      schema: ListConfigResponseSchema,
    });
    expect(r.status).toBe(200);
  });

  it('admin.put_config: PUT /v1/admin/config/:key (upsert with reason)', async () => {
    // Sub-E: any lowercase.dotted.path key is accepted. Reason is required (Sub-C convention).
    const r = await client.request({
      method: 'PUT', path: '/v1/admin/config/platform.test_key',
      auth: adminAuthHeader(),
      body: { value: { industries: ['Tech', 'Finance'] }, reason: 'integration test' },
      schema: GetConfigResponseSchema,
    });
    expect(r.status).toBe(200);
  });

  it('admin.suspend_user: POST /v1/admin/users/:id/suspend (active → suspended)', async () => {
    const r = await client.request({
      method: 'POST', path: `/v1/admin/users/${candidateUserId}/suspend`,
      auth: adminAuthHeader(),
      body: { reason: 'test' },
      schema: SuspendUserResponseSchema,
    });
    expect(r.status).toBe(200);
  });

  it('admin.unsuspend_user: POST /v1/admin/users/:id/unsuspend (suspended → active)', async () => {
    // First suspend
    await client.request({
      method: 'POST', path: `/v1/admin/users/${candidateUserId}/suspend`,
      auth: adminAuthHeader(), body: { reason: 'pre' },
    });
    const r = await client.request({
      method: 'POST', path: `/v1/admin/users/${candidateUserId}/unsuspend`,
      auth: adminAuthHeader(),
      schema: UnsuspendUserResponseSchema,
    });
    expect(r.status).toBe(200);
  });

  it('admin.adjust_user_quota: POST /v1/admin/users/:id/adjust-quota', async () => {
    const r = await client.request({
      method: 'POST', path: `/v1/admin/users/${candidateUserId}/adjust-quota`,
      auth: adminAuthHeader(),
      body: { new_quota: 200, reason: 'precondition test adjustment' },
      schema: AdjustQuotaResponseSchema,
    });
    expect(r.status).toBe(200);
  });

  // --- Phase 8 un-skipped tests ---
  // Production bugs (handler returned wrong field names vs the zod schema) were
  // fixed in Tasks 1-3, so strict-mode validation now passes. These are placed
  // at the end of the describe block so they run AFTER rate_limit_buckets /
  // mark_paid / cancel — otherwise e.g. clear_user_rate_limit would empty the
  // buckets before the rate_limit_buckets test runs.
  it('admin.remove_from_pool: POST /v1/admin/candidates/:id/remove-from-pool', async () => {
    const r = await client.request({
      method: 'POST', path: `/v1/admin/candidates/${candidateAnonId}/remove-from-pool`,
      auth: adminAuthHeader(),
      schema: RemoveFromPoolResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.removed).toBe(true);
  });

  it('admin.clear_user_rate_limit: POST /v1/admin/rate-limit/users/:id/clear', async () => {
    const r = await client.request({
      method: 'POST', path: `/v1/admin/rate-limit/users/${candidateUserId}/clear`,
      auth: adminAuthHeader(),
      schema: ClearRateLimitResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.cleared).toBe(true);
  });

  it('admin.placements_summary: GET /v1/admin/placements/summary', async () => {
    const r = await client.request({
      method: 'GET', path: '/v1/admin/placements/summary',
      auth: adminAuthHeader(),
      schema: PlacementsSummaryResponseSchema,
    });
    expect(r.status).toBe(200);
    // After mark_paid + cancel, both placements are no longer pending_payment.
    // The exact counts depend on which call was processed first, so we only
    // assert the schema-shape invariants here (not numeric values).
    expect(typeof r.data.data.total_count).toBe('number');
    expect(typeof r.data.data.pending_payment_count).toBe('number');
    expect(typeof r.data.data.paid_count).toBe('number');
    expect(typeof r.data.data.cancelled_count).toBe('number');
    expect(typeof r.data.data.total_revenue).toBe('number');
    // total_count should equal the sum of all status counts
    expect(r.data.data.total_count).toBe(
      r.data.data.pending_payment_count +
        r.data.data.paid_count +
        r.data.data.cancelled_count
    );
  });
});
