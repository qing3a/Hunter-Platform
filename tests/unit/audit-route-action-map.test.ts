import { describe, it, expect } from 'vitest';
import { lookupActionType } from '../../src/main/modules/audit/route-action-map.js';

describe('lookupActionType', () => {
  it('maps POST /v1/auth/register to register', () => {
    expect(lookupActionType('POST', '/v1/auth/register')).toBe('register');
  });

  it('maps POST /v1/headhunter/candidates to upload_candidate', () => {
    expect(lookupActionType('POST', '/v1/headhunter/candidates')).toBe('upload_candidate');
  });

  it('maps DELETE /v1/headhunter/recommendations/:id to withdraw_recommendation', () => {
    expect(lookupActionType('DELETE', '/v1/headhunter/recommendations/rec_abc123')).toBe('withdraw_recommendation');
  });

  it('maps POST /v1/headhunter/candidates/:id/publish to publish_to_pool', () => {
    expect(lookupActionType('POST', '/v1/headhunter/candidates/ca_xyz/publish')).toBe('publish_to_pool');
  });

  it('maps POST /v1/employer/recommendations/:id/interest to express_interest', () => {
    expect(lookupActionType('POST', '/v1/employer/recommendations/rec_1/interest')).toBe('express_interest');
  });

  it('maps POST /v1/employer/recommendations/:id/unlock to unlock_contact', () => {
    expect(lookupActionType('POST', '/v1/employer/recommendations/rec_1/unlock')).toBe('unlock_contact');
  });

  it('maps GET /v1/employer/talent to browse_talent', () => {
    expect(lookupActionType('GET', '/v1/employer/talent')).toBe('browse_talent');
  });

  it('maps POST /v1/candidate/export to export_data', () => {
    expect(lookupActionType('POST', '/v1/candidate/export')).toBe('export_data');
  });

  it('returns unknown_<METHOD>_<normalized_path> for unmatched routes', () => {
    const r = lookupActionType('GET', '/v1/foo/bar/baz');
    expect(r).toMatch(/^unknown_get/);
    expect(r).toContain('foo_bar_baz');
  });
});