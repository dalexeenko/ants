import { test, expect } from '@playwright/test';

test.describe('Account', () => {
  test('account page renders with profile info', async ({ page }) => {
    await page.goto('/account');
    await expect(page.getByTestId('server-ui-account')).toBeVisible();
    await expect(page.getByTestId('server-ui-account-edit')).toBeVisible();
    await expect(page.getByTestId('server-ui-account-change-password')).toBeVisible();
    // Should show the admin username within the account section
    await expect(page.getByTestId('server-ui-account').getByText('admin', { exact: true }).first()).toBeVisible();
  });

  test('clicking change password opens modal', async ({ page }) => {
    await page.goto('/account');
    await page.getByTestId('server-ui-account-change-password').click();
    const modal = page.getByTestId('server-ui-account-password-modal');
    await expect(modal).toBeVisible();
    // Modal should have password fields
    await expect(modal.getByText('Current Password')).toBeVisible();
    await expect(modal.getByText('New Password', { exact: true }).first()).toBeVisible();
  });

  test('change password modal closes on cancel', async ({ page }) => {
    await page.goto('/account');
    await page.getByTestId('server-ui-account-change-password').click();
    await expect(page.getByTestId('server-ui-account-password-modal')).toBeVisible();
    await page.getByTestId('server-ui-account-password-modal').getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByTestId('server-ui-account-password-modal')).not.toBeVisible();
  });

  test('edit profile toggles edit mode', async ({ page }) => {
    await page.goto('/account');
    await page.getByTestId('server-ui-account-edit').click();
    // In edit mode, there should be a save button
    await expect(page.getByRole('button', { name: /save/i })).toBeVisible({ timeout: 5000 });
  });
});
