// src/main/modules/candidate-portal/applications.ts
//
// Candidate Portal: apply / list / detail / respond (withdraw, consider,
// accept, decline) handler.
//
// Public-facing methods called from the router layer (Task 12). The handler
// enforces authz (candidate only) and orchestrates a transaction across the
// recommendations + candidate_applications tables. Notifications fire to
// every active headhunter when a new self-apply lands in the pickup queue.
//
// State machine integration:
//   - apply()     creates a recommendations row in 'pending_pickup' and a
//                 candidate_applications row that references it.
//   - respond()   reads the current rec status and runs the next event
//                 through applyTransition() so the legal/illegal guards
//                 are owned by recFlow, not duplicated here.
//
// Side effects (notifications) are fire-and-forget per spec; we do not block
// the response on them. Each notification has a dedup_key so a retried POST
// doesn't spam hunters.

import { randomUUID } from 'node:crypto';
import type { DB } from '../../db/connection.js';
import type { Recommendation, RecStatus, User } from '../../../shared/types.js';
import {
  createCandidateApplicationsRepo,
  type ApplicationListItem,
  type ApplicationRow,
} from '../../db/repositories/candidate-applications.js';
import { createRecommendationsRepo } from '../../db/repositories/recommendations.js';
import { createCandidatePortalProfileRepo } from '../../db/repositories/candidate-portal-profile.js';
import { createNotificationsRepo } from '../../db/repositories/notifications.js';
import { applyTransition, recFlow, TransitionError } from '../../flows/index.js';
import { Errors } from '../../errors.js';

export interface ApplyInput {
  note?: string;
}

export interface ApplyResult {
  application_id: number;
  recommendation_id: string;
  status: RecStatus;
}

export interface ListQuery {
  limit?: number;
  offset?: number;
}

export type RespondAction = 'withdraw' | 'consider_offer' | 'accept_offer' | 'decline_offer';

export interface ApplicationsModule {
  apply(user: User, jobId: string, input: ApplyInput): ApplyResult;
  list(user: User, opts?: ListQuery): ApplicationListItem[];
  detail(user: User, applicationId: number): ApplicationRow;
  respond(user: User, applicationId: number, action: RespondAction): { status: RecStatus };
}

/** Limit clamp for paginated list endpoints. */
const LIST_LIMIT_MAX = 50;
const LIST_LIMIT_DEFAULT = 20;

