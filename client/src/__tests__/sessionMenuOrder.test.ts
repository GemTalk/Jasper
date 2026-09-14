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

function inlineOrderFor(viewItemClause: string): string[] {
  return itemContext
    .filter((m) => m.group?.startsWith('inline') && (m.when ?? '').includes(viewItemClause))
    .sort((a, b) => inlineRank(a.group!) - inlineRank(b.group!))
    .map((m) => m.command);
}

/**
 * Entries on a SESSION row, in any of its states.
 *
 * A session row's `contextValue` carries its auto-commit state (issue #254) —
 * `gemstoneSession`, `gemstoneSessionAutoCommitOn` or `gemstoneSessionAutoCommitFailed` —
 * so most entries match the family with `=~ /^gemstoneSession(...)?$/` and the three
 * auto-commit buttons each pin one exact value. A plain `includes('viewItem ==
 * gemstoneSession')` no longer distinguishes them: it is a prefix of the other two.
 */
function sessionRowEntries(): MenuItem[] {
  return itemContext.filter((m) =>
    /viewItem (=~ \/\^gemstoneSession|== gemstoneSession)/.test(m.when ?? ''),
  );
}

describe('session row inline button order', () => {
  it('leads with the most-used safe actions and trails with Logout, without the rare backup actions', () => {
    const order = sessionRowEntries()
      .filter((m) => m.group?.startsWith('inline'))
      .sort((a, b) => inlineRank(a.group!) - inlineRank(b.group!))
      .map((m) => m.command);

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
    // The three auto-commit entries share slot 4 and are mutually exclusive — each is gated
    // on one exact `contextValue`, so the row shows exactly one of them (see the test below).
    // They sit with Commit and Abort because they are the same subject: this session's
    // transaction.
    expect(order).toEqual([
      'gemstone.fileIn',
      'gemstone.sessionCommit',
      'gemstone.sessionAbort',
      'gemstone.autoCommit.turnOn',
      'gemstone.autoCommit.turnOff',
      'gemstone.autoCommit.recover',
      'gemstone.showSessionConfiguration',
      'gemstone.sessionLogout',
    ]);
  });

  // One button on the row, not three. A contributed entry's icon is fixed text in the
  // manifest, so showing the state at all takes one command per state — which is only
  // correct as long as their `when` clauses cannot both hold. Each pins one exact
  // `contextValue`, and `loginTreeProvider.sessionContextValue` answers exactly one.
  it('shows exactly one auto-commit button, whatever state the session is in', () => {
    const buttons = sessionRowEntries().filter(
      (m) => m.command.startsWith('gemstone.autoCommit.') && m.group?.startsWith('inline'),
    );

    expect(buttons.map((m) => m.when)).toEqual([
      'view == gemstoneLogins && viewItem == gemstoneSession',
      'view == gemstoneLogins && viewItem == gemstoneSessionAutoCommitOn',
      'view == gemstoneLogins && viewItem == gemstoneSessionAutoCommitFailed',
    ]);

    // Each needs its own icon, or the state it exists to show is invisible — and they must
    // differ, or the three commands buy nothing over one.
    const icons = buttons.map(
      (m) =>
        pkg.contributes.commands.find((c: { command: string }) => c.command === m.command)?.icon,
    );
    expect(icons).toEqual(['$(sync-ignored)', '$(sync)', '$(error)']);

    // The right-click entry is the state-independent way in and so matches the family — it
    // reads the state itself and does the right thing, including opening the recovery
    // choices rather than flipping when the last commit failed.
    const contextEntry = sessionRowEntries().find(
      (m) => m.command === 'gemstone.autoCommit.toggle',
    );
    expect(contextEntry?.when).toBe(
      'view == gemstoneLogins && viewItem =~ /^gemstoneSession(AutoCommitOn|AutoCommitFailed)?$/',
    );
  });

  it('keeps the rare backup and restore actions off the inline row, paired in a context-menu group', () => {
    const sessionItems = sessionRowEntries();

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
