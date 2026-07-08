export interface MatchInput {
  candidate_skills: string[];
  candidate_expectations: {
    expected_salary_min?: number;
    expected_salary_max?: number;
    desired_roles?: string[];
    open_to_remote?: boolean;
  };
  job_skills: string[];
  job_title_level: string;
  job_industry: string;
  candidate_title_level: string;
  job_salary_min?: number | null;
  job_salary_max?: number | null;
}

const TITLE_LEVELS = ['intern', 'junior', 'mid', 'senior', 'staff', 'principal'];

export function calculateMatchScore(input: MatchInput): number {
  // Jaccard similarity (0-100)
  const a = new Set(input.candidate_skills.map(s => s.toLowerCase()));
  const b = new Set(input.job_skills.map(s => s.toLowerCase()));
  const inter = [...a].filter(x => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  const jaccard = union === 0 ? 0 : (inter / union) * 100;

  let bonus = 0;
  // Title level match: same or adjacent
  const cIdx = TITLE_LEVELS.indexOf(input.candidate_title_level.toLowerCase());
  const jIdx = TITLE_LEVELS.indexOf(input.job_title_level.toLowerCase());
  if (cIdx >= 0 && jIdx >= 0 && Math.abs(cIdx - jIdx) <= 1) bonus += 5;

  // Salary in range
  if (input.job_salary_min != null && input.candidate_expectations.expected_salary_min != null) {
    if (input.job_salary_max != null &&
        input.job_salary_max >= input.candidate_expectations.expected_salary_min) {
      bonus += 3;
    }
  }

  // Industry match (if candidate listed desired_roles)
  if (input.candidate_expectations.desired_roles?.some(r =>
    r.toLowerCase().includes(input.job_industry.toLowerCase()))) {
    bonus += 2;
  }

  return Math.round(jaccard + bonus);
}

export interface JobForRanking {
  id: string;
  skills: string[];
  title_level: string;
  industry: string;
  salary_min: number | null;
  salary_max: number | null;
}

export interface ScoredJob { job_id: string; score: number; }

export function scoreJobsForCandidate(
  candidate: { skills: string[]; expectations: any; title_level: string },
  jobs: JobForRanking[]
): ScoredJob[] {
  return jobs
    .map(j => ({
      job_id: j.id,
      score: calculateMatchScore({
        candidate_skills: candidate.skills,
        candidate_expectations: candidate.expectations ?? {},
        job_skills: j.skills,
        job_title_level: j.title_level,
        job_industry: j.industry,
        candidate_title_level: candidate.title_level,
        job_salary_min: j.salary_min,
        job_salary_max: j.salary_max,
      }),
    }))
    .sort((a, b) => b.score - a.score);
}