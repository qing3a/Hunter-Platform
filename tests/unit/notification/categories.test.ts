import { describe, it, expect } from 'vitest';
import { NOTIFICATION_CATEGORIES, isValidCategory } from '../../../src/main/modules/notification/categories';

describe('notification categories', () => {
  it('exposes 6 MVP categories', () => {
    expect(NOTIFICATION_CATEGORIES).toEqual([
      'recommendation_accepted',
      'recommendation_rejected',
      'unlock_granted',
      'candidate_viewed',
      'placement_confirmed',
      'commission_paid',
    ]);
  });

  it('isValidCategory returns true for known categories', () => {
    expect(isValidCategory('unlock_granted')).toBe(true);
  });

  it('isValidCategory returns false for unknown', () => {
    expect(isValidCategory('foo')).toBe(false);
    expect(isValidCategory('')).toBe(false);
  });
});
