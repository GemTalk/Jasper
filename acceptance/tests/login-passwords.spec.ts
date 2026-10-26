import * as fs from 'fs';
import { Frame, Page } from '@playwright/test';
import { test, expect, runCommand, VSCodeSession } from '../helpers/vscode';
import { readTestStone } from '../helpers/testStone';

/**
 * Login passwords live in VS Code's SecretStorage, not in settings.json. These
 * read the settings files Jasper writes, and read the passwords back through the
 * login editor, since a spec can't see SecretStorage itself.
 *
 * The store is VS Code's file-backed "basic" one, so a restart keeps it; whether
 * the OS keychain itself works is VS Code's to test, not ours.
 */

interface Login {
  version: string;
  gem_host: string;
  stone: string;
  netldi: string;
  gs_user: string;
  gs_password: string;
  host_user: string;
  host_password: string;
  password_in_keychain?: boolean;
}

const LOGIN: Login = {
  version: '',
  gem_host: 'localhost',
  stone: 'keychain-stone',
  netldi: 'keychain-ldi',
  gs_user: 'DataCurator',
  gs_password: 'gs-secret',
  host_user: 'hostuser',
  host_password: 'host-secret',
};

const label = (l: Pick<Login, 'gs_user' | 'stone' | 'gem_host'>) =>
  `${l.gs_user} on ${l.stone} (${l.gem_host})`;

function loginsIn(settingsPath: string): Login[] {
  return JSON.parse(fs.readFileSync(settingsPath, 'utf8'))['gemstone.logins'] ?? [];
}

function writeLogins(settingsPath: string, logins: Login[]): void {
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  fs.writeFileSync(settingsPath, JSON.stringify({ ...settings, 'gemstone.logins': logins }));
}

// Not a click on the GemStone tab: after a restart that tab is already active,
// and clicking it closes the sidebar.
async function showLogins(window: Page): Promise<void> {
  await runCommand(window, 'Focus on Logins & Sessions View');
}

async function rowButton(window: Page, login: Login, name: string) {
  const row = window.locator('.sidebar').getByRole('treeitem', { name: label(login) });
  await row.hover();
  return row.getByRole('button', { name, exact: true });
}

/** The login editor's webview, once it holds `login` (or a new login's defaults). */
async function loginForm(window: Page, stone = 'gs64stone', timeout = 15_000): Promise<Frame> {
  let form: Frame | undefined;
  await expect
    .poll(
      async () => {
        const found = [];
        for (const frame of window.frames()) {
          if (frame.isDetached()) continue;
          const value = await frame
            .locator('#stone')
            .inputValue({ timeout: 100 })
            .catch(() => undefined);
          if (value === stone) found.push(frame);
        }
        form = found.at(-1);
        return found.length > 0;
      },
      { timeout },
    )
    .toBe(true);
  return form as Frame;
}

async function fillAndSave(form: Frame, login: Login, keychain?: boolean): Promise<void> {
  if (login.version) await form.locator('#version').selectOption(login.version);
  for (const field of [
    'gem_host',
    'stone',
    'netldi',
    'gs_user',
    'gs_password',
    'host_user',
    'host_password',
  ] as const) {
    await form.locator(`#${field}`).fill(login[field]);
  }
  if (keychain !== undefined) await form.locator('#password_in_keychain').setChecked(keychain);
  await form.locator('#saveBtn').click();
}

async function addLogin(session: VSCodeSession, login: Login): Promise<void> {
  await runCommand(session.window, 'GemStone: Add Login');
  const form = await loginForm(session.window);
  await expect(form.locator('#password_in_keychain')).toBeChecked();
  await fillAndSave(form, login);
  await expect.poll(() => loginsIn(session.userSettingsPath).map(label)).toContain(label(login));
}

// Retried because right after a save the Logins tree redraws, and a click on
// the row being replaced runs Edit Login with no login.
async function openEditor(window: Page, login: Login): Promise<Frame> {
  let form: Frame | undefined;
  await expect(async () => {
    await (await rowButton(window, login, 'Edit Login')).click();
    form = await loginForm(window, login.stone, 3_000);
  }).toPass({ timeout: 30_000 });
  return form as Frame;
}

async function expectPasswordsInEditor(window: Page, login: Login, gs: string, host: string) {
  const form = await openEditor(window, login);
  await expect(form.locator('#gs_password')).toHaveValue(gs);
  await expect(form.locator('#host_password')).toHaveValue(host);
  await form.locator('#cancelBtn').click();
}

/**
 * Nothing is left in the keychain under `login`'s name: a keychain-backed login
 * saved under that name by hand opens in the editor with both passwords empty.
 * The restart is so the Logins tree can't still hold the row it had before.
 */
async function expectNothingStoredFor(session: VSCodeSession, login: Login): Promise<void> {
  const blank = { ...login, gs_password: '', host_password: '', password_in_keychain: true };
  writeLogins(session.userSettingsPath, [blank]);
  const window = await session.restart();
  await showLogins(window);
  await expectPasswordsInEditor(window, blank, '', '');
}

const withoutPasswords = { gs_password: '', host_password: '', password_in_keychain: true };

