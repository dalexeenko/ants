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
// Model Picker
// ---------------------------------------------------------------------------

// TODO: ensureSession races against AppShell init — the welcome screen button
// gets detached from the DOM before the click lands, causing consistent 30s timeouts.
test.describe.skip('Model Picker', () => {
  test.beforeAll(async () => {
    await ensureSession(page);
  });

  test('should display the model picker', async () => {
    await expect(page.getByTestId('openmgr-model-picker')).toBeVisible();
  });

  test('should open dropdown when clicked', async () => {
    await page.getByTestId('openmgr-model-picker').click();
    await expect(page.getByTestId('openmgr-model-picker-dropdown')).toBeVisible();
  });
});
