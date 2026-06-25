import { describe, it, expect } from 'vitest';
import { renderHook, act, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useSearchParams } from 'react-router-dom';
import { useTimelineFilters } from '../../src/hooks/useTimelineFilters';

// Helper: a component that exposes the current URL search via a data attribute
// so tests can read the live URL after setSearchParams updates.
function LocationProbe({ searchIdAttr }: { searchIdAttr: string }) {
  const loc = useLocation();
  return <div data-testid={searchIdAttr} data-search={loc.search} />;
}

// We render the hook + a probe in the same MemoryRouter so the probe's
// useLocation() reflects URL changes from setSearchParams.
function renderHookWithRouter(initialUrl: string) {
  let lastSearch = '';
  function CaptureProbe() {
    const loc = useLocation();
    lastSearch = loc.search;
    return null;
  }
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[initialUrl]}>
      <CaptureProbe />
      {children}
    </MemoryRouter>
  );
  const hook = renderHook(() => useTimelineFilters(), { wrapper });
  return { hook, getSearch: () => lastSearch };
}

describe('useTimelineFilters (Sub-D2 follow-up)', () => {
  it('1. defaults when URL has no params', () => {
    const { hook } = renderHookWithRouter('/users/usr_1/timeline');
    expect(hook.result.current.source).toBe('all');
    expect(hook.result.current.from).toBe('');
    expect(hook.result.current.until).toBe('');
    expect(hook.result.current.actor).toBe('');
    expect(hook.result.current.page).toBe(1);
  });

  it('2. reads source/from/until/actor/page from URL', () => {
    const { hook } = renderHookWithRouter('/users/usr_1/timeline?source=admin&from=2026-06-01T00:00:00Z&until=2026-06-30T23:59:59Z&actor=adm_1&page=3');
    expect(hook.result.current.source).toBe('admin');
    expect(hook.result.current.from).toBe('2026-06-01T00:00:00Z');
    expect(hook.result.current.until).toBe('2026-06-30T23:59:59Z');
    expect(hook.result.current.actor).toBe('adm_1');
    expect(hook.result.current.page).toBe(3);
  });

  it('3. invalid source defaults to all', () => {
    const { hook } = renderHookWithRouter('/users/usr_1/timeline?source=garbage');
    expect(hook.result.current.source).toBe('all');
  });

  it('4. setSource("admin") updates URL via setSearchParams', async () => {
    const { hook, getSearch } = renderHookWithRouter('/users/usr_1/timeline');
    await act(async () => {
      hook.result.current.setSource('admin');
    });
    expect(getSearch()).toContain('source=admin');
  });

  it('5. setSource("all") removes source from URL', async () => {
    const { hook, getSearch } = renderHookWithRouter('/users/usr_1/timeline?source=admin');
    await act(async () => {
      hook.result.current.setSource('all');
    });
    expect(getSearch()).not.toContain('source=');
  });

  it('6. setPage(3) updates URL with page=3', async () => {
    const { hook, getSearch } = renderHookWithRouter('/users/usr_1/timeline');
    await act(async () => {
      hook.result.current.setPage(3);
    });
    expect(getSearch()).toContain('page=3');
  });

  it('7. setPage(1) removes page from URL', async () => {
    const { hook, getSearch } = renderHookWithRouter('/users/usr_1/timeline?page=3');
    await act(async () => {
      hook.result.current.setPage(1);
    });
    expect(getSearch()).not.toContain('page=');
  });

  it('8. resetAll clears all filters from URL', async () => {
    const { hook, getSearch } = renderHookWithRouter('/users/usr_1/timeline?source=admin&from=2026-06-01&actor=adm_1&page=2');
    await act(async () => {
      hook.result.current.resetAll();
    });
    const search = getSearch();
    expect(search).not.toContain('source=');
    expect(search).not.toContain('from=');
    expect(search).not.toContain('actor=');
    expect(search).not.toContain('page=');
  });

  it('9. setSource resets page to 1', async () => {
    const { hook, getSearch } = renderHookWithRouter('/users/usr_1/timeline?page=5');
    await act(async () => {
      hook.result.current.setSource('user');
    });
    expect(getSearch()).not.toContain('page=');
  });
});