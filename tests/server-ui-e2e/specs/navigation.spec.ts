import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('sidebar is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('server-ui-sidebar')).toBeVisible();
  });

  test('sidebar has all navigation links', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('server-ui-sidebar-nav-projects')).toBeVisible();
    await expect(page.getByTestId('server-ui-sidebar-nav-settings')).toBeVisible();
    await expect(page.getByTestId('server-ui-sidebar-nav-channels')).toBeVisible();
  });

  test('navigating to projects page', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('server-ui-sidebar-nav-projects').click();
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  });

  test('navigating to channels page', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('server-ui-sidebar-nav-channels').click();
    await expect(page.getByRole('heading', { name: 'Channels' })).toBeVisible();
  });

  test('navigating to analytics page', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('server-ui-sidebar-nav-analytics').click();
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
  });

  test('navigating to tasks page', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('server-ui-sidebar-nav-tasks').click();
    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
  });

  test('navigating to webhooks page', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('server-ui-sidebar-nav-webhooks').click();
    await expect(page.getByRole('heading', { name: 'Webhooks' })).toBeVisible();
  });

  test('navigating to account page', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('server-ui-sidebar-nav-account').click();
    await expect(page.getByTestId('server-ui-account')).toBeVisible();
  });

  test('main content area exists', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('server-ui-content')).toBeVisible();
  });
});
