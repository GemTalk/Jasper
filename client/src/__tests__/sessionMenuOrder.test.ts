import { applies, inlineRank } from './menuWhenClause';
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// The Logins tree exposes inline action buttons whose left-to-right order VS
// Code derives from the `inline@<n>` suffix (ascending — lowest number is
// leftmost). That order is a deliberate UX decision: the most-used and safe
// actions lead, and the session-ending / destructive actions trail so they are
// not the first thing the cursor reaches. Pin the sequence here so a future
// edit to package.json can't silently scramble it.

interface MenuItem {
  command: string;
  when?: string;
  group?: string;
}

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf-8'),
);
const itemContext: MenuItem[] = pkg.contributes.menus['view/item/context'];

// The context value each kind of session row carries, from sessionContextValue:
// `gemstoneSession`, then the auto-commit state when it is not off, then what the
// session can do about its transaction.
const AUTO_BEGIN_ROW = 'gemstoneSession.canCommit';
const MANUAL_BETWEEN_TRANSACTIONS_ROW = 'gemstoneSession.canBegin';
const TRANSACTIONLESS_ROW = 'gemstoneSession';
const AUTO_COMMIT_ON_ROW = 'gemstoneSessionAutoCommitOn.canCommit';
const AUTO_COMMIT_FAILED_ROW = 'gemstoneSessionAutoCommitFailed.canCommit';
// Not a row any session shows — Begin and Commit are mutually exclusive — but
// every session clause fires for it, which is what the package.json-hygiene
// checks below want.
const EVERY_SESSION_CLAUSE = 'gemstoneSession.canCommit.canBegin';

function inlineItemsFor(viewItem: string): MenuItem[] {
  return itemContext
    .filter((m) => m.group?.startsWith('inline') && applies(m.when ?? '', viewItem))
    .sort((a, b) => inlineRank(a.group!) - inlineRank(b.group!));
}

function inlineOrderFor(viewItem: string): string[] {
  return inlineItemsFor(viewItem).map((m) => m.command);
}

function inlineRanksFor(viewItem: string): number[] {
  return inlineItemsFor(viewItem).map((m) => inlineRank(m.group!));
}

function sessionMenuItemFor(command: string): MenuItem | undefined {
  return itemContext.find(
    (m) => m.command === command && applies(m.when ?? '', EVERY_SESSION_CLAUSE),
  );
}

