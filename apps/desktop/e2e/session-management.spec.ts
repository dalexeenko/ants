import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, closeApp, ensureProject } from './electron';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
});

test.afterAll(async () => {
  await closeApp(app);
});

// ---------------------------------------------------------------------------
// Session Management
// ---------------------------------------------------------------------------

// TODO: ensureProject races against AppShell init — the welcome screen button
// gets detached from the DOM before the click lands, causing consistent 30s timeouts.
test.describe.skip('Session Management', () => {
  test.beforeAll(async () => {
    await ensureProject(page);
  });

  test('should create a session and show it in the sidebar', async () => {
    // The new session button is hidden (opacity: 0) until hovered — use force click
    await page.getByTestId('ants-project-new-session').click({ force: true });
    await expect(page.getByTestId('ants-session-list')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('ants-chat-input')).toBeVisible();
  });

  test('should show the chat view for the active session', async () => {
    await expect(page.getByTestId('ants-chat-view')).toBeVisible();
  });
});
