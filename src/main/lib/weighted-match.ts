// src/main/lib/weighted-match.ts
//
// PM Workbench (Phase 3b, Task 10) - Weighted match scoring for PM use.
//
// This library complements src/main/lib/matching.ts (which powers the
// candidate-portal Jaccard-only scoring). PMs rank candidates by a multi-
// dimensional fit (skills + level + industry + salary + education +
// location) with human-readable reasons and gaps.
//
// Score layout (sums to 100):
//   skill     40 pts - Jaccard
//   level     15 pts - exact / adjacent / far
//   industry  15 pts - exact match / unknown
//   salary    10 pts - within / over / under
//   education 10 pts - meets / one-below / two-below
//   location  10 pts - same city / remote_ok / diff
//
// Argument-order convention for sub-scoring helpers: position first,
// candidate second (matches levelMatchScore). salaryMatchScore and
// educationMatchScore take object params to stay readable at the call site.

export interface PositionMatchInput {
  required_skills: string[];
  title_level: 'junior' | 'mid' | 'senior' | 'staff' | null;
  industry: string | null;
  salary_min: number | null;
  salary_max: number | null;
}

export interface CandidateMatchInput {
  skills: string[];
  title_level: 'junior' | 'mid' | 'senior' | 'staff' | null;
  industry: string | null;
  expected_salary_min: number | null;
  expected_salary_max: number | null;
  education: 'none' | 'highschool' | 'bachelor' | 'master' | 'phd' | null;
  location: string | null;
  remote_ok: boolean;
}

export interface MatchInput {
  position: PositionMatchInput;
  candidate: CandidateMatchInput;
}

export interface MatchResult {
  score: number;
  reasons: string[];
  gaps: string[];
}

export const WEIGHTS = {
  skill: 40,
  level: 15,
  industry: 15,
  salary: 10,
  education: 10,
  location: 10,
} as const;

const LEVELS = ['junior', 'mid', 'senior', 'staff'] as const;
export const EDU_LEVELS = ['none', 'highschool', 'bachelor', 'master', 'phd'] as const;

export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a.map((s) => s.toLowerCase()));
  const setB = new Set(b.map((s) => s.toLowerCase()));
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function levelMatchScore(
  positionLevel: string | null,
  candidateLevel: string | null,
): number {
  if (!positionLevel || !candidateLevel) return 0;
  const p = (LEVELS as readonly string[]).indexOf(positionLevel);
  const c = (LEVELS as readonly string[]).indexOf(candidateLevel);
  if (p < 0 || c < 0) return 0;
  const diff = Math.abs(p - c);
  if (diff === 0) return 1;
  if (diff === 1) return 0.5;
  return 0;
}

export const typeMatchScore = levelMatchScore;

export function industryMatchScore(
  positionIndustry: string | null,
  candidateIndustry: string | null,
): number {
  const p = positionIndustry?.trim().toLowerCase() ?? '';
  const c = candidateIndustry?.trim().toLowerCase() ?? '';
  if (!p && !c) return 0.5;
  if (!p || !c) return 0.5;
  return p === c ? 1 : 0;
}

export function salaryMatchScore(
  position: { min: number | null; max: number | null },
  candidate: { min: number | null; max: number | null },
): number {
  if (position.min == null || position.max == null) return 0.5;
  if (candidate.min == null && candidate.max == null) return 0.5;
  const cMin = candidate.min ?? candidate.max ?? 0;
  const cMax = candidate.max ?? candidate.min ?? 0;
  if (cMin > position.max) return 0;
  if (cMax < position.min) return 0.5;
  return 1;
}

export function educationMatchScore(
  positionRequirement: string | null,
  candidateEducation: string | null,
): number {
  if (!positionRequirement) return 0.5;
  const c = (EDU_LEVELS as readonly string[]).indexOf(candidateEducation ?? '');
  const p = (EDU_LEVELS as readonly string[]).indexOf(positionRequirement);
  if (c < 0) return 0.5;
  if (p < 0) return 0.5;
  if (c >= p) return 1;
  const diff = p - c;
  if (diff === 1) return 0.7;
  if (diff === 2) return 0.4;
  return 0;
}