test.describe('login passwords', () => {
  test.skip(
    process.platform === 'darwin',
    'macOS ignores --password-store and asks for the login keychain password',
  );
  // `undefined` drops the login the container run would otherwise seed into the
  // workspace, which would hide the user settings' logins from Jasper.
  test.use({
    passwordOffer: true,
    persistentSecrets: true,
    workspaceSettings: { 'gemstone.logins': undefined },
  });

  test('a new login keeps both passwords out of settings and gets them back after a restart', async ({
    session,
  }) => {
    await showLogins(session.window);
    await addLogin(session, LOGIN);

    expect(loginsIn(session.userSettingsPath)).toEqual([
      expect.objectContaining({ stone: LOGIN.stone, ...withoutPasswords }),
    ]);

    await session.restart();
    await showLogins(session.window);
    await expectPasswordsInEditor(session.window, LOGIN, 'gs-secret', 'host-secret');
  });

  test('renaming a login moves its passwords to the new name', async ({ session }) => {
    await showLogins(session.window);
    await addLogin(session, LOGIN);
    const renamed = { ...LOGIN, stone: 'renamed-stone' };

    await fillAndSave(await openEditor(session.window, LOGIN), renamed);

    await expect
      .poll(() => loginsIn(session.userSettingsPath).map(label))
      .toEqual([label(renamed)]);
    await expectPasswordsInEditor(session.window, renamed, 'gs-secret', 'host-secret');
    await expectNothingStoredFor(session, LOGIN);
  });

  test('unchecking the box moves the passwords back to settings and out of the keychain', async ({
    session,
  }) => {
    await showLogins(session.window);
    await addLogin(session, LOGIN);

    await fillAndSave(await openEditor(session.window, LOGIN), LOGIN, false);

    await expect
      .poll(() => loginsIn(session.userSettingsPath)[0])
      .toMatchObject({
        gs_password: 'gs-secret',
        host_password: 'host-secret',
        password_in_keychain: false,
      });
    await expectNothingStoredFor(session, LOGIN);
  });

  test('deleting a login deletes its passwords', async ({ session }) => {
    await showLogins(session.window);
    await addLogin(session, LOGIN);

    await (await rowButton(session.window, LOGIN, 'Delete Login')).click();
    await session.window
      .locator('.monaco-dialog-box')
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect.poll(() => loginsIn(session.userSettingsPath)).toEqual([]);
    await expectNothingStoredFor(session, LOGIN);
  });

  test('moving old plain-text passwords keeps a GemStone password already in the keychain', async ({
    session,
  }) => {
    // Before #671 a keychain login kept only its GemStone password there and its
    // host password in settings. Made here by saving the GemStone password alone,
    // then putting the host password back into settings by hand.
    await showLogins(session.window);
    const old = { ...LOGIN, host_password: '' };
    await addLogin(session, old);
    const plain = { ...LOGIN, stone: 'plain-stone', password_in_keychain: false };
    writeLogins(session.userSettingsPath, [
      { ...loginsIn(session.userSettingsPath)[0], host_password: 'host-secret' },
      plain,
    ]);

    const window = await session.restart();
    await window
      .locator('.notification-toast')
      .filter({ hasText: '2 GemStone logins keep their passwords as plain text' })
      .getByRole('button', { name: 'Move to keychain' })
      .click();

    await expect
      .poll(() => loginsIn(session.userSettingsPath))
      .toEqual([
        expect.objectContaining({ stone: LOGIN.stone, ...withoutPasswords }),
        expect.objectContaining({ stone: 'plain-stone', ...withoutPasswords }),
      ]);
    await showLogins(window);
    await expectPasswordsInEditor(window, LOGIN, 'gs-secret', 'host-secret');
    await expectPasswordsInEditor(window, plain, 'gs-secret', 'host-secret');
  });

  test.describe('a login in the workspace settings', () => {
    test.use({
      workspaceSettings: { 'gemstone.logins': [{ ...LOGIN, password_in_keychain: false }] },
    });

    test('has its plain-text passwords moved to the keychain', async ({ session }) => {
      await session.window
        .locator('.notification-toast')
        .filter({ hasText: 'keeps its password as plain text' })
        .getByRole('button', { name: 'Move to keychain' })
        .click();

      await expect
        .poll(() => loginsIn(session.workspaceSettingsPath))
        .toEqual([expect.objectContaining(withoutPasswords)]);
      await showLogins(session.window);
      await expectPasswordsInEditor(session.window, LOGIN, 'gs-secret', 'host-secret');
    });
  });

  test.describe('against the test stone', () => {
    const stone = readTestStone();
    test.skip(!stone, 'test stone env is missing or incomplete (run npm run test:server:start)');
    test.use({
      workspaceSettings: {
        'gemstone.logins': undefined,
        // Jasper finds a NetLDI by name in `gemstone.rootPath`, so it must be
        // the directory the test stone registered in.
        'gemstone.rootPath': stone?.globalDir,
        'gemstone.gciLibraries': stone ? { [stone.version]: stone.gciLibraryPath } : {},
      },
    });

    test('logs in after a restart with only the passwords in the keychain', async ({ session }) => {
      if (!stone) return;
      const login: Login = {
        version: stone.version,
        gem_host: stone.host,
        stone: stone.stone,
        netldi: stone.netldi,
        gs_user: stone.user,
        gs_password: stone.password,
        host_user: '',
        host_password: '',
      };
      await showLogins(session.window);
      await addLogin(session, login);
      expect(loginsIn(session.userSettingsPath)[0].gs_password).toBe('');

      const window = await session.restart();
      await showLogins(window);
      await (await rowButton(window, login, 'Login')).click();

      // A password missing from the keychain would be asked for, and the session
      // would never appear.
      await expect(window.locator('.sidebar').getByText(/Session \d+/)).toBeVisible({
        timeout: 45_000,
      });
    });
  });
});
