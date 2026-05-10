import { test, expect } from '@playwright/test';

test.describe('Tasks', () => {
  test('tasks page renders with add button', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByTestId('server-ui-tasks')).toBeVisible();
    await expect(page.getByTestId('server-ui-tasks-add')).toBeVisible();
  });

  test('clicking add task opens modal', async ({ page }) => {
    await page.goto('/tasks');
    await page.getByTestId('server-ui-tasks-add').click();
    await expect(page.getByTestId('server-ui-tasks-create-modal')).toBeVisible();
    // Modal should have name and cron inputs
    await expect(page.getByTestId('server-ui-tasks-create-modal').getByRole('textbox').first()).toBeVisible();
  });

  test('add task modal closes on cancel', async ({ page }) => {
    await page.goto('/tasks');
    await page.getByTestId('server-ui-tasks-add').click();
    await expect(page.getByTestId('server-ui-tasks-create-modal')).toBeVisible();
    await page.getByTestId('server-ui-tasks-create-modal').getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByTestId('server-ui-tasks-create-modal')).not.toBeVisible();
  });
});
