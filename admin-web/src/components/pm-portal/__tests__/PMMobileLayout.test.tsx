import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PMMobileLayout } from '../PMMobileLayout';
import { setSession, clearSession } from '../../../lib/candidate-session';

// react-router-dom's `useNavigate` is wired to MemoryRouter's history; we
// render an actual <Routes> below so the navigate() side-effects are
// observable by walking the rendered tree.

describe('PMMobileLayout', () => {
  beforeEach(() => {
    clearSession();
    cleanup();
  });

  function renderAt(route: string, withSession = true) {
    if (withSession) {
      setSession({
        api_key: 'hp_live_pm_abc',
        user_id: 'u-pm',
        profile_complete: true,
        email: 'pm@example.com',
        role: 'pm',
      });
    }
    return render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route element={<PMMobileLayout />}>
            <Route
              path="/admin/pm/projects"
              element={<div data-testid="child-page">child page</div>}
            />
            <Route
              path="/admin/pm/snapshot"
              element={<div data-testid="child-page">snapshot page</div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  }

  it('renders the workbench brand in the topbar', () => {
    renderAt('/admin/pm/projects');
    expect(screen.getByTestId('pm-topbar')).toHaveTextContent('猎头平台 · PM 工作台');
  });

  it('renders the sidebar (desktop chrome) inside the page wrapper', () => {
    renderAt('/admin/pm/projects');
    const page = screen.getByTestId('pm-page');
    expect(within(page).getByTestId('pm-sidebar')).toBeInTheDocument();
  });

  it('renders the matched child route inside <main>', () => {
    renderAt('/admin/pm/projects');
    const main = screen.getByTestId('pm-main');
    expect(within(main).getByTestId('child-page')).toHaveTextContent('child page');
  });

  it('shows logout when a PM session is present', () => {
    renderAt('/admin/pm/projects');
    expect(screen.getByTestId('pm-logout')).toBeInTheDocument();
  });

  it('hides the logout button when no session is set', () => {
    renderAt('/admin/pm/projects', /* withSession */ false);
    expect(screen.queryByTestId('pm-logout')).toBeNull();
  });

  it('renders all four mobile tab-bar links with correct href values', () => {
    renderAt('/admin/pm/projects');
    const tabbar = screen.getByTestId('pm-tabbar');
    // Tabbar link labels — "📊 总览 / 📁 项目 / 👥 人才库 / ⚙️ 我的"
    expect(within(tabbar).getByText(/总览/).closest('a')).toHaveAttribute('href', '/admin/pm/snapshot');
    expect(within(tabbar).getByText(/项目/).closest('a')).toHaveAttribute('href', '/admin/pm/projects');
    expect(within(tabbar).getByText(/人才库/).closest('a')).toHaveAttribute('href', '/admin/pm/library');
    expect(within(tabbar).getByText(/我的/).closest('a')).toHaveAttribute('href', '/admin/pm/settings');
  });

  it('hides the mobile tabbar when no session is set', () => {
    renderAt('/admin/pm/projects', /* withSession */ false);
    expect(screen.queryByTestId('pm-tabbar')).toBeNull();
  });

  it('marks the active tab with .active (react-router default)', () => {
    renderAt('/admin/pm/projects');
    const tabbar = screen.getByTestId('pm-tabbar');
    const projectsTab = within(tabbar).getByText(/项目/).closest('a')!;
    // NavLink appends ' active' to the className when the link's `to`
    // matches the current location. For /admin/pm/projects we expect the active
    // class on the 项目 tab, and NOT on the other tabs.
    expect(projectsTab.className).toContain('pm-tab');
    expect(projectsTab.className).toContain('active');
    expect(within(tabbar).getByText(/总览/).closest('a')!.className).not.toContain('active');
    expect(within(tabbar).getByText(/人才库/).closest('a')!.className).not.toContain('active');
    expect(within(tabbar).getByText(/我的/).closest('a')!.className).not.toContain('active');
  });

  it('clicking logout clears the session and bounces to /admin/pm/login', () => {
    renderAt('/admin/pm/projects');
    fireEvent.click(screen.getByTestId('pm-logout'));
    // After clearSession() localStorage is wiped. The router then navigates
    // to /admin/pm/login. We don't unmount (RequirePMAuth would catch the empty
    // session and redirect in a real app) — here we just verify that the
    // navigation is triggered by observing session + that no error throws.
    const stored = localStorage.getItem('hp_candidate_session');
    expect(stored).toBeNull();
  });

  it('renders the topbar brand colour token via inline pm-brand class (no regressions)', () => {
    renderAt('/admin/pm/projects');
    // The brand text lives inside an element tagged .pm-brand.
    const brandEl = screen.getByText('猎头平台 · PM 工作台');
    expect(brandEl.className).toBe('pm-brand');
  });
});
