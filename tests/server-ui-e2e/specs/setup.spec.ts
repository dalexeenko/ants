/**
 * Tests the initial setup flow. This spec runs in the 'setup' project
 * WITHOUT stored auth state because it tests the unauthenticated
 * setup/login flow.
 *
 * Note: global-setup already creates the admin account, so these tests
 * verify the setup page behavior on an already-configured server.
 */

import { test, expect } from '@playwright/test';

test.describe('Setup & Login', () => {
  test('setup page redirects when already configured', async ({ page }) => {
    await page.goto('/setup');
    await page.waitForURL('**/login');
    expect(page.url()).toContain('/login');
  });

  test('login page renders', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('server-ui-login-form')).toBeVisible();
  });

  test('login with valid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('server-ui-login-username').fill('admin');
    await page.getByTestId('server-ui-login-password').fill('testpassword123');
    await page.getByTestId('server-ui-login-submit').click();

    // Should redirect away from /login after successful authentication
    await expect(page).not.toHaveURL(/\/login/);
  });
});
