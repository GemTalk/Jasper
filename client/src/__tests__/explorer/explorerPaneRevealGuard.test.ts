/**
 * Which Explorer panes an automatic navigation is allowed to open.
 *
 * `TreeView.reveal` makes VS Code *show* the view the row belongs to, so every
 * reveal is also a layout decision. The rule the controller now draws (see
 * `revealCascade`): a reveal that merely highlights a row reached from somewhere
 * else — a Hierarchy click, Go Back, a refresh resync, a method jump — is skipped
 * while its pane is closed and re-applied when the user opens it; a reveal that
 * IS the user's request — a GemStone Search jump — still opens its pane.
 *
 * The stone is mocked and the REAL cascade runs, so what is asserted is which
 * panes the run touched rather than which private it called on the way. A test
 * that pinned the private calls would stay green through a guard placed one
 * level too deep to save the layout.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  getAllClassNames: vi.fn(() => []),
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

import { __resetConfig } from '../../__mocks__/vscode';
import { logWarning } from '../../gciLog';
import { ExplorerController, HierarchyItem, MethodItem } from '../../gemstoneExplorer';
import {
  getAllClassNames,
  getClassesWithCategory,
  getClassEnvironments,
  getDictionaryNames,
} from '../../browserQueries';
import type { ClassHierarchyEntry } from '../../queries/getClassHierarchy';
import type { SessionManager, ActiveSession } from '../../sessionManager';

const SESSION_ID = 1;
const DICT = 'UserGlobals';
const OTHER_DICT = 'Legacy';
const CLASS = 'Account';
const SUPER = 'Object';

/** A TreeView stub whose `visible` mirrors whether its sidebar section is expanded. */
function fakeView(visible = true) {
  return { reveal: vi.fn(async () => {}), selection: [] as unknown[], description: '', visible };
}

type Panes = ReturnType<typeof makeController>['panes'];

function info(selector: string) {
  return { selector, category: 'accessing', overrideBits: 0, sessionBit: 0 };
}

function makeController() {
  const session = { id: SESSION_ID } as ActiveSession;
  const sessionManager = {
    getSelectedSession: () => session,
    getSession: (id: number) => (id === SESSION_ID ? session : undefined),
    resolveSession: () => Promise.resolve(session),
  } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  const panes = {
    dict: fakeView(),
    category: fakeView(),
    klass: fakeView(),
    hierarchy: fakeView(),
    method: fakeView(),
  };
  ctl.setViews(panes as never);
  return { ctl, panes };
}

/** Collapse the named panes, as the user does by clicking their section headers. */
function collapse(panes: Panes, ...names: (keyof Panes)[]): void {
  for (const name of names) panes[name].visible = false;
}

/** Open a pane and tell the controller, the way the view's onDidChangeVisibility does. */
function expand(ctl: ExplorerController, panes: Panes, name: keyof Panes): void {
  panes[name].visible = true;
  ctl.onPaneVisibilityChanged(name, true);
}

/** Seed the private hierarchy chain a Hierarchy click reads, without a live query. */
function seedHierarchy(ctl: ExplorerController): void {
  const access = ctl as unknown as {
    hierChain: ClassHierarchyEntry[];
    hierSubs: ClassHierarchyEntry[];
  };
  access.hierChain = [
    { className: SUPER, dictName: DICT, kind: 'ancestor' },
    { className: CLASS, dictName: DICT, kind: 'self' },
  ] as ClassHierarchyEntry[];
  access.hierSubs = [];
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetConfig();
  vi.mocked(getDictionaryNames).mockReturnValue([DICT, OTHER_DICT]);
  vi.mocked(getAllClassNames).mockReturnValue([
    { className: CLASS, dictName: DICT, dictIndex: 1 },
    { className: SUPER, dictName: DICT, dictIndex: 1 },
  ]);
  vi.mocked(getClassesWithCategory).mockReturnValue([
    { className: CLASS, category: 'Finance', hasComment: false },
    { className: SUPER, category: 'Kernel', hasComment: false },
  ]);
  vi.mocked(getClassEnvironments).mockReturnValue([
    { isMeta: false, envId: 0, category: 'accessing', selectors: ['balance'] },
  ]);
});

