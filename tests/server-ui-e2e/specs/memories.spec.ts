import { test, expect } from '@playwright/test';

test.describe('Memories', () => {
  test('memories page renders with controls', async ({ page }) => {
    await page.goto('/memories');
    await expect(page.getByTestId('server-ui-memories')).toBeVisible();
    await expect(page.getByTestId('server-ui-memories-search')).toBeVisible();
    await expect(page.getByTestId('server-ui-memories-add')).toBeVisible();
  });

  test('search input accepts text', async ({ page }) => {
    await page.goto('/memories');
    const search = page.getByTestId('server-ui-memories-search');
    await search.fill('test query');
    await expect(search).toHaveValue('test query');
  });

  test('clicking add memory opens modal', async ({ page }) => {
    await page.goto('/memories');
    await page.getByTestId('server-ui-memories-add').click();
    await expect(page.getByTestId('server-ui-memories-create-modal')).toBeVisible();
    // Modal should have a textarea for content
    await expect(page.getByTestId('server-ui-memories-create-modal').locator('textarea')).toBeVisible();
  });

  test('add memory modal closes on cancel', async ({ page }) => {
    await page.goto('/memories');
    await page.getByTestId('server-ui-memories-add').click();
    await expect(page.getByTestId('server-ui-memories-create-modal')).toBeVisible();
    await page.getByTestId('server-ui-memories-create-modal').getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByTestId('server-ui-memories-create-modal')).not.toBeVisible();
  });
});
