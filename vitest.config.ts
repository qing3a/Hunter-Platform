import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    globalSetup: ['./tests/global-setup.ts'],
    testTimeout: 60000,
    // freshApp() boots an in-process Express server + admin auth login on
    // first call which can exceed 10s under Windows + first-cold-start of
    // node:sqlite. Bump the default hookTimeout so beforeAll isn't the
    // bottleneck.
    hookTimeout: 30_000,
  },
});
