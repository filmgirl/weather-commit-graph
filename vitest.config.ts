import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@wcg/shared': fileURLToPath(new URL('./shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    // Generates the demo git fixtures if they are missing, so `npm test` works
    // from a fresh clone without any manual setup step.
    globalSetup: ['./vitest.global-setup.ts'],
    // Generating git fixture repos is slower than a typical unit test.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
