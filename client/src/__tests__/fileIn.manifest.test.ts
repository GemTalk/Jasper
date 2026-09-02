import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Where File In is reachable from (issue #539).
 *
 * All manifest-only choices — a `when` clause and a menu group — so nothing else sees
 * them. The one that goes wrong silently is the resource command: it needs a file to
 * act on, so leaving it in the Command Palette offers the user a command that can only
 * fail, and gating it on the wrong language id takes it off `.gs` files entirely.
 */

interface Command {
  command: string;
  title?: string;
  category?: string;
  icon?: string;
}
interface MenuEntry {
  command: string;
  when?: string;
  group?: string;
}

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf-8'),
) as {
  contributes: {
    commands: Command[];
    menus: Record<string, MenuEntry[]>;
    languages: Array<{ id: string; extensions?: string[] }>;
  };
};

const command = (id: string): Command | undefined =>
  pkg.contributes.commands.find((c) => c.command === id);
const entriesIn = (menu: string, id: string): MenuEntry[] =>
  (pkg.contributes.menus[menu] ?? []).filter((e) => e.command === id);

const PICK = 'gemstone.fileIn';
const RESOURCE = 'gemstone.fileInFile';

describe('File In command declarations', () => {
  it('declares both, under the GemStone category', () => {
    for (const id of [PICK, RESOURCE]) {
      expect(command(id), `no such command contributed: ${id}`).toBeDefined();
      expect(command(id)?.category).toBe('GemStone');
    }
  });

  it('marks only the picker with an ellipsis — the resource one asks nothing', () => {
    expect(command(PICK)?.title).toBe('File In...');
    expect(command(RESOURCE)?.title).toBe('File In to GemStone');
  });

  it('registers a handler for each', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'extension.ts'), 'utf-8');

    const unregistered = [PICK, RESOURCE].filter(
      (id) => !new RegExp(String.raw`registerCommand\(\s*'${id}'`).test(src),
    );

    expect(unregistered).toEqual([]);
  });
});

describe('where File In is offered', () => {
  it('leaves the picker in the Command Palette, since it prompts for the file', () => {
    const hidden = (pkg.contributes.menus['commandPalette'] ?? []).find(
      (e) => e.command === PICK && e.when === 'false',
    );

    expect(hidden).toBeUndefined();
  });

  it('keeps the resource command OUT of the palette — it has no file to act on there', () => {
    const entry = (pkg.contributes.menus['commandPalette'] ?? []).find(
      (e) => e.command === RESOURCE,
    );

    expect(entry?.when).toBe('false');
  });

  it('puts it on a connected session row, where it is easiest to find', () => {
    const onSession = entriesIn('view/item/context', PICK).filter((e) =>
      (e.when ?? '').includes('viewItem == gemstoneSession'),
    );

    // One inline (the row button) and one in the row's right-click menu.
    expect(onSession.map((e) => e.group).sort()).toEqual(['2_transfer@0', 'inline@1']);
    for (const e of onSession) expect(e.when).toContain('view == gemstoneLogins');
  });

  it('gives the row button an icon, or it renders as nothing at all', () => {
    expect(command(PICK)?.icon).toBeDefined();
  });

  it("offers it on a .gs or .tpz file in VS Code's own Explorer", () => {
    const when = entriesIn('explorer/context', RESOURCE)[0]?.when ?? '';

    expect(when).toContain('resourceExtname == .gs');
    // A hand-written topaz script is filed in the same way a file-out is.
    expect(when).toContain('resourceExtname == .tpz');
  });

  it('offers it on an open Topaz file, in the title bar and the editor menu', () => {
    const clauses = ['editor/title', 'editor/context'].map(
      (menu) => `${menu}: ${entriesIn(menu, RESOURCE)[0]?.when ?? ''}`,
    );

    // A `gemstone://` method editor is not a file that can be filed in, hence the
    // scheme term alongside the language one.
    expect(clauses).toEqual([
      'editor/title: resourceLangId == gemstone-topaz && resourceScheme == file',
      'editor/context: resourceLangId == gemstone-topaz && resourceScheme == file',
    ]);
  });

  it('gates on the language id that .gs and .tpz actually map to', () => {
    const topaz = pkg.contributes.languages.find((l) => l.id === 'gemstone-topaz');

    // The editor clauses name gemstone-topaz; if either extension ever moved to
    // another language the command would vanish from the very files it exists for.
    expect(topaz?.extensions).toEqual(expect.arrayContaining(['.gs', '.tpz']));
  });
});
