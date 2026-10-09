/**
 * The Methods pane's two removal gestures. VS Code hands a command in a multi-select
 * tree both the clicked row and the selection, whichever way it was invoked, so the
 * two are separate commands:
 *
 * - the row's inline 🗑 (`removeMethod`) removes THAT row, even when it is one of
 *   several selected -- a button drawn on one row must not reach the others;
 * - **Remove…** on the context menu (`removeMethods`) removes the selection in one
 *   call, so the removal can ask one question for all of it
 *   (explorerRemoveMethods.test.ts).
 *
 * Where each is contributed is pinned in explorerRemoveMethods.manifest.test.ts.
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
import type { SessionManager, ActiveSession } from '../../sessionManager';

const REMOVE_ROW = 'gemstone.explorer.removeMethod';
const REMOVE_SELECTION = 'gemstone.explorer.removeMethods';

function row(selector: string, isMeta = false): MethodItem {
  return new MethodItem(
    isMeta,
    { selector, category: 'accessing', overrideBits: 0, sessionBit: 0 },
    'accessing',
  );
}

function handler(command: string): (...a: unknown[]) => unknown {
  vi.mocked(vscode.window.createTreeView).mockImplementation(
    () =>
      ({
        onDidChangeVisibility: vi.fn(),
        onDidChangeCheckboxState: vi.fn(),
        onDidChangeSelection: vi.fn(),
        onDidCollapseElement: vi.fn(),
        onDidExpandElement: vi.fn(),
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
    onDidRemoveSession: vi.fn(() => ({ dispose: vi.fn() })),
  } as unknown as SessionManager;
  registerGemStoneExplorer(context, sessionManager);
  const call = vi.mocked(vscode.commands.registerCommand).mock.calls.find((c) => c[0] === command);
  expect(call, `${command} has no handler`).toBeDefined();
  return call![1] as (...a: unknown[]) => unknown;
}

let removeMethod: ReturnType<typeof vi.fn>;
let removeMethods: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  __resetConfig();
  removeMethod = vi
    .spyOn(ExplorerController.prototype, 'removeMethod')
    .mockResolvedValue(undefined);
  removeMethods = vi
    .spyOn(ExplorerController.prototype, 'removeMethods')
    .mockResolvedValue(undefined);
});

describe("the row's trash button", () => {
  it('removes its own row, and only that row, when several are selected', () => {
    // Clicking the trash on one of four selected rows is about that row.
    const [a, b, c, d] = [row('addMember:'), row('lead'), row('members'), row('name')];

    handler(REMOVE_ROW)(a, [a, b, c, d]);

    expect(removeMethod).toHaveBeenCalledTimes(1);
    expect(removeMethod).toHaveBeenCalledWith(a);
    expect(removeMethods).not.toHaveBeenCalled();
  });

  it('removes its own row when it is not part of the selection', () => {
    const [a, b, c] = [row('a'), row('b'), row('c')];

    handler(REMOVE_ROW)(c, [a, b]);

    expect(removeMethod).toHaveBeenCalledWith(c);
    expect(removeMethods).not.toHaveBeenCalled();
  });

  it('removes its own row with nothing else selected', () => {
    const a = row('a');

    handler(REMOVE_ROW)(a, [a]);

    expect(removeMethod).toHaveBeenCalledWith(a);
  });

  it('does nothing when handed no method row', () => {
    handler(REMOVE_ROW)(undefined, [row('a')]);

    expect(removeMethod).not.toHaveBeenCalled();
    expect(removeMethods).not.toHaveBeenCalled();
  });

  it('reports a removal that throws instead of dropping it', async () => {
    removeMethod.mockRejectedValue(new Error('session gone'));

    handler(REMOVE_ROW)(row('a'));

    await vi.waitFor(() =>
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('session gone'),
      ),
    );
  });
});

describe('Remove… on the context menu', () => {
  it('passes the whole selection in one call', () => {
    const [a, b, c] = [row('a'), row('b'), row('c', true)];

    handler(REMOVE_SELECTION)(a, [a, b, c]);

    expect(removeMethods).toHaveBeenCalledTimes(1);
    expect(removeMethods).toHaveBeenCalledWith([a, b, c]);
    expect(removeMethod).not.toHaveBeenCalled();
  });

  it('removes just the clicked row on a one-argument call', () => {
    const a = row('a');

    handler(REMOVE_SELECTION)(a);

    expect(removeMethods).toHaveBeenCalledWith([a]);
  });

  it('removes just the right-clicked row when it is not part of the selection', () => {
    // VS Code right-clicks a row outside the selection without selecting it.
    const [a, b, c] = [row('a'), row('b'), row('c')];

    handler(REMOVE_SELECTION)(c, [a, b]);

    expect(removeMethods).toHaveBeenCalledWith([c]);
  });

  it('ignores anything in the selection that is not a method row', () => {
    const [a, b] = [row('a'), row('b')];

    handler(REMOVE_SELECTION)(a, [a, { label: 'ALL METHODS' }, b]);

    expect(removeMethods).toHaveBeenCalledWith([a, b]);
  });

  it('does nothing when handed no method row at all', () => {
    handler(REMOVE_SELECTION)(undefined, []);

    expect(removeMethods).not.toHaveBeenCalled();
  });

  it('reports a removal that throws instead of dropping it', async () => {
    removeMethods.mockRejectedValue(new Error('session gone'));
    const a = row('a');

    handler(REMOVE_SELECTION)(a, [a, row('b')]);

    await vi.waitFor(() =>
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('session gone'),
      ),
    );
  });
});
