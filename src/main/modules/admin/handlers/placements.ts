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
    list(filter: { status?: 'pending_payment' | 'paid' | 'cancelled' }): unknown[] {
      return places.listAll(filter);
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