describe('a cascade navigation leaves closed panes closed', () => {
  it('does not re-open Classes, Class Categories or Dictionaries on a Hierarchy click', async () => {
    const { ctl, panes } = makeController();
    await ctl.findClass(CLASS, SESSION_ID, DICT); // land somewhere first
    seedHierarchy(ctl);
    collapse(panes, 'dict', 'category', 'klass');
    vi.clearAllMocks();

    ctl.selectHierarchyNode(new HierarchyItem(SUPER, DICT, 'ancestor', 0, true));
    await vi.waitFor(() => expect(ctl.state.className).toBe(SUPER));

    // The navigation happened — only the highlight was withheld.
    expect(panes.klass.reveal).not.toHaveBeenCalled();
    expect(panes.category.reveal).not.toHaveBeenCalled();
    expect(panes.dict.reveal).not.toHaveBeenCalled();
  });

  it('still highlights those panes when they are open', async () => {
    const { ctl, panes } = makeController();
    await ctl.findClass(CLASS, SESSION_ID, DICT);
    seedHierarchy(ctl);
    vi.clearAllMocks();

    ctl.selectHierarchyNode(new HierarchyItem(SUPER, DICT, 'ancestor', 0, true));
    await vi.waitFor(() => expect(ctl.state.className).toBe(SUPER));

    await vi.waitFor(() => expect(panes.klass.reveal).toHaveBeenCalled());
    expect(panes.dict.reveal).toHaveBeenCalled();
  });

  it('never takes keyboard focus into a Classes pane it did not open', async () => {
    const { ctl, panes } = makeController();
    await ctl.findClass(CLASS, SESSION_ID, DICT);
    seedHierarchy(ctl);
    collapse(panes, 'klass');
    vi.clearAllMocks();

    ctl.selectHierarchyNode(new HierarchyItem(SUPER, DICT, 'ancestor', 0, true));
    await vi.waitFor(() => expect(ctl.state.className).toBe(SUPER));

    // A class landing asks for focus:true; withholding the reveal is what keeps
    // the arrow keys walking the hierarchy the user was reading.
    expect(panes.klass.reveal).not.toHaveBeenCalled();
  });

  // Two landings of different shapes, because goToLanding reveals down two paths:
  // a class landing goes through revealClass, a dictionary landing reveals the
  // dictionary and category rows itself. The second is in a *different*
  // dictionary — a coarser landing inside the same one folds into the first.
  async function twoLandings(ctl: ExplorerController) {
    await ctl.findClass(CLASS, SESSION_ID, DICT, { selector: 'balance', isMeta: false });
    ctl.selectDict({ dictName: OTHER_DICT, dictIndex: 2 });
    expect(ctl.history.canGoBack()).toBe(true);
  }

  it('does not re-open a pane walking Back to a class', async () => {
    const { ctl, panes } = makeController();
    await twoLandings(ctl);
    collapse(panes, 'dict', 'category', 'klass');
    vi.clearAllMocks();

    await ctl.history.back();

    expect(ctl.state.className).toBe(CLASS);
    expect(panes.dict.reveal).not.toHaveBeenCalled();
    expect(panes.category.reveal).not.toHaveBeenCalled();
    expect(panes.klass.reveal).not.toHaveBeenCalled();
  });

  it('does not re-open a pane walking Forward to a dictionary', async () => {
    const { ctl, panes } = makeController();
    await twoLandings(ctl);
    await ctl.history.back();
    collapse(panes, 'dict', 'category');
    vi.clearAllMocks();

    await ctl.history.forward();

    expect(ctl.state.dictName).toBe(OTHER_DICT);
    expect(ctl.state.className).toBeUndefined();
    expect(panes.dict.reveal).not.toHaveBeenCalled();
    expect(panes.category.reveal).not.toHaveBeenCalled();
  });

  it('does not re-open the Methods pane when a jump lands on a method', async () => {
    const { ctl, panes } = makeController();
    collapse(panes, 'method');

    await ctl.findClass(CLASS, SESSION_ID, DICT, { selector: 'balance', isMeta: false });

    expect(ctl.state.className).toBe(CLASS);
    expect(panes.method.reveal).not.toHaveBeenCalled();
  });

  // The positive control for the case above: without it, "did not reveal" would
  // pass just as well if the jump had stopped revealing the method at all.
  it('does highlight the method row when the Methods pane is open', async () => {
    const { ctl, panes } = makeController();

    await ctl.findClass(CLASS, SESSION_ID, DICT, { selector: 'balance', isMeta: false });

    expect(panes.method.reveal).toHaveBeenCalled();
  });

  it('does not re-open any pane on a refresh resync', async () => {
    const { ctl, panes } = makeController();
    await ctl.findClass(CLASS, SESSION_ID, DICT);
    collapse(panes, 'dict', 'category', 'klass', 'hierarchy', 'method');
    vi.clearAllMocks();

    await ctl.refreshRetainingSelection();

    for (const name of ['dict', 'category', 'klass', 'hierarchy', 'method'] as const) {
      expect(panes[name].reveal, `${name} pane`).not.toHaveBeenCalled();
    }
  });

  /**
   * An undo that refiles a class asks the Class Categories pane to follow it. The
   * SELECTION has to happen either way — without it the pane stays filtered to a
   * category the class has just left, which hides it — but the row highlight is
   * still only a highlight, and an undo pressed from somewhere else is not a
   * request to open this pane.
   */
  it('does not re-open Class Categories when an undo refiles a class', async () => {
    const { ctl, panes } = makeController();
    await ctl.findClass(CLASS, SESSION_ID, DICT);
    collapse(panes, 'category');
    vi.clearAllMocks();

    await ctl.classCategoriesChanged(CLASS);

    expect(panes.category.reveal).not.toHaveBeenCalled();
    // The state fix still happened, so the Classes pane is not left filtered to
    // a category the class has left.
    expect(ctl.state.classCategory).toBe('Finance');
  });

  it('does follow the refiled class when Class Categories is open', async () => {
    const { ctl, panes } = makeController();
    await ctl.findClass(CLASS, SESSION_ID, DICT);
    vi.clearAllMocks();

    await ctl.classCategoriesChanged(CLASS);

    expect(panes.category.reveal).toHaveBeenCalled();
  });

  // The positive control for the case above.
  it('does re-highlight the panes a refresh resync finds open', async () => {
    const { ctl, panes } = makeController();
    await ctl.findClass(CLASS, SESSION_ID, DICT);
    vi.clearAllMocks();

    await ctl.refreshRetainingSelection();

    expect(panes.dict.reveal).toHaveBeenCalled();
    expect(panes.klass.reveal).toHaveBeenCalled();
  });
});

