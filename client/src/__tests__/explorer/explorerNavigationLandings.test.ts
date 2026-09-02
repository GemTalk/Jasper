/**
 * Where the Explorer records a landing, and what Go Back does with one.
 *
 * The chain's own rules are unit-tested against hand-built landings in
 * explorerNavigationHistory.test.ts. What is asserted here is the half that file
 * cannot reach: that the *real* pane cascade produces the landings those rules
 * expect, and that walking back re-resolves a landing against the stone.
 *
 * The distinction matters because the folding rules are written in terms of pairs
 * a cascade is assumed to emit. If the Explorer emitted a different pair —
 * recording the class before the dictionary, say, or a method without its class —
 * every unit test would still pass while Back took two presses per step, which is
 * the bug the folding exists to prevent.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  getClassesWithCategory: vi.fn(() => []),
  getClassEnvironments: vi.fn(() => []),
  getDictionaryNames: vi.fn(() => ['UserGlobals']),
  getDefinedInstVarCounts: vi.fn(() => new Map()),
  getDefinedClassVarCounts: vi.fn(() => new Map()),
  getClassHierarchy: vi.fn(() => []),
  getClassDescendantNames: vi.fn(() => []),
  getMethodInstVarAccess: vi.fn(() => []),
  isKernelClass: vi.fn(() => false),
}));
vi.mock('../../gciLog', () => ({
  logInfo: vi.fn(),
  logWarning: vi.fn(),
  logError: vi.fn(),
  getGciLog: vi.fn(() => ({ show: vi.fn(), appendLine: vi.fn() })),
  _resetGciLogForTests: vi.fn(),
}));

import * as vscode from 'vscode';
import { __resetConfig } from '../../__mocks__/vscode';
import { ExplorerController, MethodItem, registerGemStoneExplorer } from '../../gemstoneExplorer';
import {
  getClassesWithCategory,
  getClassEnvironments,
  getDictionaryNames,
} from '../../browserQueries';
import type { NavigationViewState } from '../../explorerNavigationView';
import type { SessionManager, ActiveSession } from '../../sessionManager';

const classesInDict = getClassesWithCategory as ReturnType<typeof vi.fn>;
const classEnvs = getClassEnvironments as ReturnType<typeof vi.fn>;
const dictNames = getDictionaryNames as ReturnType<typeof vi.fn>;

const DICT = 'UserGlobals';
const CLASS = 'Account';

/** One instance-side category line holding `selectors`. */
function envLine(selectors: string[]) {
  return [{ isMeta: false, envId: 0, category: 'accessing', selectors }];
}

function info(selector: string) {
  return { selector, category: 'accessing', overrideBits: 0, sessionBit: 0 };
}

/**
 * A controller wired to one session, with tree views that accept every reveal.
 * `session` is read through a mutable holder so a test can log the session out
 * (or switch to another) between recording a landing and walking back to it.
 */
function makeController() {
  const holder: { session: ActiveSession | undefined } = { session: { id: 1 } as ActiveSession };
  const sessionManager = {
    getSelectedSession: () => holder.session,
    resolveSession: () => Promise.resolve(holder.session),
  } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  const view = () => ({
    reveal: vi.fn(async () => {}),
    selection: [],
    description: '',
    visible: true,
  });
  ctl.setViews({
    dict: view(),
    category: view(),
    klass: view(),
    hierarchy: view(),
    method: view(),
  } as never);

  // DictItem / ClassCategoryItem are module-private; these paths read only the
  // fields below off the row they are handed.
  const clickDict = (dictIndex = 1) => ctl.selectDict({ dictName: DICT, dictIndex });
  const clickClass = (className = CLASS) => ctl.selectClass({ className });
  const clickCategory = (fullPath: string) =>
    ctl.selectClassCategory({ fullPath, label: fullPath } as never);
  const openMethod = (selector: string, isMeta = false) =>
    ctl.openMethod(new MethodItem(isMeta, info(selector)));

  return { ctl, holder, clickDict, clickClass, clickCategory, openMethod };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetConfig();
  classesInDict.mockReturnValue([{ className: CLASS, category: 'Kernel', hasComment: false }]);
  classEnvs.mockReturnValue(envLine(['balance', 'deposit:']));
  dictNames.mockReturnValue([DICT]);
  vi.mocked(vscode.window.showQuickPick).mockReset();
  vi.mocked(vscode.window.showWarningMessage).mockReset();
  vi.mocked(vscode.window.showInformationMessage).mockReset();
});

