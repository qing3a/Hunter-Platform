import { useMemo } from 'react';
import { RadarChart } from '../candidate-portal/RadarChart';
import type { TitleLevel } from '../../api/pm-portal';

// ============================================================================
// CandidateRadar (S5 / Task 13)
// ============================================================================
//
// PM-side 5-dimension capability radar for a single candidate. Re-uses
// the candidate-portal's `<RadarChart>` SVG primitive so the visual
// treatment is identical across portals (PM sees the same polygon as
// the candidate on their own radar).
//
// Dimensions (5, fixed order — the radar's SVG geometry assumes this
// ordering, so the page MUST render with this exact sequence):
//   - 前端   (frontend)
//   - 后端   (backend)
//   - 移动端 (mobile)
//   - 数据   (data)
//   - 设计   (design)
//
// Scoring rule (per Task 13 spec)
// --------------------------------
// A candidate profile has two inputs:
//   1. skills:      string[] — keywords the candidate has tagged.
//   2. title_level: TitleLevel — the candidate's seniority band.
//
// Each dimension is the SUM (capped at 100) of:
//   - skill matches in that category (one per matching skill, +30 each)
//   - the level score (LEVEL_SCORE[level])
//
// Example: a senior full-stack web engineer with skills
//   ["vue", "react", "typescript", "node.js", "postgres"]
// and title_level "senior" would score approximately
//   前端=100 (vue+react, capped) + 75 (level)
//   后端=75 (node.js) + 75 (level) = 100 (capped)
//   移动端=0 + 75 = 75
//   数据=0 + 75 = 75
//   设计=0 + 75 = 75
//
// The component is pure — it accepts the candidate inputs from the
// parent so the page can pass them straight from the candidate summary
// fetched elsewhere. No network calls, no React Query deps.
//
// Tests live in __tests__/CandidateRadar.test.tsx — they cover
// bucketing edge cases, level score tables, the cap-at-100 rule, and
// the pure-function stability guarantee.

// ---- Public type surface (re-exported so the page can type its input) ----

/** MatchCandidateSummary — minimal candidate shape needed for the radar. */
export interface CandidateRadarSource {
  /** Free-form skills (case-insensitive substring matching). */
  skills: string[];
  /** Candidate's title_level (optional — defaults to "mid"). */
  title_level?: TitleLevel | null;
}

// ---- Categories (mirrors CapabilityRadar so the two radars look the same) -

export type CandidateCapabilityCategory =
  | 'frontend'
  | 'backend'
  | 'mobile'
  | 'data'
  | 'design';

export const CANDIDATE_CAPABILITY_CATEGORIES: CandidateCapabilityCategory[] = [
  'frontend',
  'backend',
  'mobile',
  'data',
  'design',
];

export const CANDIDATE_CAPABILITY_LABELS: Record<CandidateCapabilityCategory, string> = {
  frontend: '前端',
  backend: '后端',
  mobile: '移动端',
  data: '数据',
  design: '设计',
};

/**
 * Skill keyword buckets. Substring + case-insensitive matching (same
 * semantics as CapabilityRadar so the two charts feel coherent).
 *
 * Note: the buckets are tighter than CapabilityRadar because candidate
 * skill tags are noisier than position titles — we don't want
 * "Designer" to leak into the "design" bucket via a single token match
 * when a frontend engineer happens to use a design tool.
 */
const CANDIDATE_CATEGORY_KEYWORDS: Record<CandidateCapabilityCategory, string[]> = {
  frontend: ['vue', 'react', 'typescript', 'javascript', 'frontend', 'html', 'css', '前端', 'webpack'],
  backend: ['node', 'node.js', 'java', 'python', 'go ', 'rust', 'backend', '后端', 'postgres', 'mysql', 'redis'],
  mobile: ['ios', 'android', 'swift', 'kotlin', 'flutter', 'react native', '移动端', 'mobile'],
  data: ['ai', 'ml', 'machine learning', '数据', 'data', 'bigquery', 'spark', '算法'],
  design: ['设计', 'design', 'ui', 'ux', 'figma', 'sketch'],
};

