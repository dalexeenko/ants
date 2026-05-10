import { test, expect } from '@playwright/test';

test.describe('Channels', () => {
  test('channels page renders with add button', async ({ page }) => {
    await page.goto('/channels');
    await expect(page.getByTestId('server-ui-channels')).toBeVisible();
    await expect(page.getByTestId('server-ui-channels-add')).toBeVisible();
  });

  test('clicking add channel opens create modal', async ({ page }) => {
    await page.goto('/channels');
    await page.getByTestId('server-ui-channels-add').click();
    await expect(page.getByTestId('server-ui-channels-create-modal')).toBeVisible();
    // Modal should have form fields
    await expect(page.getByTestId('server-ui-channels-create-modal').getByRole('textbox').first()).toBeVisible();
  });

  test('create channel modal closes on cancel', async ({ page }) => {
    await page.goto('/channels');
    await page.getByTestId('server-ui-channels-add').click();
    await expect(page.getByTestId('server-ui-channels-create-modal')).toBeVisible();
    await page.getByTestId('server-ui-channels-create-modal').getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByTestId('server-ui-channels-create-modal')).not.toBeVisible();
  });
});
