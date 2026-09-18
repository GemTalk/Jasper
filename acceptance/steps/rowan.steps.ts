import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Locator, Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import {
  test,
  expect,
  runCommand,
  touch,
  mark,
  shows,
  clearMarks,
  beginStep,
  shot,
} from '../helpers/vscode';
import { SourceControlView } from '../pageobjects/sourceControlView';
import { IntegratedBrowser } from '../pageobjects/integratedBrowser';
import { ThisProjectView } from '../pageobjects/thisProjectView';

const { Given, When, Then, Before, BeforeStep, AfterStep } = createBdd(test);

// Each step is rung for its own interactions only — a step that just asserts
// shows a clean window rather than the previous step's click.
BeforeStep(async ({ window, $step }) => {
  beginStep($step.title);
  await clearMarks(window);
});

// A screenshot after every step, attached to that step — so the report reads as
// a storyboard: expand a scenario and each Given/When/Then carries its own image.
AfterStep(async ({ window, $step, $testInfo }) => {
  await $testInfo.attach($step.title, {
    body: await window.screenshot(),
    contentType: 'image/png',
  });
});

// ── Creating a project ──────────────────────────────────────

// Creating a project is a Command Palette action. Jasper's only Rowan section is
// the one in the Explorer, and it is contributed for a folder that already *is*
// a project — so an empty folder is one with no Rowan section to be seen.
const CREATE_PROJECT = 'GemStone: Create Rowan Project';

/** The Explorer's Rowan section header — present only for a Rowan project. */
function rowanSection(window: Page): Locator {
  return window.locator('.sidebar').getByRole('button', { name: /^Rowan\b/ });
}

async function createRowanProject(window: Page): Promise<void> {
  await runCommand(window, CREATE_PROJECT);
}

Given('an empty folder is open', async ({ window }) => {
  await touch(window.getByRole('tab', { name: /^Explorer/ }));

  await expect(rowanSection(window)).toBeHidden();
});

When('I create a Rowan project', async ({ window }) => {
  await createRowanProject(window);
});

Then('the folder becomes a Rowan project', async ({ window }) => {
  // Create Rowan Project opens the new load spec; close it for a clean view.
  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyW' : 'Control+KeyW');

  // The Explorer's Rowan section is contributed only for a folder that is one,
  // so its arrival is the folder having become a project.
  await new ThisProjectView(window).open();
  await shows(rowanSection(window));
});

// ── Committing to git ───────────────────────────────────────

async function putUnderVersionControl(window: Page): Promise<void> {
  const git = new SourceControlView(window);
  await git.open();

  await touch(git.initializeButton);
}

async function commitEverything(window: Page, message: string): Promise<void> {
  const git = new SourceControlView(window);
  await git.open();

  await touch(git.messageBox);
  await window.keyboard.type(message);
  await shot(window, 'the commit message is written');

  await touch(git.commitButton);

  // Nothing is staged, so VS Code offers to stage everything and commit it —
  // the ordinary way a commit is made from this view.
  await shot(window, 'VS Code offers to commit every change');
  await touch(window.getByRole('button', { name: 'Yes', exact: true }));

  await expect(git.tab).not.toHaveAccessibleName(/pending changes/);
}

When('I put the folder under version control', async ({ window }) => {
  await putUnderVersionControl(window);
});

Then("the project's files are waiting to be committed", async ({ window }) => {
  await shows(new SourceControlView(window).change('project.ston'));
});

When('I commit them with a message', async ({ window }) => {
  const git = new SourceControlView(window);

  await touch(git.messageBox);
  await window.keyboard.type('Start a Rowan project');
  await shot(window, 'the commit message is written');

  await touch(git.commitButton);

  await shot(window, 'VS Code offers to commit every change');
  await touch(window.getByRole('button', { name: 'Yes', exact: true }));
});

// The activity-bar tab counts what is outstanding, so a clean tree is the count
// being gone — one durable place to look, rather than the absence of each row.
Then('nothing is left to commit', async ({ window }) => {
  const git = new SourceControlView(window);

  await expect(git.tab).not.toHaveAccessibleName(/pending changes/);
  await mark(git.tab);
});

// ── A dependency's state ────────────────────────────────────

Given('a committed Rowan project is open', async ({ window }) => {
  await createRowanProject(window);

  await putUnderVersionControl(window);
  await commitEverything(window, 'Start a Rowan project');
});

Then('{word} is listed as a dependency', async ({ window }, name: string) => {
  await shows(new ThisProjectView(window).dependency(name));
});

