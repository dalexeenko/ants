import { defineConfig } from '@playwright/test';
import path from 'path';

/**
 * Playwright configuration for testing/debugging the OpenMgr Electron app.
 * 
 * Usage:
 *   - Run tests: pnpm test:e2e
 *   - Debug mode: pnpm test:e2e:debug (opens Playwright inspector)
 *   - UI mode: pnpm test:e2e:ui (opens Playwright UI)
 * 
 * Note: The app must be built first with `pnpm build`
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false, // Electron tests should run sequentially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Only one worker for Electron
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'electron',
      testMatch: '**/*.spec.ts',
    },
  ],
});
