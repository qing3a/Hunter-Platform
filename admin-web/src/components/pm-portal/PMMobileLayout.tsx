import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { getSession, clearSession } from '../../lib/candidate-session';
import { PMSidebar } from './PMSidebar';

/**
 * PM Workbench — route shell (Phase 3b / Task 17).
 *
 * Mounted as a route-level element behind `<RequirePMAuth>`:
 *
 *   <Route element={
 *     <RequirePMAuth>
 *       <PMMobileLayout />
 *     </RequirePMAuth>
 *   }>
 *     <Route path="/pm/projects" element={<ProjectsLibraryPage />} />
 *     ...
 *   </Route>
 *
 * Mirrors `HunterMobileLayout` but couples the mobile + desktop chrome into a
 * single component (PM sidebar appears on the desktop media query, mobile
 * tab bar on mobile) so the route tree doesn't need a separate wrapper for
 * each.  The child page is rendered through React Router's `<Outlet />`.
 *
 * Brand:
 *   - top bar reads "猎头平台 · PM 工作台"
 *   - accent uses `var(--c-project)` so the workbench feels native with
 *     the existing `.pm-` pages
 *   - logout button calls `clearSession()` and bounces back to `/pm/login`
 *     (same behaviour as the hunter portal)
 */
export function PMMobileLayout() {
  const session = getSession();
  const navigate = useNavigate();

  return (
    <div className="pm-page" data-testid="pm-page">
      <PMSidebar />
      <div className="pm-layout">
        <header className="pm-topbar" data-testid="pm-topbar">
          <div className="pm-brand">猎头平台 · PM 工作台</div>
          <div className="pm-spacer" />
          {session && (
            <button
              type="button"
              className="pm-logout"
              onClick={() => { clearSession(); navigate('/pm/login'); }}
              data-testid="pm-logout"
            >
              退出
            </button>
          )}
        </header>
        <main className="pm-main" data-testid="pm-main">
          <Outlet />
        </main>
        {session && (
          <nav className="pm-tabbar" data-testid="pm-tabbar">
            <NavLink to="/pm/snapshot" className="pm-tab">📊 总览</NavLink>
            <NavLink to="/pm/projects" className="pm-tab">📁 项目</NavLink>
            <NavLink to="/pm/library" className="pm-tab">👥 人才库</NavLink>
            <NavLink to="/pm/settings" className="pm-tab">⚙️ 我的</NavLink>
          </nav>
        )}
      </div>
    </div>
  );
}