describe('the Explorer records a landing where the panes actually land', () => {
  it('folds a drill-down from dictionary to class to method into the one place it reached', async () => {
    const { ctl, clickDict, clickClass, openMethod } = makeController();

    clickDict();
    clickClass();
    await openMethod('balance');

    // Three clicks, one destination: the two coarser records are the cascade
    // passing through, not places the user asked to be. Were they kept, leaving
    // this method would cost three presses of Back instead of one.
    expect(ctl.history.entries()).toHaveLength(1);
    expect(ctl.history.current()).toMatchObject({
      dictName: DICT,
      className: CLASS,
      selector: 'balance',
    });
    expect(ctl.history.canGoBack()).toBe(false);
  });

  it('records a second method in the same class as a landing of its own', async () => {
    const { ctl, clickDict, clickClass, openMethod } = makeController();

    clickDict();
    clickClass();
    await openMethod('balance');
    await openMethod('deposit:');

    expect(ctl.history.entries().map((l) => l.selector)).toEqual(['balance', 'deposit:']);
    expect(ctl.history.canGoBack()).toBe(true);
  });

  it('separates the two sides of one selector', async () => {
    const { ctl, clickDict, clickClass, openMethod } = makeController();
    classEnvs.mockReturnValue([
      { isMeta: false, envId: 0, category: 'accessing', selectors: ['new'] },
      { isMeta: true, envId: 0, category: 'instance creation', selectors: ['new'] },
    ]);

    clickDict();
    clickClass();
    await openMethod('new', false);
    await openMethod('new', true);

    expect(ctl.history.entries()).toHaveLength(2);
    expect(ctl.history.entries().map((l) => l.isMeta)).toEqual([false, true]);
  });

  it('does not record a category click that leaves the selected class where it is', async () => {
    const { ctl, clickDict, clickClass, clickCategory, openMethod } = makeController();

    clickDict();
    clickClass();
    await openMethod('balance');
    // The class stays selected (it lives under this category), so the panes are
    // showing the same method afterwards — pinning the category pane is not a move.
    clickCategory('Kernel');

    expect(ctl.history.entries()).toHaveLength(1);
    expect(ctl.history.current()).toMatchObject({ selector: 'balance' });
  });

  it('records nothing while no session is selected', () => {
    const { ctl, holder, clickDict } = makeController();
    holder.session = undefined;

    clickDict();

    expect(ctl.history.entries()).toHaveLength(0);
  });
});

describe('Go Back puts the panes back on a landing, recomputed against the stone', () => {
  /** Drill in and open two methods, leaving a two-landing chain sat on the second. */
  async function seedTwoMethods() {
    const h = makeController();
    h.clickDict();
    h.clickClass();
    await h.openMethod('balance');
    await h.openMethod('deposit:');
    expect(h.ctl.history.entries()).toHaveLength(2);
    return h;
  }

  it('re-resolves the dictionary by name when the symbol list has shifted under it', async () => {
    const { ctl } = await seedTwoMethods();
    // A commit elsewhere added a dictionary ahead of ours, so the index recorded
    // with the landing (1) now names a different dictionary.
    dictNames.mockReturnValue(['Globals', DICT]);
    classEnvs.mockClear();

    await ctl.history.back();

    // Re-resolved to 2 by name rather than trusting the recorded 1.
    expect(classEnvs).toHaveBeenCalledWith(expect.anything(), 2, CLASS, expect.anything());
    expect(ctl.history.currentIndex()).toBe(0);
  });

  it('declines a landing recorded in a session that is no longer selected, and drops it', async () => {
    const { ctl, holder } = await seedTwoMethods();
    holder.session = { id: 2 } as ActiveSession; // logged in somewhere else since

    await ctl.history.back();

    const said = String(vi.mocked(vscode.window.showInformationMessage).mock.calls[0]?.[0] ?? '');
    expect(said).toContain('no longer selected');
    // Deliberately no reconnect and no session switch behind the user's back; the
    // unreachable entry leaves the chain so a second press tries the one before it.
    expect(ctl.history.entries()).toHaveLength(1);
  });

  it('drops a landing whose dictionary has left the symbol list', async () => {
    const { ctl } = await seedTwoMethods();
    dictNames.mockReturnValue(['Globals']);

    await ctl.history.back();

    const warned = String(vi.mocked(vscode.window.showWarningMessage).mock.calls[0]?.[0] ?? '');
    expect(warned).toContain(DICT);
    expect(ctl.history.entries()).toHaveLength(1);
  });

  it('still moves to the class when only the method is gone, and says which', async () => {
    const { ctl } = await seedTwoMethods();
    // The method was removed since it was visited; its class is still there.
    classEnvs.mockReturnValue(envLine(['deposit:']));

    await ctl.history.back();

    const warned = String(vi.mocked(vscode.window.showWarningMessage).mock.calls[0]?.[0] ?? '');
    expect(warned).toContain(CLASS);
    expect(warned).toContain('balance');
    // Moving to the class beats refusing to move at all, so the reveal still ran.
    expect(classEnvs).toHaveBeenCalledWith(expect.anything(), 1, CLASS, expect.anything());
    expect(ctl.history.entries()).toHaveLength(1);
  });

  it('keeps the landings its own reveal provokes out of the chain', async () => {
    const { ctl } = await seedTwoMethods();

    await ctl.history.back();

    // Going back drives the same cascade a click does — selectDict, revealClass and
    // openMethod all record. Replaying those would append the place we just came
    // back to, so Back would bounce between the last two landings forever.
    expect(ctl.history.entries().map((l) => l.selector)).toEqual(['balance', 'deposit:']);
    expect(ctl.history.currentIndex()).toBe(0);
    expect(ctl.history.canGoForward()).toBe(true);
  });

  it('walks forward again over what Back undid', async () => {
    const { ctl } = await seedTwoMethods();

    await ctl.history.back();
    await ctl.history.forward();

    expect(ctl.history.currentIndex()).toBe(1);
    expect(ctl.history.current()).toMatchObject({ selector: 'deposit:' });
    expect(ctl.history.entries()).toHaveLength(2);
  });
});

