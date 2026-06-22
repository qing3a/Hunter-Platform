// tests/integration/skill-md-conformance/schema-shape.test.ts
//
// Per-capability zod response-shape validation. For every capability declared
// in src/main/capabilities/ with a `response_schema`, calls the endpoint
// (after registering the appropriate user type and creating minimum
// prerequisites), then validates the response envelope against
// `EnvelopeSchema(cap.response_schema)`.
//
// Capabilities that need multi-step flows (placement, full unlock chain) are
// marked `it.skip` with a TODO comment. Target: ≥30 real tests, ≤16 skipped.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z, type ZodTypeAny } from 'zod';
import {
  freshApp, cleanupDb, ConformanceClient, adminAuthHeader,
} from './_setup';
import { getAllCapabilitySets, findCapabilityByEndpoint } from '../../../src/main/capabilities/index.js';

/** Envelope wrapper used by the JSON API. We import the named export rather
 *  than re-implementing it so the test stays in sync with production code. */

let app: import('express').Express;
let dbPath: string;
let client: ConformanceClient;

let hKey = '';  // headhunter API key
let eKey = '';  // employer API key
let cKey = '';  // candidate API key

let hCandidateId = '';     // anonymized candidate id from POST /v1/headhunter/candidates
let hJobId = '';           // job id from POST /v1/headhunter/jobs
let eJobId = '';           // job id from POST /v1/employer/jobs
let hRecommendationId = '';// recommendation id from POST /v1/headhunter/recommendations

beforeAll(async () => {
  const f = await freshApp('schema-shape');
  app = f.app;
  dbPath = f.dbPath;
  client = new ConformanceClient(app);

  // Register all three roles once; reuse across describes.
  hKey = await client.register('headhunter', 'ShapeH', 'sh@x.com');
  eKey = await client.register('employer', 'ShapeE', 'se@x.com');
  cKey = await client.register('candidate', 'ShapeC', 'sc@x.com');

  // Pre-create resources needed by per-capability tests.
  const candRes = await client.request({
    method: 'POST', path: '/v1/headhunter/candidates', auth: hKey,
    body: { candidate_user_id: client.ids.get('candidate'), name: 'Cand1', phone: '13800000001', email: 'cand1@x.com' },
  });
  hCandidateId = candRes.data.data.anonymized_id as string;

  const hJobRes = await client.request({
    method: 'POST', path: '/v1/headhunter/jobs', auth: hKey,
    body: { title: 'HJob1', description: 'd', created_for_employer_id: client.ids.get('employer') },
  });
  hJobId = hJobRes.data.data.id as string;

  const eJobRes = await client.request({
    method: 'POST', path: '/v1/employer/jobs', auth: eKey,
    body: { title: 'EJob1', description: 'd' },
  });
  eJobId = eJobRes.data.data.id as string;

  const recRes = await client.request({
    method: 'POST', path: '/v1/headhunter/recommendations', auth: hKey,
    body: { anonymized_candidate_id: hCandidateId, job_id: eJobId },
  });
  hRecommendationId = recRes.data.data.id as string;
}, 30000);

