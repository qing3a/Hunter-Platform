import { describe, it, expect } from 'vitest';
import { lookupActionType, ACTION_TYPES } from '../../src/main/modules/audit/route-action-map.js';

describe('lookupActionType', () => {
  it('maps POST /v1/auth/register to register', () => {
    expect(lookupActionType('POST', '/v1/auth/register')).toBe('register');
  });

  it('maps POST /v1/auth/rotate-key to rotate_api_key', () => {
    expect(lookupActionType('POST', '/v1/auth/rotate-key')).toBe('rotate_api_key');
  });

  it('maps POST /v1/headhunter/candidates to upload_candidate', () => {
    expect(lookupActionType('POST', '/v1/headhunter/candidates')).toBe('upload_candidate');
  });

  it('maps POST /v1/headhunter/recommendations/:id/withdraw to withdraw_recommendation', () => {
    // new spec: withdraw uses POST, not DELETE
    expect(lookupActionType('POST', '/v1/headhunter/recommendations/rec_abc123/withdraw')).toBe('withdraw_recommendation');
  });

  it('maps POST /v1/headhunter/candidates/:id/publish-to-pool to publish_to_pool', () => {
    // new spec: canonical endpoint uses full suffix (also accepts /publish as alias)
    expect(lookupActionType('POST', '/v1/headhunter/candidates/ca_xyz/publish-to-pool')).toBe('publish_to_pool');
    expect(lookupActionType('POST', '/v1/headhunter/candidates/ca_xyz/publish')).toBe('publish_to_pool');
  });

  it('maps POST /v1/employer/recommendations/:id/express-interest to express_interest', () => {
    // new spec: full suffix is express-interest, not /interest
    expect(lookupActionType('POST', '/v1/employer/recommendations/rec_1/express-interest')).toBe('express_interest');
  });

  it('maps POST /v1/employer/recommendations/:id/unlock-contact to unlock_contact', () => {
    // new spec: full suffix is unlock-contact, not /unlock
    expect(lookupActionType('POST', '/v1/employer/recommendations/rec_1/unlock-contact')).toBe('unlock_contact');
  });

  it('maps GET /v1/employer/talent to browse_talent', () => {
    expect(lookupActionType('GET', '/v1/employer/talent')).toBe('browse_talent');
  });

  it('maps GET /v1/candidate/export-my-data to export_my_data', () => {
    // new spec: hyphenated endpoint name
    expect(lookupActionType('GET', '/v1/candidate/export-my-data')).toBe('export_my_data');
  });

  it('maps POST /v1/candidate/delete-my-data to delete_my_data', () => {
    expect(lookupActionType('POST', '/v1/candidate/delete-my-data')).toBe('delete_my_data');
  });

  it('maps GET /v1/users/:id/history to get_user_history', () => {
    expect(lookupActionType('GET', '/v1/users/u_abc/history')).toBe('get_user_history');
  });

  it('maps GET /v1/candidate/access-log to view_access_log', () => {
    expect(lookupActionType('GET', '/v1/candidate/access-log')).toBe('view_access_log');
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

  it('exposes ACTION_TYPES as the canonical enum', () => {
    expect(ACTION_TYPES).toContain('register');
    expect(ACTION_TYPES).toContain('rotate_api_key');
    expect(ACTION_TYPES).toContain('upload_candidate');
    expect(ACTION_TYPES).toContain('withdraw_recommendation');
    expect(ACTION_TYPES).toContain('express_interest');
    expect(ACTION_TYPES).toContain('unlock_contact');
    expect(ACTION_TYPES).toContain('browse_talent');
    expect(ACTION_TYPES).toContain('export_my_data');
    expect(ACTION_TYPES).toContain('delete_my_data');
    expect(ACTION_TYPES).toContain('get_user_status');
    expect(ACTION_TYPES).toContain('get_user_history');
    expect(ACTION_TYPES).toContain('view_access_log');
  });
});