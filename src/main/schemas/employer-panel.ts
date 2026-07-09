// src/main/schemas/employer-panel.ts
//
// Employer Panel (Phase 3c, Task 3) — Zod request/response shapes for
// /v1/employer-panel/*.
//
// This file declares wire shapes only. Routing is wired in
// src/main/routes/employer-panel.ts and the underlying handler lives in
// src/main/modules/employer/dashboard.ts.
//
// Conventions match src/main/schemas/headhunter-workspace.ts and
// src/main/schemas/pm.ts:
//   - All envelopes are .strict() — unknown keys cause a 400/parse failure.
//   - Counter fields are non-negative integers (no float drift).
//   - No request body for GET — only the response envelope is declared.

import { z } from 'zod';

// ===== Dashboard =====

/**
 * Single dashboard payload — the seven counters surfaced on the SPA home.
 *
 * active_jobs                 — jobs.status='open' AND employer_id=me
 * open_positions              — MVP: equals active_jobs (jobs has no
 *                               headcount_planned column; see audit §5)
 * candidates_viewed_this_month — COUNT(unlock_audit_log) joined to recs/jobs
 *                               where created_at >= now - 30d
 * interested_count            — COUNT(recs WHERE status='employer_interested')
 * unlocked_count              — COUNT(recs WHERE status='candidate_approved')
 * placements_count            — COUNT(placements joined to my jobs)
 * spend_this_month            — SUM(platform_fee+primary_share+referrer_share)
 *                               over placements created in the last 30d
 */
export const DashboardDataSchema = z.object({
  active_jobs: z.number().int().nonnegative(),
  open_positions: z.number().int().nonnegative(),
  candidates_viewed_this_month: z.number().int().nonnegative(),
  interested_count: z.number().int().nonnegative(),
  unlocked_count: z.number().int().nonnegative(),
  placements_count: z.number().int().nonnegative(),
  spend_this_month: z.number().int().nonnegative(),
}).strict();

/** GET /v1/employer-panel/dashboard response envelope. */
export const DashboardResponseSchema = z.object({
  ok: z.literal(true),
  data: DashboardDataSchema,
}).strict();

export type DashboardData = z.infer<typeof DashboardDataSchema>;