When('I review what has changed', async ({ window }) => {
  const git = new SourceControlView(window);
  await git.open();

  await touch(git.refreshButton);
});

Then("{word}'s reference is waiting to be committed", async ({ window }, name: string) => {
  await shows(new SourceControlView(window).change(`${name}.ston`));
});

// ── A real dependency, over the network ─────────────────────

/**
 * FIXME — depends on a personal fork. The Rowanized WebGS lives only on the
 * `rowanize` branch of github.com/srbaker/WebGS; upstream (jgfoster/WebGS) has
 * no such branch yet. Repoint both constants at upstream the moment it merges.
 */
const WEBGS_URL = 'https://github.com/srbaker/WebGS.git';
const WEBGS_COMMIT = '88835be';

Before({ tags: '@online' }, async () => {
  test.skip(
    !process.env.JASPER_ONLINE_SPECS,
    'fetches from the internet — set JASPER_ONLINE_SPECS=1 to run it',
  );
  // Cloning a project and loading it into a database is minutes of real work,
  // well past the suite's default budget — and a step timeout can't help, since
  // the test's own budget caps it.
  test.setTimeout(900_000);
});

When('I add WebGS as a dependency, pinned to a commit', async ({ window }) => {
  await new ThisProjectView(window).addDependency(WEBGS_URL);

  // Branches and tags are offered, but a branch moves — name the commit.
  await touch(window.getByRole('option', { name: /Enter a commit/ }));
  await window.locator('.quick-input-widget input').waitFor();
  await window.keyboard.type(WEBGS_COMMIT);
  await shot(window, 'the exact commit is named');

  await window.keyboard.press('Enter');
});

// ── Serving it ──────────────────────────────────────────────

const APP_URL = 'http://localhost:8888/hello.gs';

// The Rowan test extent carries US Pacific as its baked-in default timezone
// (proven against the fixture stone: `TimeZone default` is PST and
// `DateAndTime now` prints -07:00), and `Date today` renders in that zone
// whatever the container's own clock reads — near midnight UTC the two are a
// day apart, which is exactly what tripped this up. Changing the repository's
// timezone needs SystemUser, so read "today" in the same zone the gem uses
// instead. That is what printing it "the way GemStone does" has to mean.
const GEMSTONE_ZONE = 'America/Los_Angeles';

/** Today, formatted the way GemStone's `Date today printString` renders it. */
function todayAsGemStonePrintsIt(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: GEMSTONE_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date());
  const field = (type: string): string => parts.find((p) => p.type === type)!.value;
  return `${field('day')}/${field('month')}/${field('year')}`;
}

Given('the web-demo Rowan project is open', async ({ window }) => {
  await touch(window.getByRole('tab', { name: /GemStone/ }));
});

// Loading fetches WebGS from git and loads it too, so this is minutes, not
// seconds — the wait is the clone and the compile, not flakiness.
When('I accept the offer to load', async ({ window }) => {
  // Wait for the offer by its own words before pressing anything. Adding the
  // dependency is not instant — it fetches refs from GitHub — so arriving here
  // with the quick pick still open is normal, not exceptional. Clicking a bare
  // "Load" the moment this step starts asks whatever happens to be on screen,
  // and a click that lands somewhere unexpected reads later as a load that
  // silently never began.
  await shows(loadOffer(window));
  await touch(window.getByRole('button', { name: 'Load', exact: true }));

  // Adding WebGS as a dependency put a second loadable spec on disk, so the
  // loader now asks which one — a prompt no earlier scenario meets, because
  // with a single spec it doesn't ask. Load our own project: resolving it is
  // what fetches and loads the WebGS dependency along with it.
  await touch(window.getByRole('option', { name: /^WebDemo/ }));

  // Cloning WebGS and loading it is minutes of real work. Watch for the failure
  // notification as well as the success one: waiting only for success turns any
  // error into a silent timeout that says nothing about what went wrong.
  const loaded = window.getByText(/Rowan project .* loaded/).first();
  const failed = window.getByText(/(failed|error|could not)/i).first();
  const deadline = Date.now() + 600_000;
  for (;;) {
    if (await loaded.count()) break;
    if (await failed.count()) {
      throw new Error(`load reported: ${(await failed.allInnerTexts()).join(' ')}`);
    }
    if (Date.now() > deadline) throw new Error('the load neither finished nor reported anything');
    await window.waitForTimeout(2_000);
  }
});

Then('WebGS is listed as loaded', async ({ window }) => {
  const row = new ThisProjectView(window).dependency('WebGS');

  await expect(row).toContainText('loaded');
  await mark(row);
});

