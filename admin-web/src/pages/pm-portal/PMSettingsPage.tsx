// ============================================================================
// PMSettingsPage (Task 12 / S7)
//
// Rewritten from the placeholder profile card into the S7 ERP settings
// surface. Four sections, stacked top-to-bottom:
//
//   1. <ErpConnectionForm> — backend radio (MOCK | ow-headhunter-erp) +
//                           URL/Token inputs + Save / Test buttons
//   2. <ErpStatusTable>   — current backend / URL / 已发布数 (read-only)
//   3. <ErpCallLog>       — monospace pre block of recent mock API calls
//
// v1 behaviour (no backend integration exists yet):
//   - Form state is held in `useState` and persisted to
//     `localStorage['pm.settings.erp']` on Save.
//   - "测试连接" returns a fake success toast after a 1s delay.
//   - "API 调用日志" is a hard-coded mock list shown for inspection.
//
// Reference: prototype.html lines 1660-1707 (S7 full settings surface).
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { ErpConnectionForm, type ErpConfig, type ErpBackend } from '../../components/pm-portal/ErpConnectionForm';
import { ErpStatusTable } from '../../components/pm-portal/ErpStatusTable';
import { ErpCallLog, type CallLogEntry } from '../../components/pm-portal/ErpCallLog';
import { useToast } from '@hunter-platform/shared-web/lib';

const STORAGE_KEY = 'pm.settings.erp';

const DEFAULT_CONFIG: ErpConfig = {
  backend: 'MOCK',
  url: '',
  token: '',
};

function readStoredConfig(): ErpConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<ErpConfig>;
    const backend: ErpBackend = parsed.backend === 'ow-headhunter-erp' ? 'ow-headhunter-erp' : 'MOCK';
    return {
      backend,
      url: typeof parsed.url === 'string' ? parsed.url : '',
      token: typeof parsed.token === 'string' ? parsed.token : '',
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function buildMockCallLog(): CallLogEntry[] {
  const now = Date.now();
  return [
    { ts: now - 5 * 60_000, method: 'GET', path: '/api/positions', status: 200, ms: 28 },
    { ts: now - 4 * 60_000, method: 'GET', path: '/api/positions/pos-1', status: 200, ms: 31 },
    { ts: now - 3 * 60_000, method: 'POST', path: '/api/candidates/match', status: 201, ms: 412 },
    { ts: now - 2 * 60_000, method: 'GET', path: '/api/sandbox/pos-1', status: 200, ms: 76 },
    { ts: now - 60_000, method: 'POST', path: '/api/publish', status: 200, ms: 188 },
  ];
}

export function PMSettingsPage() {
  const toast = useToast();

  // ---- Local state (form + status + log) ----------------------------------
  // Seed from localStorage so a Save persists across reloads. The publish
  // count is reset to 0 every render — for v1 it's a stable mock number.
  const [config, setConfig] = useState<ErpConfig>(() => readStoredConfig());
  const [published, setPublished] = useState(0);
  const [isTesting, setIsTesting] = useState(false);

  const callLog = useMemo(() => buildMockCallLog(), []);

  // ---- Persistence -------------------------------------------------------
  // Defensive re-read on mount in case another tab wrote a newer value
  // before this page hydrated. No-op in jsdom-less environments.
  useEffect(() => {
    setConfig(readStoredConfig());
  }, []);

  const handleSave = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      toast.push({ type: 'success', message: 'ERP 设置已保存' });
    } catch {
      toast.push({ type: 'error', message: '保存失败：无法写入本地存储' });
    }
  };

  const handleTest = () => {
    if (isTesting) return;
    setIsTesting(true);
    window.setTimeout(() => {
      setIsTesting(false);
      setPublished((n) => n + 1);
      toast.push({
        type: 'success',
        message:
          config.backend === 'MOCK'
            ? '测试连接成功（MOCK 后端）'
            : `测试连接成功：${config.url || 'ow-headhunter-erp'}`,
      });
    }, 1000);
  };

  return (
    <section className="pm-settings" data-testid="pm-settings">
      <h1 className="pm-settings-title">设置</h1>
      <p className="pm-settings-subtitle">
        PM Workbench ERP 后端连接（v1 — 仅本地存储）
      </p>

      <ErpConnectionForm
        value={config}
        onChange={setConfig}
        onTest={handleTest}
        onSave={handleSave}
      />

      <ErpStatusTable config={config} published={published} />

      <ErpCallLog entries={callLog} />
    </section>
  );
}