describe('a pane catches up on the highlight it missed when the user opens it', () => {
  it('highlights the selected dictionary', async () => {
    const { ctl, panes } = makeController();
    collapse(panes, 'dict');
    await ctl.findClass(CLASS, SESSION_ID, DICT);
    expect(panes.dict.reveal).not.toHaveBeenCalled();

    expand(ctl, panes, 'dict');

    await vi.waitFor(() => expect(panes.dict.reveal).toHaveBeenCalledTimes(1));
  });

  it('highlights the selected class', async () => {
    const { ctl, panes } = makeController();
    collapse(panes, 'klass');
    await ctl.findClass(CLASS, SESSION_ID, DICT);
    expect(panes.klass.reveal).not.toHaveBeenCalled();

    expand(ctl, panes, 'klass');

    await vi.waitFor(() => expect(panes.klass.reveal).toHaveBeenCalledTimes(1));
  });

  it('highlights the selected class category', async () => {
    const { ctl, panes } = makeController();
    collapse(panes, 'category');
    await ctl.findClass(CLASS, SESSION_ID, DICT);
    ctl.selectClassCategory({ fullPath: 'Finance', label: 'Finance' } as never);
    expect(panes.category.reveal).not.toHaveBeenCalled();

    expand(ctl, panes, 'category');

    await vi.waitFor(() => expect(panes.category.reveal).toHaveBeenCalledTimes(1));
  });

  it('highlights the selected method', async () => {
    const { ctl, panes } = makeController();
    await ctl.findClass(CLASS, SESSION_ID, DICT);
    collapse(panes, 'method');
    await ctl.openMethod(new MethodItem(false, info('balance')));
    vi.clearAllMocks();

    expand(ctl, panes, 'method');

    await vi.waitFor(() => expect(panes.method.reveal).toHaveBeenCalledTimes(1));
  });

  it('does nothing when a pane is being closed', async () => {
    const { ctl, panes } = makeController();
    await ctl.findClass(CLASS, SESSION_ID, DICT);
    vi.clearAllMocks();

    panes.klass.visible = false;
    ctl.onPaneVisibilityChanged('klass', false);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(panes.klass.reveal).not.toHaveBeenCalled();
  });
});

