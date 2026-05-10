import { test, expect } from '@playwright/test';

test.describe('Notifications', () => {
  test('notifications page renders', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page.getByTestId('server-ui-notifications')).toBeVisible();
  });

  test('notifications page shows content', async ({ page }) => {
    await page.goto('/notifications');
    const notifications = page.getByTestId('server-ui-notifications');
    await expect(notifications).toBeVisible();
    // Should show either notifications or an empty state
    await expect(notifications).not.toBeEmpty();
  });
});
