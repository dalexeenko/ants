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
// Mode Picker
// ---------------------------------------------------------------------------

// TODO: ensureSession races against AppShell init — the welcome screen button
// gets detached from the DOM before the click lands, causing consistent 30s timeouts.
test.describe.skip('Mode Picker', () => {
  test.beforeAll(async () => {
    await ensureSession(page);
  });

  test('should display the mode picker', async () => {
    await expect(page.getByTestId('openmgr-mode-picker')).toBeVisible();
  });

  test('should show plan and build options', async () => {
    await expect(page.getByTestId('openmgr-mode-option-plan')).toBeVisible();
    await expect(page.getByTestId('openmgr-mode-option-build')).toBeVisible();
  });
});
