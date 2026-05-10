import { test, expect } from '@playwright/test';

test.describe('Webhooks', () => {
  test('webhooks page renders with add button', async ({ page }) => {
    await page.goto('/webhooks');
    await expect(page.getByTestId('server-ui-webhooks')).toBeVisible();
    await expect(page.getByTestId('server-ui-webhooks-add')).toBeVisible();
  });

  test('clicking add webhook opens modal', async ({ page }) => {
    await page.goto('/webhooks');
    await page.getByTestId('server-ui-webhooks-add').click();
    await expect(page.getByTestId('server-ui-webhooks-create-modal')).toBeVisible();
    // Modal should have a name input
    await expect(page.getByTestId('server-ui-webhooks-create-modal').getByRole('textbox').first()).toBeVisible();
  });

  test('add webhook modal closes on cancel', async ({ page }) => {
    await page.goto('/webhooks');
    await page.getByTestId('server-ui-webhooks-add').click();
    await expect(page.getByTestId('server-ui-webhooks-create-modal')).toBeVisible();
    await page.getByTestId('server-ui-webhooks-create-modal').getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByTestId('server-ui-webhooks-create-modal')).not.toBeVisible();
  });
});
