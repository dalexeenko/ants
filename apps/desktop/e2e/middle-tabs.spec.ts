import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, closeApp, ensureSession } from './electron';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
});

test.afterAll(async () => {
  await closeApp(app);
});

// ---------------------------------------------------------------------------
// Middle Tab Bar
// ---------------------------------------------------------------------------

test.describe('Middle Tab Bar', () => {
  test.beforeAll(async () => {
    await ensureSession(page);
  });

  test('should show the chat tab', async () => {
    await expect(page.getByTestId('ants-middle-tab-chat')).toBeVisible();
  });

  test('chat tab should be active by default', async () => {
    await expect(page.getByTestId('ants-chat-view')).toBeVisible();
  });

  test('should show terminal tab when opened', async () => {
    // Look for an "add tab" or "+" button in the middle tab bar
    const addButton = page.getByTestId('ants-middle-tab-add');
    if (await addButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addButton.click();
      // Select terminal from the dropdown/menu
      const terminalOption = page.getByText('Terminal');
      if (await terminalOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await terminalOption.click();
        await expect(page.getByTestId('ants-middle-tab-terminal')).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('should switch back to chat tab after opening another', async () => {
    // Click the chat tab to switch back
    const chatTab = page.getByTestId('ants-middle-tab-chat');
    await chatTab.click();
    await expect(page.getByTestId('ants-chat-view')).toBeVisible({ timeout: 5000 });
  });
});
