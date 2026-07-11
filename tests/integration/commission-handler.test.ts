import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('commission handler', () => {
  const testDb = path.join(__dirname, '../../tmp/comm-handler.db');
  let db: any, users: any, priv: any, anon: any, jobs: any, recs: any, places: any, handler: any, decrypt: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    const { createUsersRepo } = await import('../../src/main/db/repositories/users');
    const { createCandidatesPrivateRepo } = await import('../../src/main/db/repositories/candidates-private');
    const { createCandidatesAnonymizedRepo } = await import('../../src/main/db/repositories/candidates-anonymized');
    const { createJobsRepo } = await import('../../src/main/db/repositories/jobs');
    const { createRecommendationsRepo } = await import('../../src/main/db/repositories/recommendations');
    const { createPlacementsRepo } = await import('../../src/main/db/repositories/placements');
    const { createCommissionHandler } = await import('../../src/main/modules/commission/handler');
    const _decrypt = await import('../../src/main/modules/crypto/aes-gcm');
    decrypt = _decrypt.decrypt;
    users = createUsersRepo(db);
    priv = createCandidatesPrivateRepo(db);
    anon = createCandidatesAnonymizedRepo(db);
    jobs = createJobsRepo(db);
    recs = createRecommendationsRepo(db);
    places = createPlacementsRepo(db);
    handler = createCommissionHandler(db, Buffer.alloc(32, 1));
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'e1', user_type: 'pm', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'h1', user_type: 'hr', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'c1', user_type: 'candidate', name: 'C', contact: null, agent_endpoint: null, api_key_hash: 'h3', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    priv.insert({ id: 'cp_1', headhunter_id: 'h1', candidate_user_id: 'c1', name_enc: 'n', phone_enc: 'p', email_enc: 'e', current_company_raw: null, current_title_raw: null, expected_salary: null, years_experience: null, education_school: null, resume_url: null, skills_json: null, raw_payload_json: null, created_at: now, updated_at: now });
    anon.insert({ id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'h1', industry: '互联网', title_level: 'P6', years_experience: 8, salary_range: '60-80万', education_tier: '985', skills_json: '[]', is_public_pool: 0, unlock_status: 'unlocked', created_at: now, updated_at: now });
    jobs.insert({ id: 'j1', employer_id: 'e1', title: 'A', description: null, requirements: null, salary_min: null, salary_max: null, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
    recs.insert({ id: 'r1', headhunter_id: 'h1', employer_id: 'e1', anonymized_candidate_id: 'ca_1', job_id: 'j1', status: 'unlocked', commission_split_json: null, referrer_headhunter_id: null, created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('createPlacement requires employer role', async () => {
    const h: any = { id: 'h1', user_type: 'hr' };
    await expect(handler.createPlacement(h, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 600000 })).rejects.toThrow();
  });

  it('createPlacement requires recommendation in unlocked status', async () => {
    db.prepare("UPDATE recommendations SET status = 'pending' WHERE id = 'r1'").run();
    const e: any = { id: 'e1', user_type: 'pm' };
    await expect(handler.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 600000 })).rejects.toThrow(/Invalid state/);
  });

  it('createPlacement computes commission and inserts', async () => {
    const e: any = { id: 'e1', user_type: 'pm' };
    const p = await handler.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 1_000_000 });
    // Sub-G: platform_fee_rate is read from config (default 0.1 = 10%)
    expect(p.platform_fee).toBe(100_000);
    expect(p.primary_share).toBe(100_000);  // no referrer → primary gets all
    expect(p.status).toBe('pending_payment');
  });

  it('createPlacement with trigger sends placement_confirmed notification (v1.9.0)', async () => {
    const { createNotificationTrigger } = await import('../../src/main/modules/notification/trigger');
    const { createNotificationsRepo } = await import('../../src/main/db/repositories/notifications');
    const { createCommissionHandler: cch } = await import('../../src/main/modules/commission/handler');
    const notif = createNotificationTrigger(db);
    const notifsRepo = createNotificationsRepo(db);
    const hWithNotif = cch(db, Buffer.alloc(32, 1), notif);
    const e: any = { id: 'e1', user_type: 'pm' };
    await hWithNotif.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 1_000_000 });
    // h1 is primary_headhunter in this fixture
    const list = notifsRepo.listByUser({ user_id: 'h1' });
    const placementNotifs = list.filter(n => n.category === 'placement_confirmed');
    expect(placementNotifs.length).toBe(1);
  });

  it('createPlacement rejects duplicate (P1#4)', async () => {
    const e: any = { id: 'e1', user_type: 'pm' };
    await handler.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 600000 });
    await expect(handler.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 600000 })).rejects.toThrow();
  });

  // Bug #4 from external test report: placement_created webhook is not enqueued.
  // After createPlacement, the primary headhunter should receive a webhook so their
  // agent knows to expect a commission / next step.
  it('createPlacement enqueues placement_created webhook for primary headhunter', async () => {
    const e: any = { id: 'e1', user_type: 'pm' };
    const p = await handler.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 600000 });
    const rows = db.prepare(
      "SELECT * FROM webhook_delivery_queue WHERE event_type = 'placement_created' AND target_user_id = 'h1'"
    ).all() as any[];
    expect(rows.length).toBe(1);
    const payload = JSON.parse(decrypt(Buffer.alloc(32, 1), rows[0].payload_enc));
    expect(payload.placement_id).toBe(p.id);
    expect(payload.job_id).toBe('j1');
    expect(payload.anonymized_candidate_id).toBe('ca_1');
    expect(payload.annual_salary).toBe(600000);
    expect(payload.platform_fee).toBe(p.platform_fee);
    expect(payload.status).toBe('pending_payment');
    expect(rows[0].contains_pii).toBe(0);
  });

  it('createPlacement also enqueues webhook for referrer headhunter when present', async () => {
    // Insert a referrer headhunter and update the recommendation to point at them
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'h2', user_type: 'hr', name: 'H2', contact: null, agent_endpoint: null, api_key_hash: 'h2b', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    db.prepare("UPDATE recommendations SET referrer_headhunter_id = 'h2' WHERE id = 'r1'").run();
    const e: any = { id: 'e1', user_type: 'pm' };
    await handler.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 600000 });
    const h1Rows = db.prepare("SELECT * FROM webhook_delivery_queue WHERE event_type = 'placement_created' AND target_user_id = 'h1'").all() as any[];
    const h2Rows = db.prepare("SELECT * FROM webhook_delivery_queue WHERE event_type = 'placement_created' AND target_user_id = 'h2'").all() as any[];
    expect(h1Rows.length).toBe(1);
    expect(h2Rows.length).toBe(1);
  });

  it('createPlacement rolls back webhook on UNIQUE constraint failure', async () => {
    // If placement insert fails (duplicate), the webhook must NOT be enqueued —
    // otherwise the headhunter would be told about a non-existent placement.
    const e: any = { id: 'e1', user_type: 'pm' };
    await handler.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 600000 });
    await expect(handler.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 600000 })).rejects.toThrow();
    // Still only 1 row from the first (successful) call
    const rows = db.prepare("SELECT * FROM webhook_delivery_queue WHERE event_type = 'placement_created'").all() as any[];
    expect(rows.length).toBe(1);
  });

  it('markPaid transitions pending_payment → paid', async () => {
    const e: any = { id: 'e1', user_type: 'pm' };
    const p = await handler.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 600000 });
    handler.markPaid('admin', p.id);
    expect(places.findById(p.id)?.status).toBe('paid');
  });

  it('markPaid with trigger sends commission_paid notification (v1.9.0)', async () => {
    const { createNotificationTrigger } = await import('../../src/main/modules/notification/trigger');
    const { createNotificationsRepo } = await import('../../src/main/db/repositories/notifications');
    const { createCommissionHandler: cch } = await import('../../src/main/modules/commission/handler');
    const notif = createNotificationTrigger(db);
    const notifsRepo = createNotificationsRepo(db);
    const hWithNotif = cch(db, Buffer.alloc(32, 1), notif);
    const e: any = { id: 'e1', user_type: 'pm' };
    const p = await hWithNotif.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 600000 });
    hWithNotif.markPaid('admin', p.id);
    // h1 is primary_headhunter
    const list = notifsRepo.listByUser({ user_id: 'h1' });
    const paidNotifs = list.filter(n => n.category === 'commission_paid');
    expect(paidNotifs.length).toBe(1);
  });

  it('markPaid rejects when status is not pending_payment', async () => {
    const e: any = { id: 'e1', user_type: 'pm' };
    const p = await handler.createPlacement(e, { anonymized_candidate_id: 'ca_1', job_id: 'j1', annual_salary: 600000 });
    handler.markPaid('admin', p.id);
    expect(() => handler.markPaid('admin', p.id)).toThrow(/Invalid state/);
  });
});