export function createCandidatePortalApplications(db: DB): ApplicationsModule {
  const apps = createCandidateApplicationsRepo(db);
  const recs = createRecommendationsRepo(db);
  const profiles = createCandidatePortalProfileRepo(db);
  const notif = createNotificationsRepo(db);

  /** Look up active headhunters (excludes suspended / deleted). */
  const listActiveHuntersStmt = db.prepare(
    "SELECT id FROM users WHERE user_type = 'headhunter' AND status = 'active'",
  );

  /**
   * Notify all active headhunters about a new self-apply.
   * dedup_key is `apply:<recommendationId>:<hunterId>` so a retried POST
   * (e.g. after a network blip) will update the existing notification
   * instead of creating duplicates.
   */
  function notifyHunters(recommendationId: string, candidateName: string | null, jobTitle: string): void {
    const hunters = listActiveHuntersStmt.all() as { id: string }[];
    for (const h of hunters) {
      notif.insert({
        user_id: h.id,
        category: 'candidate_pending_pickup',
        title: '新候选人待认领',
        body: `候选人 ${candidateName ?? '(匿名)'} 申请了工作 ${jobTitle}`,
        dedup_key: `apply:${recommendationId}:${h.id}`,
      });
    }
  }

  return {
    /**
     * Apply to a job. Atomic transaction: create recommendation row
     * (status=pending_pickup) + candidate_applications row + notify hunters.
     * Refuses duplicate active applications against the same job.
     */
    apply(user: User, jobId: string, input: ApplyInput): ApplyResult {
      if (user.user_type !== 'candidate') {
        throw Errors.forbidden('Only candidates can apply to jobs');
      }
      if (!jobId || typeof jobId !== 'string') {
        throw Errors.invalidParams('job_id is required');
      }

      // 1. Job must exist and be open.
      const job = db
        .prepare('SELECT id, title, employer_id, status FROM jobs WHERE id = ?')
        .get(jobId) as
        | { id: string; title: string; employer_id: string | null; status: string }
        | undefined;
      if (!job) throw Errors.notFound('Job not found');
      if (job.status !== 'open') {
        throw Errors.invalidParams('JOB_NOT_OPEN: Job is not open for applications');
      }
      // recommendations.employer_id is NOT NULL with FK to users. If the job
      // was created by a headhunter (employer_id IS NULL — allowed by v009),
      // we can't synthesize a sensible employer. Refuse to apply in that case.
      if (!job.employer_id) {
        throw Errors.invalidParams(
          'JOB_HAS_NO_EMPLOYER: This job was created by a headhunter and is not directly applicable',
        );
      }

      // 2. Candidate must have an onboarding-complete profile.
      const profile = profiles.getProfile(user.id);
      if (!profile) {
        throw Errors.notFound('Profile not found — complete onboarding before applying');
      }

      // 3. No duplicate active application.
      const existing = recs.findActiveByCandidateAndJob(user.id, jobId);
      if (existing) {
        throw Errors.invalidState('ALREADY_APPLIED: You have an active application for this job');
      }

      // 4. Atomic insert: recommendation + candidate_application.
      const recommendationId = `rec_${randomUUID().slice(0, 12)}`;
      const now = new Date().toISOString();
      const note = input.note?.trim() || null;

      db.exec('BEGIN');
      try {
        const rec: Recommendation & {
          source_type: string;
          candidate_note: string | null;
        } = {
          id: recommendationId,
          headhunter_id: null,                 // nullable since v026
          employer_id: job.employer_id as string,  // verified non-null above
          anonymized_candidate_id: profile.id,
          job_id: jobId,
          status: 'pending_pickup',
          commission_split_json: null,
          referrer_headhunter_id: null,
          source_type: 'candidate_self_apply',
          candidate_note: note,
          created_at: now,
          updated_at: now,
        };
        recs.insert(rec);

        const applicationId = apps.insert({
          recommendation_id: recommendationId,
          candidate_user_id: user.id,
          job_id: jobId,
          candidate_note: note,
        });

        db.exec('COMMIT');

        // 5. Notify all active hunters (best-effort, outside the transaction).
        try {
          notifyHunters(recommendationId, profile.pii.name, job.title);
        } catch {
          // Notification failures are non-fatal — the application is recorded.
        }

        return { application_id: applicationId, recommendation_id: recommendationId, status: 'pending_pickup' };
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* ignore */ }
        throw e;
      }
    },

    /**
     * List the candidate's own applications, newest first.
     * Default limit 20, max 50.
     */
    list(user: User, opts: ListQuery = {}): ApplicationListItem[] {
      if (user.user_type !== 'candidate') {
        throw Errors.forbidden('Only candidates can list their applications');
      }
      const limit = Math.min(Math.max(opts.limit ?? LIST_LIMIT_DEFAULT, 1), LIST_LIMIT_MAX);
      const offset = Math.max(opts.offset ?? 0, 0);
      return apps.listByCandidate(user.id, limit, offset);
    },

    /**
     * Fetch a single application. 403 when the caller is not the owner.
     */
    detail(user: User, applicationId: number): ApplicationRow {
      if (user.user_type !== 'candidate') {
        throw Errors.forbidden('Only candidates can view application detail');
      }
      if (!Number.isInteger(applicationId) || applicationId <= 0) {
        throw Errors.invalidParams('application_id must be a positive integer');
      }
      const app = apps.findById(applicationId);
      if (!app) throw Errors.notFound('Application not found');
      if (app.candidate_user_id !== user.id) {
        throw Errors.forbidden('APPLICATION_NOT_OWNED: This is not your application');
      }
      return app;
    },

    /**
     * State machine transition on the candidate's behalf. The current
     * rec.status determines what's legal — applyTransition() enforces it
     * and the handler maps our action string to the right recFlow event.
     */
    respond(user: User, applicationId: number, action: RespondAction): { status: RecStatus } {
      if (user.user_type !== 'candidate') {
        throw Errors.forbidden('Only candidates can respond to applications');
      }
      if (!Number.isInteger(applicationId) || applicationId <= 0) {
        throw Errors.invalidParams('application_id must be a positive integer');
      }
      const app = apps.findById(applicationId);
      if (!app) throw Errors.notFound('Application not found');
      if (app.candidate_user_id !== user.id) {
        throw Errors.forbidden('APPLICATION_NOT_OWNED: This is not your application');
      }
      const rec = recs.findById(app.recommendation_id);
      if (!rec) {
        throw Errors.notFound('Application record is inconsistent (recommendation missing)');
      }

      // Map our public action to a recFlow event. Different starting
      // statuses need different events.
      let event: string;
      switch (action) {
        case 'withdraw':
          event = 'withdraw';
          break;
        case 'consider_offer':
          event = 'consider_offer';
          break;
        case 'accept_offer':
          event = 'accept_offer';
          break;
        case 'decline_offer':
          event = 'decline_offer';
          break;
        default:
          throw Errors.invalidParams(`Unknown action: ${String(action)}`);
      }

      // applyTransition throws TransitionError on illegal transitions. The
      // router layer maps that to 409 INVALID_STATE so the client gets a
      // precise error code.
      let result;
      try {
        result = applyTransition(recFlow, rec.status, event as any, {
          candidate_user_id: user.id,
          employer_id: rec.employer_id,
          recommendation_id: rec.id,
        });
      } catch (e) {
        if (e instanceof TransitionError) {
          throw Errors.invalidState(
            `APPLICATION_INVALID_STATE: cannot '${action}' from status '${rec.status}'`,
          );
        }
        throw e;
      }

      db.exec('BEGIN');
      try {
        recs.updateStatus(app.recommendation_id, result.next);
        if (action === 'withdraw') {
          apps.withdraw(applicationId, Date.now());
        }
        db.exec('COMMIT');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* ignore */ }
        throw e;
      }

      return { status: result.next };
    },
  };
}
