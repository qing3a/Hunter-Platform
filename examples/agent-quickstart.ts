#!/usr/bin/env node
/**
 * Hunter Platform — Agent Quickstart
 *
 * Run a full happy path end-to-end against the platform:
 *
 *   1. Register three roles (candidate / headhunter / employer)
 *   2. Headhunter uploads a candidate (desensitization)
 *   3. Employer creates a JD
 *   4. Headhunter recommends the candidate to the JD
 *   5. Employer expresses interest → webhook fires `notify_unlock_request`
 *   6. Candidate approves unlock → webhook fires `notify_unlock_approved`
 *   7. Employer unlocks contact → webhook fires `deliver_contact` (PII)
 *   8. Employer creates a placement
 *
 * Mirrors §11 in `docs/superpowers/skill.md` (Python Day-1 sample) but
 * in TypeScript and using `fetch()` instead of `urllib`. Uses `hp_live_*`
 * API keys (no session token) for terseness — see §1.1 for the
 * multi-role + session path.
 *
 * Usage:
 *
 *   HUNTER_BASE=http://localhost:3000 node --import tsx examples/agent-quickstart.ts
 *
 * Environment:
 *
 *   HUNTER_BASE   — defaults to http://localhost:3000
 *   HUNTER_QUIET  — set to '1' to suppress progress logging
 *
 * Prerequisites:
 *
 *   - The server is reachable at $HUNTER_BASE
 *   - No prior data is required; this script registers fresh users with
 *     a unique run id derived from the timestamp + os pid so successive
 *     runs don't collide on `contact` (which has a "contact_taken"
 *     constraint).
 *
 * The script does NOT bind a webhook receiver — step 5/6/7 still succeed
 * because the platform records the state transitions, but the deliver_contact
 * webhook (which carries PII) is sent to whichever `agent_endpoint` was
 * passed during registration. None is set here, so the webhook will 404
 * silently — the platform retries per its own backoff schedule (§6.3).
 *
 * In real usage, register each user with `agent_endpoint: 'https://your-agent/cb'`
 * and verify each webhook with HMAC.
 */

import { randomUUID } from 'node:crypto';

const BASE  = process.env.HUNTER_BASE ?? 'http://localhost:3000';
const QUIET = process.env.HUNTER_QUIET === '1';

async function call(
  method: string,
  path: string,
  body?: unknown,
  bearer?: string,
  baseOverride?: string,
): Promise<{ data: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
  };
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  const target = (baseOverride ?? BASE) + path;
  const res = await fetch(target, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok !== true) {
    throw new Error(
      `${method} ${path} → ${res.status}: ${JSON.stringify(json.error ?? json)}`,
    );
  }
  return json;
}

/**
 * Public entry point for the happy path. Exported so callers (including
 * the integration smoke test) can drive it without spawning a subprocess
 * and without depending on env vars being frozen at module-load time.
 *
 * Override `baseUrl` to point at any reachable Hunter Platform instance;
 * `quiet` suppresses progress logging.
 */
