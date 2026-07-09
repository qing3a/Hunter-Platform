import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EmployerSidebar } from '../EmployerSidebar';
import { setSession, clearSession } from '../../../lib/candidate-session';

describe('EmployerSidebar', () => {
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
        <EmployerSidebar />
      </MemoryRouter>,
    );
  }

  it('renders the sidebar brand "雇主门户 · 工作台"', () => {
    renderAt('/admin/employer/dashboard');
    const sidebar = screen.getByTestId('employer-sidebar');
    expect(within(sidebar).getByText('雇主门户 · 工作台')).toBeInTheDocument();
  });

  it('renders all four navigation links with correct href values', () => {
    renderAt('/admin/employer/dashboard');
    const nav = screen.getByLabelText('Employer navigation');
    const links = within(nav).getAllByRole('link');
    const map: Record<string, { href: string | null; text: string | null }> = {};
    for (const a of links) {
      const href = a.getAttribute('href');
      if (href) map[href] = { href, text: a.textContent };
    }
    expect(map['/admin/employer/dashboard']?.text).toContain('总览');
    expect(map['/admin/employer/jobs']?.text).toContain('岗位');
    expect(map['/admin/employer/candidates']?.text).toContain('人才');
    expect(map['/admin/employer/placements']?.text).toContain('成交');
  });

  it('renders the sidebar logout button when an employer session is present', () => {
    renderAt('/admin/employer/dashboard');
    expect(screen.getByTestId('employer-sidebar-logout')).toBeInTheDocument();
  });

  it('hides the sidebar logout button when no session is set', () => {
    renderAt('/admin/employer/dashboard', /* withSession */ false);
    expect(screen.queryByTestId('employer-sidebar-logout')).toBeNull();
  });

  it('marks the currently-active route link with .active', () => {
    renderAt('/admin/employer/dashboard');
    const dashboardLink = screen.getByText(/总览/).closest('a')!;
    expect(dashboardLink.className).toContain('employer-sidebar-link');
    expect(dashboardLink.className).toContain('active');
  });

  it('does not mark other sidebar links as active for the current route', () => {
    renderAt('/admin/employer/dashboard');
    expect(screen.getByText(/岗位/).closest('a')!.className).not.toContain('active');
    expect(screen.getByText(/人才/).closest('a')!.className).not.toContain('active');
    expect(screen.getByText(/成交/).closest('a')!.className).not.toContain('active');
  });

  it('marks the jobs link as active when the route starts with /admin/employer/jobs', () => {
    renderAt('/admin/employer/jobs');
    const jobsLink = screen.getByText(/岗位/).closest('a')!;
    expect(jobsLink.className).toContain('active');
    expect(screen.getByText(/总览/).closest('a')!.className).not.toContain('active');
  });

  it('clicking logout clears the session from localStorage', () => {
    renderAt('/admin/employer/dashboard');
    expect(localStorage.getItem('hp_candidate_session')).not.toBeNull();
    fireEvent.click(screen.getByTestId('employer-sidebar-logout'));
    expect(localStorage.getItem('hp_candidate_session')).toBeNull();
  });
});