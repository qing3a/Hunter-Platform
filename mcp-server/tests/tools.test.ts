/**
 * Integration tests for all 15 Hunter Platform MCP tools.
 *
 * Runs against the production API at https://qing3.top by default.
 * Override with HUNTER_PLATFORM_BASE_URL env var to point at a local instance.
 *
 * IMPORTANT:
 *   - /v1/auth/register is IP-rate-limited (5/h).
 *   - Tests share one candidate/employer/headhunter triple created in beforeAll().
 *   - If those accounts are deleted or rotated, tests will fail. Set
 *     HUNTER_PLATFORM_BASE_URL to a local instance with RATE_LIMIT_ENABLED=false
 *     to run from a clean state.
 *
 * To run against an existing triple without consuming IP rate limit:
 *   TEST_CANDIDATE_KEY / TEST_CANDIDATE_ID / TEST_EMPLOYER_KEY / TEST_EMPLOYER_ID /
 *   TEST_HEADHUNTER_KEY / TEST_HEADHUNTER_ID
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { HunterClient } from '../src/client.js';
import { authTools } from '../src/tools/auth.js';
import { userTools } from '../src/tools/users.js';
import { headhunterTools } from '../src/tools/headhunter.js';
import { employerTools } from '../src/tools/employer.js';
import { candidateTools } from '../src/tools/candidate.js';
import type { ToolContext, ToolDef } from '../src/types.js';

const BASE_URL = process.env.HUNTER_PLATFORM_BASE_URL ?? 'https://qing3.top';
const unique = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function newClient(apiKey?: string): HunterClient {
  return new HunterClient({ apiKey, baseUrl: BASE_URL });
}

function newCtx(apiKey?: string): ToolContext {
  return { client: newClient(apiKey) };
}

function getTool(name: string): ToolDef {
  const all: ToolDef[] = [
    ...authTools, ...userTools, ...headhunterTools, ...employerTools, ...candidateTools,
  ];
  const t = all.find((x) => x.tool.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

/**
 * Test helper that mimics the MCP framework's CallToolRequestSchema handler:
 *   1. Validate args with zod schema
 *   2. Extract api_key from args (priority) or fall back to ctx
 *   3. Rebuild a client with the resolved api_key
 *   4. Invoke the tool handler
 */
async function callTool(
  def: ToolDef,
  args: Record<string, unknown>,
  ctx: ToolContext = newCtx(),
) {
  const parsed = def.schema.parse(args);
  const argRecord = parsed as Record<string, unknown>;
  const apiKey = typeof argRecord.api_key === 'string'
    ? argRecord.api_key
    : ctx.client.apiKey;
  const baseUrl = typeof argRecord.base_url === 'string' ? argRecord.base_url : BASE_URL;
  const effectiveCtx: ToolContext = {
    client: new HunterClient({ apiKey, baseUrl }),
  };
  return def.handler(parsed as never, effectiveCtx);
}

let ACCOUNTS: {
  candidateId: string;
  candidateKey: string;
  employerId: string;
  employerKey: string;
  headhunterId: string;
  headhunterKey: string;
};