describe('Recent Locations lists the trail', () => {
  it('says nothing has been visited yet rather than opening an empty picker', async () => {
    const { ctl } = makeController();

    await ctl.showHistory();

    expect(vi.mocked(vscode.window.showInformationMessage)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(vscode.window.showQuickPick)).not.toHaveBeenCalled();
  });

  it('lists the trail newest first and marks the landing being shown', async () => {
    const { ctl, clickDict, clickClass, openMethod } = makeController();
    clickDict();
    clickClass();
    await openMethod('balance');
    await openMethod('deposit:');
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

    await ctl.showHistory();

    const items = vi.mocked(vscode.window.showQuickPick).mock.calls[0][0] as unknown as {
      label: string;
      description: string;
      index: number;
    }[];
    expect(items.map((i) => i.label)).toEqual([`${CLASS}>>deposit:`, `${CLASS}>>balance`]);
    expect(items[0].description).toContain('current');
    expect(items[1].description).not.toContain('current');
  });

  it('jumps to the landing that was picked', async () => {
    const { ctl, clickDict, clickClass, openMethod } = makeController();
    clickDict();
    clickClass();
    await openMethod('balance');
    await openMethod('deposit:');
    // Pick the older of the two — the last row in a newest-first list.
    vi.mocked(vscode.window.showQuickPick).mockImplementation(
      (async (items: unknown) => (items as { index: number }[])[1]) as never,
    );

    await ctl.showHistory();

    // Picking a row walks the chain to it, the way Back does — it does not add an
    // entry, so the one ahead is still there to go Forward to.
    expect(ctl.history.currentIndex()).toBe(0);
    expect(ctl.history.current()).toMatchObject({ selector: 'balance' });
    expect(ctl.history.entries().map((l) => l.selector)).toEqual(['balance', 'deposit:']);
    expect(ctl.history.canGoForward()).toBe(true);
  });
});

