import { test, expect } from '@playwright/test';

test.describe('Analytics', () => {
  test('analytics page renders', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page.getByTestId('server-ui-analytics')).toBeVisible();
  });

  test('analytics tabs are visible', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page.getByTestId('server-ui-analytics-tabs')).toBeVisible();
  });

  test('cleanup button is visible', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page.getByTestId('server-ui-analytics-cleanup')).toBeVisible();
  });
});