beforeAll(async () => {
  // Optional: use pre-existing accounts via env vars (saves IP rate limit budget).
  const candKey = process.env.TEST_CANDIDATE_KEY;
  const candId = process.env.TEST_CANDIDATE_ID;
  const empKey = process.env.TEST_EMPLOYER_KEY;
  const empId = process.env.TEST_EMPLOYER_ID;
  const hhKey = process.env.TEST_HEADHUNTER_KEY;
  const hhId = process.env.TEST_HEADHUNTER_ID;

  if (candKey && candId && empKey && empId && hhKey && hhId) {
    // Verify the candidate key is still valid before adopting it.
    const probe = await newClient(candKey).get(`/v1/users/${candId}/status`).catch(() => null);
    if (probe && (probe as { user_type?: string }).user_type) {
      ACCOUNTS = {
        candidateId: candId, candidateKey: candKey,
        employerId: empId, employerKey: empKey,
        headhunterId: hhId, headhunterKey: hhKey,
      };
      return;
    }
    console.warn('Provided env-var accounts are invalid; falling through to register fresh.');
  }

  // Register fresh triple. Counts as 3 of the IP's 5/h budget.
  const ts = Date.now();

  const candRes = await callTool(getTool('auth_register'), {
    user_type: 'candidate',
    name: unique('mcp-test-cand'),
    contact: `mcp-cand-${ts}@test.dev`,
  });
  const cand = JSON.parse(candRes.content[0]!.text);
  if (!cand.ok) throw new Error(`register candidate failed: ${JSON.stringify(cand)}`);

  const empRes = await callTool(getTool('auth_register'), {
    user_type: 'employer',
    name: unique('mcp-test-emp'),
    contact: `mcp-emp-${ts}@test.dev`,
  });
  const emp = JSON.parse(empRes.content[0]!.text);
  if (!emp.ok) throw new Error(`register employer failed: ${JSON.stringify(emp)}`);

  const hhRes = await callTool(getTool('auth_register'), {
    user_type: 'headhunter',
    name: unique('mcp-test-hh'),
    contact: `mcp-hh-${ts}@test.dev`,
  });
  const hh = JSON.parse(hhRes.content[0]!.text);
  if (!hh.ok) throw new Error(`register headhunter failed: ${JSON.stringify(hh)}`);

  ACCOUNTS = {
    candidateId: cand.data.id, candidateKey: cand.data.api_key,
    employerId: emp.data.id, employerKey: emp.data.api_key,
    headhunterId: hh.data.id, headhunterKey: hh.data.api_key,
  };
});

// ----------------------------------------------------------------

describe('auth_register', () => {
  it('returns api_key with hp_live_ prefix', async () => {
    expect(ACCOUNTS.candidateKey).toMatch(/^hp_live_/);
    expect(ACCOUNTS.employerKey).toMatch(/^hp_live_/);
    expect(ACCOUNTS.headhunterKey).toMatch(/^hp_live_/);
  });
});

// ----------------------------------------------------------------

describe('users_get_status', () => {
  it('returns user_type, quota, reputation', async () => {
    const res = await callTool(getTool('users_get_status'), {
      user_id: ACCOUNTS.employerId,
      api_key: ACCOUNTS.employerKey,
    });
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.user_type).toBe('employer');
    expect(parsed.data.quota_per_day).toBe(100);
  });
});

describe('users_get_history', () => {
  it('returns recent actions', async () => {
    const res = await callTool(getTool('users_get_history'), {
      user_id: ACCOUNTS.employerId,
      api_key: ACCOUNTS.employerKey,
      limit: 5,
    });
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.data)).toBe(true);
  });
});

// ----------------------------------------------------------------

describe('headhunter_upload_candidate', () => {
  it('uploads a resume and returns anonymized_id + view_url', async () => {
    const res = await callTool(getTool('headhunter_upload_candidate'), {
      candidate_user_id: ACCOUNTS.candidateId,
      name: '张三',
      phone: '13800138000',
      email: `zhangsan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.dev`,
      current_company: '字节跳动',
      current_title: '高级前端工程师',
      expected_salary: 600000,
      years_experience: 8,
      education_school: '清华大学',
      skills: ['React', 'TypeScript'],
      api_key: ACCOUNTS.headhunterKey,
    });
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.anonymized_id).toMatch(/^ca_/);
    expect(parsed.data.preview.industry).toBe('互联网');
    expect(parsed.data.preview.title_level).toBe('P6');
    expect(parsed.data.view_url).toMatch(/^https:\/\/.+\/view\//);
  });
});

describe('headhunter_list_candidates', () => {
  it('lists my uploaded candidates', async () => {
    const res = await callTool(getTool('headhunter_list_candidates'), {
      api_key: ACCOUNTS.headhunterKey,
    });
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.data)).toBe(true);
  });
});

// ----------------------------------------------------------------

