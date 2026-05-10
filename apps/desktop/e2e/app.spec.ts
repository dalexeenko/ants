import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, closeApp } from './electron';

/**
 * E2E tests for the OpenMgr desktop app.
 *
 * Run with: pnpm test:e2e
 * Debug with: pnpm test:e2e:debug
 *
 * Requires: pnpm build (the app must be built first)
 */

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
});

test.afterAll(async () => {
  await closeApp(app);
});

// ---------------------------------------------------------------------------
// Launch & basic structure
// ---------------------------------------------------------------------------

test.describe('App Launch', () => {
  test('should launch and have a window', async () => {
    const windows = app.windows();
    expect(windows.length).toBeGreaterThan(0);
  });

  test('should render the root app container', async () => {
    await expect(page.getByTestId('openmgr-app')).toBeVisible();
  });

  test('should display the icon rail', async () => {
    await expect(page.getByTestId('openmgr-icon-rail')).toBeVisible();
  });

  test('should show the welcome screen when no project is selected', async () => {
    // On a fresh launch with no persisted projects, the welcome screen shows
    await expect(page.getByTestId('openmgr-welcome-screen')).toBeVisible({ timeout: 10000 });
  });

  test('should have the main content area', async () => {
    await expect(page.getByTestId('openmgr-main-content')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Icon rail navigation
// ---------------------------------------------------------------------------

test.describe('Navigation via Icon Rail', () => {
  test('should navigate to settings when settings icon is clicked', async () => {
    await page.getByTestId('openmgr-icon-rail-settings').click();
    await expect(page.getByTestId('openmgr-settings-panel')).toBeVisible();
  });

  test('should navigate to agents when agents icon is clicked', async () => {
    await page.getByTestId('openmgr-icon-rail-agents').click();
    await expect(page.getByTestId('openmgr-agents-panel')).toBeVisible();
  });

  test('should navigate back to projects view', async () => {
    await page.getByTestId('openmgr-icon-rail-projects').click();
    // Should show either the welcome screen (no project) or the project sidebar.
    // Both may be visible simultaneously (sidebar header + welcome in main content),
    // so check each independently instead of using .or() which fails strict mode.
    const welcomeVisible = await page.getByTestId('openmgr-welcome-screen').isVisible().catch(() => false);
    const sidebarVisible = await page.getByTestId('openmgr-project-sidebar').isVisible().catch(() => false);
    expect(welcomeVisible || sidebarVisible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Welcome screen actions
// ---------------------------------------------------------------------------

test.describe('Welcome Screen', () => {
  test('should have a "New Project" button', async () => {
    // Navigate back to project view first
    await page.getByTestId('openmgr-icon-rail-projects').click();

    const welcomeScreen = page.getByTestId('openmgr-welcome-screen');
    // Only run this test if we're on the welcome screen (no project selected)
    if (await welcomeScreen.isVisible()) {
      await expect(page.getByTestId('openmgr-welcome-new-project')).toBeVisible();
    }
  });
});
