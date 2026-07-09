import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getSession, clearSession } from '../../lib/candidate-session';

/**
 * Employer Panel — desktop sidebar (Phase 3c, Task 4).
 *
 * Mirrors `PMSidebar`: vertical list of links to the four primary
 * surfaces, brand strip on top, optional logout at the bottom. Hidden
 * below the desktop breakpoint (controlled in `employer-portal.css`)
 * because the mobile layout uses the bottom tab bar instead.
 *
 * Nav surface map (kept in sync with EmployerMobileLayout's tab bar):
 *   - 总览     -> /admin/employer/dashboard
 *   - 岗位库   -> /admin/employer/jobs
 *   - 人才库   -> /admin/employer/candidates
 *   - 成交     -> /admin/employer/placements
 *
 * Tasks 5-9 will wire up the badge counts (active jobs / pending claims /
 * etc.) — for now the sidebar renders the nav links without any counters
 * to keep the Task-4 surface minimal and reviewable.
 *
 * The sidebar lives outside the `<Outlet />` and is rendered by
 * `EmployerMobileLayout`, so individual pages don't have to wire it up.
 */
const NAV = [
  { to: '/admin/employer/dashboard', label: '📊 总览', key: 'dashboard' as const },
  { to: '/admin/employer/jobs', label: '💼 岗位', key: 'jobs' as const },
  { to: '/admin/employer/candidates', label: '👤 人才', key: 'candidates' as const },
  { to: '/admin/employer/placements', label: '🤝 成交', key: 'placements' as const },
];

export function EmployerSidebar() {
  const session = getSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <aside className="employer-sidebar" data-testid="employer-sidebar" aria-label="Employer 导航">
      <div className="employer-sidebar-brand">雇主门户 · 工作台</div>
      <nav className="employer-sidebar-nav" aria-label="Employer navigation">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.to);
          return (
            <Link
              key={item.key}
              to={item.to}
              className={`employer-sidebar-link${active ? ' active' : ''}`}
            >
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      {session && (
        <button
          type="button"
          className="employer-sidebar-logout"
          onClick={() => {
            clearSession();
            navigate('/admin/employer/login');
          }}
          data-testid="employer-sidebar-logout"
        >
          退出
        </button>
      )}
    </aside>
  );
}