describe('the navigation commands are actually registered, not just contributed', () => {
  // explorerNavigationView.test.ts asserts the pane's buttons name commands the
  // manifest contributes. That leaves the other half open: a command can be in
  // package.json — reachable from the Command Palette and a keybinding — with
  // nothing registering a handler, in which case invoking it throws.
  const NAV_COMMANDS = [
    'gemstone.navigateBack',
    'gemstone.navigateForward',
    'gemstone.explorer.showHistory',
    'gemstone.explorer.clearHistory',
  ];

  /** The session events the registration subscribes to, captured as they arrive. */
  let sessionListeners: {
    selection: ((id: number | null) => void)[];
    removal: ((id: number) => void)[];
  };

  function register() {
    sessionListeners = { selection: [], removal: [] };
    // The shared vscode mock's TreeView stub has no onDidChangeSelection, which
    // registerGemStoneExplorer subscribes to for the filter-commit-on-click wiring.
    vi.mocked(vscode.window.createTreeView).mockImplementation(
      () =>
        ({
          onDidChangeVisibility: vi.fn(),
          onDidChangeCheckboxState: vi.fn(),
          onDidChangeSelection: vi.fn(),
          reveal: vi.fn(),
          dispose: vi.fn(),
        }) as never,
    );
    const context = {
      subscriptions: [] as { dispose?: () => void }[],
      globalState: { get: vi.fn(), update: vi.fn(async () => {}), keys: () => [] },
      extensionPath: '/x',
    } as unknown as vscode.ExtensionContext;
    const sessionManager = {
      getSelectedSession: () => ({ id: 1 }) as ActiveSession,
      resolveSession: () => Promise.resolve({ id: 1 } as ActiveSession),
      onDidChangeSelection: vi.fn((listener: (id: number | null) => void) => {
        sessionListeners.selection.push(listener);
        return { dispose: vi.fn() };
      }),
      onDidRemoveSession: vi.fn((listener: (id: number) => void) => {
        sessionListeners.removal.push(listener);
        return { dispose: vi.fn() };
      }),
    } as unknown as SessionManager;
    const handle = registerGemStoneExplorer(context, sessionManager);
    const handlers = new Map<string, (...a: unknown[]) => unknown>();
    for (const call of vi.mocked(vscode.commands.registerCommand).mock.calls) {
      handlers.set(call[0], call[1] as (...a: unknown[]) => unknown);
    }
    return { handlers, handle };
  }

  it('registers a handler for each one', () => {
    const { handlers } = register();
    for (const command of NAV_COMMANDS) {
      expect(handlers.has(command), `${command} has no handler`).toBe(true);
    }
  });

  it('runs them without throwing on an empty chain, so the palette entries are real', async () => {
    const { handlers } = register();
    for (const command of NAV_COMMANDS) {
      await expect(Promise.resolve(handlers.get(command)!())).resolves.not.toThrow();
    }
  });

  it('subscribes the chain to the session being switched and to a session logging out', () => {
    register();
    expect(sessionListeners.selection).toHaveLength(1);
    expect(sessionListeners.removal).toHaveLength(1);
  });
});

