import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useLocation, Routes, Route } from 'react-router-dom';
import { Fragment, type ReactNode } from 'react';
import { useUrlParam } from '../../src/hooks/useUrlParam';

function Probe() {
  const loc = useLocation();
  return <div data-testid="probe" data-search={loc.search} />;
}

function renderWithUrl(initialUrl: string) {
  let capturedSearch = '';
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialUrl]}>
      <Routes>
        <Route path="*" element={<Fragment><Probe />{children}</Fragment>} />
      </Routes>
    </MemoryRouter>
  );
  const hook = renderHook(() => useUrlParam('test', 'all'), { wrapper });
  return {
    hook,
    getSearch: () => {
      const el = document.querySelector('[data-testid="probe"]');
      return el?.getAttribute('data-search') ?? '';
    },
  };
}

describe('useUrlParam', () => {
  it('1. returns defaultValue when no URL param', () => {
    const { hook } = renderWithUrl('/page');
    expect(hook.result.current[0]).toBe('all');
  });

  it('2. reads URL param value', () => {
    const { hook } = renderWithUrl('/page?test=foo');
    expect(hook.result.current[0]).toBe('foo');
  });

  it('3. setter updates URL', async () => {
    const { hook, getSearch } = renderWithUrl('/page');
    await act(async () => { hook.result.current[1]('bar'); });
    expect(getSearch()).toContain('test=bar');
  });

  it('4. setter with null removes from URL', async () => {
    const { hook, getSearch } = renderWithUrl('/page?test=foo');
    await act(async () => { hook.result.current[1](null); });
    expect(getSearch()).not.toContain('test=');
  });

  it('5. setter with defaultValue removes from URL (keeps URL clean)', async () => {
    const { hook, getSearch } = renderWithUrl('/page?test=foo');
    await act(async () => { hook.result.current[1]('all'); });
    expect(getSearch()).not.toContain('test=');
  });

  it('6. works with custom parser (number-like string)', () => {
    const parser = (v: string | null) => v ? String(Number(v)) : null;
    const r = renderHook(() => useUrlParam('page', '1', parser), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={['/page?page=5']}>
          <Routes>
            <Route path="*" element={<Fragment>{children}</Fragment>} />
          </Routes>
        </MemoryRouter>
      ),
    });
    expect(r.result.current[0]).toBe('5');
  });
});
