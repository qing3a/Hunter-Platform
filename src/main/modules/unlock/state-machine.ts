import type { RecStatus } from '../../../shared/types.js';

// Spec §7.1 + §7.2: 状态机转换表
const TRANSITIONS: Record<RecStatus, RecStatus[]> = {
  pending:              ['employer_interested', 'rejected_employer', 'withdrawn'],
  employer_interested:  ['candidate_approved', 'rejected_candidate', 'rejected_employer'],
  candidate_approved:   ['unlocked', 'rejected_candidate'],
  unlocked:             ['placed'],
  rejected_employer:    [],
  rejected_candidate:   [],
  withdrawn:            [],
  placed:               [],
};

export const TERMINAL_STATUSES = new Set<RecStatus>([
  'rejected_employer', 'rejected_candidate', 'withdrawn', 'placed',
]);

export function canTransition(from: RecStatus, to: RecStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: RecStatus, to: RecStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid state transition: ${from} -> ${to}`);
  }
}
