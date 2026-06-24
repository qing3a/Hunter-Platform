import type { DB } from '../../../db/connection.js';

export type RecommendationStatus =
  | 'pending' | 'employer_interested' | 'candidate_approved' | 'unlocked'
  | 'rejected_employer' | 'rejected_candidate' | 'withdrawn' | 'placed';

export type RecommendationRow = {
  id: string;
  job_id: string;
  job_title: string;
  anonymized_candidate_id: string;
  headhunter_id: string;
  headhunter_name: string;
  status: RecommendationStatus;
  created_at: string;
  updated_at: string;
};

export function createAdminRecommendationsHandler(db: DB) {
  return {
    list(filter: {
      status?: RecommendationStatus;
      keyword?: string;
      from?: string;
      until?: string;
      limit?: number;
      offset?: number;
    }): { rows: RecommendationRow[]; total: number } {
      const where: string[] = ['1=1'];
      const params: any[] = [];
      if (filter.status) {
        where.push('r.status = ?');
        params.push(filter.status);
      }
      if (filter.keyword) {
        where.push('(j.title LIKE ? OR u.name LIKE ?)');
        params.push(`%${filter.keyword}%`, `%${filter.keyword}%`);
      }
      if (filter.from) {
        if (!Number.isFinite(Date.parse(filter.from))) {
          throw new Error('INVALID_PARAMS: from must be ISO timestamp');
        }
        where.push('r.created_at >= ?');
        params.push(filter.from);
      }
      if (filter.until) {
        if (!Number.isFinite(Date.parse(filter.until))) {
          throw new Error('INVALID_PARAMS: until must be ISO timestamp');
        }
        where.push('r.created_at < ?');
        params.push(filter.until);
      }
      const total = (db.prepare(`
        SELECT COUNT(*) AS cnt
        FROM recommendations r
        LEFT JOIN jobs j ON j.id = r.job_id
        LEFT JOIN users u ON u.id = r.headhunter_id
        WHERE ${where.join(' AND ')}
      `).get(...params) as { cnt: number }).cnt;

      const rows = db.prepare(`
        SELECT r.id, r.job_id, j.title AS job_title,
               r.anonymized_candidate_id, r.headhunter_id,
               u.name AS headhunter_name, r.status,
               r.created_at, r.updated_at
        FROM recommendations r
        LEFT JOIN jobs j ON j.id = r.job_id
        LEFT JOIN users u ON u.id = r.headhunter_id
        WHERE ${where.join(' AND ')}
        ORDER BY r.created_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, filter.limit ?? 20, filter.offset ?? 0) as RecommendationRow[];

      return { rows, total };
    },
  };
}