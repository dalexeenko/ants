import { test, expect } from '@playwright/test';

test.describe('Projects', () => {
  test('projects page renders with list', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.getByTestId('server-ui-projects')).toBeVisible();
    await expect(page.getByTestId('server-ui-projects-list')).toBeVisible();
  });

  test('project card displays project name', async ({ page }) => {
    await page.goto('/projects');
    const list = page.getByTestId('server-ui-projects-list');
    await expect(list).toBeVisible();
    await expect(list.getByText('test-project', { exact: true }).first()).toBeVisible();
  });

  test('project card has delete button', async ({ page }) => {
    await page.goto('/projects');
    const list = page.getByTestId('server-ui-projects-list');
    await expect(list).toBeVisible();
    // Each project card should have a delete button
    const deleteBtn = list.locator('[data-testid^="server-ui-project-delete-"]').first();
    await expect(deleteBtn).toBeVisible();
  });
});
