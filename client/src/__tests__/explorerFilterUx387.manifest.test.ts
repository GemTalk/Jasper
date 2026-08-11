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
  fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
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
