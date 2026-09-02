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
import { ExplorerController, MethodItem, registerGemStoneExplorer } from '../../gemstoneExplorer';
import {
  getClassesWithCategory,
  getClassEnvironments,
  getDictionaryNames,
} from '../../browserQueries';
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

    expect(ctl.history.currentIndex()).toBe(0);
    expect(ctl.history.current()).toMatchObject({ selector: 'balance' });
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
  ];

  function register() {
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
      onDidChangeSelection: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as SessionManager;
    registerGemStoneExplorer(context, sessionManager);
    const handlers = new Map<string, (...a: unknown[]) => unknown>();
    for (const call of vi.mocked(vscode.commands.registerCommand).mock.calls) {
      handlers.set(call[0], call[1] as (...a: unknown[]) => unknown);
    }
    return handlers;
  }

  it('registers a handler for each one', () => {
    const handlers = register();
    for (const command of NAV_COMMANDS) {
      expect(handlers.has(command), `${command} has no handler`).toBe(true);
    }
  });

  it('runs them without throwing on an empty chain, so the palette entries are real', async () => {
    const handlers = register();
    for (const command of NAV_COMMANDS) {
      await expect(handlers.get(command)!()).resolves.not.toThrow();
    }
  });
});
