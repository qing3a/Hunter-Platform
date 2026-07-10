// ============================================================================
// SortPills (Task 11 / S6)
// ============================================================================
//
// Three pill-buttons that drive the sort key for the S6 candidate-matches
// grid. The active option swaps to the project accent colour so the PM can
// see at a glance which dimension is in effect.
//
// Why a tablist?
//   - Sort is a "pick exactly one of N" choice; ARIA's `tablist`/`tab` role
//     (with `aria-selected`) is the cleanest way to convey that to screen
//     readers without inventing a custom role.
//   - Using plain `<button>`s keeps keyboard activation trivial (Enter /
//     Space) — no extra `role="tab"` wiring required.
//
// Why exported `SORT_OPTIONS`?
//   - The page (and the unit tests) sometimes want to enumerate the keys
//     without re-declaring the array. Exposing it as a named export keeps
//     a single source of truth.
//
// Sort semantics live in the page (CandidateMatchesPage) — this component
// is a pure controlled widget that just emits a SortKey via onChange.

export type SortKey = 'score' | 'time' | 'salary';

export const SORT_OPTIONS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'score', label: '匹配度' },
  { key: 'time', label: '到岗时间' },
  { key: 'salary', label: '薪资匹配' },
];

interface SortPillsProps {
  value: SortKey;
  onChange: (key: SortKey) => void;
}

export function SortPills({ value, onChange }: SortPillsProps) {
  return (
    <div
      className="pm-sort-pills"
      role="tablist"
      aria-label="匹配排序"
      data-testid="pm-sort-pills"
    >
      {SORT_OPTIONS.map((o) => {
        const isActive = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            data-testid={`pm-sort-pill-${o.key}`}
            className={`pm-sort-pill${isActive ? ' active' : ''}`}
            onClick={() => onChange(o.key)}
            role="tab"
            aria-selected={isActive}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
