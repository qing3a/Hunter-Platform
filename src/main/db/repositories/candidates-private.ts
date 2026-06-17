import type { DB } from '../connection.js';

export interface CandidatePrivate {
  id: string;
  headhunter_id: string;
  candidate_user_id: string;
  name_enc: string;
  phone_enc: string;
  email_enc: string;
  current_company_raw: string | null;
  current_title_raw: string | null;
  expected_salary: number | null;
  years_experience: number | null;
  education_school: string | null;
  resume_url: string | null;
  skills_json: string | null;
  raw_payload_json: string | null;
  created_at: string;
  updated_at: string;
}

export function createCandidatesPrivateRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO candidates_private (id, headhunter_id, candidate_user_id,
      name_enc, phone_enc, email_enc, current_company_raw, current_title_raw,
      expected_salary, years_experience, education_school, resume_url,
      skills_json, raw_payload_json, created_at, updated_at)
    VALUES (@id, @headhunter_id, @candidate_user_id,
      @name_enc, @phone_enc, @email_enc, @current_company_raw, @current_title_raw,
      @expected_salary, @years_experience, @education_school, @resume_url,
      @skills_json, @raw_payload_json, @created_at, @updated_at)
  `);
  const findByIdStmt = db.prepare('SELECT * FROM candidates_private WHERE id = ?');

  return {
    insert(c: CandidatePrivate): void {
      insertStmt.run(c as unknown as Record<string, import('node:sqlite').SQLInputValue>);
    },
    findById(id: string): CandidatePrivate | undefined {
      return findByIdStmt.get(id) as CandidatePrivate | undefined;
    },
  };
}
