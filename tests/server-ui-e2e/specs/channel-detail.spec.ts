import { test, expect } from '@playwright/test';

test.describe('Channel Detail', () => {
  test('channels page shows create modal with form fields', async ({ page }) => {
    await page.goto('/channels');
    await expect(page.getByTestId('server-ui-channels')).toBeVisible();

    // Open the create channel modal
    await page.getByTestId('server-ui-channels-add').click();
    const modal = page.getByTestId('server-ui-channels-create-modal');
    await expect(modal).toBeVisible();

    // Verify the modal has a text input for channel name
    await expect(modal.getByRole('textbox').first()).toBeVisible();

    // Verify there's a create/submit button
    await expect(modal.getByRole('button', { name: /create/i })).toBeVisible();

    // Verify there's a cancel button
    await expect(modal.getByRole('button', { name: /cancel/i })).toBeVisible();
  });

  test('channel create modal has platform selection', async ({ page }) => {
    await page.goto('/channels');
    await page.getByTestId('server-ui-channels-add').click();
    const modal = page.getByTestId('server-ui-channels-create-modal');
    await expect(modal).toBeVisible();

    // Channels should have platform options (Slack, Discord, Telegram)
    const hasPlatformText = await modal.getByText(/slack|discord|telegram/i).first()
      .isVisible({ timeout: 3000 }).catch(() => false);
    // At minimum, the modal should have selectable options or platform indicators
    expect(hasPlatformText || await modal.locator('select, [role="listbox"], [role="combobox"]').first()
      .isVisible({ timeout: 2000 }).catch(() => false)).toBeTruthy();
  });
});
