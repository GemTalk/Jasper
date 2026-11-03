import { test, expect } from '../helpers/vscode';

/**
 * A user who has configured a login expects to see it in the Logins panel,
 * labelled the way they'd recognise it — user, stone, and host. This drives
 * only what's declared in settings, so it needs no running stone.
 */
test.use({
  userSettings: {
    'gemstone.logins': [
      {
        version: '3.7.5',
        gem_host: 'localhost',
        stone: 'jasper-test-3.7.5-gs64-stone',
        gs_user: 'DataCurator',
        netldi: 'jasper-test-3.7.5-gs64-ldi',
      },
    ],
  },
});

test('a configured login appears in the Logins panel', async ({ window }) => {
  await window.getByRole('tab', { name: /GemStone/ }).click();

  const sidebar = window.locator('.sidebar');
  await expect(
    sidebar.getByText('DataCurator on jasper-test-3.7.5-gs64-stone (localhost)'),
  ).toBeVisible();
});
