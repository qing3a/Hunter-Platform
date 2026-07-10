// ============================================================================
// ErpStatusTable (Task 12 / S7)
//
// Read-only 3-row table that mirrors the current ERP settings + the count of
// published records. Rendered in the middle of `PMSettingsPage`, just below
// the connection form.
//
// The `published` count is fed by the parent for v1 (no live endpoint yet);
// it's the same counter the S5 match publish button increments in real life.
//
// Reference: prototype.html lines 1660-1707 (S7 ERP settings surface).
// ============================================================================

import type { ErpConfig } from './ErpConnectionForm';

interface Props {
  config: ErpConfig;
  published: number;
}

export function ErpStatusTable({ config, published }: Props) {
  return (
    <section className="pm-erp-status" data-testid="pm-erp-status">
      <h3 className="pm-erp-status-title">📊 状态</h3>
      <table data-testid="pm-erp-status-table" className="pm-erp-table">
        <tbody>
          <tr>
            <th>当前后端</th>
            <td>{config.backend}</td>
          </tr>
          <tr>
            <th>URL</th>
            <td>{config.url || '—'}</td>
          </tr>
          <tr>
            <th>已发布数</th>
            <td data-testid="pm-erp-published">{published}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}