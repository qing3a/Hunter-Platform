// Migrated from src/main/ipc/placements.ts on 2026-06-20
import type { DB } from '../../../db/connection.js';
import { createPlacementsRepo } from '../../../db/repositories/placements.js';
import { createAdminActionLogRepo } from '../../../db/repositories/admin-action-log.js';
import { createCommissionHandler } from '../../commission/handler.js';
import { Errors } from '../../../errors.js';

export function createAdminPlacementsHandler(db: DB, encryptionKey: Buffer) {
  const places = createPlacementsRepo(db);
  const adminLog = createAdminActionLogRepo(db);
  const commission = createCommissionHandler(db, encryptionKey);

  return {
    list(filter: { status?: 'pending_payment' | 'paid' | 'cancelled' }): Array<{
      id: string; job_id: string; employer_id: string;
      anonymized_candidate_id: string; primary_headhunter_id: string | null;
      referrer_headhunter_id: string | null; annual_salary: number;
      platform_fee: number; primary_share: number; referrer_share: number;
      status: 'pending_payment' | 'paid' | 'cancelled';
      created_at: string; updated_at: string;
    }> {
      // JOIN jobs to get employer_id (placements table does not store it directly).
      let sql = `
        SELECT p.id, p.job_id, j.employer_id AS employer_id,
               p.anonymized_candidate_id, p.candidate_user_id,
               p.primary_headhunter_id, p.referrer_headhunter_id,
               p.annual_salary, p.platform_fee, p.primary_share, p.referrer_share,
               p.candidate_bonus, p.status, p.created_at, p.updated_at
        FROM placements p
        JOIN jobs j ON j.id = p.job_id
        WHERE 1=1`;
      const params: any[] = [];
      if (filter.status) { sql += ' AND p.status = ?'; params.push(filter.status); }
      sql += ' ORDER BY p.created_at DESC LIMIT 100';
      const rows = db.prepare(sql).all(...params) as any[];
      return rows.map((r) => ({
        id: r.id,
        job_id: r.job_id,
        employer_id: r.employer_id,
        anonymized_candidate_id: r.anonymized_candidate_id,
        primary_headhunter_id: r.primary_headhunter_id,
        referrer_headhunter_id: r.referrer_headhunter_id,
        annual_salary: r.annual_salary,
        platform_fee: r.platform_fee,
        primary_share: r.primary_share,
        referrer_share: r.referrer_share,
        status: r.status,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));
    },
    markPaid(adminUserId: string, placementId: string): { id: string; status: 'paid' } {
      const result = commission.markPaid(adminUserId, placementId);
      return { id: result.id, status: 'paid' };
    },
    cancel(adminUserId: string, placementId: string): { id: string; status: 'cancelled' } {
      const p = places.findById(placementId);
      if (!p) throw Errors.notFound('Placement not found');
      if (p.status === 'paid') throw Errors.invalidState('Cannot cancel paid placement');
      places.updateStatus(placementId, 'cancelled');
      adminLog.insert({
        admin_user_id: adminUserId, action: 'cancel_placement',
        target_type: 'placement', target_id: placementId,
        details_json: JSON.stringify({ previous_status: p.status }),
      });
      return { id: placementId, status: 'cancelled' };
    },
    summary(): {
      pending_count: number; paid_count: number; total_paid_amount: number;
      total_platform_revenue: number; total_hunter_payout: number;
    } {
      const rows = db.prepare(
        "SELECT status, COUNT(*) as cnt, COALESCE(SUM(platform_fee), 0) as total_fee, COALESCE(SUM(primary_share), 0) as total_primary, COALESCE(SUM(referrer_share), 0) as total_referrer FROM placements GROUP BY status"
      ).all() as { status: string; cnt: number; total_fee: number; total_primary: number; total_referrer: number }[];
      let pending_count = 0, paid_count = 0, total_platform_revenue = 0, total_hunter_payout = 0;
      for (const r of rows) {
        if (r.status === 'pending_payment') pending_count = r.cnt;
        if (r.status === 'paid') paid_count = r.cnt;
        total_platform_revenue += r.total_fee;
        total_hunter_payout += r.total_primary + r.total_referrer;
      }
      return {
        pending_count, paid_count, total_paid_amount: total_hunter_payout,
        total_platform_revenue, total_hunter_payout,
      };
    },
  };
}