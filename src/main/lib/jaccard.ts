// src/main/lib/jaccard.ts
//
// Shared Jaccard similarity primitive used by both:
//   - src/main/lib/matching.ts (candidate-portal Jaccard-only scoring)
//   - src/main/lib/weighted-match.ts (PM multi-dimensional scoring)
//
// Definition: |A ∩ B| / |A ∪ B|. Inputs are lower-cased before comparison.
// Empty input on either side yields 0 (no signal, no false-positive baseline).

export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a.map((s) => s.toLowerCase()));
  const setB = new Set(b.map((s) => s.toLowerCase()));
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}