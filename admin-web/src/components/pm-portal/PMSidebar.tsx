import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getSession, clearSession } from '../../lib/candidate-session';

/**
 * PM Workbench — desktop sidebar (Phase 3b / Task 17, extended by
 * Task 2 of the visual-fidelity plan).
 *
 * Mirrors `HunterSidebar`: vertical list of links to the four primary
 * surfaces, brand strip on top, optional logout at the bottom. Hidden
 * below the desktop breakpoint (controlled in `pm-portal.css`) because
 * the mobile layout uses the bottom tab bar instead.
 *
 * Task 2 additions:
 *   - Completeness pill (项目数 / 人才库 totals) rendered as a <button>
 *     that jumps to /admin/pm/projects.
 *   - Section labels (🏠 主导航 / 📊 项目视图) grouping the nav list and
 *     the (deferred) per-project shortcut list.
 *   - Badge counts next to the projects and library nav items, sourced
 *     from the optional `badgeCounts` prop. The prop defaults to
 *     `{ projects: 0, library: 0 }` so callers that don't yet wire the
 *     counts (e.g. older PMMobileLayout versions) keep rendering.
 *
 * Nav surface map (kept in sync with PMMobileLayout's tab bar):
 *   - 总览     -> /admin/pm/snapshot
 *   - 项目库   -> /admin/pm/projects
 *   - 候选人库 -> /admin/pm/library
 *   - 设置     -> /admin/pm/settings
 *
 * The sidebar lives outside the `<Outlet />` and is rendered by
 * `PMMobileLayout`, so individual pages don't have to wire it up.
 */
export interface PMSidebarProps {
  badgeCounts?: { projects: number; library: number };
}

const NAV = [
  { to: '/admin/pm/snapshot', label: '📊 总览', key: 'snapshot' as const },
  { to: '/admin/pm/projects', label: '📁 项目库', key: 'projects' as const },
  { to: '/admin/pm/library', label: '👤 候选人库', key: 'library' as const },
  { to: '/admin/pm/settings', label: '⚙️ 设置', key: 'settings' as const },
];

/** Keys that should show a numeric badge in the sidebar. */
type BadgeKey = 'projects' | 'library';

export function PMSidebar({ badgeCounts = { projects: 0, library: 0 } }: PMSidebarProps) {
  const session = getSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <aside className="pm-sidebar" data-testid="pm-sidebar" aria-label="PM 导航">
      <div className="pm-sidebar-brand">猎头平台 · PM 工作台</div>
      <button
        type="button"
        className="pm-sidebar-pill"
        data-testid="pm-sidebar-pill"
        onClick={() => { window.location.href = '/admin/pm/projects'; }}
        title="点击查看项目详情"
      >
        <span>项目数 {badgeCounts.projects}</span>
        <span>人才库 {badgeCounts.library}</span>
      </button>
      <div className="pm-sidebar-section">🏠 主导航</div>
      <nav className="pm-sidebar-nav" aria-label="PM navigation">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.to);
          const showBadge = item.key === 'projects' || item.key === 'library';
          return (
            <Link
              key={item.key}
              to={item.to}
              className={`pm-sidebar-link${active ? ' active' : ''}`}
            >
              <span>{item.label}</span>
              {showBadge && (
                <span
                  className="pm-sidebar-badge"
                  data-testid={`pm-sidebar-nav-${item.key}-badge`}
                >
                  {badgeCounts[item.key as BadgeKey]}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="pm-sidebar-section">📊 项目视图</div>
      {/* Per-project shortcut chips — Task 8 defers; place empty state */}
      <div className="pm-sidebar-empty" data-testid="pm-sidebar-no-projects">
        暂无项目
      </div>
      {session && (
        <button
          type="button"
          className="pm-sidebar-logout"
          onClick={() => { clearSession(); navigate('/admin/pm/login'); }}
          data-testid="pm-sidebar-logout"
        >
          退出
        </button>
      )}
    </aside>
  );
}
