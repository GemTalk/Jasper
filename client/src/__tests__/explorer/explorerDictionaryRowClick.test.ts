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

import { __resetConfig } from '../../__mocks__/vscode';
import { DictItem, ExplorerController } from '../../gemstoneExplorer';
import { registeredExplorerCommand } from '../helpers/explorerCommands';

const DICT_CLICKED = 'gemstone.explorer.dictClicked';

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

    registeredExplorerCommand(DICT_CLICKED)(row);

    expect(selectDictFromTree).toHaveBeenCalledWith(row);
  });

  it('does nothing when it is not given a dictionary row', () => {
    registeredExplorerCommand(DICT_CLICKED)(undefined);

    expect(selectDictFromTree).not.toHaveBeenCalled();
  });
});
