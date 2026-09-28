/**
 * The Methods pane's Remove command acts on the whole selection. VS Code hands a
 * command in a multi-select tree both the clicked row and the selection; the handler
 * passes the selection on in one call, so the removal can ask one question for all
 * of it (explorerRemoveMethods.test.ts). The context menu offering it is pinned in
 * explorerRemoveMethods.manifest.test.ts.
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

const REMOVE = 'gemstone.explorer.removeMethod';

function row(selector: string, isMeta = false): MethodItem {
  return new MethodItem(
    isMeta,
    { selector, category: 'accessing', overrideBits: 0, sessionBit: 0 },
    'accessing',
  );
}

function removeHandler(): (...a: unknown[]) => unknown {
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
    onDidRemoveSession: vi.fn(() => ({ dispose: vi.fn() })),
  } as unknown as SessionManager;
  registerGemStoneExplorer(context, sessionManager);
  const call = vi.mocked(vscode.commands.registerCommand).mock.calls.find((c) => c[0] === REMOVE);
  expect(call, `${REMOVE} has no handler`).toBeDefined();
  return call![1] as (...a: unknown[]) => unknown;
}

let removeMethods: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  __resetConfig();
  removeMethods = vi
    .spyOn(
      ExplorerController.prototype as unknown as { removeMethods: () => Promise<void> },
      'removeMethods',
    )
    .mockResolvedValue(undefined);
});

describe('the Remove Method command', () => {
  it('passes the whole selection in one call', () => {
    const [a, b, c] = [row('a'), row('b'), row('c', true)];

    removeHandler()(a, [a, b, c]);

    expect(removeMethods).toHaveBeenCalledTimes(1);
    expect(removeMethods).toHaveBeenCalledWith([a, b, c]);
  });

  it('removes just the clicked row on a one-argument call', () => {
    // The Command Palette and keybindings pass no selection.
    const a = row('a');

    removeHandler()(a);

    expect(removeMethods).toHaveBeenCalledWith([a]);
  });

  it('removes just the clicked row when it is not part of the selection', () => {
    // A trash button on a row outside the selection must not delete rows the user
    // did not click.
    const [a, b, c] = [row('a'), row('b'), row('c')];

    removeHandler()(c, [a, b]);

    expect(removeMethods).toHaveBeenCalledWith([c]);
  });

  it('ignores anything in the selection that is not a method row', () => {
    const [a, b] = [row('a'), row('b')];

    removeHandler()(a, [a, { label: 'ALL METHODS' }, b]);

    expect(removeMethods).toHaveBeenCalledWith([a, b]);
  });

  it('does nothing when handed no method row at all', () => {
    removeHandler()(undefined, []);

    expect(removeMethods).not.toHaveBeenCalled();
  });

  it('reports a removal that throws instead of dropping it', async () => {
    removeMethods.mockRejectedValue(new Error('session gone'));
    const a = row('a');

    removeHandler()(a, [a, row('b')]);

    await vi.waitFor(() =>
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('session gone'),
      ),
    );
  });
});
