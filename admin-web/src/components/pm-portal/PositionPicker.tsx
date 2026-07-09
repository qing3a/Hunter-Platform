// ============================================================================
// PositionPicker (Task 7 / S3 / S5 / S6)
// ============================================================================
//
// Inline `<select>` that lets the PM flip between positions of a project
// without leaving the current page. Rendered at the top of:
//   - S3 (PipelineSandboxPage)  → on change navigate to the new sandbox
//   - S5 (CandidateMatchesPage) → on change navigate to the new matches page
//
// The position list is fed by the parent (caller fetches via
// pmPositions.list(projectId)) — the picker itself is a controlled
// dumb component so it stays trivially testable and reusable.
//
// The optional `title_level` (e.g. "P5" / "senior") is rendered as a
// parenthetical when present, matching the inline annotation style
// used in the prototype (prototype.html lines 1537, 1628).
//
// Reference: prototype.html lines 1537, 1628 (inline position selector).

interface PositionLite {
  id: string;
  title: string;
  title_level?: string;
}

interface Props {
  positions: PositionLite[];
  value: string;
  onChange: (id: string) => void;
}

export function PositionPicker({ positions, value, onChange }: Props) {
  return (
    <select
      data-testid="pm-position-picker"
      className="pm-picker pm-picker-position"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="选择岗位"
    >
      {positions.map((p) => (
        <option key={p.id} value={p.id}>
          {p.title}
          {p.title_level ? ` (${p.title_level})` : ''}
        </option>
      ))}
    </select>
  );
}