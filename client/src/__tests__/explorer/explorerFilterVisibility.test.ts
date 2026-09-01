import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// The per-pane Filter (and Clear Filter) buttons must be visible whenever the pane
// is shown — like Find Class / New Class — not only when the pane happens to have
// keyboard focus. An earlier `focusedView == <view>` gate hid the magnifying glass
// until you first clicked into the pane, so you couldn't filter a pane you'd just
// navigated to from another one. Pin the when-clauses so the focus gate can't creep
// back in.

interface MenuItem {
  command?: string;
  when?: string;
}

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', '..', '..', '..', 'package.json'), 'utf-8'),
);
const viewTitle: MenuItem[] = pkg.contributes.menus['view/title'];

const filterEntries = viewTitle.filter(
  (m) => m.command?.endsWith('.filter') || m.command?.endsWith('.clearFilter'),
);

describe('Explorer per-pane filter buttons', () => {
  it('contributes a filter and clear-filter button for all four panes', () => {
    expect(filterEntries.map((m) => m.command).sort()).toEqual(
      [
        'gemstoneExplorerCategories.clearFilter',
        'gemstoneExplorerCategories.filter',
        'gemstoneExplorerClasses.clearFilter',
        'gemstoneExplorerClasses.filter',
        'gemstoneExplorerDicts.clearFilter',
        'gemstoneExplorerDicts.filter',
        'gemstoneExplorerMethods.clearFilter',
        'gemstoneExplorerMethods.filter',
      ].sort(),
    );
  });

  for (const entry of filterEntries) {
    it(`shows ${entry.command} regardless of which pane has focus`, () => {
      expect(entry.when ?? '').not.toContain('focusedView');
    });
  }

  it('still gates each Clear Filter on that pane actually having an active filter', () => {
    for (const entry of filterEntries.filter((m) => m.command?.endsWith('.clearFilter'))) {
      expect(entry.when ?? '').toContain('gemstone.explorerFiltered.');
    }
  });
});
