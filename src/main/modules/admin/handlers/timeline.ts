import type { DB } from '../../../db/connection.js';

export type TimelineType = 'user' | 'candidate' | 'job' | 'recommendation';
export type TimelineSource = 'admin' | 'user' | 'unlock';

export type TimelineItem = {
  id: number;
  source: TimelineSource;
  action: string;
  actor: string | null;
  details: string | null;
  created_at: string;
};

export type TimelineFilter = {
  type: TimelineType;
  id: string;
  source?: TimelineSource | '';
  from?: string;
  until?: string;
  actor?: string;
  limit?: number;
  offset?: number;
};

// Each audit table uses a different column name for the actor.
// We build SQL with a string placeholder '__ACTOR__' that gets replaced
// per-branch to avoid SQL injection (actor value still goes through
// parameterized query).
const ACTOR_COLS: Record<TimelineSource, string> = {
  admin: 'admin_user_id',
  user: 'user_id',
  unlock: 'actor_user_id',
};

export function createAdminTimelineHandler(db: DB) {
  return {
    list(filter: TimelineFilter): { rows: TimelineItem[]; total: number } {
      const { branches, params: branchParams } = buildUnionBranches(filter);
      // Append source/from/until/actor filters to every branch.
      const timeActorFilter = buildTimeActorClause(filter);
      const filteredBranches = branches.map(b =>
        b.sql.replace(/__ACTOR_COL__/g, () => ACTOR_COLS[b.source as TimelineSource])
          .replace('__TIME_ACTOR__', timeActorFilter.clause)
      );
      // Each branch has its own [id, ...timeActorFilter.params] so params align
      // with the repeated WHERE clause in each UNION ALL branch.
      const allParams = branchParams.flatMap(p => [...p, ...timeActorFilter.params]);

      const limit = filter.limit ?? 20;
      const offset = filter.offset ?? 0;
      const sql = `SELECT * FROM (${filteredBranches.join(' UNION ALL ')}) ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      const rows = db.prepare(sql).all(...allParams, limit, offset) as any[];
      const totalSql = `SELECT COUNT(*) AS c FROM (${filteredBranches.join(' UNION ALL ')})`;
      const total = (db.prepare(totalSql).get(...allParams) as { c: number }).c;
      return {
        rows: rows.map(r => ({
          id: r.id,
          source: r.source as TimelineSource,
          action: r.action,
          actor: r.actor ?? null,
          details: r.details ?? null,
          created_at: r.created_at,
        })),
        total,
      };
    },
  };
}

// ============ Internal helpers ============

type BranchBuilder = {
  source: TimelineSource;
  selectSql: string;
  whereSql: string;
};

type BranchResult = {
  source: TimelineSource;
  /** Final SQL fragment for this branch (no trailing semicolon) */
  sql: string;
};

function buildUnionBranches(filter: TimelineFilter): { branches: BranchResult[]; params: any[][] } {
  const allBranches = buildAllBranches(filter);
  // Filter branches by source param (each branch's source is a static literal)
  if (filter.source) {
    return {
      branches: allBranches.branches.filter(b => b.source === filter.source),
      params: allBranches.params.filter((_, i) => allBranches.branches[i].source === filter.source),
    };
  }
  return allBranches;
}

function buildAllBranches(filter: TimelineFilter): { branches: BranchResult[]; params: any[][] } {
  switch (filter.type) {
    case 'user':
      return userBranches(filter.id);
    case 'candidate':
      return candidateBranches(filter.id);
    case 'job':
      return jobBranches(filter.id);
    case 'recommendation':
      return recommendationBranches(filter.id);
    default:
      throw new Error(`Unsupported timeline type: ${filter.type}`);
  }
}

function userBranches(userId: string): { branches: BranchResult[]; params: any[][] } {
  const branches: BranchResult[] = [
    {
      source: 'admin',
      sql: `SELECT 'admin' AS source, id, action, __ACTOR_COL__ AS actor, details_json AS details, created_at FROM admin_action_log WHERE target_type = 'user' AND target_id = ?__TIME_ACTOR__`,
    },
    {
      source: 'user',
      sql: `SELECT 'user' AS source, id, capability_name AS action, __ACTOR_COL__ AS actor, response_summary_json AS details, created_at FROM action_history WHERE user_id = ?__TIME_ACTOR__`,
    },
  ];
  return { branches, params: [[userId], [userId]] };
}

function candidateBranches(anonymizedId: string): { branches: BranchResult[]; params: any[][] } {
  // Subquery to look up candidate_user_id. The id passed to all 3 branches is
  // the same anonymized_id (referenced from recommendations for the unlock branch).
  const branches: BranchResult[] = [
    {
      source: 'admin',
      sql: `SELECT 'admin' AS source, a.id, a.action, __ACTOR_COL__ AS actor, a.details_json AS details, a.created_at FROM admin_action_log a WHERE a.target_type = 'user' AND a.target_id = (SELECT candidate_user_id FROM candidates_private WHERE id = ?)__TIME_ACTOR__`,
    },
    {
      source: 'user',
      sql: `SELECT 'user' AS source, ah.id, ah.capability_name AS action, __ACTOR_COL__ AS actor, ah.response_summary_json AS details, ah.created_at FROM action_history ah WHERE ah.user_id = (SELECT candidate_user_id FROM candidates_private WHERE id = ?)__TIME_ACTOR__`,
    },
    {
      source: 'unlock',
      sql: `SELECT 'unlock' AS source, u.id, u.action, __ACTOR_COL__ AS actor, NULL AS details, u.created_at FROM unlock_audit_log u JOIN recommendations r ON r.id = u.recommendation_id WHERE r.anonymized_candidate_id = ?__TIME_ACTOR__`,
    },
  ];
  return { branches, params: [[anonymizedId], [anonymizedId], [anonymizedId]] };
}

function jobBranches(jobId: string): { branches: BranchResult[]; params: any[][] } {
  const branches: BranchResult[] = [
    {
      source: 'admin',
      sql: `SELECT 'admin' AS source, id, action, __ACTOR_COL__ AS actor, details_json AS details, created_at FROM admin_action_log WHERE target_type = 'job' AND target_id = ?__TIME_ACTOR__`,
    },
    {
      source: 'unlock',
      sql: `SELECT 'unlock' AS source, u.id, u.action, __ACTOR_COL__ AS actor, NULL AS details, u.created_at FROM unlock_audit_log u JOIN recommendations r ON r.id = u.recommendation_id WHERE r.job_id = ?__TIME_ACTOR__`,
    },
  ];
  return { branches, params: [[jobId], [jobId]] };
}

function recommendationBranches(recId: string): { branches: BranchResult[]; params: any[][] } {
  const branches: BranchResult[] = [
    {
      source: 'unlock',
      sql: `SELECT 'unlock' AS source, id, action, __ACTOR_COL__ AS actor, NULL AS details, created_at FROM unlock_audit_log WHERE recommendation_id = ?__TIME_ACTOR__`,
    },
  ];
  return { branches, params: [[recId]] };
}

function buildTimeActorClause(filter: TimelineFilter): { clause: string; params: any[] } {
  const clauses: string[] = [];
  const params: any[] = [];
  if (filter.from) {
    clauses.push('created_at >= ?');
    params.push(filter.from);
  }
  if (filter.until) {
    clauses.push('created_at < ?');
    params.push(filter.until);
  }
  if (filter.actor) {
    // The 'actor' string is replaced per-branch with the correct column name
    // (admin_user_id / user_id / actor_user_id) — see ACTOR_COLS.
    clauses.push('actor LIKE ?');
    params.push(`%${filter.actor}%`);
  }
  return { clause: clauses.length ? ' AND ' + clauses.join(' AND ') : '', params };
}