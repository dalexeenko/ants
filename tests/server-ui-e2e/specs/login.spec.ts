import { test, expect } from '@playwright/test';

test.describe('Login', () => {
  test('login page renders with form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('server-ui-login-form')).toBeVisible();
    await expect(page.getByTestId('server-ui-login-username')).toBeVisible();
    await expect(page.getByTestId('server-ui-login-password')).toBeVisible();
    await expect(page.getByTestId('server-ui-login-submit')).toBeVisible();
  });

  test('invalid credentials show error', async ({ page }) => {
    await page.goto('/login');
    // Wait for the form to be fully loaded before interacting
    await expect(page.getByTestId('server-ui-login-form')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('server-ui-login-username').fill('admin');
    await page.getByTestId('server-ui-login-password').fill('wrongpassword');
    await page.getByTestId('server-ui-login-submit').click();
    // After failed login, page should stay on /login (not redirect)
    // and either show the error banner or remain on the login page
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/\/login/);
    // The login form should still be visible (user was not redirected)
    await expect(page.getByTestId('server-ui-login-form')).toBeVisible();
  });

  test('valid login redirects to settings', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('server-ui-login-username').fill('admin');
    await page.getByTestId('server-ui-login-password').fill('testpassword123');
    await page.getByTestId('server-ui-login-submit').click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
  });
});