describe('a jump the user aimed at a pane still opens it', () => {
  it('opens the Dictionaries pane for a GemStone Search dictionary result', async () => {
    const { ctl, panes } = makeController();
    collapse(panes, 'dict');

    await ctl.revealDictionaryByName(DICT, SESSION_ID);

    expect(panes.dict.reveal).toHaveBeenCalledTimes(1);
  });

  it('opens the Class Categories pane for a GemStone Search category result', async () => {
    const { ctl, panes } = makeController();
    collapse(panes, 'dict', 'category');

    await ctl.revealCategoryByPath(DICT, 'Finance', SESSION_ID);

    expect(panes.category.reveal).toHaveBeenCalledTimes(1);
  });
});

/**
 * A reveal can reject even with its pane open — the row may not be in the rebuilt
 * tree yet. That must never fail the navigation that asked for it, since the panes
 * are already correct from state by then; the highlight is all that is lost.
 */
describe('a reveal that rejects', () => {
  function rejectingViews(ctl: ExplorerController) {
    const panes = {
      dict: fakeView(),
      category: fakeView(),
      klass: fakeView(),
      hierarchy: fakeView(),
      method: fakeView(),
    };
    for (const pane of Object.values(panes)) {
      pane.reveal = vi.fn(async () => {
        throw new Error('row not in the rebuilt tree');
      });
    }
    ctl.setViews(panes as never);
    return panes;
  }

  it('does not fail the navigation', async () => {
    const { ctl } = makeController();
    rejectingViews(ctl);

    await expect(ctl.findClass(CLASS, SESSION_ID, DICT)).resolves.not.toThrow();
    expect(ctl.state.className).toBe(CLASS);
  });

  // Silent for the class/dictionary/category cascade: state is already right, and a
  // rejection there says nothing a reader of the GCI log can act on.
  it('says nothing for a class-cascade reveal', async () => {
    const { ctl } = makeController();
    rejectingViews(ctl);

    await ctl.findClass(CLASS, SESSION_ID, DICT);

    expect(vi.mocked(logWarning)).not.toHaveBeenCalled();
  });

  // The method reveal kept its logging when it moved onto the shared helper.
  it('still logs a failed method reveal, naming the method and the reason', async () => {
    const { ctl } = makeController();
    rejectingViews(ctl);

    await ctl.findClass(CLASS, SESSION_ID, DICT, { selector: 'balance', isMeta: false });

    const logged = vi.mocked(logWarning).mock.calls.map((c) => String(c[0]));
    expect(logged.some((l) => l.includes('balance'))).toBe(true);
    expect(logged.some((l) => l.includes('row not in the rebuilt tree'))).toBe(true);
  });
});

/**
 * The catch-up reads the same state the pane's rows are built from, so it has to
 * cope with that state being empty or stale — a pane opened before anything is
 * selected, or holding a selector the class no longer lists.
 */
describe('the catch-up when there is nothing to highlight', () => {
  it('reveals nothing in a pane opened before anything is selected', async () => {
    const { ctl, panes } = makeController();
    collapse(panes, 'dict', 'category', 'klass', 'method');

    for (const name of ['dict', 'category', 'klass', 'method'] as const) {
      expand(ctl, panes, name);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    for (const name of ['dict', 'category', 'klass', 'method'] as const) {
      expect(panes[name].reveal, `${name} pane`).not.toHaveBeenCalled();
    }
  });

  it('reveals no category when the dictionary is showing all classes', async () => {
    const { ctl, panes } = makeController();
    collapse(panes, 'category');
    await ctl.findClass(CLASS, SESSION_ID, DICT);
    expect(ctl.state.classCategory).toBeUndefined();

    expand(ctl, panes, 'category');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(panes.category.reveal).not.toHaveBeenCalled();
  });

  it('reveals no method row when the class no longer lists the selector', async () => {
    const { ctl, panes } = makeController();
    await ctl.findClass(CLASS, SESSION_ID, DICT);
    collapse(panes, 'method');
    await ctl.openMethod(new MethodItem(false, info('balance')));
    // The method list is reloaded without that selector — an undo, or another
    // session removing it — while the recorded selection still names it. Set the
    // private method metadata directly rather than re-navigating: revealClass
    // clears the recorded selector, which would make this pass through the
    // "nothing selected" branch instead of the one under test.
    (ctl as unknown as { envLines: unknown[] }).envLines = [];
    // Assert the precondition, so a future change that clears the selector here
    // cannot turn this into a test that passes by reaching nothing at all.
    expect(ctl.state.selectedSelector).toBe('balance');
    vi.clearAllMocks();

    expand(ctl, panes, 'method');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(panes.method.reveal).not.toHaveBeenCalled();
  });
});