// ---- Level score table ----

/**
 * Per-level contribution. Mirrors the CapabilityRadar table so the two
 * radars use the same numeric anchor (a senior candidate is "worth 75
 * points" to any dimension they're even slightly relevant to).
 */
export const CANDIDATE_LEVEL_SCORE: Record<TitleLevel, number> = {
  junior: 25,
  mid: 50,
  senior: 75,
  staff: 100,
};

/** Per-matching-skill contribution. Cap per dimension is 100. */
const SKILL_CONTRIBUTION = 30;

// ============================================================================
// Pure bucketing functions (exported so the test file can target them in
// isolation — these need to stay side-effect-free for unit testing).
// ============================================================================

/**
 * Bucket a single skill keyword into a capability category. Returns
 * null when no keyword matches. Case-insensitive, substring-based.
 *
 * First match wins (same convention as CapabilityRadar's
 * `categorizePosition`); the keyword lists are ordered so the more
 * specific match (frontend > data > design) is checked first.
 */
export function categorizeSkill(skill: string): CandidateCapabilityCategory | null {
  if (!skill || typeof skill !== 'string') return null;
  const lower = skill.toLowerCase();
  for (const cat of CANDIDATE_CAPABILITY_CATEGORIES) {
    const keywords = CANDIDATE_CATEGORY_KEYWORDS[cat];
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) {
        return cat;
      }
    }
  }
  return null;
}

/**
 * Compute the 5-dimension capability score for a candidate. Pure,
 * synchronous, deterministic — safe to memoise with useMemo.
 *
 * Algorithm:
 *   result = { frontend: level, backend: level, ... }
 *   for each skill:
 *     cat = categorizeSkill(skill)
 *     if cat: result[cat] = min(100, result[cat] + SKILL_CONTRIBUTION)
 *
 * A candidate with no skills / no level contribution defaults to all
 * dimensions = level score for the level they hold. A junior candidate
 * with zero matching skills resolves to (25, 25, 25, 25, 25).
 */
export function computeCandidateCapabilities(
  source: CandidateRadarSource,
): Record<CandidateCapabilityCategory, number> {
  const level: TitleLevel = (source.title_level ?? 'mid') as TitleLevel;
  const levelScore = CANDIDATE_LEVEL_SCORE[level];

  const result: Record<CandidateCapabilityCategory, number> = {
    frontend: levelScore,
    backend: levelScore,
    mobile: levelScore,
    data: levelScore,
    design: levelScore,
  };

  const skills = source.skills ?? [];
  for (const skill of skills) {
    const cat = categorizeSkill(skill);
    if (!cat) continue;
    result[cat] = Math.min(100, result[cat] + SKILL_CONTRIBUTION);
  }

  return result;
}

// ============================================================================
// Component
// ============================================================================

interface CandidateRadarProps {
  /** Candidate summary (skills + title_level). */
  source: CandidateRadarSource;
  /** Optional size override (square). Defaults to 240. */
  size?: number;
}

/**
 * Candidate-level capability radar. Re-uses the candidate-portal's
 * `<RadarChart>` for the actual SVG so the PM and candidate portals
 * render identical shapes.
 */
export function CandidateRadar({ source, size = 240 }: CandidateRadarProps) {
  const scores = useMemo(() => computeCandidateCapabilities(source), [source]);

  const dimensions = CANDIDATE_CAPABILITY_CATEGORIES.map((cat) => ({
    label: CANDIDATE_CAPABILITY_LABELS[cat],
    score: scores[cat],
  }));

  return (
    <div className="pm-candidate-radar" data-testid="pm-candidate-radar">
      <RadarChart dimensions={dimensions} size={size} />
    </div>
  );
}
