// tests/unit/webhook-encryption-fix.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../src/main/db/connection';
import { runMigrations } from '../../src/main/db/migrations';
import { createCandidateHandler } from '../../src/main/modules/candidate/handler';
import { createCommissionHandler } from '../../src/main/modules/commission/handler';

const TEST_KEY = Buffer.alloc(32, 1); // 32-byte test key

function seedFullGraph(db: ReturnType<typeof openDb>) {
  const now = '2026-06-21T00:00:00Z';
  db.exec(`
    INSERT INTO users (id, user_type, name, contact, status, reputation,
                       api_key_hash, api_key_prefix, quota_per_day, quota_used,
                       quota_reset_at, created_at, updated_at)
    VALUES ('u_h1', 'hr', 'H1', 'h@h.com', 'active', 50,
            'h1', 'p1', 500, 0, '${now}', '${now}', '${now}');
  `);
  db.exec(`
    INSERT INTO users (id, user_type, name, contact, status, reputation,
                       api_key_hash, api_key_prefix, quota_per_day, quota_used,
                       quota_reset_at, created_at, updated_at)
    VALUES ('u_e1', 'pm', 'E1', 'e@e.com', 'active', 50,
            'h2', 'p2', 800, 0, '${now}', '${now}', '${now}');
  `);
  db.exec(`
    INSERT INTO users (id, user_type, name, contact, status, reputation,
                       api_key_hash, api_key_prefix, quota_per_day, quota_used,
                       quota_reset_at, created_at, updated_at)
    VALUES ('u_c1', 'candidate', 'C1', 'c@c.com', 'active', 50,
            'h3', 'p3', 300, 0, '${now}', '${now}', '${now}');
  `);
  db.exec(`
    INSERT INTO candidates_private (id, headhunter_id, candidate_user_id,
                                    name_enc, phone_enc, email_enc,
                                    created_at, updated_at)
    VALUES ('cp1', 'u_h1', 'u_c1', 'v1:xx', 'v1:yy', 'v1:zz',
            '${now}', '${now}');
  `);
  db.exec(`
    INSERT INTO candidates_anonymized (id, source_private_id, source_headhunter_id,
                                       industry, title_level, is_public_pool,
                                       unlock_status, created_at, updated_at)
    VALUES ('ca1', 'cp1', 'u_h1', 'AI', 'senior', 1,
            'locked', '${now}', '${now}');
  `);
  db.exec(`
    INSERT INTO jobs (id, employer_id, title, status, industry,
                     salary_min, salary_max, created_at, updated_at)
    VALUES ('j1', 'u_e1', 'J1', 'open', 'AI',
            100000, 200000, '${now}', '${now}');
  `);
  db.exec(`
    INSERT INTO recommendations (id, job_id, anonymized_candidate_id,
                                 employer_id, headhunter_id, status,
                                 created_at, updated_at)
    VALUES ('r1', 'j1', 'ca1', 'u_e1', 'u_h1', 'employer_interested',
            '${now}', '${now}');
  `);
}

function getLastWebhook(db: ReturnType<typeof openDb>, eventType: string) {
  return db.prepare(
    `SELECT id, event_type, payload_enc, contains_pii
     FROM webhook_delivery_queue
     WHERE event_type = ?
     ORDER BY id DESC LIMIT 1`
  ).get(eventType) as { id: number; event_type: string; payload_enc: string; contains_pii: number } | undefined;
}

describe('webhook payload encryption fix (Bug 1)', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    runMigrations(db);
    seedFullGraph(db);
  });

  it('candidate approveUnlock enqueues notify_unlock_approved with v1: prefix', () => {
    const handler = createCandidateHandler(db, TEST_KEY);
    handler.approveUnlock(
      { id: 'u_c1', user_type: 'candidate' } as any,
      { recommendation_id: 'r1' },
      {},
    );
    const rec = getLastWebhook(db, 'notify_unlock_approved');
    expect(rec).toBeDefined();
    expect(rec!.payload_enc.startsWith('v1:')).toBe(true);
  });

  it('commission createPlacement enqueues placement_created with v1: prefix', async () => {
    // createPlacement requires recommendation status = 'unlocked'
    db.prepare("UPDATE recommendations SET status = 'unlocked' WHERE id = 'r1'").run();
    const handler = createCommissionHandler(db, TEST_KEY);
    await handler.createPlacement(
      { id: 'u_e1', user_type: 'pm' } as any,
      { anonymized_candidate_id: 'ca1', job_id: 'j1', annual_salary: 200000 },
    );
    const rec = getLastWebhook(db, 'placement_created');
    expect(rec).toBeDefined();
    expect(rec!.payload_enc.startsWith('v1:')).toBe(true);
  });
});
