import { test, expect } from '@playwright/test';

test.describe('Docker', () => {
  test('docker page renders with status', async ({ page }) => {
    await page.goto('/docker');
    await expect(page.getByTestId('server-ui-docker')).toBeVisible();
    await expect(page.getByTestId('server-ui-docker-status')).toBeVisible();
  });

  test('docker page shows connection status text', async ({ page }) => {
    await page.goto('/docker');
    // Should show either "Connected" or "Not connected" status
    const status = page.getByTestId('server-ui-docker-status');
    await expect(status).toBeVisible();
    // Status section should have some text content about Docker
    await expect(status).not.toBeEmpty();
  });
});
