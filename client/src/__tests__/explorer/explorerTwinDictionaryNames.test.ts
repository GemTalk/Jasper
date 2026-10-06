/**
 * The Explorer when two dictionaries share a NAME.
 *
 * The symbol list can hold two dictionaries called `Shared`, each binding its own `Shadowed`. A
 * dictionary name cannot tell them apart, so every path that knows the SymbolList position must
 * use it: an editor tab's `?dict=` query, a compile event, a GemStone Search result, the retained
 * selection on Refresh, a Hierarchy node, and a Go Back landing. Each one used to turn what it had
 * back into a name and look the name up, which finds the FIRST `Shared` -- and shows the other
 * dictionary's `Shadowed` (#396).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  getClassesWithCategory: vi.fn(() => []),
  getClassEnvironments: vi.fn(() => []),
  getDictionaryNames: vi.fn(() => []),
  getAllClassNames: vi.fn(() => []),
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

import * as queries from '../../browserQueries';
import { ExplorerController, HierarchyItem, MethodItem } from '../../gemstoneExplorer';
import { buildClassDefinitionUri } from '../../gemstoneFileSystemProvider';
import type { SessionManager, ActiveSession } from '../../sessionManager';

// Two dictionaries called `Shared`, at positions 1 and 3, and UserGlobals between them.
const SYMBOL_LIST = ['Shared', 'UserGlobals', 'Shared'];
const FIRST = 1;
const SECOND = 3;
const CLASS = 'Shadowed';

function makeController(): ExplorerController {
  const session = { id: 1 } as ActiveSession;
  const ctl = new ExplorerController({
    getSelectedSession: () => session,
    resolveSession: () => Promise.resolve(session),
  } as unknown as SessionManager);
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
  return ctl;
}

/** Put the panes on `Shadowed` in the `Shared` dictionary at `dictIndex`. */
async function selectShadowedIn(ctl: ExplorerController, dictIndex: number): Promise<void> {
  await ctl.selectDict({ dictName: 'Shared', dictIndex });
  await ctl.selectClass({ className: CLASS });
}

/** The instance-side `balance` method row. */
const balance = () =>
  new MethodItem(false, {
    selector: 'balance',
    category: 'accessing',
    overrideBits: 0,
    sessionBit: 0,
  });

/** Let the reveals a `void`-launched navigation starts run to completion. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(queries.getDictionaryNames).mockResolvedValue(SYMBOL_LIST);
  // Both `Shared` dictionaries bind a `Shadowed`; UserGlobals binds nothing relevant.
  vi.mocked(queries.getClassesWithCategory).mockImplementation(((_s: unknown, idx: number) =>
    idx === FIRST || idx === SECOND ? [{ className: CLASS, category: 'Kernel' }] : []) as never);
  vi.mocked(queries.getClassEnvironments).mockReturnValue([
    { isMeta: false, envId: 0, category: 'accessing', selectors: ['balance'] },
  ] as never);
});

describe('an editor tab moves the Explorer to the dictionary its URI names by position', () => {
  it('lands on the second `Shared` when the tab carries its index', async () => {
    const ctl = makeController();
    await ctl.selectDict({ dictName: 'UserGlobals', dictIndex: 2 });

    await ctl.syncToEditor(buildClassDefinitionUri(1, 'Shared', CLASS, SECOND));

    expect(ctl.state.dictIndex).toBe(SECOND);
  });

  it('does not treat the same class name in the first `Shared` as already shown', async () => {
    // Showing Shadowed in the FIRST Shared, the tab is the SECOND one's. Same class name, same
    // dictionary name -- still a different class, so the Explorer has to move.
    const ctl = makeController();
    await selectShadowedIn(ctl, FIRST);

    await ctl.syncToEditor(buildClassDefinitionUri(1, 'Shared', CLASS, SECOND));

    expect(ctl.state.dictIndex).toBe(SECOND);
  });
});

describe('a class compiled from a definition editor is revealed where it was compiled', () => {
  it('lands on the second `Shared` even though the selected first one binds the name too', async () => {
    const ctl = makeController();
    await selectShadowedIn(ctl, FIRST);

    await ctl.onExternalClassCompiled(1, CLASS, 'Shared', SECOND);
    await settle();

    expect(ctl.state.dictIndex).toBe(SECOND);
  });
});

describe('a GemStone Search category result opens the dictionary it was found in', () => {
  it('lands on the second `Shared` when the result carries its index', async () => {
    const ctl = makeController();
    await ctl.selectDict({ dictName: 'UserGlobals', dictIndex: 2 });

    await ctl.revealCategoryByPath('Shared', 'Kernel', undefined, SECOND);

    expect(ctl.state.dictIndex).toBe(SECOND);
  });
});

describe('Refresh keeps the dictionary the user had selected', () => {
  it('stays on the second `Shared`', async () => {
    const ctl = makeController();
    await selectShadowedIn(ctl, SECOND);

    await ctl.refreshRetainingSelection({ reveal: false });

    expect(ctl.state.dictIndex).toBe(SECOND);
  });

  it('still follows a dictionary whose position shifted under it', async () => {
    const ctl = makeController();
    await ctl.selectDict({ dictName: 'UserGlobals', dictIndex: 2 });
    vi.mocked(queries.getDictionaryNames).mockResolvedValue(['Globals', ...SYMBOL_LIST]);

    await ctl.refreshRetainingSelection({ reveal: false });

    expect(ctl.state.dictIndex).toBe(3);
  });
});

describe('a Hierarchy node knows which dictionary its class is in', () => {
  it('navigates to the second `Shared` from a node that carries its index', async () => {
    const ctl = makeController();
    await ctl.selectDict({ dictName: 'UserGlobals', dictIndex: 2 });
    const node = new HierarchyItem(CLASS, 'Shared', 'ancestor', 0, true, undefined, SECOND);

    await ctl.selectHierarchyNode(node);
    await settle();

    expect(ctl.state.dictIndex).toBe(SECOND);
  });

  it('gives two same-named subclasses different tree ids', () => {
    // VS Code refuses a tree with two elements of one id, so the Hierarchy pane cannot even
    // render a class whose subclasses include two of the same name.
    const a = new HierarchyItem(CLASS, 'Shared', 'subclass', -1, false, undefined, FIRST);
    const b = new HierarchyItem(CLASS, 'Shared', 'subclass', -1, false, undefined, SECOND);

    expect(a.id).not.toBe(b.id);
  });
});

describe('Go Back returns to the dictionary a landing was recorded in', () => {
  it('lands on the second `Shared`, not the first of that name', async () => {
    const ctl = makeController();
    await selectShadowedIn(ctl, SECOND);
    await ctl.openMethod(balance());
    // Somewhere else, so Back has a landing to return to.
    await selectShadowedIn(ctl, FIRST);
    await ctl.openMethod(balance());
    expect(ctl.history.entries()).toHaveLength(2);

    await ctl.history.back();

    expect(ctl.state.dictIndex).toBe(SECOND);
  });
});
