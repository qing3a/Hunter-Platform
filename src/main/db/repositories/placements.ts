import type { DB } from '../connection.js';

export type PlacementStatus = 'pending_payment' | 'paid' | 'cancelled';

export interface Placement {
  id: string;
  job_id: string;
  candidate_user_id: string;
  primary_headhunter_id: string;
  referrer_headhunter_id: string | null;
  anonymized_candidate_id: string;
  annual_salary: number;
  platform_fee: number;
  primary_share: number;
  referrer_share: number;
  candidate_bonus: number;
  status: PlacementStatus;
  created_at: string;
  updated_at: string;
}

export function createPlacementsRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO placements (id, job_id, candidate_user_id, primary_headhunter_id, referrer_headhunter_id,
                            anonymized_candidate_id, annual_salary, platform_fee, primary_share,
                            referrer_share, candidate_bonus, status, created_at, updated_at)
    VALUES (@id, @job_id, @candidate_user_id, @primary_headhunter_id, @referrer_headhunter_id,
            @anonymized_candidate_id, @annual_salary, @platform_fee, @primary_share,
            @referrer_share, @candidate_bonus, @status, @created_at, @updated_at)
  `);
  const findByIdStmt = db.prepare('SELECT * FROM placements WHERE id = ?');
  const updateStatusStmt = db.prepare("UPDATE placements SET status = ?, updated_at = ? WHERE id = ?");
  const sumPaidStmt = db.prepare(
    "SELECT COALESCE(SUM(primary_share), 0) AS total FROM placements WHERE primary_headhunter_id = ? AND status = 'paid'"
  );

  return {
    insert(p: Placement): void {
      insertStmt.run(p as unknown as Record<string, import('node:sqlite').SQLInputValue>);
    },
    findById(id: string): Placement | undefined {
      return findByIdStmt.get(id) as unknown as Placement | undefined;
    },
    updateStatus(id: string, status: PlacementStatus): void {
      updateStatusStmt.run(status, new Date().toISOString(), id);
    },
    listByEmployer(employerId: string, opts: { status?: PlacementStatus; limit?: number; offset?: number } = {}): Placement[] {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      if (opts.status) {
        return db.prepare(
          "SELECT p.* FROM placements p JOIN jobs j ON j.id = p.job_id WHERE j.employer_id = ? AND p.status = ? ORDER BY p.created_at DESC LIMIT ? OFFSET ?"
        ).all(employerId, opts.status, limit, offset) as unknown as Placement[];
      }
      return db.prepare(
        "SELECT p.* FROM placements p JOIN jobs j ON j.id = p.job_id WHERE j.employer_id = ? ORDER BY p.created_at DESC LIMIT ? OFFSET ?"
      ).all(employerId, limit, offset) as unknown as Placement[];
    },
    listByPrimaryHeadhunter(headhunterId: string, opts: { status?: PlacementStatus; limit?: number; offset?: number } = {}): Placement[] {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      if (opts.status) {
        return db.prepare(
          "SELECT * FROM placements WHERE primary_headhunter_id = ? AND status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
        ).all(headhunterId, opts.status, limit, offset) as unknown as Placement[];
      }
      return db.prepare(
        "SELECT * FROM placements WHERE primary_headhunter_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
      ).all(headhunterId, limit, offset) as unknown as Placement[];
    },
    listAll(opts: { status?: PlacementStatus; limit?: number; offset?: number } = {}): Placement[] {
      const limit = opts.limit ?? 100;
      const offset = opts.offset ?? 0;
      if (opts.status) {
        return db.prepare(
          "SELECT * FROM placements WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
        ).all(opts.status, limit, offset) as unknown as Placement[];
      }
      return db.prepare(
        "SELECT * FROM placements ORDER BY created_at DESC LIMIT ? OFFSET ?"
      ).all(limit, offset) as unknown as Placement[];
    },
    sumPaidByHeadhunter(headhunterId: string): number {
      return (sumPaidStmt.get(headhunterId) as { total: number }).total;
    },
  };
}