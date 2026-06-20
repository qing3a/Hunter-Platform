import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'forks',  // SQLite needs single process
    poolOptions: {
      forks: { singleFork: true },
    },
    globalSetup: ['./tests/global-setup.ts'],
  },
});
