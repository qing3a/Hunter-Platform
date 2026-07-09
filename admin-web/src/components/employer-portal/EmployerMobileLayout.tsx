import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { getSession, clearSession } from '../../lib/candidate-session';
import { EmployerSidebar } from './EmployerSidebar';

/**
 * Employer Panel — route shell (Phase 3c, Task 4).
 *
 * Mounted as a route-level element behind `<RequireEmployerAuth>`:
 *
 *   <Route element={
 *     <RequireEmployerAuth>
 *       <EmployerMobileLayout />
 *     </RequireEmployerAuth>
 *   }>
 *     <Route path="/admin/employer/dashboard" element={<EmployerDashboardPage />} />
 *     ...
 *   </Route>
 *
 * Mirrors `PMMobileLayout`: couples the mobile + desktop chrome into a
 * single component (sidebar on the desktop media query, mobile tab bar on
 * mobile) so the route tree doesn't need a separate wrapper for each.
 * The child page is rendered through React Router's `<Outlet />`.
 *
 * Brand:
 *   - top bar reads "雇主门户 · 工作台"
 *   - accent uses the position-stage token (var(--c-stage-position)) so
 *     the chrome feels native with the existing `.employer-` pages
 *   - logout button calls `clearSession()` and bounces back to
 *     `/admin/employer/login` (same behaviour as the PM / hunter portals)
 *
 * Tab bar (mobile ≤768px) — kept in sync with EmployerSidebar's nav list:
 *   - 总览     -> /admin/employer/dashboard
 *   - 岗位     -> /admin/employer/jobs
 *   - 人才     -> /admin/employer/candidates
 *   - 成交     -> /admin/employer/placements
 */
export function EmployerMobileLayout() {
  const session = getSession();
  const navigate = useNavigate();

  return (
    <div className="employer-page" data-testid="employer-page">
      <EmployerSidebar />
      <div className="employer-layout">
        <header className="employer-topbar" data-testid="employer-topbar">
          <div className="employer-brand">雇主门户 · 工作台</div>
          <div className="employer-spacer" />
          {session && (
            <button
              type="button"
              className="employer-logout"
              onClick={() => {
                clearSession();
                navigate('/admin/employer/login');
              }}
              data-testid="employer-logout"
            >
              退出
            </button>
          )}
        </header>
        <main className="employer-main" data-testid="employer-main">
          <Outlet />
        </main>
        {session && (
          <nav className="employer-tabbar" data-testid="employer-tabbar">
            <NavLink to="/admin/employer/dashboard" className="employer-tab">
              📊 总览
            </NavLink>
            <NavLink to="/admin/employer/jobs" className="employer-tab">
              💼 岗位
            </NavLink>
            <NavLink to="/admin/employer/candidates" className="employer-tab">
              👤 人才
            </NavLink>
            <NavLink to="/admin/employer/placements" className="employer-tab">
              🤝 成交
            </NavLink>
          </nav>
        )}
      </div>
    </div>
  );
}