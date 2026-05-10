import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, closeApp } from './electron';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
});

test.afterAll(async () => {
  await closeApp(app);
});

// ---------------------------------------------------------------------------
// Keyboard Shortcuts
// ---------------------------------------------------------------------------

test.describe('Keyboard Shortcuts', () => {
  test('should open shortcuts modal with Cmd+/', async () => {
    // Wait for the app to fully load and register keyboard handlers
    await expect(page.getByTestId('openmgr-app')).toBeVisible({ timeout: 10000 });
    await page.keyboard.press('Meta+/');
    // The shortcuts modal should appear
    await expect(page.getByText('Keyboard Shortcuts')).toBeVisible({ timeout: 5000 });
  });

  test('should close shortcuts modal with Escape', async () => {
    // Ensure the modal is open first
    const modal = page.getByText('Keyboard Shortcuts');
    if (!await modal.isVisible().catch(() => false)) {
      await page.keyboard.press('Meta+/');
      await expect(modal).toBeVisible({ timeout: 5000 });
    }

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible({ timeout: 10000 });
  });
});
