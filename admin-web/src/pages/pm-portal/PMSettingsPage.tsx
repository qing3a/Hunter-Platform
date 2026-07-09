import { getSession } from '../../lib/candidate-session';

/**
 * PM Workbench — Settings (我的) placeholder (Phase 3b / Task 17).
 *
 * Mirrors HunterSettingsPage in spirit: read-only session card with
 * "coming soon" notice for editable preferences. The real PM-specific
 * settings (notification thresholds, default score band, etc.) ship with
 * Task 18 — for now this just confirms that the route is wired and the
 * chrome renders correctly.
 *
 * Important: no `<PMMobileLayout>` wrapper here. The route-level layout
 * (mounted by `App.tsx` inside `<RequirePMAuth>`) already provides the
 * topbar / sidebar / tabbar, so this page only owns its own content.
 */
export function PMSettingsPage() {
  const session = getSession();

  return (
    <section className="pm-settings" data-testid="pm-settings">
      <h1 className="pm-settings-title">我的</h1>

      <div className="pm-settings-card" data-testid="pm-settings-profile">
        <h2 style={{ margin: 0, fontSize: 16 }}>个人资料</h2>
        <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="pm-settings-row">
            <dt>用户 ID</dt>
            <dd data-testid="pm-settings-user-id">{session?.user_id ?? '-'}</dd>
          </div>
          <div className="pm-settings-row">
            <dt>角色</dt>
            <dd data-testid="pm-settings-role">pm</dd>
          </div>
          <div className="pm-settings-row">
            <dt>邮箱</dt>
            <dd data-testid="pm-settings-email">{session?.email ?? '-'}</dd>
          </div>
        </dl>
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: 'var(--text-muted)',
            fontStyle: 'italic',
          }}
        >
          个人资料编辑功能即将上线
        </p>
      </div>

      <p
        style={{
          marginTop: 16,
          fontSize: 12,
          color: 'var(--text-muted)',
          textAlign: 'center',
        }}
      >
        PM 偏好设置 (通知阈值 / 默认分数) 即将上线
      </p>
    </section>
  );
}
