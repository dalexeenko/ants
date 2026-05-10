import { test, expect } from '@playwright/test';

test.describe('Approvals', () => {
  test('approvals page renders with tabs', async ({ page }) => {
    await page.goto('/approvals');
    await expect(page.getByTestId('server-ui-approvals')).toBeVisible();
    await expect(page.getByTestId('server-ui-approvals-tabs')).toBeVisible();
  });

  test('can switch between requests and rules tabs', async ({ page }) => {
    await page.goto('/approvals');
    const tabs = page.getByTestId('server-ui-approvals-tabs');
    // Switch to Rules tab (text includes count, e.g. "Rules (0)")
    await tabs.getByText(/^Rules/).click();
    await expect(page.getByTestId('server-ui-approvals-add-rule')).toBeVisible({ timeout: 10000 });
    // Switch back to Requests tab
    await tabs.getByText(/^Requests/).click();
    await expect(page.getByTestId('server-ui-approvals')).toBeVisible({ timeout: 10000 });
  });

  test('clicking add rule opens modal', async ({ page }) => {
    await page.goto('/approvals');
    await page.getByText('Rules').click();
    await page.getByTestId('server-ui-approvals-add-rule').click();
    await expect(page.getByTestId('server-ui-approvals-rule-modal')).toBeVisible();
    // Modal should have a name input
    await expect(page.getByTestId('server-ui-approvals-rule-modal').getByRole('textbox').first()).toBeVisible();
  });

  test('add rule modal closes on cancel', async ({ page }) => {
    await page.goto('/approvals');
    await page.getByText('Rules').click();
    await page.getByTestId('server-ui-approvals-add-rule').click();
    await expect(page.getByTestId('server-ui-approvals-rule-modal')).toBeVisible();
    await page.getByTestId('server-ui-approvals-rule-modal').getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByTestId('server-ui-approvals-rule-modal')).not.toBeVisible();
  });
});
