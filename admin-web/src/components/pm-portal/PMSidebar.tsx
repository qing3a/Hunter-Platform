import { NavLink, useNavigate } from 'react-router-dom';
import { getSession, clearSession } from '../../lib/candidate-session';

/**
 * PM Workbench — desktop sidebar (Phase 3b / Task 17).
 *
 * Mirrors `HunterSidebar`: vertical list of links to the four primary
 * surfaces, brand strip on top, optional logout at the bottom. Hidden
 * below the desktop breakpoint (controlled in `pm-portal.css`) because
 * the mobile layout uses the bottom tab bar instead.
 *
 * Nav surface map (kept in sync with PMMobileLayout's tab bar):
 *   - 总览   -> /pm/snapshot
 *   - 项目   -> /pm/projects
 *   - 人才库 -> /pm/library
 *   - 我的   -> /pm/settings
 *
 * The sidebar lives outside the `<Outlet />` and is rendered by
 * `PMMobileLayout`, so individual pages don't have to wire it up.
 */
export function PMSidebar() {
  const session = getSession();
  const navigate = useNavigate();

  return (
    <aside className="pm-sidebar" data-testid="pm-sidebar">
      <div className="pm-sidebar-brand">PM Workbench</div>
      <nav className="pm-sidebar-nav" aria-label="PM navigation">
        <NavLink to="/pm/snapshot" className="pm-sidebar-link">📊 总览</NavLink>
        <NavLink to="/pm/projects" className="pm-sidebar-link">📁 项目</NavLink>
        <NavLink to="/pm/library" className="pm-sidebar-link">👥 人才库</NavLink>
        <NavLink to="/pm/settings" className="pm-sidebar-link">⚙️ 我的</NavLink>
      </nav>
      {session && (
        <button
          type="button"
          className="pm-sidebar-logout"
          onClick={() => { clearSession(); navigate('/pm/login'); }}
          data-testid="pm-sidebar-logout"
        >
          退出
        </button>
      )}
    </aside>
  );
}
