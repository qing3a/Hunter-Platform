import type { DB } from '../../../db/connection.js';

export type JobRow = {
  id: string;
  employer_id: string;
  employer_name: string;
  title: string;
  status: 'open' | 'claimed' | 'paused' | 'closed' | 'filled';
  created_at: string;
  updated_at: string;
};

export function createAdminJobsHandler(db: DB) {
  return {
    list(filter: {
      status?: JobRow['status'];
      keyword?: string;
      limit?: number;
      offset?: number;
    }): { rows: JobRow[]; total: number } {
      const where: string[] = ['1=1'];
      const params: any[] = [];
      if (filter.status) {
        where.push('j.status = ?');
        params.push(filter.status);
      }
      if (filter.keyword) {
        where.push('(j.title LIKE ? OR u.name LIKE ?)');
        params.push(`%${filter.keyword}%`, `%${filter.keyword}%`);
      }
      const total = (db.prepare(`
        SELECT COUNT(*) AS cnt
        FROM jobs j
        LEFT JOIN users u ON u.id = j.employer_id
        WHERE ${where.join(' AND ')}
      `).get(...params) as { cnt: number }).cnt;

      const rows = db.prepare(`
        SELECT j.id, j.employer_id, u.name AS employer_name,
               j.title, j.status, j.created_at, j.updated_at
        FROM jobs j
        LEFT JOIN users u ON u.id = j.employer_id
        WHERE ${where.join(' AND ')}
        ORDER BY j.created_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, filter.limit ?? 20, filter.offset ?? 0) as JobRow[];

      return { rows, total };
    },
  };
}