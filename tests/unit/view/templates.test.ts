import { describe, it, expect } from 'vitest';
import { renderCandidate } from '../../../src/main/modules/view/templates/candidate';
import { renderRecommendation } from '../../../src/main/modules/view/templates/recommendation';
import { renderUserQuota } from '../../../src/main/modules/view/templates/user-quota';
import { renderAudit } from '../../../src/main/modules/view/templates/audit';

describe('templates — render & escape', () => {
  it('candidate renders <html> and includes all data fields', () => {
    const html = renderCandidate({
      anonymizedId: 'cand_abc',
      industry: '互联网',
      titleLevel: 'P6',
      salaryRange: '60-80万',
      educationTier: '985',
      yearsExperience: 8,
      skills: ['React', 'TypeScript', '<script>alert(1)</script>'],
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('cand_abc');
    expect(html).toContain('互联网');
    expect(html).toContain('&lt;script&gt;'); // XSS escape applied
    expect(html).not.toContain('<script>alert(1)</script>'); // raw not present
  });

  it('recommendation timeline shows current step as "current"', () => {
    const html = renderRecommendation({
      recommendationId: 'rec_1',
      candidateAnonymizedId: 'cand_1',
      jobTitle: '高级前端',
      status: 'candidate_approved',
      createdAt: '2026-06-18T10:00:00Z',
      updatedAt: '2026-06-18T11:00:00Z',
    });
    expect(html).toMatch(/class="timeline-item[^"]*current"/);
  });

  it('user-quota renders quota table and recent actions', () => {
    const html = renderUserQuota({
      userId: 'u_1',
      userType: 'headhunter',
      name: 'Test',
      quotaPerDay: 200,
      quotaUsed: 50,
      quotaResetAt: '2026-06-19T00:00:00Z',
      rateLimits: [{ window: '1s', limit: 20, used: 0 }],
      recentActions: [{ at: '2026-06-18T10:00:00Z', action_type: 'upload_candidate', status: 'ok' }],
    });
    expect(html).toContain('200');
    expect(html).toContain('50');
    expect(html).toContain('upload_candidate');
  });

  it('audit renders rows in reverse-chronological expected order', () => {
    const html = renderAudit({
      userId: 'u_1',
      entries: [
        { at: '2026-06-18T10:00:00Z', action_type: 'login', method: 'GET', path: '/v1/users/u_1/status', status_code: 200, error_code: null, duration_ms: 12 },
        { at: '2026-06-18T11:00:00Z', action_type: 'upload', method: 'POST', path: '/v1/headhunter/candidates', status_code: 201, error_code: null, duration_ms: 45 },
      ],
    });
    expect(html).toContain('u_1');
    expect(html).toContain('login');
    expect(html).toContain('upload');
  });
});