import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

describe('candidate GDPR export', () => {
  const testDb = path.join(__dirname, '../../tmp/gdpr.db');
  let db: any, users: any, priv: any, anon: any, recs: any, audit: any, exporter: any;
  let encryptionKey: Buffer;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    encryptionKey = crypto.randomBytes(32);
    const { createUsersRepo } = await import('../../src/main/db/repositories/users');
    const { createCandidatesPrivateRepo } = await import('../../src/main/db/repositories/candidates-private');
    const { createCandidatesAnonymizedRepo } = await import('../../src/main/db/repositories/candidates-anonymized');
    const { createRecommendationsRepo } = await import('../../src/main/db/repositories/recommendations');
    const { createJobsRepo } = await import('../../src/main/db/repositories/jobs');
    const { createUnlockAuditLogRepo } = await import('../../src/main/db/repositories/unlock-audit-log');
    const { encrypt } = await import('../../src/main/modules/crypto/aes-gcm');
    const { createCandidateExport } = await import('../../src/main/modules/candidate/export');
    users = createUsersRepo(db);
    priv = createCandidatesPrivateRepo(db);
    anon = createCandidatesAnonymizedRepo(db);
    const jobs = createJobsRepo(db);
    recs = createRecommendationsRepo(db);
    audit = createUnlockAuditLogRepo(db);
    exporter = createCandidateExport(db, encryptionKey);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'e1', user_type: 'pm', name: 'E', contact: null, agent_endpoint: null, api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'h1', user_type: 'hr', name: 'H', contact: null, agent_endpoint: null, api_key_hash: 'h2', api_key_prefix: 'hp_live_', quota_per_day: 200, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    users.insert({ id: 'c1', user_type: 'candidate', name: 'C', contact: null, agent_endpoint: null, api_key_hash: 'h3', api_key_prefix: 'hp_live_', quota_per_day: 50, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
    priv.insert({ id: 'cp_1', headhunter_id: 'h1', candidate_user_id: 'c1',
      name_enc: encrypt(encryptionKey, '张三'), phone_enc: encrypt(encryptionKey, '13800138000'), email_enc: encrypt(encryptionKey, 'z@x.com'),
      current_company_raw: '字节跳动', current_title_raw: 'P6', expected_salary: 700000, years_experience: 8, education_school: '清华',
      resume_url: null, skills_json: '["React"]', raw_payload_json: null, created_at: now, updated_at: now });
    anon.insert({ id: 'ca_1', source_private_id: 'cp_1', source_headhunter_id: 'h1', industry: '互联网', title_level: 'P6', years_experience: 8, salary_range: '60-80万', education_tier: '985', skills_json: '["React"]', is_public_pool: 1, unlock_status: 'locked', created_at: now, updated_at: now });
    jobs.insert({ id: 'j1', employer_id: 'e1', title: 'A', description: null, requirements: null, salary_min: null, salary_max: null, status: 'open', priority: 'normal', deadline: null, industry: '互联网', created_at: now, updated_at: now });
    recs.insert({ id: 'r1', headhunter_id: 'h1', employer_id: 'e1', anonymized_candidate_id: 'ca_1', job_id: 'j1', status: 'pending', commission_split_json: null, referrer_headhunter_id: null, created_at: now, updated_at: now });
    audit.insert({ recommendation_id: 'r1', actor_user_id: 'c1', action: 'approve_unlock', ip_address: null, user_agent: null });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('exports decrypted PII + recommendations + audit', () => {
    const c: any = { id: 'c1', user_type: 'candidate' };
    const data = exporter.exportMyData(c);
    expect(data.user.id).toBe('c1');
    expect(data.candidates_private.length).toBe(1);
    // h1 != c1 → third-party-submitted PII is REDACTED in the candidate's export.
    expect(data.candidates_private[0].name).toBeUndefined();
    expect(data.candidates_private[0].phone).toBeUndefined();
    expect(data.candidates_private[0].email).toBeUndefined();
    expect(data.candidates_private[0].submitted_by_headhunter_id).toBe('h1');
    expect(data.candidates_private[0].notice).toMatch(/redacted/);
    expect(data.candidates_anonymized[0].industry).toBe('互联网');
    expect(data.recommendations.length).toBe(1);
    expect(data.audit_log_entries.length).toBe(1);
    expect(data.exported_at).toBeDefined();
  });

  it('exports full PII only when the candidate submitted the record themselves', async () => {
    // Insert a SELF-submitted record (headhunter_id == candidate_user_id == c1)
    const { encrypt } = await import('../../src/main/modules/crypto/aes-gcm');
    const now = '2026-06-17T00:00:00Z';
    priv.insert({ id: 'cp_self', headhunter_id: 'c1', candidate_user_id: 'c1',
      name_enc: encrypt(encryptionKey, '李四'), phone_enc: encrypt(encryptionKey, '13900139000'), email_enc: encrypt(encryptionKey, 'l@x.com'),
      current_company_raw: '腾讯', current_title_raw: 'P7', expected_salary: 900000, years_experience: 10, education_school: '北大',
      resume_url: null, skills_json: '["Node"]', raw_payload_json: null, created_at: now, updated_at: now });

    const c: any = { id: 'c1', user_type: 'candidate' };
    const data = exporter.exportMyData(c);
    const selfRow = data.candidates_private.find((r: any) => r.id === 'cp_self');
    expect(selfRow).toBeDefined();
    expect(selfRow.name).toBe('李四');
    expect(selfRow.phone).toBe('13900139000');
    expect(selfRow.email).toBe('l@x.com');
  });

  it('rejects non-candidate', () => {
    const h: any = { id: 'h1', user_type: 'hr' };
    expect(() => exporter.exportMyData(h)).toThrow();
  });
});