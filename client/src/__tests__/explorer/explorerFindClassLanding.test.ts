/**
 * Where `findClass` lands the Explorer when a caller names a dictionary and a
 * method — the shape the debugger's frame "Browse" asks for.
 *
 * The stone is mocked and the REAL pane cascade runs, so what is asserted is
 * where the Explorer ends up rather than which private it called on the way.
 * That distinction is the whole point of these tests: the outcome they guard
 * against is a Browse that opens the wrong class of the same name, and a test
 * that only checks `revealClass(…)`'s arguments would stay green through a
 * cascade that took those arguments and landed somewhere else — while breaking
 * on a rename that changed nothing. Set up the same way round as
 * explorerNavigationLandings.test.ts, for the same reason.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  getAllClassNames: vi.fn(() => []),
  getClassesWithCategory: vi.fn(() => []),
  getClassEnvironments: vi.fn(() => []),
  getDictionaryNames: vi.fn(() => ['UserGlobals', 'Legacy']),
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
import { ExplorerController } from '../../gemstoneExplorer';
import {
  getAllClassNames,
  getClassesWithCategory,
  getClassEnvironments,
} from '../../browserQueries';
import type { SessionManager, ActiveSession } from '../../sessionManager';

const SESSION_ID = 7;

// The same class name in two dictionaries — the case a bare name cannot resolve.
// UserGlobals comes first, so it is what an unnarrowed lookup lands on.
const SHADOWED = [
  { className: 'Account', dictName: 'UserGlobals', dictIndex: 1 },
  { className: 'Account', dictName: 'Legacy', dictIndex: 4 },
];

/**
 * A controller wired to one session, with tree views that accept every reveal —
 * the cascade treats `reveal` as a highlight nicety, so accepting views let the
 * real thing run to completion and leave its state behind.
 */
function makeController(): ExplorerController {
  const session = { id: SESSION_ID } as ActiveSession;
  const sessionManager = {
    getSelectedSession: () => session,
    getSession: (id: number) => (id === SESSION_ID ? session : undefined),
    resolveSession: () => Promise.resolve(session),
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
  return ctl;
}

/** The gemstone:// URIs the run opened, in order. */
function openedUris(): string[] {
  return vi
    .mocked(vscode.workspace.openTextDocument)
    .mock.calls.map(([arg]) => String((arg as vscode.Uri)?.toString?.() ?? arg));
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetConfig();
  vi.mocked(getAllClassNames).mockReturnValue(SHADOWED);
  // Both Account classes carry the same category, so the pane cascade behaves
  // identically whichever one is landed on — the dictionary is the only thing
  // that distinguishes them, which is what these tests are about.
  vi.mocked(getClassesWithCategory).mockReturnValue([
    { className: 'Account', category: 'Finance', hasComment: false },
  ]);
  vi.mocked(getClassEnvironments).mockReturnValue([
    { isMeta: false, envId: 0, category: 'accessing', selectors: ['balance'] },
  ]);
  vi.mocked(vscode.window.showWarningMessage).mockReset();
});

describe('findClass with a dictionary and a method', () => {
  it('lands on the shadowed class in the dictionary it was given', async () => {
    const ctl = makeController();

    await ctl.findClass('Account', SESSION_ID, 'Legacy');

    expect(ctl.state.dictName).toBe('Legacy');
    expect(ctl.state.dictIndex).toBe(4);
    expect(ctl.state.className).toBe('Account');
    // The narrowing worked, so nothing to warn about.
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  // Two ways a named dictionary can fail to hold the class, which want the same
  // answer: land on the class anyway, and say where you landed. The second is the
  // one that happens in practice — a dictionary full of classes that doesn't hold
  // this one — and it is the one a dictionary-only filter cannot see.
  const dictionaryMisses = {
    'holds no class of that name': 'Finance',
    'is not in the symbol list at all': 'DictionaryThatIsGone',
  };
  it.each(Object.entries(dictionaryMisses))(
    'warns and falls back to another dictionary when the one it was given %s',
    async (_case, missing) => {
      vi.mocked(getAllClassNames).mockReturnValue([
        ...SHADOWED,
        { className: 'Invoice', dictName: 'Finance', dictIndex: 6 },
      ]);
      const ctl = makeController();

      await ctl.findClass('Account', SESSION_ID, missing);

      expect(ctl.state.dictName).toBe('UserGlobals');
      expect(ctl.state.dictIndex).toBe(1);
      // Names the dictionary asked for AND the one landed in: the point is that
      // the pane may not be the class the caller meant.
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining(missing),
      );
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('UserGlobals'),
      );
    },
  );

  it('refuses only when no dictionary holds the class', async () => {
    const ctl = makeController();

    await ctl.findClass('NoSuchClass', SESSION_ID, 'Legacy');

    expect(ctl.state.className).toBeUndefined();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('No class matching "NoSuchClass"'),
    );
  });

  it('opens the named method of that dictionary’s class', async () => {
    const ctl = makeController();

    await ctl.findClass('Account', SESSION_ID, 'Legacy', { selector: 'balance', isMeta: false });

    expect(ctl.state.selectedSelector).toBe('balance');
    // The method's own document, on the Legacy Account — not the UserGlobals one.
    expect(openedUris()).toContainEqual(
      expect.stringContaining(`gemstone://${SESSION_ID}/Legacy/Account/instance/accessing/balance`),
    );
  });

  it('warns instead of opening when the class does not implement the method', async () => {
    vi.mocked(getClassEnvironments).mockReturnValue([]); // no selectors on either side
    const ctl = makeController();

    await ctl.findClass('Account', SESSION_ID, 'Legacy', { selector: 'balance', isMeta: false });

    expect(ctl.state.className).toBe('Account'); // the class was still reached
    expect(openedUris()).toEqual([]);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('#balance'),
    );
  });

  it('opens nothing when the cascade could not reach the class', async () => {
    // revealClass warns and leaves state untouched when a query fails; reading
    // the method list then would read the PREVIOUS class's selectors and open a
    // method of whatever the panes were showing before.
    vi.mocked(getClassEnvironments).mockImplementation(() => {
      throw new Error('class not resolvable in that dictionary');
    });
    const ctl = makeController();

    await ctl.findClass('Account', SESSION_ID, 'Legacy', { selector: 'balance', isMeta: false });

    // The cascade was attempted and declined — asserting only that nothing
    // opened would pass just as well for a findClass that did nothing at all,
    // since a fresh controller starts with no class either way.
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('not resolvable in that dictionary'),
    );
    expect(ctl.state.className).toBeUndefined();
    expect(openedUris()).toEqual([]);
  });
});
