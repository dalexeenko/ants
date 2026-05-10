/**
 * Playwright global setup for server-ui E2E tests.
 *
 * Starts the Ants server in mock mode, runs initial admin setup,
 * authenticates via the login page, and saves the browser storage state
 * so all subsequent tests share the same session.
 */

import { chromium, type FullConfig } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { UITestServer } from './server-harness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Store server instance globally so teardown can access it
declare global {
  // eslint-disable-next-line no-var
  var __uiTestServer: UITestServer | undefined;
}

export default async function globalSetup(config: FullConfig) {
  const server = new UITestServer({ multiUser: true });
  globalThis.__uiTestServer = server;

  // Start server
  const serverInfo = await server.start();
  console.log(`[global-setup] Server started at ${serverInfo.url}`);

  // Update baseURL for all tests
  process.env.SERVER_UI_URL = serverInfo.url;

  // Run initial admin setup via API
  await server.setupAdmin('admin', 'testpassword123');
  console.log('[global-setup] Admin account created');

  // Login to get a session cookie for authenticated API calls
  await server.login('admin', 'testpassword123');
  console.log('[global-setup] Logged in as admin');

  // Create a test project for tests that need one
  await server.createProject('test-project');
  console.log('[global-setup] Test project created');

  // Launch browser, log in via UI, save auth state
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: serverInfo.url });
  const page = await context.newPage();

  // Log in
  await page.goto('/login');
  await page.getByTestId('server-ui-login-username').fill('admin');
  await page.getByTestId('server-ui-login-password').fill('testpassword123');
  await page.getByTestId('server-ui-login-submit').click();

  // Wait for redirect to settings (successful login)
  await page.waitForURL('**/settings', { timeout: 10000 }).catch(() => {
    // May redirect to index which is also settings
    return page.waitForURL('**/', { timeout: 5000 });
  });

  // Save storage state (cookies, localStorage)
  const authDir = join(__dirname, '.auth');
  mkdirSync(authDir, { recursive: true });
  await context.storageState({ path: join(authDir, 'state.json') });
  console.log('[global-setup] Auth state saved');

  await browser.close();

  // Write server URL to a file for the config to pick up
  writeFileSync(
    join(__dirname, '.auth', 'server-info.json'),
    JSON.stringify(serverInfo),
  );
}
