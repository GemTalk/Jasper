import { test, expect } from '../helpers/vscode';

/**
 * The simplest thing a new user does: open VS Code with Jasper installed and
 * find the GemStone view. No stone, no login — just proof the extension is
 * present and its sidebar opens to the panels a user works from.
 */
test.describe('opening the GemStone sidebar', () => {
  test('the GemStone item is in the activity bar', async ({ window }) => {
    const gemstone = window.getByRole('tab', { name: /GemStone/ });

    await expect(gemstone).toBeVisible();
  });

  test('clicking it reveals the GemStone panels', async ({ window }) => {
    await window.getByRole('tab', { name: /GemStone/ }).click();

    const sidebar = window.locator('.sidebar');
    await expect(sidebar.getByText('Databases', { exact: true })).toBeVisible();
    // A section's title-bar buttons only show while the pointer is over it.
    await sidebar.getByRole('heading', { name: 'Databases' }).hover();
    await expect(
      sidebar.getByRole('button', { name: 'Manage Databases & Versions' }),
    ).toBeVisible();
    await expect(sidebar.getByText('Logins & Sessions', { exact: true })).toBeVisible();
  });
});
