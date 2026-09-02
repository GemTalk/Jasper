import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Which Explorer rows offer "File Out ..." (issue #539).
 *
 * Where a command appears is a manifest-only choice — a `when` clause and a menu
 * group — so no other test sees it. Two things go wrong silently here: a `when`
 * clause that admits rows the command cannot act on (the computed ALL METHODS row
 * is not a real method category, and `fileOutCategory:` has nothing to look up for
 * it), and a class-row clause written as a bare prefix, which would also swallow
 * `explorerClassVar`.
 */

interface Command {
  command: string;
  title?: string;
  icon?: string;
  category?: string;
}
interface MenuEntry {
  command: string;
  when?: string;
  group?: string;
}

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', '..', '..', '..', 'package.json'), 'utf-8'),
) as { contributes: { commands: Command[]; menus: Record<string, MenuEntry[]> } };

const itemContext = pkg.contributes.menus['view/item/context'];
const palette = pkg.contributes.menus['commandPalette'];

const admits = (when: string, view: string, viewItem: string): boolean => {
  if (!when.includes(`view == ${view}`)) return false;
  const exact = when.match(/viewItem == ([\w.]+)/);
  if (exact) return exact[1] === viewItem;
  const re = when.match(/viewItem =~ \/(.+?)\/(?: |$|&)/);
  if (!re) return false;
  return new RegExp(re[1]).test(viewItem);
};

const commandsOn = (view: string, viewItem: string): string[] =>
  itemContext.filter((e) => admits(e.when ?? '', view, viewItem)).map((e) => e.command);

const DICTS = 'gemstoneExplorerDicts';
const CATEGORIES = 'gemstoneExplorerCategories';
const CLASSES = 'gemstoneExplorerClasses';
const HIERARCHY = 'gemstoneExplorerClassHierarchy';
const METHODS = 'gemstoneExplorerMethods';

const FILE_OUT_COMMANDS = [
  'gemstone.explorer.fileOutDictionary',
  'gemstone.explorer.fileOutClassCategory',
  'gemstone.explorer.fileOutClass',
  'gemstone.explorer.fileOutProtocol',
  'gemstone.explorer.fileOutMethods',
];

// Every shape a Classes-pane class row's contextValue can take.
const CLASS_ROWS = [
  'explorerClass',
  'explorerClass.novars',
  'explorerClass.commented',
  'explorerClass.novars.commented',
  'explorerClass.test',
  'explorerClass.novars.commented.test',
  'explorerClass.test.running',
];

describe('File Out command declarations', () => {
  it('declares all five, under the GemStone category', () => {
    for (const id of FILE_OUT_COMMANDS) {
      const cmd = pkg.contributes.commands.find((c) => c.command === id);
      expect(cmd, `no such command contributed: ${id}`).toBeDefined();
      expect(cmd?.category).toBe('GemStone');
      expect(cmd?.title).toMatch(/^File Out /);
    }
  });

  it('registers a handler for each — a declared command with none is a runtime-only failure', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'gemstoneExplorer.ts'),
      'utf-8',
    );

    const unregistered = FILE_OUT_COMMANDS.filter(
      (id) => !new RegExp(String.raw`registerCommand\(\s*'${id}'`).test(src),
    );

    expect(unregistered).toEqual([]);
  });

  it('hides them from the palette — each one acts on the row it was invoked on', () => {
    for (const id of FILE_OUT_COMMANDS) {
      const entry = palette.find((e) => e.command === id);
      expect(entry?.when, `${id} is reachable from the palette with no row`).toBe('false');
    }
  });
});

describe('which rows offer File Out', () => {
  it('offers the dictionary file-out on a dictionary row', () => {
    expect(commandsOn(DICTS, 'explorerDict')).toContain('gemstone.explorer.fileOutDictionary');
  });

  it('offers the class-category file-out on a class-category row', () => {
    expect(commandsOn(CATEGORIES, 'explorerCategory')).toContain(
      'gemstone.explorer.fileOutClassCategory',
    );
  });

  it('offers the class file-out on every shape of class row, in both class panes', () => {
    for (const row of CLASS_ROWS) {
      expect(commandsOn(CLASSES, row), `class row ${row}`).toContain(
        'gemstone.explorer.fileOutClass',
      );
    }
    expect(commandsOn(HIERARCHY, 'explorerHierClass')).toContain('gemstone.explorer.fileOutClass');
    expect(commandsOn(HIERARCHY, 'explorerHierClass.test')).toContain(
      'gemstone.explorer.fileOutClass',
    );
  });

  it('keeps the class file-out off the variable rows that sit under a class', () => {
    for (const row of ['explorerClassVar', 'explorerIvar', 'explorerVarSide.instance']) {
      expect(commandsOn(CLASSES, row), `variable row ${row}`).not.toContain(
        'gemstone.explorer.fileOutClass',
      );
    }
  });

  it('offers the protocol file-out on a real method category only', () => {
    expect(commandsOn(METHODS, 'explorerProtocol')).toContain('gemstone.explorer.fileOutProtocol');
    // The computed ALL METHODS / SESSION METHODS rows carry no contextValue at all,
    // so nothing should match them.
    expect(commandsOn(METHODS, '')).not.toContain('gemstone.explorer.fileOutProtocol');
  });

  it('offers the method file-out on method rows, not on the category rows above them', () => {
    expect(commandsOn(METHODS, 'explorerMethod')).toContain('gemstone.explorer.fileOutMethods');
    expect(commandsOn(METHODS, 'explorerMethod.test')).toContain(
      'gemstone.explorer.fileOutMethods',
    );
    expect(commandsOn(METHODS, 'explorerProtocol')).not.toContain(
      'gemstone.explorer.fileOutMethods',
    );
  });

  it('groups them together, after the browse/modify/refactor groups', () => {
    const groups = itemContext
      .filter((e) => FILE_OUT_COMMANDS.includes(e.command))
      .map((e) => e.group ?? '');
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) expect(g).toMatch(/^4_fileout@/);
  });

  it('adds no inline row buttons — file out lives in the context menu', () => {
    const inline = itemContext.filter(
      (e) => FILE_OUT_COMMANDS.includes(e.command) && (e.group ?? '').startsWith('inline'),
    );
    expect(inline).toEqual([]);
  });
});
