import { describe, it, expect } from 'vitest';
import { lookupActionType, ACTION_TYPES } from '../../src/main/modules/audit/route-action-map.js';

describe('lookupActionType', () => {
  it('maps POST /v1/auth/register to auth.register', () => {
    expect(lookupActionType('POST', '/v1/auth/register')).toBe('auth.register');
  });

  it('maps POST /v1/auth/rotate-key to auth.rotate_key', () => {
    expect(lookupActionType('POST', '/v1/auth/rotate-key')).toBe('auth.rotate_key');
  });

  it('maps POST /v1/headhunter/candidates to headhunter.upload_candidate', () => {
    expect(lookupActionType('POST', '/v1/headhunter/candidates')).toBe('headhunter.upload_candidate');
  });

  it('maps POST /v1/headhunter/recommendations/:id/withdraw to headhunter.withdraw_recommendation', () => {
    // new spec: withdraw uses POST, not DELETE
    expect(lookupActionType('POST', '/v1/headhunter/recommendations/rec_abc123/withdraw')).toBe('headhunter.withdraw_recommendation');
  });

  it('maps POST /v1/headhunter/candidates/:id/publish-to-pool to headhunter.publish_to_pool', () => {
    // new spec: canonical endpoint uses full suffix (also accepts /publish as alias)
    expect(lookupActionType('POST', '/v1/headhunter/candidates/ca_xyz/publish-to-pool')).toBe('headhunter.publish_to_pool');
    expect(lookupActionType('POST', '/v1/headhunter/candidates/ca_xyz/publish')).toBe('headhunter.publish_to_pool');
  });

  it('maps POST /v1/employer/recommendations/:id/express-interest to employer.express_interest', () => {
    // new spec: full suffix is express-interest, not /interest
    expect(lookupActionType('POST', '/v1/employer/recommendations/rec_1/express-interest')).toBe('employer.express_interest');
  });

  it('maps POST /v1/employer/recommendations/:id/unlock-contact to employer.unlock_contact', () => {
    // new spec: full suffix is unlock-contact, not /unlock
    expect(lookupActionType('POST', '/v1/employer/recommendations/rec_1/unlock-contact')).toBe('employer.unlock_contact');
  });

  it('maps GET /v1/employer/talent to employer.talent', () => {
    expect(lookupActionType('GET', '/v1/employer/talent')).toBe('employer.talent');
  });

  it('maps GET /v1/candidate/export-my-data to candidate.export_my_data', () => {
    // new spec: hyphenated endpoint name
    expect(lookupActionType('GET', '/v1/candidate/export-my-data')).toBe('candidate.export_my_data');
  });

  it('maps POST /v1/candidate/delete-my-data to candidate.delete_my_data', () => {
    expect(lookupActionType('POST', '/v1/candidate/delete-my-data')).toBe('candidate.delete_my_data');
  });

  it('maps GET /v1/users/:id/history to users.get_history', () => {
    expect(lookupActionType('GET', '/v1/users/u_abc/history')).toBe('users.get_history');
  });

  it('maps GET /v1/candidate/access-log to candidate.access_log', () => {
    expect(lookupActionType('GET', '/v1/candidate/access-log')).toBe('candidate.access_log');
  });

  it('returns unknown_<METHOD>_<last_resource> for unmatched routes (uses last resource segment, not full path)', () => {
    // new fallback format: just the last non-param, non-version segment
    // /v1/foo/bar/baz → last segment is "baz", so "unknown_get_baz"
    const r = lookupActionType('GET', '/v1/foo/bar/baz');
    expect(r).toBe('unknown_get_baz');
    expect(r).not.toContain('foo');
    expect(r).not.toContain('bar');
  });

  it('skips v-prefixed numeric segments in fallback', () => {
    // /v1/foobar/strange-thing → "strange-thing" (not "v1" or "foobar")
    const r = lookupActionType('GET', '/v1/foobar/strange-thing');
    expect(r).toBe('unknown_get_strange-thing');
  });

  it('exposes ACTION_TYPES as the canonical enum (capability names)', () => {
    expect(ACTION_TYPES).toContain('auth.register');
    expect(ACTION_TYPES).toContain('auth.rotate_key');
    expect(ACTION_TYPES).toContain('headhunter.upload_candidate');
    expect(ACTION_TYPES).toContain('headhunter.withdraw_recommendation');
    expect(ACTION_TYPES).toContain('employer.express_interest');
    expect(ACTION_TYPES).toContain('employer.unlock_contact');
    expect(ACTION_TYPES).toContain('employer.talent');
    expect(ACTION_TYPES).toContain('candidate.export_my_data');
    expect(ACTION_TYPES).toContain('candidate.delete_my_data');
    expect(ACTION_TYPES).toContain('users.get_status');
    expect(ACTION_TYPES).toContain('users.get_history');
    expect(ACTION_TYPES).toContain('candidate.access_log');
  });
});