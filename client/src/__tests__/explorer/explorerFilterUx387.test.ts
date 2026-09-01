import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  canClassBeWritten: vi.fn(() => true),
  getClassEnvironments: vi.fn(() => []),
  // Needed by the ivar-token filter path: with no access rows, no method reads or
  // writes anything, so a reads:/writes:/accesses: filter must match nothing. That is
  // what makes the "an ivar filter cannot pull in a whole category" test meaningful
  // rather than vacuous.
  getMethodInstVarAccess: vi.fn(() => []),
}));

import * as vscode from 'vscode';
import { ExplorerController, FilterChipItem, MethodItem } from '../../gemstoneExplorer';
import { ALL_METHODS_CATEGORY } from '../../systemBrowser';
import type { SessionManager, ActiveSession } from '../../sessionManager';
import type { EnvCategoryLine } from '../../browserQueries';

/** The InputBox `beginFilter` just created — the accessor the vscode mock advertises. */
interface MockInputBox {
  prompt?: string;
  placeholder?: string;
  __type: (text: string) => void;
}
function lastInputBox(): MockInputBox {
  return vi.mocked(vscode.window.createInputBox).mock.results.at(-1)!.value;
}

// The Explorer filter's wording and behaviour, from #387. The icon and title choices live
// only in package.json and are asserted in explorerFilterUx387.manifest.test.ts; these cover
// the behaviour: the chip announces an active filter, the prompt tells the truth about live
// filtering, method CATEGORIES are filterable and not just selectors, and the ALL METHODS
// pseudo-category row is gone without any method becoming unreachable.

function makeViews() {
  const pane = () => ({
    description: '',
    reveal: vi.fn(() => Promise.resolve()),
    selection: [] as unknown[],
  });
  const method = pane();
  return { views: { dict: pane(), category: pane(), klass: pane(), hierarchy: pane(), method } };
}

function makeController(): ExplorerController {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.setViews(makeViews().views as unknown as Parameters<ExplorerController['setViews']>[0]);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.className = 'Ux387Demo';
  ctl.state.dictIndex = 3;
  return ctl;
}

function setEnvLines(ctl: ExplorerController, lines: EnvCategoryLine[]): void {
  (ctl as unknown as { envLines: EnvCategoryLine[] }).envLines = lines;
}

const envLine = (isMeta: boolean, category: string, selectors: string[]): EnvCategoryLine => ({
  isMeta,
  envId: 0,
  category,
  selectors,
});

// 'accessing' holds selectors that do NOT begin with "accessing", which is the whole
// point: filtering by category name cannot fall out of selector matching.
function seedTwoCategories(ctl: ExplorerController): void {
  setEnvLines(ctl, [
    envLine(false, 'accessing', ['name', 'name:', 'size']),
    envLine(false, 'printing', ['printOn:', 'printString']),
  ]);
}

// Look categories up by name, not position: SESSION METHODS can still lead the list on a
// class that has session methods, and pinning an index would couple these to that.
function categoryNamed(ctl: ExplorerController, filter: string, name: string) {
  const found = ctl.methodCategories(false, filter).find((c) => c.category === name);
  if (!found) throw new Error(`filter "${filter}" did not keep category "${name}"`);
  return found;
}