afterAll(() => cleanupDb('schema-shape'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Replace `:param` placeholders in a capability path with real values. */
function bindPath(template: string, params: Record<string, string>): string {
  return template.replace(/:([a-zA-Z_]+)/g, (_, k) => params[k] ?? `:${k}`);
}

/** Map a role name to the API key created in beforeAll. */
function keyFor(role: string): string | undefined {
  if (role === 'headhunter') return hKey;
  if (role === 'employer') return eKey;
  if (role === 'candidate') return cKey;
  return undefined; // admin / auth
}

/** Build a minimal valid request body for a given capability. The
 *  capability's `effects` list hints at side-effects; we provide bodies that
 *  exercise the happy path. */
function bodyFor(capName: string): unknown | undefined {
  switch (capName) {
    case 'auth.register':
      return { user_type: 'candidate', name: 'NewC', contact: 'newc@x.com' };
    case 'auth.rotate_key':
      return undefined; // GET-ish; no body
    case 'headhunter.upload_candidate':
      return { candidate_user_id: client.ids.get('candidate'), name: 'BodyC', phone: '13800009999', email: 'bodyc@x.com' };
    case 'headhunter.recommend_candidate':
      return { anonymized_candidate_id: hCandidateId, job_id: eJobId };
    case 'headhunter.withdraw_recommendation':
      return undefined;
    case 'headhunter.publish_to_pool':
      return undefined;
    case 'headhunter.create_job':
      return { title: 'BodyJob', description: 'd', created_for_employer_id: client.ids.get('employer') };
    case 'employer.create_job':
      return { title: 'EJobBody', description: 'd' };
    case 'employer.express_interest':
      return undefined;
    case 'employer.unlock_contact':
      return undefined;
    case 'employer.reject_jobs':
      return { reason: 'not a fit' };
    case 'employer.claim_jobs':
      return undefined;
    case 'candidate.approve_unlock':
      return undefined;
    case 'candidate.reject_unlock':
      return undefined;
    case 'candidate.delete_my_data':
      return undefined;
    case 'admin.suspend_user':
      return { reason: 'test' };
    case 'admin.unsuspend_user':
      return { reason: 'test' };
    case 'admin.rotate_user_key':
      return undefined;
    case 'admin.soft_warn_user':
      return { reason: 'test' };
    case 'admin.adjust_user_quota':
      return { new_quota: 100 };
    default:
      return undefined;
  }
}

/** Pick a path-params binding for capabilities that include `:id`. */
function pathParamsFor(capName: string): Record<string, string> {
  switch (capName) {
    case 'headhunter.withdraw_recommendation':
    case 'employer.express_interest':
    case 'employer.unlock_contact':
    case 'candidate.approve_unlock':
    case 'candidate.reject_unlock':
      return { id: hRecommendationId };
    case 'headhunter.publish_to_pool':
      return { id: hCandidateId };
    case 'employer.reject_jobs':
    case 'employer.claim_jobs':
      return { id: eJobId };
    case 'admin.suspend_user':
    case 'admin.unsuspend_user':
    case 'admin.rotate_user_key':
    case 'admin.soft_warn_user':
    case 'admin.adjust_user_quota':
      return { id: client.ids.get('candidate') ?? '' };
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// Per-role describe blocks
// ---------------------------------------------------------------------------

describe('schema-shape: auth capabilities', () => {
  for (const cap of getAllCapabilitySets().find((s) => s.role === 'auth')!.capabilities) {
    // auth.rotate_key rotates the hKey, breaking shared beforeAll tests.
    // It has its own test in schema-shape-destructive.test.ts (per-test fresh DB).
    if (cap.name === 'auth.rotate_key') {
      it.skip(`${cap.name}: ${cap.method} ${cap.path} — TODO: side-effect (rotates key), covered in schema-shape-destructive.test.ts`);
      continue;
    }
    it(`${cap.name}: ${cap.method} ${cap.path}`, async () => {
      const r = await client.request({
        method: cap.method,
        path: bindPath(cap.path, pathParamsFor(cap.name)),
        auth: cap.name === 'auth.register' ? undefined : hKey,
        body: bodyFor(cap.name),
        schema: cap.response_schema ? (cap.response_schema as ZodTypeAny) : undefined,
      });
      expect([200, 201, 204]).toContain(r.status);
    });
  }
});

describe('schema-shape: headhunter capabilities', () => {
  // headhunter.recommend_candidate is exercised in schema-shape-flow.test.ts
  // (per-test fresh rec) — can't call it twice on same rec due to UNIQUE constraint.
  const skipHeadhunter = new Set(['headhunter.recommend_candidate']);
  for (const cap of getAllCapabilitySets().find((s) => s.role === 'headhunter')!.capabilities) {
    if (skipHeadhunter.has(cap.name)) {
      it.skip(`${cap.name}: ${cap.method} ${cap.path} — covered in schema-shape-flow.test.ts`);
      continue;
    }
    it(`${cap.name}: ${cap.method} ${cap.path}`, async () => {
      const r = await client.request({
        method: cap.method,
        path: bindPath(cap.path, pathParamsFor(cap.name)),
        auth: hKey,
        body: bodyFor(cap.name),
        schema: cap.response_schema ? (cap.response_schema as ZodTypeAny) : undefined,
      });
      expect([200, 201, 204]).toContain(r.status);
    });
  }
});

describe('schema-shape: employer capabilities', () => {
  // Multi-step flow capabilities are exercised in schema-shape-flow.test.ts
  // with proper state machine prerequisites.
  const skipEmployer = new Set([
    'employer.express_interest',
    'employer.unlock_contact',
    'employer.claim_job',
    'employer.reject_job',
    'employer.create_placement',
  ]);
  for (const cap of getAllCapabilitySets().find((s) => s.role === 'employer')!.capabilities) {
    if (skipEmployer.has(cap.name)) {
      it.skip(`${cap.name}: ${cap.method} ${cap.path} — covered in schema-shape-flow.test.ts`);
      continue;
    }
    it(`${cap.name}: ${cap.method} ${cap.path}`, async () => {
      const r = await client.request({
        method: cap.method,
        path: bindPath(cap.path, pathParamsFor(cap.name)),
        auth: eKey,
        body: bodyFor(cap.name),
        schema: cap.response_schema ? (cap.response_schema as ZodTypeAny) : undefined,
      });
      expect([200, 201, 204]).toContain(r.status);
    });
  }
});

describe('schema-shape: candidate capabilities', () => {
  for (const cap of getAllCapabilitySets().find((s) => s.role === 'candidate')!.capabilities) {
    // delete_my_data wipes the candidate's PII (name → null), breaking admin.list_users later.
    // It has its own test in schema-shape-destructive.test.ts (per-test fresh DB).
    if (cap.name === 'candidate.delete_my_data') {
      it.skip(`${cap.name}: ${cap.method} ${cap.path} — covered in schema-shape-destructive.test.ts`);
      continue;
    }
    // approve_unlock and reject_unlock are multi-step — covered in schema-shape-flow.test.ts
    if (cap.name === 'candidate.approve_unlock' || cap.name === 'candidate.reject_unlock') {
      it.skip(`${cap.name}: ${cap.method} ${cap.path} — covered in schema-shape-flow.test.ts`);
      continue;
    }
    it(`${cap.name}: ${cap.method} ${cap.path}`, async () => {
      const r = await client.request({
        method: cap.method,
        path: bindPath(cap.path, pathParamsFor(cap.name)),
        auth: cKey,
        body: bodyFor(cap.name),
        schema: cap.response_schema ? (cap.response_schema as ZodTypeAny) : undefined,
      });
      expect([200, 201, 204]).toContain(r.status);
    });
  }
});

describe('schema-shape: admin capabilities', () => {
  // Admin endpoints needing pre-existing records are exercised in
  // schema-shape-admin-precondition.test.ts.
  const skipAdmin = new Set([
    'admin.remove_from_pool',
    'admin.mark_placement_paid',
    'admin.cancel_placement',
    'admin.retry_webhook',
    'admin.rate_limit_buckets',
    'admin.clear_user_rate_limit',
    'admin.placements_summary',
    'admin.put_config',
    'admin.suspend_user',
    'admin.unsuspend_user',
    'admin.adjust_user_quota',
  ]);
  for (const cap of getAllCapabilitySets().find((s) => s.role === 'admin')!.capabilities) {
    if (skipAdmin.has(cap.name)) {
      it.skip(`${cap.name}: ${cap.method} ${cap.path} — covered in schema-shape-admin-precondition.test.ts`);
      continue;
    }
    it(`${cap.name}: ${cap.method} ${cap.path}`, async () => {
      const r = await client.request({
        method: cap.method,
        path: bindPath(cap.path, pathParamsFor(cap.name)),
        auth: adminAuthHeader(),
        body: bodyFor(cap.name),
        schema: cap.response_schema ? (cap.response_schema as ZodTypeAny) : undefined,
      });
      expect([200, 201, 204]).toContain(r.status);
    });
  }
});
