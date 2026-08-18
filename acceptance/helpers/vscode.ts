import { test as base } from 'playwright-bdd';
import { _electron as electron, Locator, Page } from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MARKS, FRAME_SEPARATOR } from './marks';
import { readContainerStone } from './containerStone';

/** Repo root — the extension-development path VS Code loads Jasper from. */
const repoRoot = path.resolve(__dirname, '..', '..');

/**
 * The Electron binary that ships alongside the CLI launcher `@vscode/test-electron`
 * hands back. We exec it directly (never via macOS `open`/LaunchServices, which
 * would collide with a running VS Code — same bundle id — and drop our args).
 */
function electronBinary(vscodeCliPath: string): string {
  if (process.platform === 'darwin') {
    // macOS hands back the CLI launcher inside the .app; Playwright needs the
    // Electron binary that sits beside it in the bundle.
    const appRoot = vscodeCliPath.slice(0, vscodeCliPath.indexOf('.app/') + '.app'.length);
    return path.join(appRoot, 'Contents', 'MacOS', 'Electron');
  }
  // On Linux and Windows the returned path is already the launchable binary.
  return vscodeCliPath;
}

/**
 * Rings the control a step acted on or asserted about, so a storyboard frame
 * shows what mattered and not merely what the window looked like afterwards.
 *
 * The mark rides on the element (see `touch`), never on a screen position. VS
 * Code reshuffles under a stationary pointer — registering the SUnit test
 * controller inserts a Testing icon that shifts the activity bar down a slot —
 * so anything derived from `:hover` ends up ringing whatever slid under the
 * mouse rather than the thing that was clicked.
 *
 * Drawn inside the element's box (negative `outline-offset`): an outline drawn
 * outside is clipped away by VS Code's many `overflow: hidden` ancestors.
 */
const INTERACTION_HIGHLIGHT = `
  [data-touched] {
    outline: 2px solid ${MARKS.acted} !important;
    outline-offset: -2px !important;
  }
  [data-shown] {
    outline: 2px solid ${MARKS.checked} !important;
    outline-offset: -2px !important;
  }
`;

/**
 * The VS Code build every scenario runs against. Pinned, not 'stable': the
 * accessible names and DOM this suite drives are VS Code's, not ours, so an
 * automatic upgrade can break every scenario overnight with no change on our
 * side — which is exactly what a release landing mid-session did. Raise this
 * deliberately, and expect to re-run the suite when you do.
 */
const VSCODE_VERSION = '1.129.1';

/**
 * A Playwright fixture that gives each test a live VS Code window with Jasper
 * loaded, driven over CDP, and torn down afterwards.
 *
 * Non-disruptive on macOS: the moment the app is up we switch it to the
 * "accessory" activation policy — the runtime equivalent of LSUIElement — and
 * hide it. An accessory app has no Dock icon and never becomes the active
 * application, so its window can't steal focus or sit on your desktop while you
 * work. Playwright drives it over CDP, which is unaffected by any of that.
 *
 * Isolated from your own machine — not just VS Code's settings:
 *   - a fresh user-data dir (no personal settings, theme, or window state)
 *   - a fresh extensions dir (only Jasper loads)
 *   - a throwaway workspace folder
 *   - HOME pointed at the profile, so `~/.claude.json` and `~/Documents/GemStone`
 *     resolve to empty throwaway paths (no MCP write to your real config)
 *   - `gemstone.rootPath` at an empty temp dir, so the Versions and Databases
 *     panels never surface your real GemStone installs
 *   - secrets kept in an in-profile file store, never the macOS login keychain
 *
 * Fixtures:
 *   - `workspaceSettings` — seeds the workspace's `.vscode/settings.json` before
 *      launch (override with `test.use({ workspaceSettings })`) to declare
 *      logins, GCI library paths, etc. Its keys win over the isolation defaults.
 *   - `window` — the workbench page, ready to drive (`.monaco-workbench` present)
 */