When('I run the web app in a gem of its own', async ({ window }) => {
  // The launch expression is not project code — it belongs in a scratch
  // Workspace, not committed into the Tonel source. The serving method itself
  // (HelloApi class >> runHttp) is the project's, loaded from disk; this only
  // calls it. The Workspace opens seeded with a template, so select it all and
  // replace it with the one line that starts the app.
  await runCommand(window, 'Open Getting Started Workspace');
  await shows(window.getByRole('tab', { name: /Workspace/ }));

  // Put keyboard focus in the buffer before typing. Opening it is async, and
  // typing into an editor that is not yet focused is what made an earlier
  // approach flaky. Scope to the editor area so the click can never land in the
  // Source Control box, which is a Monaco editor too.
  await window.getByRole('main').locator('.monaco-editor').first().click();
  await window.keyboard.press('Control+KeyA');
  await window.keyboard.type('HelloApi runHttp');

  await runCommand(window, 'GemStone: Run in a New Gem');

  // The notification carries the new gem's session id — the only handle there
  // is on a gem started this way.
  await shows(window.getByText(/Running in gem session/).first());
});

When("I open the app in the editor's browser", async ({ window }) => {
  await new IntegratedBrowser(window).open(APP_URL);
});

// The served page is a real Chromium page of its own, so this reads what was
// actually rendered — not the browser tab's title.
Then("the page shows today's date", async ({ window }) => {
  const page = await new IntegratedBrowser(window).pageShowing(APP_URL);
  const today = todayAsGemStonePrintsIt();
  const target = page.getByText(today);

  // The gem binds its HTTP port a moment after the fork returns, so the
  // browser's first navigation can beat it and land on a connection-error page
  // that never reloads itself. Reload until the app answers — and if it never
  // does, put the page's own text in the failure, so the log says what was
  // served instead of leaving it to be guessed.
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (await target.count()) break;
    if (Date.now() > deadline) {
      const body = await page.innerText('body').catch((e) => `(page unreadable: ${e})`);
      throw new Error(`the app never served ${today}. ${page.url()} showed:\n${body}`);
    }
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await window.waitForTimeout(2_000);
  }
});

// The row's description is the revision, so the pin is visible without opening
// the spec file — which is the whole point of pinning one.
Then('WebGS records the commit it was pinned to', async ({ window }) => {
  const row = new ThisProjectView(window).dependency('WebGS');

  await expect(row).toContainText(WEBGS_COMMIT);
  await mark(row);
});

/** The modal offering to load the project now that a dependency was added. */
function loadOffer(window: Page): Locator {
  return window.getByText(/Load this project into the database/);
}

Then('Jasper offers to load the project', async ({ window }) => {
  await shows(loadOffer(window));
});

When('I decline the offer', async ({ window }) => {
  await touch(window.getByRole('button', { name: 'Cancel', exact: true }));
});

When('I answer never to the offer', async ({ window }) => {
  await touch(window.getByRole('button', { name: 'Never', exact: true }));
});

// The answer is remembered, so the next dependency goes straight in — the
// "Added …" notification is the evidence it was added without being asked.
Then('{word} is added without another offer', async ({ window }, name: string) => {
  // A notification shows twice — as a toast and in the notification centre.
  await shows(window.getByText(new RegExp(`Added ${name} as a dependency`)).first());

  await expect(loadOffer(window)).toBeHidden();
});

// Declaring a dependency doesn't put it in the database — the row says so, and
// only says so while connected, since disconnected nothing can know.
Then('{word} is listed as not loaded', async ({ window }, name: string) => {
  const row = new ThisProjectView(window).dependency(name);

  await expect(row).toContainText('not loaded');
  await mark(row);
});

// ── An already-open project (opened via the @fixture:demo-library tag) ───

Given('the demo-library Rowan project is open', async ({ window }) => {
  // Reveal the GemStone view so the extension activates for this workspace.
  await touch(window.getByRole('tab', { name: /GemStone/ }));
});

When('I open the This Project view', async ({ window }) => {
  await new ThisProjectView(window).open();
});

Then('it lists the DemoLibrary-Core package', async ({ window }) => {
  await shows(new ThisProjectView(window).package('DemoLibrary-Core'));
});

When('I add a local directory as a dependency', async ({ window }) => {
  const dependencyDir = path.join(os.tmpdir(), 'SharedKit');
  fs.mkdirSync(dependencyDir, { recursive: true });

  await runCommand(window, 'GemStone: Add Dependency');

  await window.locator('.quick-input-widget input').waitFor();
  await shot(window, 'Jasper asks for a git URL or a directory');

  await window.keyboard.type(dependencyDir);
  await shot(window, 'a directory on this machine is entered');

  await window.keyboard.press('Enter');
});

