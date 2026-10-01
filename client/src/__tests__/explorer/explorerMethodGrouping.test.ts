import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({}));

import {
  commands,
  TreeItemCollapsibleState,
  __resetConfig,
  __setConfig,
} from '../../__mocks__/vscode';
import {
  ExplorerController,
  MethodCategoryItem,
  MethodItem,
  FilterChipItem,
} from '../../gemstoneExplorer';
import { ALL_METHODS_CATEGORY } from '../../systemBrowser';
import type { SessionManager, ActiveSession } from '../../sessionManager';
import type { EnvCategoryLine } from '../../browserQueries';

const GROUP_KEY = 'explorer.groupMethodsByCategory';

function makeController(): ExplorerController {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.className = 'Demo';
  ctl.state.dictIndex = 1;
  (ctl as unknown as { envLines: EnvCategoryLine[] }).envLines = [
    { isMeta: false, envId: 0, category: 'accessing', selectors: ['at:', 'size'] },
    { isMeta: false, envId: 0, category: 'printing', selectors: ['printString'] },
  ];
  return ctl;
}

const executeCommand = commands.executeCommand as ReturnType<typeof vi.fn>;

// The pane filter is private state; set it directly rather than driving the
// (async, input-box-backed) beginFilter flow.
function setMethodFilter(ctl: ExplorerController, pattern: string): void {
  (ctl as unknown as { filters: Map<string, string> }).filters.set(
    'gemstoneExplorerMethods',
    pattern,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetConfig();
});

describe('Methods pane category grouping', () => {
  it('groups methods under their categories by default', async () => {
    const ctl = makeController();

    const children = await ctl.methodProvider.getChildren();

    expect(children.every((c) => c instanceof MethodCategoryItem)).toBe(true);
    expect((children as MethodCategoryItem[]).map((c) => c.category)).toEqual(
      expect.arrayContaining(['accessing', 'printing']),
    );
  });

  it('leads with a REAL category — no ALL METHODS pseudo-category (#387 item 10)', async () => {
    const ctl = makeController();

    const categories = ((await ctl.methodProvider.getChildren()) as MethodCategoryItem[]).map(
      (c) => c.category,
    );

    // It used to come first and expanded, pushing the real categories below the fold.
    expect(categories).not.toContain(ALL_METHODS_CATEGORY);
    expect(categories[0]).toBe('accessing');
  });

  it('starts every category collapsed now that nothing forces itself open', async () => {
    const ctl = makeController();

    for (const c of (await ctl.methodProvider.getChildren()) as MethodCategoryItem[]) {
      expect(c.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
    }
  });

  it('lists methods flat, with no category rows, when grouping is off', async () => {
    __setConfig('gemstone', GROUP_KEY, false);
    const ctl = makeController();

    const children = await ctl.methodProvider.getChildren();

    expect(children.every((c) => c instanceof MethodItem)).toBe(true);
    expect((children as MethodItem[]).map((c) => c.info.selector)).toEqual(
      expect.arrayContaining(['at:', 'size', 'printString']),
    );
  });

  it('parents a grouped method row under its category so reveal can locate it', async () => {
    const ctl = makeController();
    const [accessing] = ((await ctl.methodProvider.getChildren()) as MethodCategoryItem[]).filter(
      (c) => c.category === 'accessing',
    );
    const [method] = (await ctl.methodProvider.getChildren(accessing)) as MethodItem[];

    const parent = ctl.methodProvider.getParent(method);

    expect(parent).toBeInstanceOf(MethodCategoryItem);
    expect((parent as MethodCategoryItem).category).toBe('accessing');
  });

  it('gives a flat method row no parent, so it hangs off the root', async () => {
    __setConfig('gemstone', GROUP_KEY, false);
    const ctl = makeController();

    const [flat] = (await ctl.methodProvider.getChildren()) as MethodItem[];

    expect(flat.displayCategory).toBeUndefined();
    expect(ctl.methodProvider.getParent(flat)).toBeUndefined();
  });

  it('reads the group-by-category setting, defaulting to on', () => {
    const ctl = makeController();

    expect(ctl.groupMethodsByCategory()).toBe(true);

    __setConfig('gemstone', GROUP_KEY, false);
    expect(ctl.groupMethodsByCategory()).toBe(false);
  });

  it('persists the choice by writing the setting when toggled', async () => {
    const ctl = makeController();

    await ctl.setGroupMethodsByCategory(false);

    expect(ctl.groupMethodsByCategory()).toBe(false);
  });

  it('keeps the category structure when filtering with categories visible', async () => {
    const ctl = makeController();
    setMethodFilter(ctl, 'at');

    // The filter chip leads the list; the rest are the pruned category rows.
    const [chip, ...rest] = await ctl.methodProvider.getChildren();

    expect(chip).toBeInstanceOf(FilterChipItem);
    expect(rest.every((c) => c instanceof MethodCategoryItem)).toBe(true);
    const cats = (rest as MethodCategoryItem[]).map((c) => c.category);
    expect(cats).toContain('accessing');
    expect(cats).not.toContain('printing');
  });

  it('shows only matching selectors under a filtered category', async () => {
    const ctl = makeController();
    setMethodFilter(ctl, 'at');

    const rows = (await ctl.methodProvider.getChildren(
      new MethodCategoryItem(false, 'accessing', false),
    )) as MethodItem[];

    expect(rows.map((r) => r.info.selector)).toEqual(['at:']);
  });

  it('expands matching categories while filtering so the matches show', async () => {
    const ctl = makeController();
    setMethodFilter(ctl, 'at');

    const accessing = ((await ctl.methodProvider.getChildren()) as MethodCategoryItem[]).find(
      (c) => c.category === 'accessing',
    );

    expect(accessing?.collapsibleState).toBe(TreeItemCollapsibleState.Expanded);
  });

  it('still flattens to matching methods when filtering with categories off', async () => {
    __setConfig('gemstone', GROUP_KEY, false);
    const ctl = makeController();
    setMethodFilter(ctl, 'at');

    // Chip leads; the rest are the flat matching method rows.
    const [chip, ...rest] = await ctl.methodProvider.getChildren();

    expect(chip).toBeInstanceOf(FilterChipItem);
    expect(rest.every((c) => c instanceof MethodItem)).toBe(true);
    expect((rest as MethodItem[]).map((c) => c.info.selector)).toEqual(['at:']);
  });

  it('keeps the title-toggle context key in step with the setting', () => {
    __setConfig('gemstone', GROUP_KEY, false);
    const ctl = makeController();

    ctl.syncMethodGrouping();

    expect(executeCommand).toHaveBeenCalledWith(
      'setContext',
      'gemstone.explorer.methodsGrouped',
      false,
    );
  });
});
