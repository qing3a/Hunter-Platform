// Migrated from src/main/ipc/candidates.ts on 2026-06-20
import type { DB } from '../../../db/connection.js';
import { createCandidatesAnonymizedRepo } from '../../../db/repositories/candidates-anonymized.js';
import { Errors } from '../../../errors.js';

export function createAdminCandidatesHandler(db: DB) {
  const candidates = createCandidatesAnonymizedRepo(db);
  return {
    list(filter: { in_pool?: boolean; unlock_status?: string; limit?: number }): Array<{
      anonymized_id: string; candidate_user_id: string; headhunter_id: string;
      industry: string | null; title_level: string | null;
      is_public_pool: 0 | 1; unlock_status: string; created_at: string;
    }> {
      // Project only the AdminCandidateSchema fields.
      let sql = `
        SELECT ca.id AS anonymized_id, cp.candidate_user_id,
               ca.source_headhunter_id AS headhunter_id,
               ca.industry, ca.title_level, ca.is_public_pool, ca.unlock_status, ca.created_at
        FROM candidates_anonymized ca
        JOIN candidates_private cp ON cp.id = ca.source_private_id
        WHERE 1=1`;
      const params: any[] = [];
      if (filter.in_pool !== undefined) { sql += ' AND ca.is_public_pool = ?'; params.push(filter.in_pool ? 1 : 0); }
      if (filter.unlock_status) { sql += ' AND ca.unlock_status = ?'; params.push(filter.unlock_status); }
      sql += ' ORDER BY ca.created_at DESC LIMIT ?';
      params.push(filter.limit ?? 100);
      return db.prepare(sql).all(...params) as any;
    },
    removeFromPool(anonymized_id: string): { anonymized_id: string; removed: true } {
      const c = candidates.findById(anonymized_id);
      if (!c) throw Errors.notFound('Candidate not found');
      db.prepare("UPDATE candidates_anonymized SET is_public_pool = 0, updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), anonymized_id);
      return { anonymized_id, removed: true };
    },
  };
}