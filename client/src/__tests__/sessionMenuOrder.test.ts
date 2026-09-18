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

function inlineRank(group: string): number {
  const match = /inline@(\d+)/.exec(group);
  return match ? Number(match[1]) : 0;
}

// Whether a `when` clause fires for a row carrying this context value. Session
// clauses are `viewItem =~ /.../` now that each row says in its own context value
// what that session can do (see sessionContextValue in loginTreeProvider.ts), so
// the clause is EVALUATED rather than matched as text: a substring test passes
// for any clause that merely fails to contain the literal, which is every clause
// once one is reworded. Same helper, same reason, as databaseMenuOrder.test.ts.
function applies(when: string, viewItem: string): boolean {
  const literal = /viewItem == ([A-Za-z]+)/.exec(when);
  if (literal) return literal[1] === viewItem;
  const pattern = /viewItem =~ \/(.+?)\//.exec(when);
  return pattern ? new RegExp(pattern[1]).test(viewItem) : false;
}

// The context value each kind of session row carries, from sessionContextValue.
const AUTO_BEGIN_ROW = 'gemstoneSession.canCommit';
const MANUAL_BETWEEN_TRANSACTIONS_ROW = 'gemstoneSession.canBegin';
const TRANSACTIONLESS_ROW = 'gemstoneSession';
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
    expect(order).toEqual([
      'gemstone.fileIn',
      'gemstone.sessionBegin',
      'gemstone.sessionCommit',
      'gemstone.sessionAbort',
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
      'gemstone.showSessionConfiguration',
      'gemstone.sessionLogout',
    ]);
  });

  it('swaps Commit for Begin on a manual session between transactions', () => {
    expect(inlineOrderFor(MANUAL_BETWEEN_TRANSACTIONS_ROW)).toEqual([
      'gemstone.fileIn',
      'gemstone.sessionBegin',
      'gemstone.sessionAbort',
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
      'gemstone.showSessionConfiguration',
      'gemstone.sessionLogout',
    ]);
  });

  it('offers the mode switch from the session row’s context menu, not its inline strip', () => {
    // Switching modes aborts, so it is not something to put a click away from
    // Commit. The status bar carries the frequent path; this is the row's copy.
    const setMode = sessionMenuItemFor('gemstone.setTransactionMode');
    expect(setMode?.group).toBe('1_transaction@1');
  });

  // A vacated number is invisible in the rendered row — VS Code just sorts —
  // but it reads as a missing button to whoever adds the next one, which is how
  // a button ends up in the wrong place. Removing a button means renumbering
  // the ones after it.
  it('numbers the declared slots 1..n with no vacated one', () => {
    expect(inlineRanksFor(EVERY_SESSION_CLAUSE)).toEqual([1, 2, 3, 4, 5, 6]);
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
