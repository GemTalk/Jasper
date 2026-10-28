import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// The Getting Started walkthrough and the Logins view's welcome text are authored
// as static package.json buttons (`command:...` links). Two problems have bitten
// users:
//   1. The walkthrough opened on "Connect to a stone", skipping the download-a-
//      version / create-a-database setup a first-time user needs.
//   2. The "Add a Login" buttons pointed at `gemstone.login`, which logs in to a
//      *selected* login and dereferences that item — so from a static button
//      (no item) it throws and nothing happens. Creating a new login is
//      `gemstone.addLogin`.
// These tests read the real package.json and guard both, plus keep the Reset
// command's title aligned with how the walkthrough actually re-triggers, and keep
// the way to a stone on another machine (a login and client libraries, not a
// database) said where a first-time user looks.

describe('Getting Started walkthrough content', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  const walkthroughs: Array<{
    id: string;
    steps: Array<{ id: string; title: string; description: string }>;
  }> = pkg.contributes?.walkthroughs ?? [];
  const gettingStarted = walkthroughs.find((w) => w.id === 'gemstoneGettingStarted');
  const steps = gettingStarted?.steps ?? [];

  const viewsWelcome: Array<{ view: string; contents: string }> =
    pkg.contributes?.viewsWelcome ?? [];
  const loginsWelcome = viewsWelcome.find((v) => v.view === 'gemstoneLogins');
  // The Databases view has two welcome variants (the WSL-missing prompt and the
  // normal one); the normal one is the entry that offers a new database.
  const databasesWelcome = viewsWelcome.find(
    (v) => v.view === 'gemstoneDatabases' && v.contents.includes('command:gemstone.newDatabase'),
  );

  const commands: Array<{ command: string; title: string }> = pkg.contributes?.commands ?? [];
  const resetCommand = commands.find((c) => c.command === 'gemstone.resetGettingStarted');

  // Matches an "Add a Login" (or any) button wired to the item-only connect
  // command — the closing paren pins it to `gemstone.login` and not the
  // legitimate `gemstone.addLogin`.
  const invokesConnectFromButton = /command:gemstone\.login\)/;

  // VS Code draws a step's page beside the list only when the editor is wide
  // enough, and says nothing when it is not. It also cuts this text off after
  // three lines, so the note has to come first.
  it("starts by telling the reader to widen the window to see a step's details", () => {
    const description = (gettingStarted as { description?: string } | undefined)?.description;
    expect(description).toMatch(/^Widen the window/);
  });

  it('guides setup (download + database) before connecting', () => {
    const setupIndex = steps.findIndex((s) =>
      s.description.includes('command:gemstone.quickSetup'),
    );
    const connectIndex = steps.findIndex((s) => s.id === 'connect');

    expect(setupIndex).toBeGreaterThanOrEqual(0);
    expect(connectIndex).toBeGreaterThanOrEqual(0);
    expect(setupIndex).toBeLessThan(connectIndex);
  });

  it('offers a notebook, blank or the tutorial, after the workspace steps', () => {
    const notebook = steps.find((s) => s.id === 'notebook');
    expect(notebook?.description).toContain('command:gemstone.openNotebook');
    expect(notebook?.description).toContain('command:gemstone.openTutorial');
    // Display It and Inspect It are done in the workspace, so the notebook step
    // follows them rather than splitting them from the workspace step.
    const index = (id: string) => steps.findIndex((s) => s.id === id);
    expect(index('notebook')).toBeGreaterThan(index('inspectIt'));
    expect(index('inspectIt')).toBeGreaterThan(index('openWorkspace'));
  });

  it('names creating a database in the setup step', () => {
    const setup = steps.find((s) => s.description.includes('command:gemstone.quickSetup'));

    expect(setup?.title.toLowerCase()).toContain('database');
  });

  it('without WSL, says a running server elsewhere needs no WSL, and keeps Install WSL', () => {
    // WSL is only for running a server here; a stone elsewhere needs only the
    // client libraries, so the prompt does not read as a requirement.
    const noWsl = viewsWelcome.find(
      (v) => v.view === 'gemstoneDatabases' && v.contents.includes('Install WSL'),
    );
    const contents = noWsl?.contents ?? '';
    expect(contents).toContain('needs no WSL');
    expect(contents).toContain('click + on Logins & Sessions');
    // One button, and it is the one this prompt is for.
    expect(contents.match(/\[[^\]]+\]\(/g)).toEqual(['[Install WSL](']);
  });

  it('wires the connect step’s "Add a Login" button to the new-login editor', () => {
    const connect = steps.find((s) => s.id === 'connect');

    expect(connect?.description).toContain('command:gemstone.addLogin');
  });

  it('never invokes the item-only connect command from a static walkthrough button', () => {
    const offenders = steps.filter((s) => invokesConnectFromButton.test(s.description));

    expect(offenders.map((s) => s.id)).toEqual([]);
  });

  it('wires the Logins view welcome "Add a Login" button to the new-login editor', () => {
    expect(loginsWelcome?.contents).toContain('command:gemstone.addLogin');
    expect(loginsWelcome?.contents).not.toMatch(invokesConnectFromButton);
  });

  // Each empty view offers the action that populates *it*: adding a login here,
  // not creating a database (that belongs to the Databases view). Keeping the
  // stone-setup actions out of this view keeps it from becoming a scrolling list
  // of steps that point "back" to things a user does elsewhere.
  it('keeps the Logins view welcome focused on adding a login', () => {
    expect(loginsWelcome?.contents).not.toContain('command:gemstone.quickSetup');
    expect(loginsWelcome?.contents).not.toContain('command:gemstone.openWalkthrough');
  });

  // Quick Setup is the one-step "I have no stone yet" path, so it belongs where a
  // missing database is surfaced — the Databases view — alongside the manual
  // path, which now opens the Databases & Versions panel on its form rather than
  // starting a chain of Quick Picks.
  it('offers Quick Setup and a new database from the Databases view welcome', () => {
    expect(databasesWelcome?.contents).toContain('command:gemstone.quickSetup');
    expect(databasesWelcome?.contents).toContain('command:gemstone.newDatabase');
  });

  // Said where it is always on screen: the Databases view's text runs past its
  // height on a normal window, and a last line there goes unseen.
  it('tells someone reaching a stone elsewhere that they need a login, not a database', () => {
    const contents = loginsWelcome?.contents ?? '';
    expect(contents).toContain('another machine needs no database locally');
    expect(contents.indexOf('needs no database')).toBeLessThan(
      contents.indexOf('command:gemstone.newDatabase'),
    );
  });

  // The Databases view's + runs this command, and its title is all the + says on
  // hover, so it has to say the database is made here.
  it('names the new-database command as making a database on this machine', () => {
    const newDatabase = commands.find((c) => c.command === 'gemstone.newDatabase');
    expect(newDatabase?.title).toBe('New Database on This Machine...');
  });

  // The page has to say how to get a version's client libraries, in the words the
  // login editor uses, or a remote user reads the version list as needing a full
  // install.
  it('tells the connect page’s reader how to fetch a version’s client libraries', () => {
    const page = fs.readFileSync(path.join(repoRoot, 'resources/walkthrough/connect.md'), 'utf8');
    const editorHtml = fs.readFileSync(
      path.join(repoRoot, 'client/src/loginEditorHtml.ts'),
      'utf8',
    );
    const button = /id="downloadVersionBtn"[^>]*>([^<]+)</.exec(editorHtml)?.[1];
    expect(button).toBeDefined();
    expect(page).toContain(`**${button}**`);
    expect(page).toContain('(not yet downloaded)');
  });

  // Reset re-arms two first-run surfaces: the walkthrough (auto-opens on startup)
  // and the Start Here status-bar button (shows on connect). The title names both
  // so the user knows what comes back, rather than describing a single trigger.
  it('names both surfaces the reset command restores', () => {
    const title = resetCommand?.title.toLowerCase();
    expect(title).toContain('walkthrough');
    expect(title).toContain('start here');
  });
});
