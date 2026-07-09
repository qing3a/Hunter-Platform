// src/main/modules/headhunter/stats.ts
//
// Hunter Workspace (Phase 3a, Task 5) — personal stats handler.
//
// Authorization model:
//   - All methods require user_type === 'headhunter'. Non-headhunters
//     get FORBIDDEN. Centralized via `assertHeadhunter(user)`, identical
//     to the other hunter-portal modules (tasks.ts, kanban.ts).
//   - overview and funnel are pass-throughs to the repo, scoped by
//     `user.id` — there is no second ownership check, because the
//     stats are inherently "about the caller" (the headhunter's own
//     metrics).
//
// HTTP routing for this module is wired in Task 7. The handler is
// invoked directly by the router (and by integration tests in this
// phase).

import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import {
  createHunterStatsRepo,
  type DateRange,
  type FunnelStageCount,
  type HunterOverview,
} from '../../db/repositories/hunter-stats.js';
import { Errors } from '../../errors.js';

export interface HunterStatsModule {
  overview(user: User): HunterOverview;
  funnel(user: User, range?: DateRange): FunnelStageCount[];
}

export function createHunterStats(db: DB): HunterStatsModule {
  const repo = createHunterStatsRepo(db);

  /** Throw unless the caller is a headhunter. */
  function assertHeadhunter(user: User): void {
    if (user.user_type !== 'headhunter') {
      throw Errors.forbidden('Only headhunters can view their stats');
    }
  }

  return {
    /**
     * Return the caller's overview KPIs (5 metrics, lifetime). Throws
     * FORBIDDEN for non-headhunters. No input — the dashboard always
     * surfaces lifetime numbers per the task spec.
     */
    overview(user: User): HunterOverview {
      assertHeadhunter(user);
      return repo.getOverview(user.id);
    },

    /**
     * Return the caller's funnel breakdown (5 stages, conversion
     * ratios). When `range` is provided, the count is restricted to
     * recs whose `created_at` falls in [from, to] (unix ms). The
     * array is always 5 rows in submitted → onboarded order.
     */
    funnel(user: User, range?: DateRange): FunnelStageCount[] {
      assertHeadhunter(user);
      return repo.getFunnel(user.id, range);
    },
  };
}