/**
 * A real git repository on disk, with a branch and a release tag.
 *
 * `git ls-remote` treats a path as a remote, so the whole git flow — listing
 * refs, choosing a revision, writing the reference — runs against a genuine
 * repository without reaching the network. Cloned bare so the path ends in
 * `.git`, which is how Jasper tells a repository from a directory.
 */
function aGitRepositoryNamed(name: string): string {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-dependency-'));
  const work = path.join(parent, name);
  fs.mkdirSync(work);

  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=Test', ...args], {
      cwd: work,
      stdio: 'ignore',
    });
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(work, 'README.md'), `# ${name}\n`);
  git('add', '.');
  git('commit', '-qm', 'first');
  git('tag', 'v1.0.0');

  const bare = path.join(parent, `${name}.git`);
  execFileSync('git', ['clone', '-q', '--bare', work, bare], { stdio: 'ignore' });
  return bare;
}

When('I add a git repository as a dependency', async ({ window }) => {
  const repository = aGitRepositoryNamed('Toolkit');

  await runCommand(window, 'GemStone: Add Dependency');

  await window.locator('.quick-input-widget input').waitFor();
  await window.keyboard.type(repository);
  await window.keyboard.press('Enter');

  // Jasper reads the repository's refs and offers them; pin to the release tag.
  await shot(window, 'the repository\u2019s branches and tags are offered');
  await touch(window.getByRole('option', { name: 'v1.0.0' }));
});

// Assert the project's own row, not the "Added …" toast: a toast auto-dismisses,
// so racing it is flaky, and the row is the durable evidence the dependency
// landed — it lists the project's packages plus everything it depends on.
Then('the project lists {word} alongside its own package', async ({ window }, name: string) => {
  const projectRow = await mark(
    window.locator('.sidebar').getByRole('treeitem', { name: /workspace project/i }),
  );

  await expect(projectRow).toContainText(name);
  await expect(projectRow).toContainText('DemoLibrary');
});

// ── Loading into a database ─────────────────────────────────

Given('I am logged in to a database', async ({ window }) => {
  const sidebar = window.locator('.sidebar');

  const login = sidebar.getByRole('treeitem', { name: /DataCurator on/ });
  await login.hover();
  await touch(login.getByRole('button', { name: 'Login', exact: true }));

  await shows(sidebar.getByText(/Session \d+/).first());

  // Logging in offers to install enhanced inspector support — a modal that
  // blocks the window until answered. Decline: it commits classes to the
  // database over a SystemUser login, which is nothing to do with Rowan.
  const inspectorOffer = window.getByRole('button', { name: 'Never', exact: true });
  if (await inspectorOffer.count()) await touch(inspectorOffer);
});

When('I load the project into the database', async ({ window }) => {
  const sidebar = window.locator('.sidebar');

  const project = sidebar.getByRole('treeitem', { name: /The open workspace project/ });
  await project.hover();
  await touch(project.getByRole('button', { name: /Load into Image/ }));

  // The load runs on this session, so there is no second session to reconcile
  // and nothing to accept — it is simply done when Jasper says so.
  await shows(window.getByText(/Rowan project .* loaded/).first());
});

/** The DemoLibrary row under Loaded Projects, not the workspace repository row. */
function loadedProject(sidebar: Locator): Locator {
  return sidebar.getByRole('treeitem', { name: /DemoLibrary/ }).filter({ hasNotText: 'workspace' });
}

Then('DemoLibrary is listed among the loaded projects', async ({ window }) => {
  const loaded = loadedProject(window.locator('.sidebar'));

  // Wait before marking: marking evaluates against the element, so it cannot
  // be what waits for it to turn up.
  await expect(loaded).toBeVisible({ timeout: 90_000 });
  await mark(loaded);
});

When('I unload the project from the database', async ({ window }) => {
  await runCommand(window, 'GemStone: Unload Rowan Project');

  await touch(window.getByRole('option', { name: 'DemoLibrary', exact: true }));

  // Unloading discards the code from the database, so Jasper asks first.
  await shot(window, 'Jasper asks before discarding the code');
  await touch(window.getByRole('button', { name: 'Unload', exact: true }));
});

Then('DemoLibrary is no longer among the loaded projects', async ({ window }) => {
  await expect(loadedProject(window.locator('.sidebar'))).toBeHidden({ timeout: 90_000 });
});
