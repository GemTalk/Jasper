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
// command's title aligned with how the walkthrough actually re-triggers.

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
  // normal one); the normal one is the entry that offers Create Database.
  const databasesWelcome = viewsWelcome.find(
    (v) => v.view === 'gemstoneDatabases' && v.contents.includes('command:gemstone.createDatabase'),
  );

  const commands: Array<{ command: string; title: string }> = pkg.contributes?.commands ?? [];
  const resetCommand = commands.find((c) => c.command === 'gemstone.resetGettingStarted');

  // Matches an "Add a Login" (or any) button wired to the item-only connect
  // command — the closing paren pins it to `gemstone.login` and not the
  // legitimate `gemstone.addLogin`.
  const invokesConnectFromButton = /command:gemstone\.login\)/;

  it('guides setup (download + database) before connecting', () => {
    const setupIndex = steps.findIndex((s) =>
      s.description.includes('command:gemstone.quickSetup'),
    );
    const connectIndex = steps.findIndex((s) => s.id === 'connect');

    expect(setupIndex).toBeGreaterThanOrEqual(0);
    expect(connectIndex).toBeGreaterThanOrEqual(0);
    expect(setupIndex).toBeLessThan(connectIndex);
  });

  it('names creating a database in the setup step', () => {
    const setup = steps.find((s) => s.description.includes('command:gemstone.quickSetup'));

    expect(setup?.title.toLowerCase()).toContain('database');
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
  // Create Database.
  it('offers Quick Setup and Create Database from the Databases view welcome', () => {
    expect(databasesWelcome?.contents).toContain('command:gemstone.quickSetup');
    expect(databasesWelcome?.contents).toContain('command:gemstone.createDatabase');
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
