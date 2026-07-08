import { useState } from 'react';
import { HunterMobileLayout } from '../../components/hunter-portal/HunterMobileLayout';
import { HunterSidebar } from '../../components/hunter-portal/HunterSidebar';
import { getSession } from '../../lib/candidate-session';

// Default kanban column names — the UI is intentionally un-wired per the
// spec ("UI only, no tests required"). When the backend exposes a PATCH
// endpoint, these local state values are what the page would submit.
const DEFAULT_COLUMNS: Array<{ stage: string; name: string }> = [
  { stage: 'submitted', name: '投递' },
  { stage: 'screen_passed', name: '简历过' },
  { stage: 'interview', name: '面试' },
  { stage: 'offer', name: 'Offer' },
  { stage: 'onboarded', name: '到岗' },
];

/**
 * Hunter Portal — Settings page (Phase 3a / Task 16).
 *
 * Read-only profile + UI-only preferences placeholder. Per the spec, this
 * page is intentionally minimal: no edit endpoint exists yet, so
 *
 *   - profile is rendered from `candidate-session` (no save),
 *   - notification checkboxes are visual placeholders (no submit handler),
 *   - kanban column names are local-state inputs (no save).
 *
 * YAGNI: no tests, no persistence, no mutation. When the backend adds the
 * corresponding endpoints, this page becomes the place to wire them.
 */
export function HunterSettingsPage() {
  const session = getSession();
  const [notifyStageChange, setNotifyStageChange] = useState(true);
  const [notifyNewPickup, setNotifyNewPickup] = useState(true);
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);

  return (
    <div className="hp-page" data-testid="hp-page-settings">
      <HunterSidebar />
      <HunterMobileLayout title="我的">
        <section className="hp-settings-section" data-testid="hp-settings-profile">
          <h2>个人资料</h2>
          <div className="hp-settings-row">
            <span className="hp-settings-label">用户 ID</span>
            <span data-testid="hp-settings-user-id">{session?.user_id ?? '-'}</span>
          </div>
          <div className="hp-settings-row">
            <span className="hp-settings-label">角色</span>
            <span data-testid="hp-settings-role">headhunter</span>
          </div>
          <div className="hp-settings-row">
            <span className="hp-settings-label">邮箱</span>
            <span data-testid="hp-settings-email">{session?.email ?? '-'}</span>
          </div>
          <p className="hp-settings-notice">个人资料编辑功能即将上线</p>
        </section>

        <section className="hp-settings-section" data-testid="hp-settings-notifications">
          <h2>通知偏好</h2>
          <label className="hp-settings-row" htmlFor="hp-settings-notify-stage">
            <span className="hp-settings-label">阶段变更时邮件通知</span>
            <input
              id="hp-settings-notify-stage"
              type="checkbox"
              checked={notifyStageChange}
              onChange={(e) => setNotifyStageChange(e.target.checked)}
              data-testid="hp-settings-notify-stage"
            />
          </label>
          <label className="hp-settings-row" htmlFor="hp-settings-notify-pickup">
            <span className="hp-settings-label">新自荐到达时邮件通知</span>
            <input
              id="hp-settings-notify-pickup"
              type="checkbox"
              checked={notifyNewPickup}
              onChange={(e) => setNotifyNewPickup(e.target.checked)}
              data-testid="hp-settings-notify-pickup"
            />
          </label>
          <p className="hp-settings-notice">通知偏好保存功能即将上线</p>
        </section>

        <section className="hp-settings-section" data-testid="hp-settings-columns">
          <h2>看板列名</h2>
          {columns.map((col, idx) => (
            <div key={col.stage} className="hp-settings-row" data-testid="hp-settings-col-row">
              <span className="hp-settings-stage-tag">{col.stage}</span>
              <input
                type="text"
                className="hp-settings-col-input"
                value={col.name}
                onChange={(e) => {
                  const next = e.target.value;
                  setColumns((prev) => prev.map((c, i) => (i === idx ? { ...c, name: next } : c)));
                }}
                data-testid="hp-settings-col-input"
                aria-label={`${col.stage} 列名`}
              />
            </div>
          ))}
          <p className="hp-settings-notice">列名保存功能即将上线</p>
        </section>
      </HunterMobileLayout>
    </div>
  );
}
