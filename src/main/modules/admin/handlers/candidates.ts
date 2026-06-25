// Migrated from src/main/ipc/candidates.ts on 2026-06-20
import type { DB } from '../../../db/connection.js';
import { createCandidatesAnonymizedRepo } from '../../../db/repositories/candidates-anonymized.js';
import { Errors } from '../../../errors.js';
import { maskName, maskEmail } from '../../../lib/mask.js';

export function createAdminCandidatesHandler(db: DB) {
  const candidates = createCandidatesAnonymizedRepo(db);
  return {
    list(filter: { in_pool?: boolean; unlock_status?: string; keyword?: string; limit?: number; offset?: number }): { rows: Array<{
      anonymized_id: string; candidate_user_id: string; masked_name: string; masked_email: string;
      headhunter_id: string;
      industry: string | null; title_level: string | null;
      is_public_pool: 0 | 1; unlock_status: string; created_at: string;
    }>; total: number } {
      // Project AdminCandidateSchema fields. JOINs candidates_private + users
      // to surface masked PII (full name/email reserved for /v1/admin/users drill-down).
      const where: string[] = ['1=1'];
      const params: any[] = [];
      if (filter.in_pool !== undefined) { where.push('ca.is_public_pool = ?'); params.push(filter.in_pool ? 1 : 0); }
      if (filter.unlock_status) { where.push('ca.unlock_unlock_status = ?'); params.push(filter.unlock_status); }
      if (filter.keyword) {
        where.push('(u.name LIKE ? OR u.contact LIKE ?)');
        params.push(`%${filter.keyword}%`, `%${filter.keyword}%`);
      }

      const total = (db.prepare(`
        SELECT COUNT(*) as cnt FROM candidates_anonymized ca
        JOIN candidates_private cp ON cp.id = ca.source_private_id
        JOIN users u ON u.id = cp.candidate_user_id
        WHERE ${where.join(' AND ')}`).get(...params) as { cnt: number }).cnt;

      const sql = `
        SELECT ca.id AS anonymized_id, cp.candidate_user_id,
               u.name AS raw_name, u.contact AS raw_email,
               ca.source_headhunter_id AS headhunter_id,
               ca.industry, ca.title_level, ca.is_public_pool, ca.unlock_status, ca.created_at
        FROM candidates_anonymized ca
        JOIN candidates_private cp ON cp.id = ca.source_private_id
        JOIN users u ON u.id = cp.candidate_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY ca.created_at DESC LIMIT ? OFFSET ?`;
      const rawRows = db.prepare(sql).all(...params, filter.limit ?? 20, filter.offset ?? 0) as any;
      const rows = rawRows.map((r: any) => ({
        anonymized_id: r.anonymized_id,
        candidate_user_id: r.candidate_user_id,
        masked_name: maskName(r.raw_name),
        masked_email: maskEmail(r.raw_email),
        headhunter_id: r.headhunter_id,
        industry: r.industry,
        title_level: r.title_level,
        is_public_pool: r.is_public_pool,
        unlock_status: r.unlock_status,
        created_at: r.created_at,
      }));
      return { rows, total };
    },
    removeFromPool(anonymized_id: string): { anonymized_id: string; removed: true } {
      const c = candidates.findById(anonymized_id);
      if (!c) throw Errors.notFound('Candidate not found');
      db.prepare("UPDATE candidates_anonymized SET is_public_pool = 0, updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), anonymized_id);
      return { anonymized_id, removed: true };
    },
    get(anonymized_id: string): {
      anonymized_id: string; candidate_user_id: string; masked_name: string; masked_email: string;
      headhunter_id: string;
      industry: string | null; title_level: string | null;
      is_public_pool: 0 | 1; unlock_status: string; created_at: string;
    } | null {
      const r = db.prepare(`
        SELECT ca.id AS anonymized_id, cp.candidate_user_id,
               u.name AS raw_name, u.contact AS raw_email,
               ca.source_headhunter_id AS headhunter_id,
               ca.industry, ca.title_level, ca.is_public_pool, ca.unlock_status, ca.created_at
        FROM candidates_anonymized ca
        JOIN candidates_private cp ON cp.id = ca.source_private_id
        JOIN users u ON u.id = cp.candidate_user_id
        WHERE ca.id = ?
      `).get(anonymized_id) as any;
      if (!r) return null;
      return {
        anonymized_id: r.anonymized_id,
        candidate_user_id: r.candidate_user_id,
        masked_name: maskName(r.raw_name),
        masked_email: maskEmail(r.raw_email),
        headhunter_id: r.headhunter_id,
        industry: r.industry,
        title_level: r.title_level,
        is_public_pool: r.is_public_pool,
        unlock_status: r.unlock_status,
        created_at: r.created_at,
      };
    },
  };
}