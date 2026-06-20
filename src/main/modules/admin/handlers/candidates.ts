// Migrated from src/main/ipc/candidates.ts on 2026-06-20
import type { DB } from '../../../db/connection.js';
import { createCandidatesAnonymizedRepo } from '../../../db/repositories/candidates-anonymized.js';
import { Errors } from '../../../errors.js';

export function createAdminCandidatesHandler(db: DB) {
  const candidates = createCandidatesAnonymizedRepo(db);
  return {
    list(filter: { in_pool?: boolean; unlock_status?: string; limit?: number }): unknown[] {
      let sql = 'SELECT * FROM candidates_anonymized WHERE 1=1';
      const params: any[] = [];
      if (filter.in_pool !== undefined) { sql += ' AND is_public_pool = ?'; params.push(filter.in_pool ? 1 : 0); }
      if (filter.unlock_status) { sql += ' AND unlock_status = ?'; params.push(filter.unlock_status); }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(filter.limit ?? 100);
      return db.prepare(sql).all(...params);
    },
    removeFromPool(anonymized_id: string): { anonymized_id: string; is_public_pool: number } {
      const c = candidates.findById(anonymized_id);
      if (!c) throw Errors.notFound('Candidate not found');
      db.prepare("UPDATE candidates_anonymized SET is_public_pool = 0, updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), anonymized_id);
      return { anonymized_id, is_public_pool: 0 };
    },
  };
}