export const test = base.extend<{
  workspaceSettings: Record<string, unknown>;
  workspaceFixture: string;
  window: Page;
}>({
  workspaceSettings: [{}, { option: true }],
  // Name of a directory under acceptance/fixtures/ to open as the workspace
  // (e.g. a ready-made Rowan project). Empty = a fresh empty folder.
  workspaceFixture: ['', { option: true }],

  window: async ({ workspaceSettings, workspaceFixture }, use) => {
    const vscodeCliPath = await downloadAndUnzipVSCode(VSCODE_VERSION);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-acceptance-'));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-workspace-'));
    // A scenario opens a ready-made project via a `@fixture:<name>` tag; a plain
    // spec via the workspaceFixture option; otherwise the folder starts empty.
    const tag = base.info().tags.find((t) => t.startsWith('@fixture:'));
    const fixtureName = tag ? tag.slice('@fixture:'.length) : workspaceFixture;
    if (fixtureName) {
      fs.cpSync(path.join(__dirname, '..', 'fixtures', fixtureName), workspace, {
        recursive: true,
      });
    }

    const gemstoneRoot = path.join(profile, 'gemstone-root');
    fs.mkdirSync(gemstoneRoot, { recursive: true });

    // In the container a stone is already up, so seed the login it expects and
    // point at its install — a scenario can then log in as a user would, with
    // no per-scenario configuration. On a host run there is no such stone and
    // the isolation below stands: an empty root, so the Versions and Databases
    // panels never surface your own GemStone installs.
    const containerStone = readContainerStone();
    const stoneSettings = containerStone
      ? {
          'gemstone.rootPath': containerStone.globalDir,
          'gemstone.gciLibraries': { [containerStone.version]: containerStone.gciLibraryPath },
          'gemstone.logins': [
            {
              version: containerStone.version,
              gem_host: containerStone.host,
              stone: containerStone.stone,
              gs_user: containerStone.user,
              gs_password: containerStone.password,
              netldi: containerStone.netldi,
            },
          ],
        }
      : {};

    const settings = {
      'gemstone.rootPath': gemstoneRoot,
      'jasper.mcp.registerWithClaudeDesktop': false,
      // A clean, quiet workbench so traces show just the extension — no welcome
      // editor, tips, telemetry, update checks, or the built-in Copilot/Chat
      // chrome (command center, inline "Next Edit" suggestions on selections).
      'workbench.startupEditor': 'none',
      'workbench.tips.enabled': false,
      'telemetry.telemetryLevel': 'off',
      'update.mode': 'none',
      'chat.commandCenter.enabled': false,
      'editor.inlineSuggest.enabled': false,
      'github.copilot.enable': { '*': false },
      'github.copilot.nextEditSuggestions.enabled': false,
      // GemStone Search docks a webview of its own in the panel the moment a
      // session exists, which leaves `iframe.webview` matching two frames and
      // any spec that reaches into one of them ambiguous. Its QuickPick form is
      // the same feature without a second webview to trip over.
      'gemstone.omniSearch.ui': 'quickpick',
      ...stoneSettings,
      ...workspaceSettings,
    };
    // VS Code renders modal dialogs as native OS windows by default, which are
    // invisible to CDP — a confirmation prompt would be undriveable and, worse,
    // silently unseen. `window.dialogStyle` is application-scoped, so it goes in
    // the profile's user settings rather than the workspace's.
    const userSettingsDir = path.join(profile, 'user-data', 'User');
    fs.mkdirSync(userSettingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(userSettingsDir, 'settings.json'),
      JSON.stringify({ 'window.dialogStyle': 'custom' }, null, 2),
    );

    const dotVscode = path.join(workspace, '.vscode');
    fs.mkdirSync(dotVscode, { recursive: true });
    fs.writeFileSync(path.join(dotVscode, 'settings.json'), JSON.stringify(settings, null, 2));

    // Clean env: drop ELECTRON_RUN_AS_NODE (it makes VS Code's Electron boot as
    // plain Node and reject every CLI flag), and point HOME at the throwaway
    // profile so nothing home-relative touches the real machine.
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
    }
    env.HOME = profile;
    env.USERPROFILE = profile;
    // Pointing HOME at the profile also hides your `~/.gitconfig`, leaving git
    // with no identity — a commit would fail asking for one. Seed a throwaway,
    // as any real machine would already have.
    fs.writeFileSync(
      path.join(profile, '.gitconfig'),
      '[user]\n\tname = Jasper Acceptance\n\temail = acceptance@example.invalid\n',
    );
    // Keep Jasper's first-run walkthrough from popping over every run.
    env.GEMSTONE_SUPPRESS_WALKTHROUGH = '1';

    const app = await electron.launch({
      executablePath: electronBinary(vscodeCliPath),
      env,
      args: [
        `--extensionDevelopmentPath=${repoRoot}`,
        `--user-data-dir=${path.join(profile, 'user-data')}`,
        `--extensions-dir=${path.join(profile, 'extensions')}`,
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-updates',
        // Disable the bundled Copilot extensions so the Chat/Agent bar and inline
        // suggestions stay out of the trace (their settings aren't honored). The
        // selection "sparkle" in an editor is separate — specs close the editor.
        '--disable-extension',
        'GitHub.copilot',
        '--disable-extension',
        'GitHub.copilot-chat',
        '--no-sandbox',
        // In a headless Linux container Chromium's default /dev/shm is too small,
        // so it segfaults on launch (SIGSEGV) with the run appearing flaky. Route
        // shared memory to a temp file and skip the (absent) GPU under Xvfb. Only
        // needed in the container, so leave the macOS path untouched.
        ...(process.platform === 'linux' ? ['--disable-dev-shm-usage', '--disable-gpu'] : []),
        // Back VS Code's SecretStorage with RAM, never the OS keychain. This is
        // the real isolation: --user-data-dir does NOT isolate the machine-global
        // keychain, so without this a launched VS Code (core, or the extension's
        // login storage) prompts for the login-keychain password — native or
        // container. --password-store=basic is a Chromium-level backstop.
        '--use-inmemory-secretstorage',
        '--password-store=basic',
        workspace,
      ],
    });

    if (process.platform === 'darwin') {
      // Make it an accessory app (no Dock icon, never the active app) so its
      // window can't steal focus.
      await app.evaluate(({ app }) => {
        app.setActivationPolicy?.('accessory');
        app.dock?.hide?.();
      });
    }

    const page = await app.firstWindow();

    await page.waitForSelector('.monaco-workbench', { timeout: 60_000 });

    await page.addStyleTag({ content: INTERACTION_HIGHLIGHT });

    // VS Code opens the Chat/Agent secondary side bar by default; close it so the
    // trace shows only the extension. Ctrl/Cmd+Alt+B toggles it — no command-title
    // guessing, no palette left hanging open. Best-effort: never fail over chrome.
    try {
      const auxBar = page.locator('.part.auxiliarybar');
      if (await auxBar.isVisible()) {
        await page.keyboard.press(
          process.platform === 'darwin' ? 'Meta+Alt+KeyB' : 'Control+Alt+KeyB',
        );
        await auxBar.waitFor({ state: 'hidden', timeout: 5_000 });
      }
    } catch {
      /* chrome cleanup is cosmetic */
    }

    // Trace manually so the flip-through report survives regardless of the
    // launch path (leaving the runner's auto-trace off avoids double-starting).
    const context = page.context();
    // Screenshots power the trace filmstrip; DOM snapshots are off because VS
    // Code (canvas + webviews) reconstructs as garbage in the viewer's snapshot
    // pane. The report's attached step screenshots are the clean artifact.
    await context.tracing.start({ screenshots: true, snapshots: false });

    await use(page);

    const tracePath = test.info().outputPath('trace.zip');
    await context.tracing.stop({ path: tracePath });
    await test.info().attach('trace', { path: tracePath, contentType: 'application/zip' });

    await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  },
});

