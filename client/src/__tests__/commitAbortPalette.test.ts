import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Commit and Abort are contributed twice: once for a session row in Logins &
// Sessions and the Databases panel (`gemstone.session*`), once for the GemStone
// Explorer's title bar, which acts on the selected session
// (`gemstone.explorer.*`). All four carry the same category and the same title,
// so a palette that offers both pairs offers two indistinguishable
// `GemStone: Commit` entries — and picking the wrong one used to fail outright.
// The session pair is the one the palette gets, because it resolves a session
// for itself; the Explorer pair is withheld.
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
  // own fallback would answer with an error toast — so don't offer them.
  it.each(['gemstone.sessionCommit', 'gemstone.sessionAbort'])(
    'shows %s only while a session is active',
    (command) => {
      expect(paletteWhen(command)).toBe('gemstone.hasActiveSession');
    },
  );

  it.each(['gemstone.explorer.commit', 'gemstone.explorer.abort'])(
    'keeps the Explorer title-bar %s out of the palette',
    (command) => {
      expect(paletteWhen(command)).toBe('false');
    },
  );
});
