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

  it('renders the sidebar brand "猎头平台 · PM 工作台"', () => {
    renderAt('/admin/pm/projects');
    const sidebar = screen.getByTestId('pm-sidebar');
    expect(within(sidebar).getByText('猎头平台 · PM 工作台')).toBeInTheDocument();
  });

  it('renders all four navigation links with correct href values', () => {
    renderAt('/admin/pm/projects');
    const nav = screen.getByLabelText('PM navigation');
    // After Task 2 each link also contains a numeric badge <span>, so
    // the textContent is e.g. "📁 项目库3" — look up the link by its
    // href and assert the label text is *contained* in the link body.
    const links = within(nav).getAllByRole('link');
    const map: Record<string, { href: string | null; text: string | null }> = {};
    for (const a of links) {
      const href = a.getAttribute('href');
      if (href) map[href] = { href, text: a.textContent };
    }
    expect(map['/admin/pm/snapshot']?.text).toContain('总览');
    expect(map['/admin/pm/projects']?.text).toContain('项目库');
    expect(map['/admin/pm/library']?.text).toContain('候选人库');
    expect(map['/admin/pm/settings']?.text).toContain('设置');
  });

  it('renders the sidebar logout button when a PM session is present', () => {
    renderAt('/admin/pm/projects');
    expect(screen.getByTestId('pm-sidebar-logout')).toBeInTheDocument();
  });

  it('hides the sidebar logout button when no session is set', () => {
    renderAt('/admin/pm/projects', /* withSession */ false);
    expect(screen.queryByTestId('pm-sidebar-logout')).toBeNull();
  });

  it('marks the currently-active route link with .active', () => {
    renderAt('/admin/pm/projects');
    // Use the full nav label (项目库) to avoid matching the "暂无项目"
    // empty-state text introduced by the Task 2 sidebar redesign.
    const projectsLink = screen.getByText(/项目库/).closest('a')!;
    expect(projectsLink.className).toContain('pm-sidebar-link');
    expect(projectsLink.className).toContain('active');
  });

  it('does not mark other sidebar links as active for the current route', () => {
    renderAt('/admin/pm/projects');
    expect(screen.getByText(/总览/).closest('a')!.className).not.toContain('active');
    expect(screen.getByText(/候选人库/).closest('a')!.className).not.toContain('active');
    expect(screen.getByText(/设置/).closest('a')!.className).not.toContain('active');
  });

  it('clicking logout clears the session from localStorage', () => {
    renderAt('/admin/pm/projects');
    expect(localStorage.getItem('hp_candidate_session')).not.toBeNull();
    fireEvent.click(screen.getByTestId('pm-sidebar-logout'));
    expect(localStorage.getItem('hp_candidate_session')).toBeNull();
  });

  // ---- Task 2: completeness pill + section labels + badge counts ----

  it('renders the completeness pill (项目数 N / 人才库 N)', () => {
    render(
      <MemoryRouter initialEntries={['/admin/pm/projects']}>
        <PMSidebar badgeCounts={{ projects: 7, library: 142 }} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('pm-sidebar-pill')).toHaveTextContent('项目数 7');
    expect(screen.getByTestId('pm-sidebar-pill')).toHaveTextContent('人才库 142');
  });

  it('renders section labels (🏠 主导航 / 📊 项目视图)', () => {
    render(
      <MemoryRouter initialEntries={['/admin/pm/projects']}>
        <PMSidebar badgeCounts={{ projects: 0, library: 0 }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('🏠 主导航')).toBeInTheDocument();
    expect(screen.getByText('📊 项目视图')).toBeInTheDocument();
  });

  it('renders badge counts next to nav items', () => {
    render(
      <MemoryRouter initialEntries={['/admin/pm/projects']}>
        <PMSidebar badgeCounts={{ projects: 3, library: 12 }} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('pm-sidebar-nav-projects-badge')).toHaveTextContent('3');
    expect(screen.getByTestId('pm-sidebar-nav-library-badge')).toHaveTextContent('12');
  });

  it('falls back to zero when badgeCounts prop is omitted', () => {
    render(
      <MemoryRouter initialEntries={['/admin/pm/projects']}>
        <PMSidebar />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('pm-sidebar-nav-projects-badge')).toHaveTextContent('0');
  });
});
