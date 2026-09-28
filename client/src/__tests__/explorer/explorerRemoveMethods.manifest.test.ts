import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The Methods pane's two removals are separate commands, because VS Code hands both
 * gestures the selection: the inline 🗑 (`removeMethod`) acts on its own row, and
 * **Remove…** on the context menu (`removeMethods`) acts on the selection. Neither is
 * in the Command Palette, because both need a row to act on.
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
const REMOVE_ROW = 'gemstone.explorer.removeMethod';
const REMOVE_SELECTION = 'gemstone.explorer.removeMethods';
const METHODS = 'gemstoneExplorerMethods';

const admits = (when: string, view: string, viewItem: string): boolean => {
  if (!when.includes(`view == ${view}`)) return false;
  const exact = when.match(/viewItem == ([\w.]+)/);
  if (exact) return exact[1] === viewItem;
  const re = when.match(/viewItem =~ \/(.+?)\/(?: |$|&)/);
  if (!re) return false;
  return new RegExp(re[1]).test(viewItem);
};

const entriesOn = (command: string, viewItem: string) =>
  itemContext.filter((e) => e.command === command && admits(e.when ?? '', METHODS, viewItem));
const isInline = (e: MenuEntry) => (e.group ?? '').startsWith('inline');
const titleOf = (command: string) =>
  pkg.contributes.commands.find((c) => c.command === command)?.title;

describe('Removing methods from the Methods pane', () => {
  it('offers the trash button inline, and only inline', () => {
    const entries = entriesOn(REMOVE_ROW, 'explorerMethod');

    expect(entries.filter(isInline)).toHaveLength(1);
    expect(entries.filter((e) => !isInline(e))).toHaveLength(0);
  });

  it('offers Remove… on the right-click menu, and only there', () => {
    const entries = entriesOn(REMOVE_SELECTION, 'explorerMethod');

    expect(entries.filter((e) => !isInline(e))).toHaveLength(1);
    expect(entries.filter(isInline)).toHaveLength(0);
  });

  it('puts Remove… in a group of its own below File Out', () => {
    const menu = entriesOn(REMOVE_SELECTION, 'explorerMethod')[0];
    const fileOut = itemContext.find((e) => e.command === 'gemstone.explorer.fileOutMethods')!;

    expect(menu.group).toBeDefined();
    expect(menu.group!.split('@')[0]).not.toBe(fileOut.group!.split('@')[0]);
    expect(menu.group! > fileOut.group!).toBe(true);
  });

  it('titles the menu item "Remove…", since it asks before it removes', () => {
    expect(titleOf(REMOVE_SELECTION)).toMatch(/^Remove.*…$/);
  });

  it('keeps the trash button titled for the one method it removes', () => {
    expect(titleOf(REMOVE_ROW)).toBe('Remove Method');
  });

  it('keeps both out of the Command Palette', () => {
    expect(palette.find((e) => e.command === REMOVE_ROW)?.when).toBe('false');
    expect(palette.find((e) => e.command === REMOVE_SELECTION)?.when).toBe('false');
  });
});
