import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Issue #387 items 1/2/3/8 are icon and wording choices that live only in
// package.json, so they are asserted against the manifest itself. The convention
// being pinned: funnel = filter, magnifier = find. Without a test these silently
// regress the next time a command block is copy-pasted from a neighbour.

interface Command {
  command: string;
  title: string;
  icon?: string;
}

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../../package.json'), 'utf8'),
) as { contributes: { commands: Command[] } };

const byId = new Map(manifest.contributes.commands.map((c) => [c.command, c]));
const command = (id: string): Command => {
  const found = byId.get(id);
  if (!found) throw new Error(`no such command contributed: ${id}`);
  return found;
};

const FILTER_COMMANDS = [
  'gemstoneExplorerDicts.filter',
  'gemstoneExplorerCategories.filter',
  'gemstoneExplorerClasses.filter',
  'gemstoneExplorerMethods.filter',
];

describe('#387 items 1 & 3 — funnel means filter', () => {
  it.each(FILTER_COMMANDS)('%s uses the funnel, not the magnifier', (id) => {
    expect(command(id).icon).toBe('$(filter)');
  });
});

describe('#387 item 2 — the magnifier is freed for find', () => {
  it('gives Explorer find a plain magnifier', () => {
    expect(command('gemstone.explorer.findClass').icon).toBe('$(search)');
  });

  it('drops the browser reference from the find tooltip', () => {
    const title = command('gemstone.explorer.findClass').title;
    expect(title).not.toMatch(/browser/i);
    expect(title).toMatch(/find class/i);
  });

  it('stays distinguishable from the global Find Class in the command palette', () => {
    // Both are palette-visible (neither is suppressed via menus.commandPalette), so
    // identical titles would give the user two indistinguishable entries that do
    // different things.
    const explorer = command('gemstone.explorer.findClass').title;
    const global = command('gemstone.findClass').title;
    expect(explorer).not.toBe(global);
    // ...and not merely differing by the ellipsis, which reads as the same command.
    expect(explorer.replace(/[.…]+$/, '')).not.toBe(global.replace(/[.…]+$/, ''));
  });

  it('leaves no Explorer filter control claiming to be a search', () => {
    for (const id of FILTER_COMMANDS) expect(command(id).icon).not.toBe('$(search)');
  });
});

// The class row's contextValue gained a `.commented` variant, so every OTHER class
// action had its `when` widened to accept both. Getting one wrong silently drops
// that action from the context menu, which no other test would notice — hence
// evaluating the clauses here against both contextValues.
interface MenuEntry {
  command: string;
  when?: string;
  group?: string;
}
const menus = (
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../package.json'), 'utf8')) as {
    contributes: { menus: Record<string, MenuEntry[]> };
  }
).contributes.menus;

const itemContext = menus['view/item/context'];
// Does a `when` clause admit this contextValue? Only the viewItem term varies here,
// so the rest of the clause is held constant and just the viewItem test evaluated.
const admits = (when: string, viewItem: string): boolean => {
  const exact = when.match(/viewItem == ([\w.]+)/);
  if (exact) return exact[1] === viewItem;
  const re = when.match(/viewItem =~ \/(.+?)\/(?: |$|&)/);
  if (!re) throw new Error(`no viewItem test in: ${when}`);
  return new RegExp(re[1]).test(viewItem);
};
const classRowCommands = (viewItem: string): string[] =>
  itemContext
    .filter((e) => (e.when ?? '').includes('gemstoneExplorerClasses'))
    .filter((e) => /viewItem (==|=~)/.test(e.when ?? ''))
    .filter((e) => admits(e.when ?? '', viewItem))
    .map((e) => e.command);
// Same question of the Class Hierarchy pane, so the two panes' answers can be
// compared rather than asserted separately and allowed to drift.
const hierRowCommands = (viewItem: string): string[] =>
  itemContext
    .filter((e) => (e.when ?? '').includes('gemstoneExplorerClassHierarchy'))
    .filter((e) => /viewItem (==|=~)/.test(e.when ?? ''))
    .filter((e) => admits(e.when ?? '', viewItem))
    .map((e) => e.command);

// The Classes pane used to show the comment button only on a class that already had
// one, so writing a first comment had no way in from the row — while the Hierarchy
// pane offered it on every row. Removing that gate accepts GemStone's synthesised
// "No class-specific documentation for …" placeholder as the document you type a
// first comment into, which is where you would type one anyway.
describe('the comment button is offered on every class row', () => {
  it.each([
    'explorerClass',
    'explorerClass.novars',
    'explorerClass.test',
    'explorerClass.novars.test',
    'explorerClass.test.running',
    'explorerClass.test.debugging',
  ])('%s offers it', (viewItem) => {
    expect(classRowCommands(viewItem)).toContain('gemstone.explorer.openComment');
  });

  it('matches the Hierarchy pane, which never gated it', () => {
    expect(classRowCommands('explorerClass')).toContain('gemstone.explorer.openComment');
    expect(hierRowCommands('explorerHierClass')).toContain(
      'gemstone.explorer.openHierarchyComment',
    );
  });

  it('leaves every class row carrying the same set of actions bar the "+"', () => {
    // Comment state no longer distinguishes two rows at all, so the only thing that
    // may differ between a class with variables and one without is the "+".
    const plain = classRowCommands('explorerClass');
    const novars = classRowCommands('explorerClass.novars');
    expect(plain.length).toBeGreaterThan(5); // the class row is not stripped bare
    const ADD_VARIABLE = 'gemstone.explorer.addVariable';
    expect(novars.filter((c) => c !== ADD_VARIABLE).sort()).toEqual(
      plain.filter((c) => c !== ADD_VARIABLE).sort(),
    );
  });

  it('does not let the widened clauses swallow a class VARIABLE row', () => {
    // `explorerClassVar` shares the `explorerClass` prefix, so an unanchored
    // /^explorerClass/ would put class actions on class-variable rows.
    const onClassVar = classRowCommands('explorerClassVar');
    expect(onClassVar).not.toContain('gemstone.explorer.removeClass');
    expect(onClassVar).not.toContain('gemstone.explorer.openComment');
  });
});

describe('#387 item 11 — opening a comment is not pinning it', () => {
  it.each(['gemstone.explorer.openComment', 'gemstone.explorer.openHierarchyComment'])(
    '%s no longer promises a pin',
    (id) => {
      // The command opens a preview tab now, so a title of "Pin Comment" would
      // describe behaviour the command deliberately no longer has.
      expect(command(id).title).not.toMatch(/pin/i);
      expect(command(id).title).toMatch(/comment/i);
    },
  );
});

describe('#387 item 8 — the flat view is about grouping, not uncategorized methods', () => {
  it('no longer reads as "the methods that have no category"', () => {
    const title = command('gemstone.explorer.showMethodsFlat').title;
    expect(title).not.toMatch(/without categories/i);
    expect(title).toMatch(/group/i);
  });

  it('leaves the already-clear inverse label alone', () => {
    expect(command('gemstone.explorer.groupMethodsByCategory').title).toBe(
      'Group Methods by Category',
    );
  });
});
