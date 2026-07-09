import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { EmployerMobileLayout } from '../EmployerMobileLayout';
import { setSession, clearSession } from '../../../lib/candidate-session';

// react-router-dom's `useNavigate` is wired to MemoryRouter's history; we
// render an actual <Routes> below so the navigate() side-effects are
// observable by walking the rendered tree.

describe('EmployerMobileLayout', () => {
  beforeEach(() => {
    clearSession();
    cleanup();
  });

  function renderAt(route: string, withSession = true) {
    if (withSession) {
      setSession({
        api_key: 'hp_live_emp_abc',
        user_id: 'u-emp',
        profile_complete: true,
        email: 'emp@example.com',
        role: 'employer',
      });
    }
    return render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route element={<EmployerMobileLayout />}>
            <Route
              path="/admin/employer/dashboard"
              element={<div data-testid="child-page">dashboard</div>}
            />
            <Route
              path="/admin/employer/jobs"
              element={<div data-testid="child-page">jobs</div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  }

  it('renders the workbench brand in the topbar', () => {
    renderAt('/admin/employer/dashboard');
    expect(screen.getByTestId('employer-topbar')).toHaveTextContent('雇主门户 · 工作台');
  });

  it('renders the sidebar (desktop chrome) inside the page wrapper', () => {
    renderAt('/admin/employer/dashboard');
    const page = screen.getByTestId('employer-page');
    expect(within(page).getByTestId('employer-sidebar')).toBeInTheDocument();
  });

  it('renders the matched child route inside <main>', () => {
    renderAt('/admin/employer/dashboard');
    const main = screen.getByTestId('employer-main');
    expect(within(main).getByTestId('child-page')).toHaveTextContent('dashboard');
  });

  it('shows logout when an employer session is present', () => {
    renderAt('/admin/employer/dashboard');
    expect(screen.getByTestId('employer-logout')).toBeInTheDocument();
  });

  it('hides the logout button when no session is set', () => {
    renderAt('/admin/employer/dashboard', /* withSession */ false);
    expect(screen.queryByTestId('employer-logout')).toBeNull();
  });

  it('renders all four mobile tab-bar links with correct href values', () => {
    renderAt('/admin/employer/dashboard');
    const tabbar = screen.getByTestId('employer-tabbar');
    expect(within(tabbar).getByText(/总览/).closest('a')).toHaveAttribute('href', '/admin/employer/dashboard');
    expect(within(tabbar).getByText(/岗位/).closest('a')).toHaveAttribute('href', '/admin/employer/jobs');
    expect(within(tabbar).getByText(/人才/).closest('a')).toHaveAttribute('href', '/admin/employer/candidates');
    expect(within(tabbar).getByText(/成交/).closest('a')).toHaveAttribute('href', '/admin/employer/placements');
  });

  it('hides the mobile tabbar when no session is set', () => {
    renderAt('/admin/employer/dashboard', /* withSession */ false);
    expect(screen.queryByTestId('employer-tabbar')).toBeNull();
  });

  it('marks the active tab with .active (react-router default)', () => {
    renderAt('/admin/employer/dashboard');
    const tabbar = screen.getByTestId('employer-tabbar');
    const dashboardTab = within(tabbar).getByText(/总览/).closest('a')!;
    // NavLink appends ' active' to the className when the link's `to`
    // matches the current location.
    expect(dashboardTab.className).toContain('employer-tab');
    expect(dashboardTab.className).toContain('active');
    expect(within(tabbar).getByText(/岗位/).closest('a')!.className).not.toContain('active');
    expect(within(tabbar).getByText(/人才/).closest('a')!.className).not.toContain('active');
    expect(within(tabbar).getByText(/成交/).closest('a')!.className).not.toContain('active');
  });

  it('clicking logout clears the session', () => {
    renderAt('/admin/employer/dashboard');
    fireEvent.click(screen.getByTestId('employer-logout'));
    const stored = localStorage.getItem('hp_candidate_session');
    expect(stored).toBeNull();
  });
});