import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PMSidebar } from '../PMSidebar';
import { setSession, clearSession } from '../../../lib/candidate-session';

describe('PMSidebar', () => {
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
        <PMSidebar />
      </MemoryRouter>,
    );
  }

  it('renders the sidebar brand "PM Workbench"', () => {
    renderAt('/pm/projects');
    const sidebar = screen.getByTestId('pm-sidebar');
    expect(within(sidebar).getByText('PM Workbench')).toBeInTheDocument();
  });

  it('renders all four navigation links with correct href values', () => {
    renderAt('/pm/projects');
    const nav = screen.getByLabelText('PM navigation');
    const links = within(nav).getAllByRole('link');
    const map = Object.fromEntries(
      links.map((a) => [a.textContent, a.getAttribute('href')]),
    );
    expect(map['📊 总览']).toBe('/pm/snapshot');
    expect(map['📁 项目']).toBe('/pm/projects');
    expect(map['👥 人才库']).toBe('/pm/library');
    expect(map['⚙️ 我的']).toBe('/pm/settings');
  });

  it('renders the sidebar logout button when a PM session is present', () => {
    renderAt('/pm/projects');
    expect(screen.getByTestId('pm-sidebar-logout')).toBeInTheDocument();
  });

  it('hides the sidebar logout button when no session is set', () => {
    renderAt('/pm/projects', /* withSession */ false);
    expect(screen.queryByTestId('pm-sidebar-logout')).toBeNull();
  });

  it('marks the currently-active route link with .active', () => {
    renderAt('/pm/projects');
    const projectsLink = screen.getByText(/项目/).closest('a')!;
    expect(projectsLink.className).toContain('pm-sidebar-link');
    expect(projectsLink.className).toContain('active');
  });

  it('does not mark other sidebar links as active for the current route', () => {
    renderAt('/pm/projects');
    expect(screen.getByText(/总览/).closest('a')!.className).not.toContain('active');
    expect(screen.getByText(/人才库/).closest('a')!.className).not.toContain('active');
    expect(screen.getByText(/我的/).closest('a')!.className).not.toContain('active');
  });

  it('clicking logout clears the session from localStorage', () => {
    renderAt('/pm/projects');
    expect(localStorage.getItem('hp_candidate_session')).not.toBeNull();
    fireEvent.click(screen.getByTestId('pm-sidebar-logout'));
    expect(localStorage.getItem('hp_candidate_session')).toBeNull();
  });
});