export async function runQuickstart(opts: { baseUrl?: string; quiet?: boolean } = {}): Promise<void> {
  const base = opts.baseUrl ?? BASE;
  const quiet = opts.quiet ?? QUIET;

  // Helper closure capturing `base` rather than going through the
  // module-level BASE constant, so callers can swap endpoints at runtime.
  const callThrough = async (
    method: string,
    path: string,
    body?: unknown,
    bearer?: string,
  ) => call(method, path, body, bearer, base);

  const id = randomUUID().slice(0, 8);
  if (!quiet) console.log(`▶ Quickstart run id: ${id}`);

  // -- 1. Register three roles (R1.C2 enum: hr/pm, not headhunter/employer) -----
  const candidate  = await callThrough('POST', '/v1/auth/register', {
    user_type: 'candidate', name: `cand-${id}`, contact: `${id}@c.example`,
  });
  const headhunter = await callThrough('POST', '/v1/auth/register', {
    user_type: 'hr', name: `hh-${id}`, contact: `${id}@h.example`,
  });
  const employer   = await callThrough('POST', '/v1/auth/register', {
    user_type: 'pm', name: `emp-${id}`, contact: `${id}@e.example`,
  });
  if (!quiet) console.log('  ✓ 3 users registered');

  // -- 2. Headhunter uploads a candidate (PII → encrypted at rest) ------
  const upload = await callThrough('POST', '/v1/headhunter/candidates', {
    candidate_user_id: candidate.data.id,
    name: '张三',
    phone: '13800138000',
    email: `${id}@z.example`,
    current_company: '字节跳动',
    current_title: '高级前端工程师',
    expected_salary: 600000,
    years_experience: 8,
    education_school: '清华大学',
    skills: ['React', 'TypeScript'],
  }, headhunter.data.api_key);
  const anon = upload.data.anonymized_id;
  if (!quiet) console.log(`  ✓ candidate uploaded: anonymized_id=${anon}`);

  // -- 3. Employer posts a JD ------------------------------------------
  const job = await callThrough('POST', '/v1/employer/jobs', {
    title: '高级前端工程师',
    description: '8 年 React / TypeScript 经验',
    required_skills: ['React', 'TypeScript'],
    salary_min: 500000,
    salary_max: 800000,
  }, employer.data.api_key);
  const jobId = job.data.id;
  if (!quiet) console.log(`  ✓ JD posted: ${jobId}`);

  // -- 4. Headhunter recommends the candidate to the JD ----------------
  const rec = await callThrough('POST', '/v1/headhunter/recommendations', {
    anonymized_candidate_id: anon,
    job_id: jobId,
  }, headhunter.data.api_key);
  const recId = rec.data.id;
  if (!quiet) console.log(`  ✓ recommendation ${recId} created (status=pending)`);

  // -- 5. Express interest → notify_unlock_request webhook -------------
  await callThrough(
    'POST',
    `/v1/employer/recommendations/${recId}/express-interest`,
    {},
    employer.data.api_key,
  );
  if (!quiet) console.log('  ✓ express-interest → status=employer_interested (webhook fired)');

  // -- 6. Candidate approves → notify_unlock_approved ------------------
  await callThrough(
    'POST',
    `/v1/candidate/recommendations/${recId}/approve-unlock`,
    {},
    candidate.data.api_key,
  );
  if (!quiet) console.log('  ✓ approve-unlock → status=candidate_approved (webhook fired)');

  // -- 7. Unlock contact → deliver_contact webhook (carries PII) -------
  await callThrough(
    'POST',
    `/v1/employer/recommendations/${recId}/unlock-contact`,
    {},
    employer.data.api_key,
  );
  if (!quiet) console.log('  ✓ unlock-contact → status=unlocked (PII webhook fired; not received here)');

  // -- 8. Create placement ---------------------------------------------
  const placement = await callThrough('POST', '/v1/employer/placements', {
    job_id: jobId,
    anonymized_candidate_id: anon,
    annual_salary: 600000,
  }, employer.data.api_key);
  if (!quiet) console.log(`  ✓ placement ${placement.data.id} created (commission auto-computed)`);

  if (!quiet) {
    console.log('▶ Happy path complete.');
    console.log('  Tips:');
    console.log('   • §6 of skill.md for webhook receiver code (HMAC verify + replay window).');
    console.log('   • §17 for ow-recruit collab mode (multi-source + capability aliases).');
    console.log('   • §14.4.1 for the employer history decision matrix.');
  }
}

