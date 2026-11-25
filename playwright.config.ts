import { defineConfig } from '@playwright/test';

/*
 * End-to-end tests of the desktop app: `npm run e2e` (builds first with `npm run build` if `out/` is missing).
 * One app at a time: each test starts its own RackDraw with its own temporary data folder.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
