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
// Project Creation
// ---------------------------------------------------------------------------

test.describe('Project Creation', () => {
  test('should show New Project button on welcome screen', async () => {
    // Navigate to projects view
    await page.getByTestId('ants-icon-rail-projects').click();

    const welcomeScreen = page.getByTestId('ants-welcome-screen');
    if (await welcomeScreen.isVisible()) {
      await expect(page.getByTestId('ants-welcome-new-project')).toBeVisible();
    }
  });

  test('should open project creation flow when clicking New Project', async () => {
    // Navigate to projects view
    await page.getByTestId('ants-icon-rail-projects').click();

    const welcomeScreen = page.getByTestId('ants-welcome-screen');
    if (await welcomeScreen.isVisible()) {
      await page.getByTestId('ants-welcome-new-project').click();
      // After clicking, we should see a project sidebar or creation dialog
      const sidebar = page.getByTestId('ants-project-sidebar');
      const creationDialog = page.getByTestId('ants-project-creation');
      // Either a sidebar for the new project or a creation dialog should appear
      await expect(
        sidebar.or(creationDialog),
      ).toBeVisible({ timeout: 10000 });
    }
  });
});
