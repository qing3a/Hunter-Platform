import { useMemo } from 'react';
import { RadarChart } from '../candidate-portal/RadarChart';
import type { Plan, Position, TitleLevel } from '../../api/pm-portal';

// ============================================================================
// CapabilityRadar (S4 / Task 8)
// ============================================================================
//
// Computes a 5-dimension capability score for a single staffing plan and
// renders it using the candidate-portal's RadarChart so the visual
// treatment stays consistent with the rest of the product (PM sees the
// same polygon shape as in the candidate/hunter portals).
//
// Dimensions (5, fixed order — the radar's geometry is non-trivial if the
// order changes between cards, so the page MUST render with this order):
//   - 前端  (frontend)
//   - 后端  (backend)
//   - 移动端 (mobile)
//   - 数据  (data)
//   - 设计  (design)
//
// Scoring rule (per the task spec):
//   1 junior   position in a category = 25
//   1 mid      position in a category = 50
//   1 senior   position in a category = 75
//   1 staff    position in a category = 100
//   Multiple positions in the same category sum (capped at 100).
//
// The category of a position is decided by keyword matching against the
// position's `title` (case-insensitive). We use a *weighted* rule: each
// match contributes its level's score; we then cap the dimension at 100.
// This intentionally diverges from a pure "1 position = 100" rule so a
// plan that lists 4 frontend positions doesn't peg every dimension at 100
// and turn the radar into a regular pentagon.
//
// The component is pure (no network calls) — it accepts positions from
// the parent so the page can fetch them once and feed them into all 3
// cards. This keeps the comparison page from issuing N copies of the
// same /positions query.

// Per-level scores, in 0-100. The spec calls out 25/50/75/100 — we keep
// the table as a const so the test file can re-derive the expected
// numbers and stay robust to future tweaks.
export const LEVEL_SCORE: Record<TitleLevel, number> = {
  junior: 25,
  mid: 50,
  senior: 75,
  staff: 100,
};

// Keyword buckets. Order matters only for the (very unlikely) case of
// an ambiguous title — first match wins. We mirror the keywords used
// by the AI decompose heuristic (src/main/lib/ai-decompose.ts →
// POSITION_TEMPLATES) so the radar categories line up with what the
// PM sees in the AI suggestions.
//
// Each entry maps a category to the list of substrings that bucket a
// title into that category. Matching is case-insensitive, substring
// based (so "高级前端工程师" and "Senior Frontend Engineer" both land
// in 前端).
export type CapabilityCategory =
  | 'frontend'
  | 'backend'
  | 'mobile'
  | 'data'
  | 'design';

export const CAPABILITY_CATEGORIES: CapabilityCategory[] = [
  'frontend',
  'backend',
  'mobile',
  'data',
  'design',
];

export const CAPABILITY_LABELS: Record<CapabilityCategory, string> = {
  frontend: '前端',
  backend: '后端',
  mobile: '移动端',
  data: '数据',
  design: '设计',
};

const CATEGORY_KEYWORDS: Record<CapabilityCategory, string[]> = {
  frontend: ['vue', 'react', 'frontend', '前端'],
  backend: ['node', 'java', '后端', 'backend', 'go ', 'python', 'rust'],
  mobile: ['ios', 'android', 'swift', 'kotlin', '移动端', 'mobile'],
  data: ['算法', 'ai', 'ml', 'machine learning', '数据', 'data'],
  design: ['设计', 'design', 'ui'],
};

/**
 * Bucket a single position title into a capability category. Returns
 * null when no keyword matches — the radar leaves the unmatched
 * position out of the score. (For unknown titles we don't add points
 * to any dimension rather than guessing.)
 *
 * The function is exported so the test file can assert the bucketing
 * logic in isolation.
 */
export function categorizePosition(title: string): CapabilityCategory | null {
  const lower = title.toLowerCase();
  for (const cat of CAPABILITY_CATEGORIES) {
    const keywords = CATEGORY_KEYWORDS[cat];
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) {
        return cat;
      }
    }
  }
  return null;
}

/**
 * Compute the 5-dimension capability score for a plan. The function is
 * pure and synchronous — same input always yields the same output, so
 * it can be memoised cheaply with useMemo.
 *
 * The `position` lookups are joined client-side: the plan's
 * `positions_json` only contains `{position_id, count}` pairs, so we
 * need a position map to recover the title + level used for
 * categorisation. The page supplies that map once for all 3 plans.
 *
 * A plan with no matching positions resolves to all-zero dimensions
 * (a degenerate radar polygon collapsed to the centre); the card UI
 * still renders without crashing.
 */
export function computeCapabilities(
  plan: Plan,
  positions: Position[],
): Record<CapabilityCategory, number> {
  const result: Record<CapabilityCategory, number> = {
    frontend: 0,
    backend: 0,
    mobile: 0,
    data: 0,
    design: 0,
  };
  if (!plan.positions_json || plan.positions_json.length === 0) {
    return result;
  }
  const posById = new Map(positions.map((p) => [p.id, p]));
  for (const entry of plan.positions_json) {
    const pos = posById.get(entry.position_id);
    if (!pos) continue;
    const cat = categorizePosition(pos.title);
    if (!cat) continue;
    const level = (pos.title_level ?? 'mid') as TitleLevel;
    const score = LEVEL_SCORE[level] ?? 0;
    // Multiply by `count` so a plan that lists "3 frontend engineers"
    // scales up. We cap at 100 per dimension.
    result[cat] = Math.min(100, result[cat] + score * entry.count);
  }
  return result;
}

interface CapabilityRadarProps {
  plan: Plan;
  /** Map of position_id -> Position, used to recover titles for categorisation. */
  positions: Position[];
  /** Optional size override (square). Defaults to 240 to fit in a 3-col grid. */
  size?: number;
  /** Test hook: appends `-{n}` to testids when rendering multiple radars in a row. */
  index?: number;
}

/**
 * Plan-level capability radar. Re-uses the candidate-portal's
 * RadarChart (no SVG duplication, shared visual treatment) and pairs
 * each dimension with its computed score.
 */
export function CapabilityRadar({ plan, positions, size = 240, index = 0 }: CapabilityRadarProps) {
  const scores = useMemo(() => computeCapabilities(plan, positions), [plan, positions]);

  const dimensions = CAPABILITY_CATEGORIES.map((cat) => ({
    label: CAPABILITY_LABELS[cat],
    score: scores[cat],
  }));

  return (
    <div className="pm-plan-card-radar" data-testid={`pm-plan-card-radar-${index}`}>
      <RadarChart dimensions={dimensions} size={size} />
    </div>
  );
}
