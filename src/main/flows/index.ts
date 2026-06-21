// src/main/flows/index.ts
/**
 * Aggregator + convenience re-exports.
 *
 * Handlers should import from '../flows/index.js' (or '../flows') — never
 * directly from a specific flow file — so that the imports match the
 * structure of the Flow abstraction.
 */
export {
  recFlow, REC_SIDE_EFFECTS, REC_TERMINAL_STATUSES,
} from './recommendation.js';
export type { RecEvent } from './recommendation.js';

export {
  jobFlow, JOB_TERMINAL_STATUSES,
} from './job.js';
export type { JobEvent } from './job.js';

export {
  userFlow, USER_TERMINAL_STATUSES,
} from './user.js';
export type { UserEvent } from './user.js';

export {
  defineFlow, assertCanTransition, applyTransition, TransitionError,
} from './types.js';
export type { Flow, SideEffect, TransitionContext, TransitionResult } from './types.js';