// The Methods pane's getChildren reads the live filter off the controller, so tests that
// exercise it must set the pane filter, not just pass one to methodCategories.
function applyMethodFilter(ctl: ExplorerController, pattern: string): void {
  (ctl as unknown as { filters: Map<string, string> }).filters.set(
    'gemstoneExplorerMethods',
    pattern,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('An active filter announces itself', () => {
  it('labels the chip "Filter:" so the row reads as a statement, not a button', () => {
    const chip = new FilterChipItem('gemstoneExplorerMethods', 'pr*');

    expect(chip.label).toBe('Filter:');
    expect(chip.description).toBe('pr*');
  });

  it('keeps the funnel icon, matching the funnel on the filter control', () => {
    const chip = new FilterChipItem('gemstoneExplorerClasses', 'Ar*');

    expect((chip.iconPath as { id: string }).id).toBe('filter-filled');
  });

  it('still routes a click back to its own pane’s filter command', () => {
    const chip = new FilterChipItem('gemstoneExplorerDicts', 'User*');

    expect(chip.command?.command).toBe('gemstoneExplorerDicts.filter');
    expect(chip.viewId).toBe('gemstoneExplorerDicts');
  });
});

// The pane here is Classes: the Methods pane's button opens VS Code's own find box now, which
// brings its own wording (explorerMethodsFindBox.test.ts). The box under test is the one the
// other three panes still open.
describe('The filter box does not claim Enter is required', () => {
  it('sets an explicit prompt describing live filtering, replacing VS Code’s Enter hint', async () => {
    const ctl = makeController();

    await ctl.beginFilter('gemstoneExplorerClasses');
    const box = lastInputBox();

    // Left unset, VS Code fills the prompt line with its own "press Enter to confirm"
    // hint. An explicit prompt is what displaces it, so its presence is the fix.
    expect(box.prompt).toBeDefined();
    expect(box.prompt).toMatch(/as you type/i);
    // The misleading half is what had to go: nothing may promise Enter confirms.
    expect(box.prompt).not.toMatch(/enter/i);
    // Escape genuinely does cancel (see explorerFilterCancel), so it stays advertised.
    expect(box.prompt).toMatch(/escape/i);
  });

  it('leaves the live-filtering behaviour the prompt now describes intact', async () => {
    const ctl = makeController();

    await ctl.beginFilter('gemstoneExplorerClasses');
    lastInputBox().__type('Ar');

    // Typing alone filtered the pane — no Enter needed, which is what the prompt claims.
    expect(ctl.getFilter('gemstoneExplorerClasses')).toBe('Ar');
  });
});

describe('Method categories are filterable', () => {
  it('keeps a category whose NAME matches, even when no selector inside it does', () => {
    const ctl = makeController();
    seedTwoCategories(ctl);

    const names = ctl.methodCategories(false, 'accessing').map((c) => c.category);

    expect(names).toContain('accessing');
    expect(names).not.toContain('printing');
  });

  it('matches category names on a prefix and honours the * wildcard', () => {
    const ctl = makeController();
    seedTwoCategories(ctl);

    expect(ctl.methodCategories(false, 'acc').map((c) => c.category)).toContain('accessing');
    expect(ctl.methodCategories(false, '*ing').map((c) => c.category)).toEqual(
      expect.arrayContaining(['accessing', 'printing']),
    );
  });

  it('shows ALL of a name-matched category’s methods, not an empty folder', () => {
    const ctl = makeController();
    seedTwoCategories(ctl);
    applyMethodFilter(ctl, 'accessing');
    const category = categoryNamed(ctl, 'accessing', 'accessing');

    const rows = ctl.methodProvider.getChildren(category) as MethodItem[];

    expect(rows.map((r) => r.info.selector).sort()).toEqual(['name', 'name:', 'size']);
  });

  it('still filters selectors inside a category matched only by its methods', () => {
    const ctl = makeController();
    seedTwoCategories(ctl);
    applyMethodFilter(ctl, 'printO');
    const category = categoryNamed(ctl, 'printO', 'printing');

    const rows = ctl.methodProvider.getChildren(category) as MethodItem[];
    expect(rows.map((r) => r.info.selector)).toEqual(['printOn:']);
  });

  it('keeps a category reachable by selector when the name does not match', () => {
    const ctl = makeController();
    seedTwoCategories(ctl);

    const names = ctl.methodCategories(false, 'size').map((c) => c.category);

    expect(names).toContain('accessing');
    expect(names).not.toContain('printing');
  });

  it('does NOT let an ivar-token filter match category names', () => {
    const ctl = makeController();
    seedTwoCategories(ctl);

    // 'reads:printing' asks a bytecode question about an instance variable named
    // "printing"; the category of the same name must not be dragged in by its label.
    expect(ctl.methodCategoryMatchesFilter('printing', 'reads:printing')).toBe(false);
    expect(ctl.methodCategoryMatchesFilter('printing', 'print')).toBe(true);
  });

  it('leaves the unfiltered category list alone', () => {
    const ctl = makeController();
    seedTwoCategories(ctl);

    const names = ctl.methodCategories(false).map((c) => c.category);

    expect(names).toContain('accessing');
    expect(names).toContain('printing');
  });
});

describe('The flat view honours the same filter', () => {
  it('keeps a category-name match when grouping is off, so toggling does not empty the pane', () => {
    const ctl = makeController();
    seedTwoCategories(ctl);

    const grouped = ctl.methodCategories(false, 'accessing').map((c) => c.category);
    const flat = ctl.flatMethods(false, 'accessing').map((m) => m.info.selector);

    expect(grouped).toContain('accessing');
    // Same filter, other view mode: the accessing methods must still be listed.
    expect(flat.sort()).toEqual(['name', 'name:', 'size']);
  });

  it('still narrows the flat list by selector', () => {
    const ctl = makeController();
    seedTwoCategories(ctl);

    expect(ctl.flatMethods(false, 'printO').map((m) => m.info.selector)).toEqual(['printOn:']);
  });

  it('does not let an ivar-token filter pull in a whole category in flat mode either', () => {
    const ctl = makeController();
    seedTwoCategories(ctl);

    // No ivar-access map is seeded, so nothing legitimately matches reads:printing.
    expect(ctl.flatMethods(false, 'reads:printing').map((m) => m.info.selector)).toEqual([]);
  });
});

describe('The ALL METHODS pseudo-category is gone', () => {
  it('does not render it, filtered or not', () => {
    const ctl = makeController();
    seedTwoCategories(ctl);

    expect(ctl.methodCategories(false).map((c) => c.category)).not.toContain(ALL_METHODS_CATEGORY);
    expect(ctl.methodCategories(false, 'name').map((c) => c.category)).not.toContain(
      ALL_METHODS_CATEGORY,
    );
  });

  it('leaves a real category first, so switching classes needs no scrolling', () => {
    const ctl = makeController();
    seedTwoCategories(ctl);

    expect(ctl.methodCategories(false)[0].category).toBe('accessing');
  });

  it('loses no methods — every selector is still reachable under its own category', () => {
    const ctl = makeController();
    seedTwoCategories(ctl);

    const reachable = ctl
      .methodCategories(false)
      .flatMap((c) =>
        (ctl.methodProvider.getChildren(c) as MethodItem[]).map((r) => r.info.selector),
      )
      .sort();

    // Exactly what the pseudo-category used to enumerate, written out rather than
    // read back from selectorsFor: comparing that call against itself would pass
    // just as happily if it answered nothing at all, and "no methods lost" is the
    // whole claim.
    expect(reachable).toEqual(['name', 'name:', 'printOn:', 'printString', 'size']);
  });

  it('keeps ALL_METHODS_CATEGORY working as the enumerate-everything lookup key', () => {
    const ctl = makeController();
    seedTwoCategories(ctl);

    // reveal() and the flat view depend on this; only the ROW was removed.
    expect(
      ctl
        .selectorsFor(false, ALL_METHODS_CATEGORY)
        .map((i) => i.selector)
        .sort(),
    ).toEqual(['name', 'name:', 'printOn:', 'printString', 'size']);
  });
});
