import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import path from 'path';

/**
 * Helper for launching and controlling the OpenMgr Electron app with Playwright.
 * 
 * @example
 * ```typescript
 * import { launchApp, closeApp } from './electron';
 * 
 * let app: ElectronApplication;
 * let page: Page;
 * 
 * beforeAll(async () => {
 *   ({ app, page } = await launchApp());
 * });
 * 
 * afterAll(async () => {
 *   await closeApp(app);
 * });
 * 
 * test('example test', async () => {
 *   await expect(page.locator('text=OpenMgr')).toBeVisible();
 * });
 * ```
 */

export interface LaunchOptions {
  /** Enable CDP remote debugging on this port (for MCP server connection) */
  cdpPort?: number;
}

export interface AppContext {
  app: ElectronApplication;
  page: Page;
}

/**
 * Launch the Electron app and return the app instance and main window page.
 * The app must be built first (pnpm build).
 * 
 * @param options.cdpPort - If set, enables Chrome DevTools Protocol on this port.
 *   This allows external tools like @playwright/mcp to connect to the running app.
 */
export async function launchApp(options: LaunchOptions = {}): Promise<AppContext> {
  const appPath = path.resolve(__dirname, '../dist/main/index.js');

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    NODE_ENV: 'test',
  };

  // Enable CDP remote debugging if requested
  if (options.cdpPort) {
    env.OPENMGR_CDP_PORT = String(options.cdpPort);
  }

  const app = await electron.launch({
    args: [appPath],
    env,
  });

  // Wait for the main window to be ready
  const page = await app.firstWindow();
  
  // Wait for the app to fully load
  await page.waitForLoadState('domcontentloaded');
  
  return { app, page };
}

/**
 * Close the Electron app gracefully.
 */
export async function closeApp(app: ElectronApplication): Promise<void> {
  if (app) {
    await app.close();
  }
}

/**
 * Take a screenshot of the current page.
 * Useful for debugging failing tests.
 */
export async function screenshot(page: Page, name: string): Promise<void> {
  const screenshotDir = path.resolve(__dirname, '../test-results/screenshots');
  await page.screenshot({ 
    path: path.join(screenshotDir, `${name}.png`),
    fullPage: true,
  });
}

/**
 * Get the app's window title.
 */
export async function getWindowTitle(app: ElectronApplication): Promise<string> {
  const page = await app.firstWindow();
  return page.title();
}

/**
 * Evaluate JavaScript in the main process.
 */
export async function evaluateInMain<T>(
  app: ElectronApplication,
  fn: () => T | Promise<T>
): Promise<T> {
  return app.evaluate(fn);
}

/**
 * Ensure a project exists. If the welcome screen is showing, create a project
 * by clicking "New Project" and completing the setup modal.
 * Returns once the project sidebar is visible.
 *
 * Note: On CI, previously-created projects may persist in the SQLite DB across
 * spec files. The welcome screen can flash briefly before projects load, so we
 * wait for a stable state before deciding whether to create a project.
 */
export async function ensureProject(page: Page): Promise<void> {
  const { expect } = await import('@playwright/test');

  // Wait for the app to settle. Check for an existing project's session list
  // (which only appears when a project has been expanded) or the welcome
  // screen's "New Project" button.
  const sidebar = page.getByTestId('openmgr-project-sidebar');
  const newProjectBtn = page.getByTestId('openmgr-welcome-new-project');

  // Wait for the app to fully load by checking for the sidebar header
  await expect(sidebar).toBeVisible({ timeout: 15000 });

  // Check if the "New Project" button is visible — if so, no project exists yet
  const needsProject = await newProjectBtn.isVisible({ timeout: 2000 }).catch(() => false);
  if (!needsProject) {
    // Project already exists
    return;
  }

  // No project — create one via the setup modal
  await newProjectBtn.click();
  const createBtn = page.getByTestId('openmgr-create-project');
  await expect(createBtn).toBeVisible({ timeout: 5000 });
  await createBtn.click();
  // Wait for the modal to close and the project sidebar to appear
  await expect(sidebar).toBeVisible({ timeout: 15000 });
}

/**
 * Ensure an active session exists within a project. Creates a project first
 * if needed, then clicks the "new session" button.
 * Returns once the chat input is visible.
 */
export async function ensureSession(page: Page): Promise<void> {
  const { expect } = await import('@playwright/test');
  await ensureProject(page);
  // The new session button is hidden (opacity: 0) until hovered.
  // Use force: true to click it regardless of visibility.
  await page.getByTestId('openmgr-project-new-session').click({ force: true });
  await expect(page.getByTestId('openmgr-chat-input')).toBeVisible({ timeout: 10000 });
}
