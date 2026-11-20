/**
 * A click on a dictionary row must reach the Explorer even when VS Code reports no selection
 * change. A click refused while a run holds the session, with no dictionary selected before
 * it, leaves the clicked row highlighted and nothing selected; clicking that row again moves
 * no highlight, so only the row's own click command can carry the retry.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  getDictionaryNames: vi.fn(() => ['UserGlobals', 'Globals']),
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
import { DictItem, ExplorerController, registerGemStoneExplorer } from '../../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../../sessionManager';

const DICT_CLICKED = 'gemstone.explorer.dictClicked';

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

let selectDictFromTree: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  __resetConfig();
  selectDictFromTree = vi
    .spyOn(ExplorerController.prototype, 'selectDictFromTree')
    .mockResolvedValue(undefined);
});

describe('a dictionary row', () => {
  it('reports every click on it, including one on the row already highlighted', () => {
    const row = new DictItem('Globals', 2);

    expect(row.command).toMatchObject({ command: DICT_CLICKED, arguments: [row] });
  });
});

describe('clicking a dictionary row', () => {
  it('selects that dictionary', () => {
    const row = new DictItem('Globals', 2);

    handler(DICT_CLICKED)(row);

    expect(selectDictFromTree).toHaveBeenCalledWith(row);
  });

  it('does nothing when it is not given a dictionary row', () => {
    handler(DICT_CLICKED)(undefined);

    expect(selectDictFromTree).not.toHaveBeenCalled();
  });
});