async function main(): Promise<void> {
  const id = randomUUID().slice(0, 8);
  if (!QUIET) console.log(`▶ Quickstart run id: ${id}`);

  // -- 1. Register three roles -----------------------------------------
  const candidate  = await call('POST', '/v1/auth/register', {
    user_type: 'candidate', name: `cand-${id}`, contact: `${id}@c.example`,
  });
  const headhunter = await call('POST', '/v1/auth/register', {
    user_type: 'headhunter', name: `hh-${id}`, contact: `${id}@h.example`,
  });
  const employer   = await call('POST', '/v1/auth/register', {
    user_type: 'employer', name: `emp-${id}`, contact: `${id}@e.example`,
  });
  if (!QUIET) console.log('  ✓ 3 users registered');

  // -- 2. Headhunter uploads a candidate (PII → encrypted at rest) ------
  const upload = await call('POST', '/v1/headhunter/candidates', {
    candidate_user_id: candidate.data.id,
    name: '张三',
    phone: '13800138000',
    email: `${id}@z.example`,
    current_company: '字节跳动',
    current_title: '高级前端工程师',
    expected_salary: 600000,
    years_experience: 8,
    education_school: '清华大学',
    skills: ['React', 'TypeScript'],
  }, headhunter.data.api_key);
  const anon = upload.data.anonymized_id;
  if (!QUIET) console.log(`  ✓ candidate uploaded: anonymized_id=${anon}`);

  // -- 3. Employer posts a JD ------------------------------------------
  const job = await call('POST', '/v1/employer/jobs', {
    title: '高级前端工程师',
    description: '8 年 React / TypeScript 经验',
    required_skills: ['React', 'TypeScript'],
    salary_min: 500000,
    salary_max: 800000,
  }, employer.data.api_key);
  const jobId = job.data.id;
  if (!QUIET) console.log(`  ✓ JD posted: ${jobId}`);

  // -- 4. Headhunter recommends the candidate to the JD ----------------
  const rec = await call('POST', '/v1/headhunter/recommendations', {
    anonymized_candidate_id: anon,
    job_id: jobId,
  }, headhunter.data.api_key);
  const recId = rec.data.id;
  if (!QUIET) console.log(`  ✓ recommendation ${recId} created (status=pending)`);

  // -- 5. Express interest → notify_unlock_request webhook -------------
  await call(
    'POST',
    `/v1/employer/recommendations/${recId}/express-interest`,
    {},
    employer.data.api_key,
  );
  if (!QUIET) console.log('  ✓ express-interest → status=employer_interested (webhook fired)');

  // -- 6. Candidate approves → notify_unlock_approved ------------------
  await call(
    'POST',
    `/v1/candidate/recommendations/${recId}/approve-unlock`,
    {},
    candidate.data.api_key,
  );
  if (!QUIET) console.log('  ✓ approve-unlock → status=candidate_approved (webhook fired)');

  // -- 7. Unlock contact → deliver_contact webhook (carries PII) -------
  await call(
    'POST',
    `/v1/employer/recommendations/${recId}/unlock-contact`,
    {},
    employer.data.api_key,
  );
  if (!QUIET) console.log('  ✓ unlock-contact → status=unlocked (PII webhook fired; not received here)');

  // -- 8. Create placement ---------------------------------------------
  const placement = await call('POST', '/v1/employer/placements', {
    job_id: jobId,
    anonymized_candidate_id: anon,
    annual_salary: 600000,
  }, employer.data.api_key);
  if (!QUIET) console.log(`  ✓ placement ${placement.data.id} created (commission auto-computed)`);

  if (!QUIET) {
    console.log('▶ Happy path complete.');
    console.log('  Tips:');
    console.log('   • §6 of skill.md for webhook receiver code (HMAC verify + replay window).');
    console.log('   • §17 for ow-recruit collab mode (multi-source + capability aliases).');
    console.log('   • §14.4.1 for the employer history decision matrix.');
  }
}

// Only auto-execute when this file is the entry point (e.g.
// `node --import tsx examples/agent-quickstart.ts`). When imported as a
// module from tests or other scripts, the side-effect stays dormant —
// callers invoke `runQuickstart()` explicitly.
import { fileURLToPath } from 'node:url';
const isEntry =
  typeof process.argv[1] === 'string' &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isEntry) {
  main().catch((err) => {
    console.error('✗ Quickstart failed:', err.message ?? err);
    process.exit(1);
  });
}
