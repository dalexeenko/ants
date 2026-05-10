import { test, expect } from '@playwright/test';

test.describe('Users', () => {
  test('users page renders', async ({ page }) => {
    await page.goto('/users');
    await expect(page.getByTestId('server-ui-users')).toBeVisible();
  });

  test('users table shows admin user', async ({ page }) => {
    await page.goto('/users');
    const table = page.getByTestId('server-ui-users-table');
    await expect(table).toBeVisible();
    // The global setup created an admin user — look within the table for exact match
    await expect(table.getByRole('cell', { name: 'admin' }).first()).toBeVisible();
  });

  test('create user button is visible', async ({ page }) => {
    await page.goto('/users');
    await expect(page.getByTestId('server-ui-users-create')).toBeVisible();
  });

  test('clicking create user opens modal', async ({ page }) => {
    await page.goto('/users');
    await page.getByTestId('server-ui-users-create').click();
    await expect(page.getByTestId('server-ui-users-create-modal')).toBeVisible();
  });

  test('create user form has required fields', async ({ page }) => {
    await page.goto('/users');
    await page.getByTestId('server-ui-users-create').click();
    const modal = page.getByTestId('server-ui-users-create-modal');
    await expect(modal).toBeVisible();
    // Should have username and password fields
    await expect(modal.getByRole('textbox').first()).toBeVisible();
  });
});
