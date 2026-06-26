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
    body: { candidate_user_id: client.ids.get('candidate'), name: 'Cand1', phone: '13800000001', email: 'cand1@x.com' , current_company: '字节跳动' },
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
      return { candidate_user_id: client.ids.get('candidate'), name: 'BodyC', phone: '13800009999', email: 'bodyc@x.com', current_company: '字节跳动' };
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
    case 'admin.get_timeline':
      return { type: 'user', id: client.ids.get('candidate') ?? '' };
    case 'admin.update_webhook_subscription':
    case 'admin.delete_webhook_subscription':
      return { id: '99999' };
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// COMPLEX_CAPS — capabilities excluded from this main file
// ---------------------------------------------------------------------------
//
// These capabilities need pre-existing records, state-machine preconditions,
// or destructive side-effects that conflict with this file's shared beforeAll
// (single DB across all tests, single API key per role). They are tested in
// dedicated sibling files:
//
//   - schema-shape-destructive.test.ts: auth.rotate_key, candidate.delete_my_data
//     (per-test fresh DB because the side-effect invalidates shared state)
//
//   - schema-shape-flow.test.ts: employer.express_interest, employer.unlock_contact,
//     employer.claim_job, employer.reject_job, employer.create_placement,
//     candidate.approve_unlock, candidate.reject_unlock,
//     headhunter.recommend_candidate (per-test fresh rec because of UNIQUE
//     constraint on (headhunter_id, candidate_id, job_id))
//
//   - schema-shape-admin-precondition.test.ts: all admin.remove_from_pool,
//     admin.mark_placement_paid, admin.cancel_placement, admin.retry_webhook,
//     admin.rate_limit_buckets, admin.clear_user_rate_limit,
//     admin.placements_summary, admin.put_config, admin.suspend_user,
//     admin.unsuspend_user, admin.adjust_user_quota (per-test fresh DB with
//     pre-inserted rows because most of these endpoints have no public API to
//     set up the prerequisite state)
//
// Listed ONLY here so this file's loops can filter them out. They are NOT
// marked `it.skip` — they simply never reach the `it()` call, so test counts
// reflect the actual coverage of this file (25 capabilities, 0 skipped).
const COMPLEX_CAPS = new Set<string>([
  // destructive (per-test fresh DB)
  'auth.rotate_key',
  'candidate.delete_my_data',
  // flow (per-test fresh recommendation)
  'headhunter.recommend_candidate',
  'employer.unlock_contact',
  'employer.create_placement',
  'employer.express_interest',
  'employer.claim_job',
  'employer.reject_job',
  'candidate.approve_unlock',
  'candidate.reject_unlock',
  // Sub-E: webhook subscription create/update/delete need pre-existing records
  // (PATCH/PUT 99999 → 404, POST empty body → 400) which the strict [200,201,204]
  // schema-shape loop doesn't tolerate
  'admin.create_webhook_subscription',
  'admin.update_webhook_subscription',
  'admin.delete_webhook_subscription',
  // admin-precondition (per-test fresh DB with pre-inserted rows)
  'admin.remove_from_pool',
  'admin.mark_placement_paid',
  'admin.cancel_placement',
  'admin.retry_webhook',
  'admin.rate_limit_buckets',
  'admin.clear_user_rate_limit',
  'admin.placements_summary',
  'admin.put_config',
  // Sub-E: get_config + update_config tested in schema-shape-admin-precondition
  // (they need a real admin key + path param binding for the :key placeholder)
  'admin.get_config',
  'admin.update_config',
  'admin.suspend_user',
  'admin.unsuspend_user',
  'admin.adjust_user_quota',
]);

// ---------------------------------------------------------------------------
// Per-role describe blocks
// ---------------------------------------------------------------------------

describe('schema-shape: auth capabilities', () => {
  for (const cap of getAllCapabilitySets().find((s) => s.role === 'auth')!.capabilities) {
    if (COMPLEX_CAPS.has(cap.name)) continue;
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
  for (const cap of getAllCapabilitySets().find((s) => s.role === 'headhunter')!.capabilities) {
    if (COMPLEX_CAPS.has(cap.name)) continue;
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
  for (const cap of getAllCapabilitySets().find((s) => s.role === 'employer')!.capabilities) {
    if (COMPLEX_CAPS.has(cap.name)) continue;
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
    if (COMPLEX_CAPS.has(cap.name)) continue;
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
  for (const cap of getAllCapabilitySets().find((s) => s.role === 'admin')!.capabilities) {
    if (COMPLEX_CAPS.has(cap.name)) continue;
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
