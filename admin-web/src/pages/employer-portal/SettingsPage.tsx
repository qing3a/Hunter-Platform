import { useState } from 'react';
import { getSession } from '../../lib/candidate-session';
import { useToast } from '@hunter-platform/shared-web/lib';

// ============================================================================
// SettingsPage (Employer Portal — Task 9)
//
// v1 is intentionally read-only:
//   - 公司信息 comes from the session + a few placeholders for fields the
//     backend doesn't expose yet (公司名称 / 行业 / 规模). The page is
//     honest about that with a "v1 暂不可编辑" notice and the contact
//     email comes from `session.email` (the only company-shaped value
//     CandidateSession currently carries).
//   - 通知偏好 are local React state — no backend endpoint exists to
//     persist them, so the toggles flip freely but a reload resets them.
//     Wired up so a future patch endpoint can swap the useState setters
//     for a mutation without touching the JSX.
//   - API Key is the literal `session.api_key` string. The 复制 button
//     uses the modern `navigator.clipboard.writeText` API; on success
//     the button label flips to 已复制 and a toast confirms.
//
// No new backend endpoints are introduced here — this entire surface is
// driven by what's already in `localStorage['hp_candidate_session']`.
// ============================================================================

export function SettingsPage() {
  const session = getSession();
  const toast = useToast();

  // ---- Notification toggle state (local only; not persisted in v1) -------
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyInApp, setNotifyInApp] = useState(true);

  // ---- Copy-to-clipboard state --------------------------------------------
  const [copied, setCopied] = useState(false);

  const apiKey = session?.api_key ?? '';
  const userId = session?.user_id ?? '-';
  const email = session?.email ?? '-';
  const role = session?.role ?? '-';

  const handleCopyApiKey = async () => {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      toast.push({ type: 'success', message: 'API Key 已复制到剪贴板' });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.push({ type: 'error', message: '复制失败：浏览器剪贴板不可用' });
    }
  };

  return (
    <div className="employer-settings" data-testid="employer-settings-root">
      <header className="employer-settings-header">
        <h1 className="employer-settings-title" data-testid="employer-settings-title">
          ⚙️ 设置
        </h1>
        <p className="employer-settings-subtitle">v1 — 仅本地状态，会话字段只读</p>
      </header>

      {/* ====== Section 1: 公司信息 (read-only) ====== */}
      <section
        className="employer-settings-section"
        data-testid="employer-settings-section-company"
      >
        <h2 className="employer-settings-section-title">公司信息</h2>
        <div className="employer-settings-row">
          <span className="employer-settings-label">公司名称</span>
          <span className="employer-settings-value">未设置</span>
        </div>
        <div className="employer-settings-row">
          <span className="employer-settings-label">行业</span>
          <span className="employer-settings-value">未设置</span>
        </div>
        <div className="employer-settings-row">
          <span className="employer-settings-label">规模</span>
          <span className="employer-settings-value">未设置</span>
        </div>
        <div className="employer-settings-row">
          <span className="employer-settings-label">联系人邮箱</span>
          <span
            className="employer-settings-value"
            data-testid="employer-settings-company-email"
          >
            {email}
          </span>
        </div>
        <div className="employer-settings-row">
          <span className="employer-settings-label">用户 ID</span>
          <span className="employer-settings-value" data-testid="employer-settings-user-id">
            {userId}
          </span>
        </div>
        <div className="employer-settings-row">
          <span className="employer-settings-label">角色</span>
          <span className="employer-settings-value" data-testid="employer-settings-role">
            {role}
          </span>
        </div>
        <p className="employer-settings-notice">公司信息编辑功能即将上线</p>
      </section>

      {/* ====== Section 2: 通知偏好 (mock toggles) ====== */}
      <section
        className="employer-settings-section"
        data-testid="employer-settings-section-notifications"
      >
        <h2 className="employer-settings-section-title">通知偏好</h2>
        <label className="employer-settings-row" htmlFor="employer-settings-notify-email">
          <span className="employer-settings-label">邮件通知 · 匹配 / 解锁 / 成交 时通知</span>
          <input
            id="employer-settings-notify-email"
            type="checkbox"
            checked={notifyEmail}
            onChange={(e) => setNotifyEmail(e.target.checked)}
            data-testid="employer-settings-notify-email"
          />
        </label>
        <label className="employer-settings-row" htmlFor="employer-settings-notify-inapp">
          <span className="employer-settings-label">站内信 · 实时通知</span>
          <input
            id="employer-settings-notify-inapp"
            type="checkbox"
            checked={notifyInApp}
            onChange={(e) => setNotifyInApp(e.target.checked)}
            data-testid="employer-settings-notify-inapp"
          />
        </label>
        <p className="employer-settings-notice">通知偏好保存功能即将上线</p>
      </section>

      {/* ====== Section 3: API Key (read-only display + copy) ====== */}
      <section
        className="employer-settings-section"
        data-testid="employer-settings-section-api-key"
      >
        <h2 className="employer-settings-section-title">API Key</h2>
        <p className="employer-settings-hint">用于外部 Agent 集成（v1 仅展示）</p>
        <div className="employer-settings-row employer-settings-row-api">
          <code
            className="employer-settings-api-key-value"
            data-testid="employer-settings-api-key-value"
          >
            {apiKey || '（未登录）'}
          </code>
          <button
            type="button"
            className="employer-settings-api-key-copy"
            onClick={handleCopyApiKey}
            disabled={!apiKey}
            data-testid="employer-settings-api-key-copy"
          >
            {copied ? '已复制' : '复制'}
          </button>
          {copied && (
            <span
              className="employer-settings-api-key-copied"
              data-testid="employer-settings-api-key-copied"
            >
              ✓ 已复制到剪贴板
            </span>
          )}
        </div>
        <p className="employer-settings-notice">外部 Agent 接入文档即将上线</p>
      </section>
    </div>
  );
}