import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

describe('employer handler - unlockContact', () => {
  const testDb4 = path.join(__dirname, '../../tmp/emp4.db');
  let localDb: any, localUsers: any, localPriv: any, localAnon: any, localJobs: any, localRecs: any, localWebhooks: any, localEmployer: any, localAudit: any;
  let encryptionKey: Buffer;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb4); } catch {}
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    localDb = openDb(testDb4);
    runMigrations(localDb);
    encryptionKey = crypto.randomBytes(32);
    const { createUsersRepo } = await import('../../src/main/db/repositories/users');
    const { createCandidatesPrivateRepo } = await import('../../src/main/db/repositories/candidates-private');
    const { createCandidatesAnonymizedRepo } = await import('../../src/main/db/repositories/candidates-anonymized');
    const { createJobsRepo } = await import('../../src/main/db/repositories/jobs');
    const { createRecommendationsRepo } = await import('../../src/main/db/repositories/recommendations');
    const { createWebhookQueueRepo } = await import('../../src/main/db/repositories/webhook-delivery-queue');
    const { createUnlockAuditLogRepo } = await import('../../src/main/db/repositories/unlock-audit-log');
    const { createEmployerHandler } = await import('../../src/main/modules/employer/handler');
    const { encrypt } = await import('../../src/main/modules/crypto/aes-gcm');
    localUsers = createUsersRepo(localDb);
    localPriv = createCandidatesPrivateRepo(localDb);
    localAnon = createCandidatesAnonymizedRepo(localDb);
    localJobs = createJobsRepo(localDb);
    localRecs = createRecommendationsRepo(localDb);
    localWebhooks = createWebhookQueueRepo(localDb);
    localAudit = createUnlockAuditLogRepo(localDb);
    localEmployer = createEmployerHandler(localDb);
    const now = '2026-06-17T00:00:00Z';
    localUsers.insert({ id: 'e1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: 'https://e.example.com/wh', api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    localUsers.insert({ id: 'h1', user_type: 'headhunter', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    localUsers.insert({ id: 'c1', user_type: 'candidate', name: 'C', contact: null, agent_endpoint: 'https://c.example.com/wh', api_key_hash: 'h3', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    const nameEnc = encrypt(encryptionKey, '张三');
    const phoneEnc = encrypt(encryptionKey, '13800138000');
    const emailEnc = encrypt(encryptionKey, 'z@x.com');
    localPriv.insert({ id: 'cp_1', headhunter_id: 'h1', candidate_user_id: 'c1', name_enc: nameEnc, phone_enc: phoneEnc, email_enc: emailEnc, current_company_raw: null, current_title_raw: null, expected_salary: null, years_experience: null, education_school: null, resume_url: null, skills_json: null, raw_payload_json: null, created_at: now, updated_at: now });
    localAnon.insert({ id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'h1', industry: '互联网', title_level: 'P6', years_experience: 8, salary_range: '60-80万', education_tier: '985', skills_json: '[]', is_public_pool: 1, unlock_status: 'locked', created_at: now, updated_at: now });
    localJobs.insert({ id: 'job_1', employer_id: 'e1', title: 'Senior FE', description: null, requirements: null, salary_min: 500000, salary_max: 800000, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
    localRecs.insert({ id: 'rec_1', headhunter_id: 'h1', employer_id: 'e1', anonymized_candidate_id: 'ca_1', job_id: 'job_1', status: 'candidate_approved', commission_split_json: null, referrer_headhunter_id: null, created_at: now, updated_at: now });
  });
  afterEach(() => { localDb.close(); try { fs.unlinkSync(testDb4); } catch {} });

  it('unlockContact requires candidate_approved state', () => {
    localRecs.updateStatus('rec_1', 'employer_interested');
    const e: any = { id: 'e1', user_type: 'employer' };
    expect(() => localEmployer.unlockContact(e, { recommendation_id: 'rec_1' }, { encryptionKey })).toThrow(/Invalid state/);
  });

  it('unlockContact enqueues deliver_contact webhook with encrypted PII', () => {
    const e: any = { id: 'e1', user_type: 'employer' };
    localEmployer.unlockContact(e, { recommendation_id: 'rec_1' }, { encryptionKey });
    const pending = localWebhooks.fetchPending(new Date().toISOString());
    expect(pending.length).toBe(1);
    expect(pending[0].event_type).toBe('deliver_contact');
    expect(pending[0].target_user_id).toBe('e1');
    expect(pending[0].contains_pii).toBe(1);
    expect(localRecs.findById('rec_1')?.status).toBe('unlocked');
  });

  it('unlockContact audit log records unlock_delivery', () => {
    const e: any = { id: 'e1', user_type: 'employer' };
    localEmployer.unlockContact(e, { recommendation_id: 'rec_1' }, { encryptionKey, ip: '1.2.3.4' });
    const entries = localAudit.listByRecommendation('rec_1');
    expect(entries.some((e: any) => e.action === 'unlock_delivery')).toBe(true);
  });
});
