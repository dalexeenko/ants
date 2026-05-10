import { test, expect } from '@playwright/test';

test.describe('Connect', () => {
  test('connect page renders', async ({ page }) => {
    await page.goto('/connect');
    await expect(page.getByTestId('server-ui-connect')).toBeVisible();
  });

  test('connect page shows connection instructions', async ({ page }) => {
    await page.goto('/connect');
    const connect = page.getByTestId('server-ui-connect');
    await expect(connect).toBeVisible();
    // Should have some content about connecting
    await expect(connect).not.toBeEmpty();
  });
});
