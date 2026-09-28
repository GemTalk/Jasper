import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The Methods pane offers Remove… on its context menu, where a multi-row selection
 * can reach it. The inline 🗑 stays; the palette entry stays hidden, because the
 * command needs a row to act on.
 */

interface Command {
  command: string;
  title?: string;
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
const REMOVE = 'gemstone.explorer.removeMethod';
const METHODS = 'gemstoneExplorerMethods';

const admits = (when: string, view: string, viewItem: string): boolean => {
  if (!when.includes(`view == ${view}`)) return false;
  const exact = when.match(/viewItem == ([\w.]+)/);
  if (exact) return exact[1] === viewItem;
  const re = when.match(/viewItem =~ \/(.+?)\/(?: |$|&)/);
  if (!re) return false;
  return new RegExp(re[1]).test(viewItem);
};

const entriesOn = (viewItem: string) =>
  itemContext.filter((e) => e.command === REMOVE && admits(e.when ?? '', METHODS, viewItem));

describe('Remove on the Methods pane', () => {
  it('is on the right-click menu of a method row, not only inline', () => {
    const menu = entriesOn('explorerMethod').filter((e) => !(e.group ?? '').startsWith('inline'));

    expect(menu).toHaveLength(1);
  });

  it('keeps the inline trash button', () => {
    const inline = entriesOn('explorerMethod').filter((e) => (e.group ?? '').startsWith('inline'));

    expect(inline).toHaveLength(1);
  });

  it('sits in a group of its own at the bottom of the menu, apart from File Out', () => {
    const menu = entriesOn('explorerMethod').find((e) => !(e.group ?? '').startsWith('inline'))!;
    const fileOut = itemContext.find((e) => e.command === 'gemstone.explorer.fileOutMethods')!;

    expect(menu.group).toBeDefined();
    expect(menu.group!.split('@')[0]).not.toBe(fileOut.group!.split('@')[0]);
    expect(menu.group! > fileOut.group!).toBe(true);
  });

  it('is titled "Remove…", since it asks before it removes', () => {
    const title = pkg.contributes.commands.find((c) => c.command === REMOVE)!.title;

    expect(title).toMatch(/^Remove.*…$/);
  });

  it('stays out of the Command Palette', () => {
    expect(palette.find((e) => e.command === REMOVE)?.when).toBe('false');
  });
});
