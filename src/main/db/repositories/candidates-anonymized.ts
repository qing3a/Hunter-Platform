import type { DB } from '../connection.js';

export interface CandidateAnonymized {
  id: string;
  source_private_id: string;
  source_headhunter_id: string;
  industry: string | null;
  title_level: string | null;
  years_experience: number | null;
  salary_range: string | null;
  education_tier: string | null;
  skills_json: string | null;
  is_public_pool: number;
  unlock_status: 'locked' | 'unlocked' | 'revoked';
  created_at: string;
  updated_at: string;
}

export function createCandidatesAnonymizedRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO candidates_anonymized (id, source_private_id, source_headhunter_id,
      industry, title_level, years_experience, salary_range, education_tier,
      skills_json, is_public_pool, unlock_status, created_at, updated_at)
    VALUES (@id, @source_private_id, @source_headhunter_id,
      @industry, @title_level, @years_experience, @salary_range, @education_tier,
      @skills_json, @is_public_pool, @unlock_status, @created_at, @updated_at)
  `);
  const findByIdStmt = db.prepare('SELECT * FROM candidates_anonymized WHERE id = ?');

  return {
    insert(c: CandidateAnonymized): void {
      insertStmt.run(c as unknown as Record<string, import('node:sqlite').SQLInputValue>);
    },
    findById(id: string): CandidateAnonymized | undefined {
      return findByIdStmt.get(id) as CandidateAnonymized | undefined;
    },
  };
}
