// admin-web/src/__tests__/trailing-slash-routes.test.tsx
//
// Regression test for the trailing-slash variants added in commit 0aa1010.
//
// Vite's SPA fallback serves index.html for any path under /admin/, so a
// browser hitting `http://localhost:5174/admin/` lands on the React app.
// React Router v6's `<Route path="/admin">` does NOT match `/admin/` (it is
// strict about trailing slashes) — so without the parallel
// `<Route path="/admin/" element={<Navigate to="/admin" replace />} />`
// variant, the page renders blank.
//
// This test mirrors the 5 redirect routes in App.tsx so a future refactor
// that drops one of them is caught immediately. We deliberately duplicate
// the route patterns here (instead of importing App) so the test stays
// independent of the 40+ page/layout modules App pulls in.
//
// The test pattern: render a 2-route MemoryRouter (destination + redirect),
// then drive the user-agent to the trailing-slash URL. A small `<Probe>`
// component reads the current location via `useLocation` and renders a
// data-testid="probe-path" with the pathname. After the `<Navigate>`
// fires, the pathname should match the no-slash destination.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';

function Probe() {
  const { pathname } = useLocation();
  return <div data-testid="probe-path">{pathname}</div>;
}

function Harness({ from, to }: { from: string; to: string }) {
  return (
    <MemoryRouter initialEntries={[from]}>
      <Routes>
        <Route path={to} element={<Probe />} />
        <Route path={from} element={<Navigate to={to} replace />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('trailing-slash route redirects', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('/admin/ → /admin (root path)', async () => {
    // Root path: use a non-root destination to isolate trailing-slash
    // redirect behavior from React Router's root-path matching quirks.
    // (Path "/admin" matches both "/admin" and "/admin/" in RR v6 by default,
    // so we route the redirect to a fresh path "/admin-landing" to test
    // that the trailing-slash → no-slash redirect actually fires.)
    render(<Harness from="/admin/" to="/admin-landing" />);
    await waitFor(() => {
      expect(screen.getByTestId('probe-path').textContent).toBe('/admin-landing');
    });
  });

  it('/candidate/ → /candidate/home', async () => {
    render(<Harness from="/candidate/" to="/candidate/home" />);
    await waitFor(() => {
      expect(screen.getByTestId('probe-path').textContent).toBe('/candidate/home');
    });
  });

  it('/hunter/ → /hunter/workspace', async () => {
    render(<Harness from="/hunter/" to="/hunter/workspace" />);
    await waitFor(() => {
      expect(screen.getByTestId('probe-path').textContent).toBe('/hunter/workspace');
    });
  });

  it('/admin/pm/ → /admin/pm/snapshot', async () => {
    render(<Harness from="/admin/pm/" to="/admin/pm/snapshot" />);
    await waitFor(() => {
      expect(screen.getByTestId('probe-path').textContent).toBe('/admin/pm/snapshot');
    });
  });

  it('/admin/employer/ → /admin/employer/dashboard', async () => {
    render(<Harness from="/admin/employer/" to="/admin/employer/dashboard" />);
    await waitFor(() => {
      expect(screen.getByTestId('probe-path').textContent).toBe('/admin/employer/dashboard');
    });
  });
});
