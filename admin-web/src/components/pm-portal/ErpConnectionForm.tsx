// ============================================================================
// ErpConnectionForm (Task 12 / S7)
//
// Controlled form for the ERP connection settings surface (S7). Lets the PM
// pick between the local MOCK backend and the upstream `ow-headhunter-erp`
// service, then enter the URL + bearer token used when the real backend is
// selected. Rendered at the top of `PMSettingsPage`.
//
// The component itself is a dumb controlled widget — it owns no state. The
// parent reads/writes `localStorage['pm.settings.erp']` and passes the value
// in via `value` + `onChange`. Callbacks `onSave` and `onTest` are wired to
// the two action buttons (the parent owns the side-effects: persist + toast).
//
// Reference: prototype.html lines 1660-1707 (S7 ERP settings surface).
// ============================================================================

export type ErpBackend = 'MOCK' | 'ow-headhunter-erp';

export interface ErpConfig {
  backend: ErpBackend;
  url: string;
  token: string;
}

interface Props {
  value: ErpConfig;
  onChange: (v: ErpConfig) => void;
  onTest: () => void;
  onSave: () => void;
}

export function ErpConnectionForm({ value, onChange, onTest, onSave }: Props) {
  return (
    <section className="pm-erp-form" data-testid="pm-erp-form">
      <h3 className="pm-erp-form-title">🔗 ERP 连接配置</h3>

      <div className="pm-erp-radios">
        <label className="pm-erp-radio">
          <input
            type="radio"
            name="pm-erp-backend"
            checked={value.backend === 'MOCK'}
            onChange={() => onChange({ ...value, backend: 'MOCK' })}
            data-testid="pm-erp-backend-mock"
          />
          <span>MOCK（本地）</span>
        </label>
        <label className="pm-erp-radio">
          <input
            type="radio"
            name="pm-erp-backend"
            checked={value.backend === 'ow-headhunter-erp'}
            onChange={() => onChange({ ...value, backend: 'ow-headhunter-erp' })}
            data-testid="pm-erp-backend-erp"
          />
          <span>ow-headhunter-erp</span>
        </label>
      </div>

      <label className="pm-erp-field">
        <span>ERP URL</span>
        <input
          type="text"
          value={value.url}
          onChange={(e) => onChange({ ...value, url: e.target.value })}
          placeholder="https://erp.example.com"
          data-testid="pm-erp-url"
        />
      </label>

      <label className="pm-erp-field">
        <span>Token</span>
        <input
          type="password"
          value={value.token}
          onChange={(e) => onChange({ ...value, token: e.target.value })}
          placeholder="bearer token"
          data-testid="pm-erp-token"
        />
      </label>

      <div className="pm-erp-form-actions">
        <button
          type="button"
          className="pm-btn-primary"
          onClick={onSave}
          data-testid="pm-erp-save"
        >
          💾 保存设置
        </button>
        <button
          type="button"
          className="pm-btn-secondary"
          onClick={onTest}
          data-testid="pm-erp-test"
        >
          🔌 测试连接
        </button>
      </div>
    </section>
  );
}