describe('the pane draws methods; the dictionaries and classes stay on one pinned line', () => {
  /** A stand-in for the Actions & Navigation pane, to read what the controller pushes. */
  function watchPane(ctl: ExplorerController) {
    const states: NavigationViewState[] = [];
    ctl.setNavigationView({ setState: (s: NavigationViewState) => states.push(s) } as never);
    return { latest: () => states[states.length - 1] };
  }

  it('leaves a dictionary out of the trail and names it on the pinned line', () => {
    const { ctl, clickDict } = makeController();
    const pane = watchPane(ctl);

    clickDict();

    expect(pane.latest().trail).toEqual([]);
    expect(pane.latest().location).toBe(DICT);
  });

  it('puts the class on the pinned line, still with no row of its own', () => {
    const { ctl, clickDict, clickClass } = makeController();
    const pane = watchPane(ctl);

    clickDict();
    clickClass();

    expect(pane.latest().trail).toEqual([]);
    expect(pane.latest().location).toBe(`${DICT} · ${CLASS}`);
  });

  it('gives a method a row, and moves the pinned line onto it', async () => {
    const { ctl, clickDict, clickClass, openMethod } = makeController();
    const pane = watchPane(ctl);

    clickDict();
    clickClass();
    await openMethod('balance');

    expect(pane.latest().trail).toEqual([
      { index: 0, label: `${CLASS}>>balance`, context: DICT, current: true },
    ]);
    expect(pane.latest().location).toBe(`${DICT} · ${CLASS}>>balance`);
  });

  it('drops the dictionary click off the trail while keeping it in the chain', async () => {
    const { ctl, clickDict, clickClass, openMethod } = makeController();
    const pane = watchPane(ctl);

    clickDict();
    clickClass();
    await openMethod('balance');
    await openMethod('deposit:');
    dictNames.mockReturnValue([DICT, 'Globals']);
    ctl.selectDict({ dictName: 'Globals', dictIndex: 2 });

    // Three landings in the chain — Recent Locations lists all three — but only the
    // two methods get a row, and none of them is current, because the place we are
    // standing is the dictionary named on the pinned line.
    expect(ctl.history.entries()).toHaveLength(3);
    const trail = pane.latest().trail;
    expect(trail.map((r) => r.label)).toEqual([`${CLASS}>>balance`, `${CLASS}>>deposit:`]);
    // Indices are places in the CHAIN — [balance, deposit:, Globals] — so a row
    // carries the index a click has to name, not its position among the rows.
    expect(trail.map((r) => r.index)).toEqual([0, 1]);
    expect(trail.some((r) => r.current)).toBe(false);
    expect(pane.latest().location).toBe('Globals');
  });

  it('flips between two dictionaries without stacking a row each', () => {
    const { ctl, clickDict } = makeController();
    const pane = watchPane(ctl);

    clickDict();
    dictNames.mockReturnValue([DICT, 'Globals']);
    ctl.selectDict({ dictName: 'Globals', dictIndex: 2 });
    ctl.selectDict({ dictName: DICT, dictIndex: 1 });

    expect(ctl.history.entries()).toHaveLength(1);
    expect(pane.latest().location).toBe(DICT);
    expect(pane.latest().trail).toEqual([]);
  });

  it('offers Clear only once something has been recorded', async () => {
    const { ctl, clickDict, clickClass, openMethod } = makeController();
    const pane = watchPane(ctl);
    expect(pane.latest().clear).toBe(false);

    clickDict();
    clickClass();
    await openMethod('balance');
    expect(pane.latest().clear).toBe(true);

    ctl.clearHistory();
    expect(pane.latest().clear).toBe(false);
    expect(pane.latest().trail).toEqual([]);
    expect(pane.latest().location).toBeUndefined();
  });

  it('empties the trail when the session it belongs to logs out', async () => {
    const { ctl, clickDict, clickClass, openMethod } = makeController();
    const pane = watchPane(ctl);
    clickDict();
    clickClass();
    await openMethod('balance');

    ctl.history.dropSession(1);

    expect(pane.latest().trail).toEqual([]);
    expect(ctl.history.entries()).toEqual([]);
  });

  it('swaps the trail when the selected session changes', async () => {
    const { ctl, holder, clickDict, clickClass, openMethod } = makeController();
    const pane = watchPane(ctl);
    clickDict();
    clickClass();
    await openMethod('balance');

    holder.session = { id: 2 } as ActiveSession;
    ctl.history.setActiveSession(2);
    expect(pane.latest().trail).toEqual([]);

    ctl.history.setActiveSession(1);
    expect(pane.latest().trail.map((r) => r.label)).toEqual([`${CLASS}>>balance`]);
  });
});

describe('Go Back and the editor', () => {
  it('reopens the method’s tab, so walking back shows the source again', async () => {
    const { ctl, clickDict, clickClass, openMethod } = makeController();
    clickDict();
    clickClass();
    await openMethod('balance');
    await openMethod('deposit:');
    vi.mocked(vscode.workspace.openTextDocument).mockClear();

    await ctl.history.back();

    const opened = vi
      .mocked(vscode.workspace.openTextDocument)
      .mock.calls.map((c) => String((c[0] as { path?: string })?.path ?? c[0]));
    expect(opened.some((uri) => uri.includes('balance'))).toBe(true);
  });

  it('follows VS Code’s Back onto an earlier method instead of appending it again', async () => {
    const { ctl, clickDict, clickClass, openMethod } = makeController();
    const opened = vi.mocked(vscode.workspace.openTextDocument);
    clickDict();
    clickClass();
    await openMethod('balance');
    const balanceUri = opened.mock.calls.at(-1)![0] as vscode.Uri;
    // Each open fires the editor-change event that clears its own self-open mark.
    await ctl.syncToEditor(balanceUri);
    await openMethod('deposit:');
    await ctl.syncToEditor(opened.mock.calls.at(-1)![0] as vscode.Uri);
    expect(ctl.history.currentIndex()).toBe(1);

    // VS Code's Go Back reopened the earlier tab. That is the same step our own
    // Back would have taken, so it moves the cursor rather than making a third
    // entry — otherwise the two histories drift apart with every press.
    await ctl.syncToEditor(balanceUri);

    expect(ctl.history.entries().map((l) => l.selector)).toEqual(['balance', 'deposit:']);
    expect(ctl.history.currentIndex()).toBe(0);
  });

  it('hands a press with nowhere of ours to go to VS Code’s own history', async () => {
    const { ctl, clickDict, clickClass, openMethod } = makeController();
    clickDict();
    clickClass();
    await openMethod('balance');
    vi.mocked(vscode.commands.executeCommand).mockClear();

    await ctl.history.back();

    // Our commands take over ctrl+alt+- wherever the Explorer or a gemstone://
    // editor has focus, so swallowing the press would strand the user.
    expect(vi.mocked(vscode.commands.executeCommand)).toHaveBeenCalledWith(
      'workbench.action.navigateBack',
    );
  });
});

