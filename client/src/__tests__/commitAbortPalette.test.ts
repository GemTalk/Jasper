import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Commit and Abort are contributed twice: once for a session row in Logins &
// Sessions and the Databases panel (`gemstone.session*`), once for the GemStone
// Explorer's Actions & Navigation toolbar, which acts on the selected session
// (`gemstone.explorer.*`). All four carry the same category and the same title,
// so a palette that offers both pairs offers two indistinguishable
// `GemStone: Commit` entries — and picking the wrong one used to fail outright.
// The session pair is the one the palette gets, because it resolves a session
// for itself; the Explorer pair is withheld. Withholding costs that toolbar
// nothing: its buttons are a webview row that calls `executeCommand` directly
// (`explorerNavigationView.ts`), which a `commandPalette` `when` clause does not
// govern.
// See https://github.com/GemTalk/Jasper/issues/455.

interface Command {
  command: string;
  title: string;
  category?: string;
}

interface MenuItem {
  command: string;
  when?: string;
}

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf-8'),
);
const commands: Command[] = pkg.contributes.commands;
const commandPalette: MenuItem[] = pkg.contributes.menus.commandPalette;

function paletteWhen(command: string): string | undefined {
  return commandPalette.find((m) => m.command === command)?.when;
}

function paletteEntriesTitled(title: string): string[] {
  return commands
    .filter((c) => c.title === title && c.category === 'GemStone')
    .map((c) => c.command)
    .filter((command) => paletteWhen(command) !== 'false');
}

describe('Commit and Abort in the Command Palette', () => {
  it.each(['Commit', 'Abort'])('offers exactly one GemStone: %s', (title) => {
    expect(paletteEntriesTitled(title)).toEqual([
      title === 'Commit' ? 'gemstone.sessionCommit' : 'gemstone.sessionAbort',
    ]);
  });

  // Without a session there is nothing to commit or abort, and the handler's
  // own fallback would answer with an error toast — so don't offer them. Commit
  // is held to more than that: the palette acts in the current session, and a
  // session outside a transaction cannot commit at all, so the entry is gated on
  // the same `gemstone.canCommit` the session row uses — driven off the selected
  // session, which is the one the palette would act in.
  it('shows gemstone.sessionCommit only while the current session can commit', () => {
    expect(paletteWhen('gemstone.sessionCommit')).toBe(
      'gemstone.hasActiveSession && gemstone.canCommit',
    );
  });

  // Abort is the one transaction command that is never withheld by mode: it is
  // the way out of a stale view whatever the session is in.
  it('shows gemstone.sessionAbort for any active session', () => {
    expect(paletteWhen('gemstone.sessionAbort')).toBe('gemstone.hasActiveSession');
  });

  // Begin only means anything in manualBegin, between transactions; Set
  // Transaction Mode applies in all three, so it needs only a session.
  it('shows gemstone.sessionBegin only while the current session can begin', () => {
    expect(paletteWhen('gemstone.sessionBegin')).toBe(
      'gemstone.hasActiveSession && gemstone.canBegin',
    );
  });

  it('shows gemstone.setTransactionMode for any active session', () => {
    expect(paletteWhen('gemstone.setTransactionMode')).toBe('gemstone.hasActiveSession');
  });

  it.each(['gemstone.explorer.commit', 'gemstone.explorer.abort'])(
    'keeps the Explorer title-bar %s out of the palette',
    (command) => {
      expect(paletteWhen(command)).toBe('false');
    },
  );
});
