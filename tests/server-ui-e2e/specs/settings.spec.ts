import { test, expect } from '@playwright/test';

test.describe('Settings', () => {
  test('settings page renders with all sections', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('server-ui-settings')).toBeVisible();
    await expect(page.getByTestId('server-ui-settings-connect')).toBeVisible();
    await expect(page.getByTestId('server-ui-settings-providers')).toBeVisible();
    await expect(page.getByTestId('server-ui-settings-plugins')).toBeVisible();
    await expect(page.getByTestId('server-ui-settings-system')).toBeVisible();
  });

  test('install plugin button opens modal', async ({ page }) => {
    await page.goto('/settings');
    await page.getByTestId('server-ui-settings-install-plugin').click();
    await expect(page.getByTestId('server-ui-settings-plugin-modal')).toBeVisible();
    // Modal should have an input and submit button
    await expect(page.getByTestId('server-ui-settings-plugin-modal').getByRole('textbox')).toBeVisible();
    await expect(page.getByTestId('server-ui-settings-plugin-modal').getByRole('button', { name: /install/i })).toBeVisible();
  });

  test('install plugin modal closes on cancel', async ({ page }) => {
    await page.goto('/settings');
    await page.getByTestId('server-ui-settings-install-plugin').click();
    await expect(page.getByTestId('server-ui-settings-plugin-modal')).toBeVisible();
    await page.getByTestId('server-ui-settings-plugin-modal').getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByTestId('server-ui-settings-plugin-modal')).not.toBeVisible();
  });

  test('manage channels button navigates to channels page', async ({ page }) => {
    await page.goto('/settings');
    await page.getByTestId('server-ui-settings-manage-channels').click();
    await expect(page).toHaveURL(/\/channels/);
  });

  test('system info shows uptime and platform', async ({ page }) => {
    await page.goto('/settings');
    const system = page.getByTestId('server-ui-settings-system');
    await expect(system).toBeVisible();
    await expect(system.getByText('Uptime')).toBeVisible();
    await expect(system.getByText('Platform')).toBeVisible();
    await expect(system.getByText('Memory')).toBeVisible();
  });
});
