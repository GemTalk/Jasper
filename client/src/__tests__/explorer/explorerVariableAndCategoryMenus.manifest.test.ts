import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Where the Explorer's two new row buttons appear, and on which rows.
 *
 * Both are manifest-only choices — an icon string and a `when` clause — so no other
 * test sees them. The class row's "+" in particular is gated on a contextValue token
 * (`.novars`) that nothing else reads: get the clause wrong and the button quietly
 * shows up on every class in the pane, three "+" deep on one that already has both
 * variable sides, which is exactly what unit tests on the tree items cannot notice.
 */

interface Command {
  command: string;
  title?: string;
  icon?: string;
}
interface MenuEntry {
  command: string;
  when?: string;
  group?: string;
}

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', '..', '..', '..', 'package.json'), 'utf-8'),
) as { contributes: { commands: Command[]; menus: Record<string, MenuEntry[]> } };

const command = (id: string): Command => {
  const found = pkg.contributes.commands.find((c) => c.command === id);
  if (!found) throw new Error(`no such command contributed: ${id}`);
  return found;
};

const itemContext = pkg.contributes.menus['view/item/context'];

// Does a `when` clause admit this contextValue in this view? Only the viewItem and
// view terms are evaluated; the rest of the clause is held constant.
const admits = (when: string, view: string, viewItem: string): boolean => {
  if (!when.includes(`view == ${view}`)) return false;
  const exact = when.match(/viewItem == ([\w.]+)/);
  if (exact) return exact[1] === viewItem;
  const re = when.match(/viewItem =~ \/(.+?)\/(?: |$|&)/);
  if (!re) return false;
  return new RegExp(re[1]).test(viewItem);
};

const entriesFor = (view: string, viewItem: string): MenuEntry[] =>
  itemContext.filter((e) => admits(e.when ?? '', view, viewItem));
const commandsOn = (view: string, viewItem: string): string[] =>
  entriesFor(view, viewItem).map((e) => e.command);

const CLASSES = 'gemstoneExplorerClasses';
const METHODS = 'gemstoneExplorerMethods';
const ADD_VARIABLE = 'gemstone.explorer.addVariable';
const REMOVE_CATEGORY = 'gemstone.explorer.removeMethodCategory';

// Every shape a class row's contextValue can take, and whether it is a class with no
// locally-defined variables of either kind.
const CLASS_ROWS: [contextValue: string, variableLess: boolean][] = [
  ['explorerClass', false],
  ['explorerClass.commented', false],
  ['explorerClass.test', false],
  ['explorerClass.test.running', false],
  ['explorerClass.commented.test.debugging', false],
  ['explorerClass.novars', true],
  ['explorerClass.novars.commented', true],
  ['explorerClass.novars.test', true],
  ['explorerClass.novars.commented.test.running', true],
];

describe('the class row "+" lands only on a class with no variables', () => {
  it.each(CLASS_ROWS)('%s → offered: %s', (viewItem, variableLess) => {
    expect(commandsOn(CLASSES, viewItem).includes(ADD_VARIABLE)).toBe(variableLess);
  });

  it('is an inline button, not just a context-menu entry', () => {
    const inline = entriesFor(CLASSES, 'explorerClass.novars').find(
      (e) => e.command === ADD_VARIABLE && (e.group ?? '').startsWith('inline'),
    );

    expect(inline).toBeDefined();
  });

  it('shows as a plus sign', () => {
    expect(command(ADD_VARIABLE).icon).toBe('$(add)');
  });

  it('is kept out of the command palette, which has no row to act on', () => {
    const palette = pkg.contributes.menus.commandPalette.find((e) => e.command === ADD_VARIABLE);

    expect(palette?.when).toBe('false');
  });

  it('leaves every other class action reachable on both kinds of row', () => {
    // `.novars` may only ever ADD a button. Any action that stopped matching would
    // silently vanish from the context menu of every variable-less class.
    const withVars = commandsOn(CLASSES, 'explorerClass');
    const without = commandsOn(CLASSES, 'explorerClass.novars');

    expect(withVars.length).toBeGreaterThan(5); // the row is not stripped bare
    expect(without.filter((c) => c !== ADD_VARIABLE).sort()).toEqual(withVars.sort());
  });

  it('does not let the widened clauses swallow a class VARIABLE row', () => {
    // `explorerClassVar` shares the `explorerClass` prefix, so an unanchored
    // /^explorerClass/ would put class actions on class-variable rows.
    expect(commandsOn(CLASSES, 'explorerClassVar')).not.toContain(ADD_VARIABLE);
  });
});

describe('adding an instance variable is offered wherever it can be asked for', () => {
  // The engine check moved into the command (ensureRbSupport), so the menus must not
  // gate it: gating them made the empty "instance variables" row — a row whose only
  // reason to exist is hosting this "+" — a dead end on a stone without the engine,
  // one line under a class-row "+" that offered the very same add.
  const ADD_INST_VAR = 'gemstone.explorer.addInstVar';

  it.each([
    ['explorerVarSide.instance', 'the instance variable-side row'],
    ['explorerClass.novars', 'a variable-less class row'],
    ['explorerClass', 'a class row that has variables'],
  ])('%s (%s)', (viewItem) => {
    expect(commandsOn(CLASSES, viewItem)).toContain(ADD_INST_VAR);
  });

  it('is not gated on the refactoring engine by the manifest any more', () => {
    const gated = itemContext.filter(
      (e) => e.command === ADD_INST_VAR && (e.when ?? '').includes('rbSupportAvailable'),
    );

    expect(gated).toEqual([]);
  });

  it('stays off the class-variable side row, which has its own add', () => {
    expect(commandsOn(CLASSES, 'explorerVarSide.class')).not.toContain(ADD_INST_VAR);
    expect(commandsOn(CLASSES, 'explorerVarSide.class')).toContain('gemstone.explorer.addClassVar');
  });
});

describe('removing a method category', () => {
  it('shows as the trash can, like every other Explorer removal', () => {
    expect(command(REMOVE_CATEGORY).icon).toBe('$(trash)');
  });

  it('is offered on a real category row, inline and in its context menu', () => {
    const groups = entriesFor(METHODS, 'explorerProtocol')
      .filter((e) => e.command === REMOVE_CATEGORY)
      .map((e) => e.group ?? '');

    expect(groups.some((g) => g.startsWith('inline'))).toBe(true);
    expect(groups.some((g) => !g.startsWith('inline'))).toBe(true);
  });

  it('sits after the rename pencil, not before it', () => {
    // The two share the row; ordering them the other way puts a destructive action
    // where the eye lands first.
    const inlineOrder = (id: string): string =>
      entriesFor(METHODS, 'explorerProtocol').find(
        (e) => e.command === id && (e.group ?? '').startsWith('inline'),
      )?.group ?? '';

    expect(
      inlineOrder(REMOVE_CATEGORY) > inlineOrder('gemstone.explorer.renameMethodCategory'),
    ).toBe(true);
  });

  it('is withheld from the computed ALL METHODS / SESSION rows, which are not categories', () => {
    // Those rows carry no contextValue at all, so nothing can match them.
    expect(commandsOn(METHODS, '')).not.toContain(REMOVE_CATEGORY);
    expect(commandsOn(METHODS, 'explorerMethod')).not.toContain(REMOVE_CATEGORY);
  });

  it('is kept out of the command palette, which has no row to act on', () => {
    const palette = pkg.contributes.menus.commandPalette.find((e) => e.command === REMOVE_CATEGORY);

    expect(palette?.when).toBe('false');
  });
});
