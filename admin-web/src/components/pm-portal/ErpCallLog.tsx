// ============================================================================
// ErpCallLog (Task 12 / S7)
//
// Monospaced, scrollable log of the last few ERP API calls. For v1 the
// entries are mock data fed in by the parent (no real backend integration
// exists yet). Each line is formatted as:
//
//   [ISO timestamp] METHOD path → status (ms)
//
// Rendered at the bottom of `PMSettingsPage` so the PM can eyeball recent
// request volume + latency at a glance.
//
// Reference: prototype.html lines 1660-1707 (S7 ERP settings surface).
// ============================================================================

export interface CallLogEntry {
  ts: number;
  method: string;
  path: string;
  status: number;
  ms: number;
}

interface Props {
  entries: CallLogEntry[];
}

export function ErpCallLog({ entries }: Props) {
  return (
    <section className="pm-erp-log" data-testid="pm-erp-log-section">
      <h3 className="pm-erp-log-title">📋 API 调用日志（最近 {entries.length} 条）</h3>
      <pre data-testid="pm-erp-log" className="pm-erp-log-pre">
        {entries
          .map(
            (e) =>
              `[${new Date(e.ts).toISOString()}] ${e.method} ${e.path} → ${e.status} (${e.ms}ms)`,
          )
          .join('\n')}
      </pre>
    </section>
  );
}