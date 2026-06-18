import { describe, it, expect } from 'vitest';
import { ROUTE_VIEW_MAP } from '../../../src/main/modules/view/route-view-map';

describe('route-view-map config', () => {
  it('contains all 8 expected mappings', () => {
    expect(Object.keys(ROUTE_VIEW_MAP).sort()).toEqual([
      'GET /v1/users/{id}/history',
      'GET /v1/users/{id}/status',
      'POST /v1/candidate/recommendations/{id}/approve-unlock',
      'POST /v1/candidate/recommendations/{id}/reject-unlock',
      'POST /v1/employer/recommendations/{id}/express-interest',
      'POST /v1/employer/recommendations/{id}/unlock-contact',
      'POST /v1/headhunter/candidates',
      'POST /v1/headhunter/recommendations',
    ]);
  });

  it('every mapping has a non-empty idFrom', () => {
    for (const [route, m] of Object.entries(ROUTE_VIEW_MAP)) {
      expect(m.idFrom.length, `route ${route}`).toBeGreaterThan(0);
      expect(['candidate', 'recommendation', 'user-quota', 'audit']).toContain(m.type);
    }
  });

  it('view types map to existing template handlers (no typos)', () => {
    // Sanity: types are limited to the 4 we implemented
    const types = new Set(Object.values(ROUTE_VIEW_MAP).map((m) => m.type));
    expect([...types].sort()).toEqual(['audit', 'candidate', 'recommendation', 'user-quota']);
  });
});