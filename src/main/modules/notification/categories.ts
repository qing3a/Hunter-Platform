/**
 * Notification categories — the "what happened" enum.
 * Adding a new category: just add an entry here + add a `trigger.notify()`
 * call at the corresponding business handler.
 */
export const NOTIFICATION_CATEGORIES = [
  'recommendation_accepted',
  'recommendation_rejected',
  'unlock_granted',
  'candidate_viewed',
  'placement_confirmed',
  'commission_paid',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Sanity check at module load time: every category in this file should
 *  appear in the union. (TypeScript will catch a missing one at compile
 *  time, this is just a runtime sanity belt for dynamic lookups.) */
export function isValidCategory(s: string): s is NotificationCategory {
  return (NOTIFICATION_CATEGORIES as readonly string[]).includes(s);
}