export const expect = test.expect;

/**
 * Run a named step and attach a screenshot of its result, so the HTML report
 * reads as a clean storyboard of the run — one titled image per step. Prefer
 * this over bare `test.step` in acceptance specs; VS Code's DOM doesn't
 * reconstruct in the trace's snapshot pane, so these screenshots are the
 * reliable thing to look at.
 */
export async function step(page: Page, title: string, body: () => Promise<void>): Promise<void> {
  await test.step(title, async () => {
    await body();
    await test.info().attach(title, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}

/**
 * Click `locator`, ringing it in the storyboard as this step's target.
 *
 * The ring is only as durable as the element: clicking a control that removes
 * itself (a welcome button that gives way to a tree) leaves the frame unringed.
 * That is deliberate — an absent ring is honest, whereas re-pinning the ring to
 * a screen position would put it on whatever replaced the control.
 */
export async function touch(locator: Locator): Promise<void> {
  await locator.evaluate((el) => el.setAttribute('data-touched', ''));

  // A control that removes itself when clicked — a welcome button giving way to
  // the tree it creates — leaves nothing to ring once the step is over, so the
  // sentence naming it would point at an unmarked window. Keep a picture while
  // it is still on screen, and attach it only if the click did take it away.
  //
  // Alone among the frames this one predates the actions listed with it, which
  // is what its caption has to say; the sentence above already names the
  // control, and the ring already points at it.
  const page = locator.page();
  const stillThere = await page.screenshot();
  await locator.click();

  // Gone means gone from view, not gone from the DOM: VS Code hides a welcome
  // rather than removing it. Allow a moment for the click to redraw before
  // concluding the control survived.
  const wentAway = await locator
    .waitFor({ state: 'hidden', timeout: 750 })
    .then(() => true)
    .catch(() => false);
  if (wentAway) {
    await test.info().attach(`${currentStep}${FRAME_SEPARATOR}before the click`, {
      body: stillThere,
      contentType: 'image/png',
    });
  }
}

/**
 * Ring `locator` as the subject of this step's assertion, without asserting
 * anything itself — for checks other than plain visibility.
 */
export async function mark(locator: Locator): Promise<Locator> {
  await locator.evaluate((el) => el.setAttribute('data-shown', ''));
  return locator;
}

/** Assert `locator` is visible, ringing the thing being vouched for. */
export async function shows(locator: Locator): Promise<void> {
  await mark(locator);
  await test.expect(locator).toBeVisible();
}

/**
 * Forget the previous step's marks, so each frame rings only what its own step
 * touched or checked.
 */
export async function clearMarks(page: Page): Promise<void> {
  await page.locator('[data-touched], [data-shown]').evaluateAll((marked) =>
    marked.forEach((el) => {
      el.removeAttribute('data-touched');
      el.removeAttribute('data-shown');
    }),
  );
}

export { FRAME_SEPARATOR } from './marks';

/** The Gherkin step currently running, so mid-step frames can name their owner. */
let currentStep = '';

/** Called from BeforeStep — frames captured from here on belong to `title`. */
export function beginStep(title: string): void {
  currentStep = title;
}

/**
 * Capture a labelled frame partway through a step.
 *
 * One screenshot after the step finishes only shows the aftermath: "add a
 * dependency" is a palette, a prompt, and a typed path, none of which survive
 * into the final frame. Call this at each moment worth seeing, and the
 * storyboard lists them beneath the step.
 */
export async function shot(page: Page, label: string): Promise<void> {
  await test.info().attach(`${currentStep}${FRAME_SEPARATOR}${label}`, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
}

/**
 * Run a command by its palette title (VS Code's monaco input needs real keys),
 * capturing the palette itself — otherwise the command a step invoked is
 * nowhere in the storyboard.
 */
export async function runCommand(page: Page, title: string): Promise<void> {
  await page.keyboard.press('F1');
  await page.getByPlaceholder(/Type the name of a command/i).waitFor();
  await page.keyboard.type(title);
  await shot(page, `the command palette offers ${title}`);
  await page.keyboard.press('Enter');
}
