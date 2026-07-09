// src/main/lib/ai-decompose.ts
//
// PM Workbench (Phase 3b, Task 6) — Keyword-based heuristic decomposition.
//
// Given a free-form project `target` / job-description blob, this lib
// returns a list of suggested position definitions (title + skills +
// level + headcount + rationale). It does NOT call any external LLM —
// the heuristic is a deterministic keyword scan over a fixed template
// table. That choice is intentional for v1:
//   - zero-cost, zero-latency-after-warmup
//   - no LLM API key required
//   - every suggestion is explainable (rationale lists matched keywords)
//
// The 800ms `sleep` simulates downstream latency so the UI can show a
// spinner state that's perceptibly realistic. A future task can swap
// the body for an LLM call without changing the public shape.
//
// "Self-Review" checklist (from the v1 plan):
//   - Every suggested position MUST have a non-empty `rationale` so the
//     PM understands why it was suggested. No black-box.
//   - If no template matches, return a default fallback position
//     ("全栈工程师") so the modal always shows at least one suggestion.
//   - De-duplicate by title — same template, many keyword hits => one row.

/** Simulate downstream AI latency so the UI loading state is visible. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Title seniority band — mirrors
 * src/main/db/repositories/project-positions.ts → TitleLevel. Kept as a
 * local type so this file has no DB dependency (it's a pure lib, not a
 * handler).
 */
export type DecomposeTitleLevel = 'junior' | 'mid' | 'senior' | 'staff';

/**
 * Single position suggestion returned by `decomposePositions`. The shape
 * matches `CreatePositionInput` from the Zod schemas, minus the required
 * `description` (the AI doesn't fabricate descriptions — the PM writes
 * them manually after a suggestion is accepted).
 */
export interface DecomposedPosition {
  title: string;
  skills: string[];
  title_level: DecomposeTitleLevel;
  /** Always 1 from the heuristic (UI lets the PM bump it on commit). */
  headcount: number;
  /** Human-readable explanation of which keywords matched. */
  rationale: string;
}

interface PositionTemplate {
  keywords: string[];
  title: string;
  skills: string[];
  title_level: DecomposeTitleLevel;
}

/**
 * Keyword → position template table. Order matters only for output
 * order (the suggestions come back in this order, so we put the most
 * common roles first). Each template matches when ANY of its keywords
 * appears in the lowercased target text.
 *
 * Chinese keywords are listed alongside their English aliases so the
 * heuristic works regardless of which language the PM used.
 */
export const POSITION_TEMPLATES: PositionTemplate[] = [
  { keywords: ['vue', 'react', 'frontend', '前端'], title: '高级前端工程师', skills: ['vue', 'typescript'], title_level: 'senior' },
  { keywords: ['node', 'java', '后端', 'backend'], title: '后端工程师', skills: ['node.js', 'sql'], title_level: 'senior' },
  { keywords: ['ios', 'swift'], title: 'iOS 工程师', skills: ['swift', 'ios'], title_level: 'mid' },
  { keywords: ['android'], title: 'Android 工程师', skills: ['kotlin', 'android'], title_level: 'mid' },
  { keywords: ['devops', 'k8s', 'docker'], title: 'DevOps 工程师', skills: ['kubernetes', 'docker'], title_level: 'senior' },
  { keywords: ['qa', '测试', 'test'], title: '测试工程师', skills: ['selenium', 'pytest'], title_level: 'mid' },
  { keywords: ['产品', 'product', 'pm'], title: '产品经理', skills: ['产品设计'], title_level: 'mid' },
  { keywords: ['设计', 'design', 'ui'], title: 'UI 设计师', skills: ['figma'], title_level: 'mid' },
  { keywords: ['算法', 'ai', 'ml', 'machine learning'], title: '算法工程师', skills: ['python', 'tensorflow'], title_level: 'senior' },
  { keywords: ['数据', 'data'], title: '数据工程师', skills: ['sql', 'spark'], title_level: 'senior' },
];

/** Default fallback template used when no keyword matches. */
const FALLBACK_POSITION: DecomposedPosition = {
  title: '全栈工程师',
  skills: ['javascript', 'sql'],
  title_level: 'mid',
  headcount: 1,
  rationale: '默认推荐 (无匹配关键词)',
};

/**
 * Decompose a target text into suggested positions. Pure function (no
 * side effects beyond the simulated delay). Always returns at least
 * one position — when no template matches, the 全栈工程师 fallback is
 * returned so the UI has something to render.
 *
 * @param targetText raw PM-provided text (project.target or pasted JD).
 * @returns promise that resolves after ~800ms with the suggestion list.
 */
export async function decomposePositions(
  targetText: string,
): Promise<DecomposedPosition[]> {
  // Simulate downstream latency. Centralised so future swaps to a
  // real LLM keep the same UX timing.
  await sleep(800);

  // Defensive: treat nullish / pure whitespace as "no match" so the
  // fallback path triggers. The handler also rejects empty target up
  // front, but the lib is safe to call with any input.
  const lower = (targetText ?? '').toLowerCase();

  const matchedTitles = new Set<string>();
  const result: DecomposedPosition[] = [];

  for (const tmpl of POSITION_TEMPLATES) {
    const matchedKeywords = tmpl.keywords.filter((k) => lower.includes(k));
    if (matchedKeywords.length === 0) continue;
    if (matchedTitles.has(tmpl.title)) continue; // de-dup by title
    matchedTitles.add(tmpl.title);
    result.push({
      title: tmpl.title,
      skills: tmpl.skills,
      title_level: tmpl.title_level,
      headcount: 1,
      rationale: `匹配关键词: ${matchedKeywords.join(', ')}`,
    });
  }

  if (result.length === 0) {
    // Defensive: even if the caller passed empty string, return the
    // fallback rather than an empty array. UI shouldn't have to
    // special-case "no suggestions yet".
    result.push({ ...FALLBACK_POSITION });
  }

  return result;
}
