// ProjectKPICard — small tile used in the Projects Library KPI row.
//
// Visual contract:
//   - Surface card with a label (top) and a large value (bottom).
//   - The accent colour paints the value text. Pick from the same set
//     used by the hunter-portal KPI tiles (green/blue/amber/purple) so
//     the PM dashboard doesn't look out of place beside the hunter
//     dashboard when the side-by-side PM layout lands (Task 17).
//   - `value` is rendered verbatim. Callers are expected to format
//     budget / count strings (e.g. "¥1.2M" or "1,200") before passing
//     them in — keeps the card dumb and easy to test.
//
// The accent prop is duplicated in hunter-portal.css as
// `.hp-kpi-tile[data-accent="..."] .hp-kpi-value { color: ... }`. We
// re-declare the same data-* selector here so the styling slots in
// without a second stylesheet rule.

export type KpiAccent = 'green' | 'blue' | 'amber' | 'purple';

interface ProjectKPICardProps {
  label: string;
  value: string | number;
  accent?: KpiAccent;
  testId?: string;
}

export function ProjectKPICard({
  label,
  value,
  accent = 'blue',
  testId,
}: ProjectKPICardProps) {
  return (
    <div className="pm-kpi-tile" data-accent={accent} data-testid={testId}>
      <div className="pm-kpi-value" data-testid={testId ? `${testId}-value` : undefined}>
        {value}
      </div>
      <div className="pm-kpi-label">{label}</div>
    </div>
  );
}
