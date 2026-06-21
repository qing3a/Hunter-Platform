// src/main/flows/job.ts
import type { JobStatus } from '../../shared/types.js';
import { defineFlow, type Flow, type SideEffect } from './types.js';

/**
 * Job posting state machine.
 *
 * Bug 2/3 fix preserved: claim flips status open → claimed. Reject only
 * works from open (not from claimed) — once an employer claims a job,
 * they must explicitly close/cancel it, not reject it. This rule is
 * enforced by the flow: rejected transition exists only on `open` and
 * `paused`, not on `claimed`.
 *
 * Recommend (from headhunter/handler.ts) is NOT a job state transition —
 * the recommendation has its own status. The job.status stays the same
 * when a recommendation is created. The state machine only governs
 * employer-side status changes.
 */

export type JobEvent =
  | 'claim'    // open → claimed
  | 'reject'   // open → closed (only from open; claimed employers must close explicitly)
  | 'pause'    // open | claimed → paused
  | 'resume'   // paused → open
  | 'close'    // open | claimed | paused → closed
  | 'fill';    // claimed → filled (when a placement is created)

export const JOB_TERMINAL_STATUSES = new Set<JobStatus>(['closed', 'filled']);

export const jobFlow: Flow<JobStatus, JobEvent> = defineFlow({
  initial: 'open',
  states: {
    open: {
      claim: 'claimed',
      reject: 'closed',
      pause: 'paused',
      close: 'closed',
    },
    claimed: {
      pause: 'paused',
      close: 'closed',
      fill: 'filled',
    },
    paused: {
      resume: 'open',
      close: 'closed',
    },
    filled: {},   // terminal
    closed: {},   // terminal
  },
});