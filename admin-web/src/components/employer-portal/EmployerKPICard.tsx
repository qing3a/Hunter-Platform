// EmployerKPICard — small tile used in the Employer Dashboard KPI row.
//
// Visual contract (mirrors ProjectKPICard from the PM workbench):
//   - Surface card with a label (top) and a large value (bottom).
//   - The accent colour paints the value text. Pick from the same set
//     used by the PM KPI tiles (green/blue/amber/purple) so the employer
//     dashboard sits naturally next to the workbench when the side-by-side
//     layout lands.
//   - `value` is rendered verbatim. Callers format currency / count
//     strings (e.g. "¥1,200" or "9") before passing them in.
//   - Optional `subText` renders as a small caption beneath the label —
//     used by the "本月花费" tile to display "📡 权威源: <erp-id>"
//     (deferred to S7 ERP settings, but the slot is reserved here).
//
// The accent selector is mirrored from pm-portal.css's
// `.pm-kpi-tile[data-accent="..."] .pm-kpi-value { color: ... }`. We
// re-declare the same data-* selector in employer-portal.css so the styling
// slots in without a second stylesheet rule.

export type EmployerKpiAccent = 'green' | 'blue' | 'amber' | 'purple';

interface EmployerKPICardProps {
  label: string;
  value: string | number;
  accent?: EmployerKpiAccent;
  /** Optional caption rendered beneath the label (e.g. "📡 权威源: ERP-A"). */
  subText?: string;
  testId?: string;
}

export function EmployerKPICard({
  label,
  value,
  accent = 'blue',
  subText,
  testId,
}: EmployerKPICardProps) {
  return (
    <div
      className="employer-kpi-tile"
      data-accent={accent}
      data-testid={testId}
    >
      <div
        className="employer-kpi-value"
        data-testid={testId ? `${testId}-value` : undefined}
      >
        {value}
      </div>
      <div className="employer-kpi-label">{label}</div>
      {subText && (
        <div
          className="employer-kpi-sub"
          data-testid={testId ? `${testId}-sub` : undefined}
        >
          {subText}
        </div>
      )}
    </div>
  );
}