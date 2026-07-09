import '@testing-library/jest-dom';

// Silence React Router v7 future-flag deprecation warnings in test output.
// These are informational ("React Router will begin wrapping state updates in
// `React.startTransition` in v7") and fire once per test process via
// `warnOnce`. They add visual noise to the test stderr without indicating
// a real problem — the v6 behavior under test is what we want.
//
// Long-term fix: opt in to the v7 flags by passing
// `future={{ v7_startTransition: true, v7_relativeSplatPath: true }}` to
// every <MemoryRouter>. The pattern below is a no-op for non-router
// warnings.
const __origWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === 'string' && first.includes('React Router Future Flag')) {
    return;
  }
  __origWarn(...args);
};