describe('Recent Locations lists what the trail leaves out', () => {
  it('includes the dictionary and class landings, each spelled out in full', async () => {
    const { ctl, clickDict, clickClass, openMethod } = makeController();
    clickDict();
    clickClass();
    await openMethod('balance');
    dictNames.mockReturnValue([DICT, 'Globals']);
    ctl.selectDict({ dictName: 'Globals', dictIndex: 2 });
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

    await ctl.showHistory();

    const items = vi.mocked(vscode.window.showQuickPick).mock.calls[0][0] as unknown as {
      label: string;
      description: string;
    }[];
    expect(items.map((i) => i.label)).toEqual(['Globals', `${CLASS}>>balance`]);
    expect(items[1].description).toBe(`${DICT} · ${CLASS}>>balance`);
  });
});

describe('the trail label mode is a setting, not just a button', () => {
  /** A stand-in for the Actions & Navigation pane, to read what the controller pushes. */
  function watchPane(ctl: ExplorerController) {
    const states: NavigationViewState[] = [];
    ctl.setNavigationView({ setState: (s: NavigationViewState) => states.push(s) } as never);
    return { latest: () => states[states.length - 1] };
  }

  async function readTwoMethods() {
    const h = makeController();
    h.clickDict();
    h.clickClass();
    await h.openMethod('balance');
    await h.openMethod('deposit:');
    return h;
  }

  it('spells the class out in each row by default', async () => {
    const { ctl } = await readTwoMethods();
    const pane = watchPane(ctl);
    ctl.syncNavigationState();

    expect(pane.latest().mode).toBe('full');
    expect(pane.latest().trail.map((r) => r.label)).toEqual([
      `${CLASS}>>balance`,
      `${CLASS}>>deposit:`,
    ]);
    expect(pane.latest().trail.map((r) => r.context)).toEqual([DICT, DICT]);
  });

  it('drops the class to the dimmed column when the setting is on', async () => {
    // Working inside one class, the repeated class name crowds out the selector,
    // which is the only part that differs.
    vscode.workspace.getConfiguration('gemstone').update('explorer.navigationSelectorsOnly', true);
    const { ctl } = await readTwoMethods();
    const pane = watchPane(ctl);
    ctl.syncNavigationState();

    expect(pane.latest().mode).toBe('selectors');
    expect(pane.latest().trail.map((r) => r.label)).toEqual(['balance', 'deposit:']);
    expect(pane.latest().trail.map((r) => r.context)).toEqual([CLASS, CLASS]);
  });

  it('writes the setting rather than keeping the mode in memory', async () => {
    // It has to survive a reload and be findable in Settings, not only on the button.
    const { ctl } = makeController();
    await ctl.setTrailLabelMode('selectors');
    expect(
      vscode.workspace
        .getConfiguration('gemstone')
        .get<boolean>('explorer.navigationSelectorsOnly'),
    ).toBe(true);
    expect(ctl.trailLabelMode()).toBe('selectors');

    await ctl.setTrailLabelMode('full');
    expect(
      vscode.workspace
        .getConfiguration('gemstone')
        .get<boolean>('explorer.navigationSelectorsOnly'),
    ).toBe(false);
    expect(ctl.trailLabelMode()).toBe('full');
  });
});

describe('Go Back gives up on a class the stone no longer has', () => {
  it('reports failure and drops the landing when the reveal cannot place the class', async () => {
    const { ctl, clickDict, clickClass, openMethod } = makeController();
    classesInDict.mockReturnValue([
      { className: CLASS, category: 'Kernel', hasComment: false },
      { className: 'Ledger', category: 'Kernel', hasComment: false },
    ]);
    clickDict();
    clickClass();
    await openMethod('balance');
    clickClass('Ledger');
    await openMethod('balance');

    // The class cannot be resolved in that dictionary any more. revealClass fetches
    // before it commits, so it warns and leaves the panes on Ledger rather than
    // half-updating — and the walk has to notice it never arrived.
    classEnvs.mockImplementation(() => {
      throw new Error('class not found in dictionary');
    });

    await ctl.history.back();

    // Without the guard the walk would report success, leaving the trail pointing
    // at a class the panes never reached.
    expect(ctl.history.entries().map((l) => l.className)).toEqual(['Ledger']);
  });
});