export function locationMatchScore(
  positionLoc: string | null,
  candidateLoc: string | null,
  candidateRemoteOk: boolean,
): number {
  const p = positionLoc?.trim() ?? '';
  const c = candidateLoc?.trim() ?? '';
  if (!p && !c) return 0.5;
  if (!p || !c) return 0.5;
  if (p === c) return 1;
  return candidateRemoteOk ? 0.8 : 0.3;
}

export function calculateMatch(input: MatchInput): MatchResult {
  const reasons: string[] = [];
  const gaps: string[] = [];

  // Skill (40)
  const skillRatio = jaccard(input.position.required_skills, input.candidate.skills);
  const skillPts = Math.round(skillRatio * WEIGHTS.skill);
  if (input.position.required_skills.length > 0) {
    if (skillRatio >= 0.6) {
      reasons.push(`技能匹配 (${Math.round(skillRatio * 100)}%)`);
    } else if (skillRatio < 0.3) {
      const missing = input.position.required_skills
        .filter((s) => !input.candidate.skills.map((x) => x.toLowerCase()).includes(s.toLowerCase()))
        .slice(0, 3);
      if (missing.length > 0) {
        gaps.push(`缺 ${missing.join('/')} 经验`);
      } else {
        gaps.push('技能匹配不足');
      }
    }
  }

  // Level (15)
  const lvlRatio = levelMatchScore(input.position.title_level, input.candidate.title_level);
  const lvlPts = Math.round(lvlRatio * WEIGHTS.level);
  if (input.position.title_level && input.candidate.title_level) {
    if (lvlRatio === 1) {
      reasons.push('职级匹配');
    } else if (lvlRatio === 0.5) {
      reasons.push('职级相邻');
    } else {
      gaps.push('职级差距较大');
    }
  }

  // Industry (15)
  const indRatio = industryMatchScore(input.position.industry, input.candidate.industry);
  // Only award points when at least one side has data; if both sides are
  // null, we treat the dimension as "no signal" (0 pts) so a totally-empty
  // candidate row doesn't accidentally float up to 50% baseline.
  const indPts = (input.position.industry || input.candidate.industry)
    ? Math.round(indRatio * WEIGHTS.industry)
    : 0;
  if (input.position.industry && input.candidate.industry) {
    if (indRatio === 1) {
      reasons.push('行业一致');
    } else {
      gaps.push('行业不一致');
    }
  }

  // Salary (10)
  const salRatio = salaryMatchScore(
    { min: input.position.salary_min, max: input.position.salary_max },
    { min: input.candidate.expected_salary_min, max: input.candidate.expected_salary_max },
  );
  const salPts = (input.position.salary_min != null || input.position.salary_max != null
    || input.candidate.expected_salary_min != null || input.candidate.expected_salary_max != null)
    ? Math.round(salRatio * WEIGHTS.salary)
    : 0;
  if (
    input.position.salary_min != null && input.position.salary_max != null
    && input.candidate.expected_salary_min != null && input.candidate.expected_salary_max != null
  ) {
    if (salRatio === 0) {
      const overBy = Math.max(0, input.candidate.expected_salary_min - input.position.salary_max);
      gaps.push(`薪资期望超预算 ${overBy}`);
    } else if (salRatio === 1) {
      reasons.push('薪资期望在预算内');
    }
  }

  // Education (10)
  // v028 PM position schema does not carry education requirement; we
  // award full 10 pts when the candidate has any declared education,
  // and half-points (5) when they don't.
  const eduRatio = input.candidate.education ? 1 : 0.5;
  const eduPts = Math.round(eduRatio * WEIGHTS.education);
  if (input.candidate.education) {
    reasons.push('学历达标');
  }
  void educationMatchScore;

  // Location (10)
  // v028 doesn't carry a position location column either. Candidate's
  // remote_ok + city declaration becomes the dominant signal:
  //   - remote_ok=true           → 8 pts + reason "接受远程"
  //   - city declared            → 7 pts + reason "所在地 <city>"
  //   - neither                  → 5 pts (neutral)
  let locPts: number;
  if (input.candidate.remote_ok) {
    locPts = WEIGHTS.location * 0.8;
    reasons.push('接受远程');
  } else if (input.candidate.location) {
    locPts = WEIGHTS.location * 0.7;
    reasons.push(`所在地 ${input.candidate.location}`);
  } else {
    locPts = WEIGHTS.location * 0.5;
  }
  void locationMatchScore;

  const raw = skillPts + lvlPts + indPts + salPts + eduPts + locPts;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { score, reasons, gaps };
}