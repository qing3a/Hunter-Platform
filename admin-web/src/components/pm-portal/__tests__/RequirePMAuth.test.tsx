import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RequirePMAuth } from '../RequirePMAuth';
import { setSession, clearSession } from '../../../lib/candidate-session';

// Capture the props of the last rendered <Navigate /> so we can assert on `to` / `state`.
// We mock react-router-dom but keep everything else (MemoryRouter, useLocation) real.
let lastNavigateTo: string | undefined;
let lastNavigateState: unknown;
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    Navigate: ({ to, state }: { to: string; state?: unknown }) => {
      lastNavigateTo = to;
      lastNavigateState = state;
      return null;
    },
  };
});

describe('RequirePMAuth', () => {
  beforeEach(() => {
    clearSession();
    lastNavigateTo = undefined;
    lastNavigateState = undefined;
    cleanup();
  });

  it('redirects to /pm/login when there is no session', () => {
    render(
      <MemoryRouter initialEntries={['/pm/projects']}>
        <RequirePMAuth>
          <div data-testid="content">pm content</div>
        </RequirePMAuth>
      </MemoryRouter>,
    );

    expect(lastNavigateTo).toBe('/pm/login');
    expect(screen.queryByTestId('content')).toBeNull();
  });

  it('renders children when session.role is "pm"', () => {
    setSession({
      api_key: 'hp_live_pm_abc',
      user_id: 'u-pm',
      profile_complete: true,
      role: 'pm',
    });

    render(
      <MemoryRouter initialEntries={['/pm/projects']}>
        <RequirePMAuth>
          <div data-testid="content">pm content</div>
        </RequirePMAuth>
      </MemoryRouter>,
    );

    expect(lastNavigateTo).toBeUndefined();
    expect(screen.getByTestId('content')).toHaveTextContent('pm content');
  });

  it('redirects to /candidate/login when session.role is "candidate"', () => {
    setSession({
      api_key: 'hp_live_abc',
      user_id: 'u-cand',
      profile_complete: true,
      role: 'candidate',
    });

    render(
      <MemoryRouter initialEntries={['/pm/projects']}>
        <RequirePMAuth>
          <div data-testid="content">pm content</div>
        </RequirePMAuth>
      </MemoryRouter>,
    );

    expect(lastNavigateTo).toBe('/candidate/login');
    expect((lastNavigateState as { reason?: string } | undefined)?.reason).toBe('wrong_portal');
    expect(screen.queryByTestId('content')).toBeNull();
  });

  it('redirects to /candidate/login when session.role is "headhunter"', () => {
    setSession({
      api_key: 'hp_live_abc',
      user_id: 'u-hunter',
      profile_complete: true,
      role: 'headhunter',
    });

    render(
      <MemoryRouter initialEntries={['/pm/projects']}>
        <RequirePMAuth>
          <div data-testid="content">pm content</div>
        </RequirePMAuth>
      </MemoryRouter>,
    );

    expect(lastNavigateTo).toBe('/candidate/login');
    expect((lastNavigateState as { reason?: string } | undefined)?.reason).toBe('wrong_portal');
    expect(screen.queryByTestId('content')).toBeNull();
  });

  it('redirects to /candidate/login for legacy session without a role field', () => {
    // Legacy candidate sessions omit `role` entirely.
    setSession({
      api_key: 'hp_live_abc',
      user_id: 'u-legacy',
      profile_complete: true,
    });

    render(
      <MemoryRouter initialEntries={['/pm/projects']}>
        <RequirePMAuth>
          <div data-testid="content">pm content</div>
        </RequirePMAuth>
      </MemoryRouter>,
    );

    expect(lastNavigateTo).toBe('/candidate/login');
    expect((lastNavigateState as { reason?: string } | undefined)?.reason).toBe('wrong_portal');
    expect(screen.queryByTestId('content')).toBeNull();
  });
});
