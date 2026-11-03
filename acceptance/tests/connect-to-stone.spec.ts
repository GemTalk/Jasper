import { test, expect } from '../helpers/vscode';
import { readTestStone } from '../helpers/testStone';

/**
 * The core workflow: a user with a configured login connects, and a live
 * session appears under it. This needs the stone provisioned by
 * `npm run test:server:start`; without it the spec skips rather than fails.
 */
const stone = readTestStone();
// `readTestStone` collapses six distinct conditions (missing `.env.test`,
// missing GCI library, an unset/unparseable Stone NRS, an unextractable
// NetLDI name, an unresolvable version, or an unset global dir) into a single
// `undefined` — it can't tell "never provisioned" from "provisioned but
// incomplete or unreadable", so the skip reason must not claim either one.
const skipReason = 'test stone env is missing or incomplete (run npm run test:server:start)';

test.describe('connecting to a stone', () => {
  test.skip(!stone, skipReason);

  test.use({
    workspaceSettings: {
      // Jasper finds a NetLDI by name in `gemstone.rootPath`, so it must be
      // the directory the test stone registered in.
      'gemstone.rootPath': stone?.globalDir,
      'gemstone.gciLibraries': stone ? { [stone.version]: stone.gciLibraryPath } : {},
      'gemstone.logins': stone
        ? [
            {
              version: stone.version,
              gem_host: stone.host,
              stone: stone.stone,
              gs_user: stone.user,
              gs_password: stone.password,
              netldi: stone.netldi,
            },
          ]
        : [],
    },
  });

  test('logging in opens a live session under the login', async ({ window }) => {
    await window.getByRole('tab', { name: /GemStone/ }).click();

    const sidebar = window.locator('.sidebar');
    const loginRow = sidebar.getByRole('treeitem', { name: /DataCurator on/ });
    await loginRow.hover();
    const loginButton = loginRow.getByRole('button', { name: 'Login', exact: true });
    await expect(loginButton).toBeVisible();
    await loginButton.click();

    await expect(sidebar.getByText(/Session \d+/)).toBeVisible({ timeout: 45_000 });
  });
});
