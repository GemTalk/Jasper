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

// Matched on a substring of the `when` clause rather than the whole thing: the
// session clauses use `viewItem =~ /.../` so a row can carry its own answer about
// what it can do (see sessionContextValue in loginTreeProvider.ts), and no single
// literal clause covers them all.
function inlineOrderFor(viewItemFragment: string): string[] {
  return itemContext
    .filter((m) => m.group?.startsWith('inline') && (m.when ?? '').includes(viewItemFragment))
    .sort((a, b) => inlineRank(a.group!) - inlineRank(b.group!))
    .map((m) => m.command);
}

function sessionMenuItemFor(command: string): MenuItem | undefined {
  return itemContext.find(
    (m) => m.command === command && (m.when ?? '').includes('gemstoneSession'),
  );
}

describe('session row inline button order', () => {
  it('leads with the most-used safe actions and trails with Logout, without the rare backup actions', () => {
    const order = inlineOrderFor('gemstoneSession');

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
  it('shows Begin and Commit only on a row whose session can use them', () => {
    expect(sessionMenuItemFor('gemstone.sessionBegin')?.when).toContain('canBegin');
    expect(sessionMenuItemFor('gemstone.sessionCommit')?.when).toContain('canCommit');
  });

  it('keeps Abort on every session row, in every mode', () => {
    // Abort is the one action that is always safe and always meaningful: it is
    // the way out of a stale view whatever mode the session is in.
    const abort = sessionMenuItemFor('gemstone.sessionAbort');
    expect(abort?.when).not.toContain('canCommit');
    expect(abort?.when).not.toContain('canBegin');
  });

  it('offers the mode switch from the session row’s context menu, not its inline strip', () => {
    // Switching modes aborts, so it is not something to put a click away from
    // Commit. The status bar carries the frequent path; this is the row's copy.
    const setMode = sessionMenuItemFor('gemstone.setTransactionMode');
    expect(setMode?.group).toBe('1_transaction@1');
  });

  it('keeps the rare backup and restore actions off the inline row, paired in a context-menu group', () => {
    const sessionItems = itemContext.filter((m) => (m.when ?? '').includes('gemstoneSession'));

    const backup = sessionItems.find((m) => m.command === 'gemstone.fullLogicalBackup');
    const restore = sessionItems.find((m) => m.command === 'gemstone.fullLogicalRestore');

    expect(backup?.group).toBe('3_backup@1');
    expect(restore?.group).toBe('3_backup@2');
  });
});

describe('login row inline button order', () => {
  it('leads with Login and trails with the destructive Delete', () => {
    const order = inlineOrderFor('viewItem == gemstoneLogin');

    expect(order).toEqual(['gemstone.login', 'gemstone.editLogin', 'gemstone.deleteLogin']);
  });
});
