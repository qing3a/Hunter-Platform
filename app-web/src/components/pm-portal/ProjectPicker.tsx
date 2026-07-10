// ============================================================================
// ProjectPicker (Task 7 / S2)
// ============================================================================
//
// Inline `<select>` that lets the PM flip between projects without leaving
// the current page. Rendered in the top of the S2 detail surface
// (ProjectDetailPage). On change, the parent navigates to the new
// project's URL — the picker is intentionally a controlled dumb component
// (no routing awareness of its own) so it stays trivially testable.
//
// Reference: prototype.html lines 599, 1564 (inline project selector).

interface ProjectLite {
  id: string;
  name: string;
}

interface Props {
  projects: ProjectLite[];
  value: string;
  onChange: (id: string) => void;
}

export function ProjectPicker({ projects, value, onChange }: Props) {
  return (
    <select
      data-testid="pm-project-picker"
      className="pm-picker pm-picker-project"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="选择项目"
    >
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}