describe('employer_post_job', () => {
  it('creates a JD and returns job_id', async () => {
    const res = await callTool(getTool('employer_post_job'), {
      title: '高级前端',
      description: '8年 React',
      required_skills: ['React'],
      salary_min: 500000, salary_max: 800000,
      api_key: ACCOUNTS.employerKey,
    });
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.id).toMatch(/^job_/);
    expect(parsed.data.status).toBe('open');
  });
});

describe('employer_list_talent', () => {
  it('browses public talent pool', async () => {
    const res = await callTool(getTool('employer_list_talent'), {
      api_key: ACCOUNTS.employerKey,
    });
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.data)).toBe(true);
  });
});

// ----------------------------------------------------------------

describe('4-step unlock flow (end-to-end)', () => {
  it('walks pending → employer_interested → candidate_approved → unlocked', async () => {
    // Step 1: upload candidate (unique email avoids DUPLICATE_REQUEST)
    const upRes = await callTool(getTool('headhunter_upload_candidate'), {
      candidate_user_id: ACCOUNTS.candidateId,
      name: 'X', phone: '1',
      email: `unlock-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.dev`,
      current_company: '字节跳动', current_title: '高级前端',
      expected_salary: 600000, years_experience: 5,
      education_school: '清华', skills: ['React'],
      api_key: ACCOUNTS.headhunterKey,
    });
    const upParsed = JSON.parse(upRes.content[0]!.text);
    expect(upParsed.ok).toBe(true);
    const anonId = upParsed.data.anonymized_id;

    // Step 2: employer posts job (unique title avoids DUPLICATE)
    const jobRes = await callTool(getTool('employer_post_job'), {
      title: `前端-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      description: 'React',
      required_skills: ['React'], salary_min: 500000, salary_max: 800000,
      api_key: ACCOUNTS.employerKey,
    });
    const jobId = JSON.parse(jobRes.content[0]!.text).data.id;

    // Step 3: recommend
    const recRes = await callTool(getTool('headhunter_recommend_candidate'), {
      anonymized_candidate_id: anonId, job_id: jobId,
      api_key: ACCOUNTS.headhunterKey,
    });
    const recId = JSON.parse(recRes.content[0]!.text).data.id;

    // Step 4a: employer express interest
    const exprRes = await callTool(getTool('employer_express_interest'), {
      recommendation_id: recId,
      api_key: ACCOUNTS.employerKey,
    });
    expect(JSON.parse(exprRes.content[0]!.text).data.status).toBe('employer_interested');

    // Step 4b: candidate approve
    const apvRes = await callTool(getTool('candidate_approve_unlock'), {
      recommendation_id: recId,
      api_key: ACCOUNTS.candidateKey,
    });
    expect(JSON.parse(apvRes.content[0]!.text).data.status).toBe('candidate_approved');

    // Step 4c: employer unlock contact
    const unlRes = await callTool(getTool('employer_unlock_contact'), {
      recommendation_id: recId,
      api_key: ACCOUNTS.employerKey,
    });
    const unlParsed = JSON.parse(unlRes.content[0]!.text);
    expect(unlParsed.ok).toBe(true);
    expect(unlParsed.data.status).toBe('unlocked');
    expect(unlParsed.data.contact).toBeUndefined();
    expect(unlParsed.data.phone).toBeUndefined();
  });
});

// ----------------------------------------------------------------

describe('candidate_view_opportunities', () => {
  it('returns a list', async () => {
    const res = await callTool(getTool('candidate_view_opportunities'), {
      api_key: ACCOUNTS.candidateKey,
    });
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.data)).toBe(true);
  });
});

// ----------------------------------------------------------------

describe('error handling', () => {
  it('rejects bad input via zod schema', async () => {
    expect(() => getTool('employer_post_job').schema.parse({
      title: 'J', description: 'D',
      // missing required_skills, salary_min, salary_max
    })).toThrow();
  });

  it('returns HunterApiError when api_key is invalid', async () => {
    const res = await callTool(getTool('users_get_status'), {
      user_id: 'user_does_not_matter',
      api_key: 'hp_live_INVALID_KEY_xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    });
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(['UNAUTHORIZED', 'HTTP_ERROR']).toContain(parsed.error);
  });
});