// src/main/modules/candidate-portal/headhunter-pickup.ts
//
// Candidate Portal Phase 1 — headhunter pickup endpoints.
//
// Public-facing methods called from the router layer (Task 12 / Task 9):
//   - listPendingPickup: read the pickup queue (open self-applies that no
//     headhunter has claimed yet). Filtered via
//     candidate_applications.listPendingPickup() (joins on rec.status =
//     'pending_pickup' AND app.pickup_headhunter_id IS NULL).
//   - pickup: claim a self-applied recommendation. Atomic transaction:
//       1. Verify caller is a headhunter
//       2. Verify the recommendation is still in 'pending_pickup'
//       3. Run the recFlow transition 'pending_pickup' + 'pickup' so the
//          state machine owns the legality guard (and the side-effect
//          descriptor for downstream webhook handlers)
//       4. Set the recommendation's pickup_headhunter_id and flip status
//          to 'pending' (the normal post-pickup state)
//       5. Set the candidate_applications.pickup_headhunter_id
//       6. COMMIT, then notify the candidate (best-effort)
//
// Errors:
//   - non-headhunter caller    → 403 FORBIDDEN
//   - rec not found           → 404 NOT_FOUND
//   - rec not pending_pickup  → 409 INVALID_STATE
//   - state machine illegal   → 409 INVALID_STATE (TransitionError mapped)
//   - app row missing         → 404 NOT_FOUND (data inconsistency)
//
// Why we re-route the side-effect via the state machine: the candidate
// portal applications module already uses the same pattern (see
// `src/main/modules/candidate-portal/applications.ts` → `respond()`) and
// the recFlow declares a `pending_pickup->pending` side-effect of kind
// 'webhook' for the `application_picked_up` event. Keeping the side-effect
// declarations in the flow file means a future state machine audit can
// trust that every legal transition declares its side effect in one place.

import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import {
  createCandidateApplicationsRepo,
  type PendingPickupItem,
} from '../../db/repositories/candidate-applications.js';
import { createRecommendationsRepo } from '../../db/repositories/recommendations.js';
import { createNotificationsRepo } from '../../db/repositories/notifications.js';
import { applyTransition, recFlow, TransitionError } from '../../flows/index.js';
import { Errors } from '../../errors.js';

/** Max page size for the pickup queue. Defends against unbounded reads. */
const LIST_LIMIT_MAX = 50;
const LIST_LIMIT_DEFAULT = 20;

export interface ListPendingPickupQuery {
  limit?: number;
  offset?: number;
}

export interface ListPendingPickupResult {
  items: PendingPickupItem[];
  next_cursor: null;
}

export interface PickupResult {
  recommendation_id: string;
  status: 'pending';
}

export interface HeadhunterPickupModule {
  listPendingPickup(user: User, opts?: ListPendingPickupQuery): ListPendingPickupResult;
  pickup(user: User, recommendationId: string): PickupResult;
}

export function createHeadhunterPickup(db: DB): HeadhunterPickupModule {
  const apps = createCandidateApplicationsRepo(db);
  const recs = createRecommendationsRepo(db);
  const notif = createNotificationsRepo(db);

  return {
    /**
     * Return the pickup queue. The list is filtered by the DB JOIN
     * `r.status = 'pending_pickup' AND ca.pickup_headhunter_id IS NULL`,
     * so a row that has already been picked up is excluded in the same
     * request (no client-side filtering needed).
     */
    listPendingPickup(_user: User, opts: ListPendingPickupQuery = {}): ListPendingPickupResult {
      const limit = Math.min(Math.max(opts.limit ?? LIST_LIMIT_DEFAULT, 1), LIST_LIMIT_MAX);
      const offset = Math.max(opts.offset ?? 0, 0);
      return { items: apps.listPendingPickup(limit, offset), next_cursor: null };
    },

    /**
     * Claim a self-applied recommendation. Throws 403/404/409 on the
     * documented error paths; the transaction is rolled back on any
     * failure so a partial write (status updated but pickup_headhunter
     * not set) cannot leak.
     */
    pickup(user: User, recommendationId: string): PickupResult {
      if (user.user_type !== 'headhunter') {
        throw Errors.forbidden('Only headhunters can pick up applications');
      }
      if (!recommendationId || typeof recommendationId !== 'string') {
        throw Errors.invalidParams('recommendation_id is required');
      }

      const rec = recs.findById(recommendationId);
      if (!rec) throw Errors.notFound('Recommendation not found');
      if (rec.status !== 'pending_pickup') {
        throw Errors.invalidState(
          'ALREADY_PICKED_UP: Application is no longer awaiting pickup',
        );
      }

      const app = apps.findByRecommendation(recommendationId);
      if (!app) throw Errors.notFound('Application not found');

      // Run the state machine first so an illegal transition (which would
      // be a programmer error since we just checked status === 'pending_pickup')
      // is mapped to 409 INVALID_STATE before we open the transaction.
      try {
        applyTransition(recFlow, 'pending_pickup', 'pickup', {
          candidate_user_id: app.candidate_user_id,
          employer_id: rec.employer_id,
          recommendation_id: rec.id,
        });
      } catch (e) {
        if (e instanceof TransitionError) {
          throw Errors.invalidState(
            `PICKUP_INVALID_STATE: cannot 'pickup' from status '${rec.status}'`,
          );
        }
        throw e;
      }

      db.exec('BEGIN');
      try {
        recs.setPickupHeadhunter(recommendationId, user.id);
        recs.updateStatus(recommendationId, 'pending');
        apps.setPickup(app.id, user.id);
        db.exec('COMMIT');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* ignore rollback errors */ }
        throw e;
      }

      // Best-effort notification — failures here are non-fatal (the
      // pickup is already recorded). Mirrors the apply() pattern.
      try {
        notif.insert({
          user_id: app.candidate_user_id,
          category: 'application_picked_up',
          title: '您的申请已被认领',
          body: '猎头已认领您的申请, 将进入下一步流程',
          dedup_key: `pickup:${recommendationId}`,
        });
      } catch {
        // Notification failure is non-fatal — the pickup is recorded.
      }

      return { recommendation_id: recommendationId, status: 'pending' };
    },
  };
}
