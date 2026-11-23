import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setupEnv.ts'],
    // DB-backed suites share one schema, so run files sequentially.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
