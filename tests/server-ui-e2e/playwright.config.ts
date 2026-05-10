import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for testing the OpenMgr server admin UI.
 *
 * The server is started in mock mode via global setup (src/global-setup.ts)
 * and torn down via global teardown. All tests share the same server instance
 * and authenticated session (via storageState).
 */
export default defineConfig({
  testDir: './specs',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  globalSetup: './src/global-setup.ts',
  globalTeardown: './src/global-teardown.ts',
  use: {
    // baseURL is set dynamically in global-setup via an env file
    baseURL: process.env.SERVER_UI_URL || 'http://127.0.0.1:3847',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    storageState: './src/.auth/state.json',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /setup\.spec\.ts/,
      use: {
        // Setup tests run without stored auth (fresh server)
        storageState: undefined,
      },
    },
    {
      name: 'login',
      testMatch: /login\.spec\.ts/,
      use: {
        // Login tests run without stored auth
        storageState: undefined,
      },
    },
    {
      name: 'authenticated',
      testMatch: /^(?!.*(setup|login)).*\.spec\.ts$/,
      dependencies: ['setup'],
    },
  ],
});