describe('session row inline button order', () => {
  it('leads with the most-used safe actions and trails with Logout, without the rare backup actions', () => {
    const order = inlineOrderFor(EVERY_SESSION_CLAUSE);

    // File In reads a Topaz `.gs` into THIS session and leads the row: it is safe,
    // it is the hardest of these to reach any other way, and the row is what
    // answers "which session?" for it.
    //
    // Session Configuration opens the session's settings page — placed just
    // before the session-ending Logout, which stays last.
    //
    // Open Workspace is deliberately absent: Display It, Inspect It and the
    // Explorer all work in the *active* session, so opening a workspace "on"
    // some other session promised something Jasper does not do. The workspace
    // button is now in this view's title bar, where the active session is shown.
    //
    // Ping is absent too — it lives on a session row in the Databases & Versions
    // panel, which has the room to show its answer beside the row that asked.
    //
    // Nothing MCP is here: claiming the server is a property of the window, not
    // of a session, so it lives on the Databases section header and in the MCP
    // Server tab. The row's only MCP mark is `· MCP` in its description.
    //
    // The auto-commit button sits with Begin, Commit and Abort because it is the
    // same subject: this session's transaction.
    expect(order).toEqual([
      'gemstone.fileIn',
      'gemstone.sessionBegin',
      'gemstone.sessionCommit',
      'gemstone.sessionAbort',
      'gemstone.autoCommit.turnOn',
      'gemstone.showSessionConfiguration',
      'gemstone.sessionLogout',
    ]);
  });

  // Begin and Commit are the two buttons that are not always usable: outside a
  // transaction a commit can only raise 2030, and inside one there is nothing to
  // begin. Rather than show a button that fails, each row says in its own
  // contextValue whether it has them — so an autoBegin session (the default) sees
  // exactly the row it always saw, with no Begin on it.
  it('gives the autoBegin session the row it always had, with no Begin on it', () => {
    expect(inlineOrderFor(AUTO_BEGIN_ROW)).toEqual([
      'gemstone.fileIn',
      'gemstone.sessionCommit',
      'gemstone.sessionAbort',
      'gemstone.autoCommit.turnOn',
      'gemstone.showSessionConfiguration',
      'gemstone.sessionLogout',
    ]);
  });

  it('swaps Commit for Begin on a manual session between transactions', () => {
    expect(inlineOrderFor(MANUAL_BETWEEN_TRANSACTIONS_ROW)).toEqual([
      'gemstone.fileIn',
      'gemstone.sessionBegin',
      'gemstone.sessionAbort',
      'gemstone.autoCommit.turnOn',
      'gemstone.showSessionConfiguration',
      'gemstone.sessionLogout',
    ]);
  });

  it('offers neither on a transactionless session, and still offers Abort', () => {
    // Abort is the one action that is always safe and always meaningful: it is
    // the way out of a stale view whatever mode the session is in.
    expect(inlineOrderFor(TRANSACTIONLESS_ROW)).toEqual([
      'gemstone.fileIn',
      'gemstone.sessionAbort',
      'gemstone.autoCommit.turnOn',
      'gemstone.showSessionConfiguration',
      'gemstone.sessionLogout',
    ]);
  });

  // One button on the row, not three. A contributed entry's icon is fixed text in the
  // manifest, so showing the state at all takes one command per state — which is only
  // correct as long as their `when` clauses cannot both hold. Each is anchored on one
  // auto-commit state, and `loginTreeProvider.sessionContextValue` answers exactly one.
  it.each([
    [TRANSACTIONLESS_ROW, 'gemstone.autoCommit.turnOn'],
    [AUTO_BEGIN_ROW, 'gemstone.autoCommit.turnOn'],
    [MANUAL_BETWEEN_TRANSACTIONS_ROW, 'gemstone.autoCommit.turnOn'],
    [AUTO_COMMIT_ON_ROW, 'gemstone.autoCommit.turnOff'],
    [AUTO_COMMIT_FAILED_ROW, 'gemstone.autoCommit.recover'],
  ])('shows exactly one auto-commit button on a %s row', (row, command) => {
    const buttons = inlineOrderFor(row).filter((c) => c.startsWith('gemstone.autoCommit.'));
    expect(buttons).toEqual([command]);
  });

  it('keeps the rest of the row whatever the auto-commit state', () => {
    const withoutAutoCommit = (row: string) =>
      inlineOrderFor(row).filter((c) => !c.startsWith('gemstone.autoCommit.'));
    expect(withoutAutoCommit(AUTO_COMMIT_ON_ROW)).toEqual(withoutAutoCommit(AUTO_BEGIN_ROW));
    expect(withoutAutoCommit(AUTO_COMMIT_FAILED_ROW)).toEqual(withoutAutoCommit(AUTO_BEGIN_ROW));
  });

  it('gives each auto-commit state its own icon', () => {
    // Each needs its own icon, or the state it exists to show is invisible — and they must
    // differ, or the three commands buy nothing over one.
    const icons = [
      'gemstone.autoCommit.turnOn',
      'gemstone.autoCommit.turnOff',
      'gemstone.autoCommit.recover',
    ].map(
      (command) =>
        pkg.contributes.commands.find((c: { command: string }) => c.command === command)?.icon,
    );
    expect(icons).toEqual(['$(sync-ignored)', '$(sync)', '$(error)']);
  });

  it('offers the mode switch from the session row’s context menu, not its inline strip', () => {
    // Switching modes aborts, so it is not something to put a click away from
    // Commit. The status bar carries the frequent path; this is the row's copy.
    const setMode = sessionMenuItemFor('gemstone.setTransactionMode');
    expect(setMode?.group).toBe('1_transaction@1');
  });

  it('offers the auto-commit toggle beside it, on every row whatever its state', () => {
    // The right-click entry is the state-independent way in: it reads the state itself and
    // does the right thing, including opening the recovery choices rather than flipping
    // when the last commit failed.
    for (const row of [TRANSACTIONLESS_ROW, AUTO_COMMIT_ON_ROW, AUTO_COMMIT_FAILED_ROW]) {
      const toggle = itemContext.find(
        (m) => m.command === 'gemstone.autoCommit.toggle' && applies(m.when ?? '', row),
      );
      expect(toggle?.group).toBe('1_transaction@2');
    }
  });

  // A vacated number is invisible in the rendered row — VS Code just sorts —
  // but it reads as a missing button to whoever adds the next one, which is how
  // a button ends up in the wrong place. Removing a button means renumbering
  // the ones after it.
  it('numbers the declared slots 1..n with no vacated one', () => {
    expect(inlineRanksFor(EVERY_SESSION_CLAUSE)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps the rare backup and restore actions off the inline row, paired in a context-menu group', () => {
    const sessionItems = itemContext.filter((m) => applies(m.when ?? '', EVERY_SESSION_CLAUSE));

    const backup = sessionItems.find((m) => m.command === 'gemstone.fullLogicalBackup');
    const restore = sessionItems.find((m) => m.command === 'gemstone.fullLogicalRestore');

    expect(backup?.group).toBe('3_backup@1');
    expect(restore?.group).toBe('3_backup@2');
  });
});

describe('login row inline button order', () => {
  it('leads with Login and trails with the destructive Delete', () => {
    const order = inlineOrderFor('gemstoneLogin');

    expect(order).toEqual(['gemstone.login', 'gemstone.editLogin', 'gemstone.deleteLogin']);
  });

  it('numbers the row 1..n with no vacated slot', () => {
    expect(inlineRanksFor('gemstoneLogin')).toEqual([1, 2, 3]);
  });
});
