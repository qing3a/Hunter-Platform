// Migrated from src/main/ipc/placements.ts on 2026-06-20
import type { DB } from '../../../db/connection.js';
import { createPlacementsRepo } from '../../../db/repositories/placements.js';
import { createAdminActionLogRepo } from '../../../db/repositories/admin-action-log.js';
import { createCommissionHandler } from '../../commission/handler.js';
import { createNotificationTrigger } from '../../notification/trigger.js';
import { Errors } from '../../../errors.js';

export type PlacementRow = {
  id: string;
  job_id: string;
  employer_id: string;
  anonymized_candidate_id: string;
  primary_headhunter_id: string | null;
  referrer_headhunter_id: string | null;
  annual_salary: number;
  platform_fee: number;
  primary_share: number;
  referrer_share: number;
  status: 'pending_payment' | 'paid' | 'cancelled';
  created_at: string;
  updated_at: string;
};

export type ListPlacementsFilter = {
  status?: 'pending_payment' | 'paid' | 'cancelled';
  from?: string;
  until?: string;
  limit?: number;
  offset?: number;
};

export function createAdminPlacementsHandler(db: DB, encryptionKey: Buffer) {
  const places = createPlacementsRepo(db);
  const adminLog = createAdminActionLogRepo(db);
  const notifTrigger = createNotificationTrigger(db);
  const commission = createCommissionHandler(db, encryptionKey, notifTrigger);

  return {
    list(filter: ListPlacementsFilter = {}): { rows: PlacementRow[]; total: number } {
      const where: string[] = ['1=1'];
      const params: any[] = [];
      if (filter.status) {
        where.push('p.status = ?');
        params.push(filter.status);
      }
      if (filter.from) {
        where.push('p.created_at >= ?');
        params.push(filter.from);
      }
      if (filter.until) {
        where.push('p.created_at < ?');
        params.push(filter.until);
      }
      const whereSql = where.join(' AND ');
      const total = (db.prepare(
        `SELECT COUNT(*) AS cnt FROM placements p WHERE ${whereSql}`
      ).get(...params) as { cnt: number }).cnt;
      const rows = db.prepare(`
        SELECT p.id, p.job_id, j.employer_id AS employer_id,
               p.anonymized_candidate_id,
               p.primary_headhunter_id, p.referrer_headhunter_id,
               p.annual_salary, p.platform_fee, p.primary_share, p.referrer_share,
               p.status, p.created_at, p.updated_at
        FROM placements p
        JOIN jobs j ON j.id = p.job_id
        WHERE ${whereSql}
        ORDER BY p.created_at DESC LIMIT ? OFFSET ?
      `).all(...params, filter.limit ?? 20, filter.offset ?? 0) as any[];
      const projected: PlacementRow[] = rows.map(r => ({
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
      return { rows: projected, total };
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
      total_count: number; pending_payment_count: number; paid_count: number;
      cancelled_count: number; total_revenue: number;
    } {
      const rows = db.prepare(
        "SELECT status, COUNT(*) as cnt, COALESCE(SUM(platform_fee), 0) as total_fee FROM placements GROUP BY status"
      ).all() as { status: string; cnt: number; total_fee: number }[];
      let total_count = 0, pending_payment_count = 0, paid_count = 0, cancelled_count = 0, total_revenue = 0;
      for (const r of rows) {
        total_count += r.cnt;
        total_revenue += r.total_fee;
        if (r.status === 'pending_payment') pending_payment_count = r.cnt;
        if (r.status === 'paid') paid_count = r.cnt;
        if (r.status === 'cancelled') cancelled_count = r.cnt;
      }
      return { total_count, pending_payment_count, paid_count, cancelled_count, total_revenue };
    },
  };
}