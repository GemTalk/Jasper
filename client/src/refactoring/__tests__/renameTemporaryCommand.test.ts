import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  renameTemporaryDeclineReason: vi.fn(),
  startRenameTemporaryPreview: vi.fn(),
  pageRenameTemporaryPreview: vi.fn(),
  applyRenameTemporary: vi.fn(),
  clearRenameTemporaryPreview: vi.fn(),
}));
vi.mock('../renameTemporaryPanel', () => ({
  showRenameTemporaryPanel: vi.fn(),
}));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { renameTemporaryCommand } from '../renameTemporaryCommand';
import type { SessionManager } from '../../sessionManager';

/**
 * Drives the rename-temporary COMMAND itself (not the engine) so the "user is
 * always told why nothing happened" contract is pinned down: a cursor on a
 * comment / message selector / punctuation must surface a visible warning, never
 * silently return. The engine's classification is mocked; what's under test is
 * that the client SHOWS it.
 */

const SOURCE = [
  'readsCount',
  '\t"pure instance-variable read -> rename is declined"',
  '\t^count',
].join('\n');

// A minimal TextDocument over SOURCE with real offset arithmetic, addressed by a
// genuine gemstone method URI so the command's parseUri sees a method editor.
function makeDocument(): vscode.TextDocument {
  const lines = SOURCE.split('\n');
  return {
    uri: vscode.Uri.parse('gemstone://7/UserGlobals/R5Demo/instance/demo/readsCount?dict=2'),
    isDirty: false,
    getWordRangeAtPosition: (pos: vscode.Position, re: RegExp) => {
      const line = lines[pos.line] ?? '';
      const global = new RegExp(re.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = global.exec(line)) !== null) {
        if (m.index <= pos.character && pos.character < m.index + m[0].length) {
          return new vscode.Range(
            new vscode.Position(pos.line, m.index),
            new vscode.Position(pos.line, m.index + m[0].length),
          );
        }
      }
      return undefined;
    },
    getText: (range: vscode.Range) =>
      lines[range.start.line].slice(range.start.character, range.end.character),
    offsetAt: (pos: vscode.Position) =>
      lines.slice(0, pos.line).reduce((n, l) => n + l.length + 1, 0) + pos.character,
    save: vi.fn(async () => true),
  } as unknown as vscode.TextDocument;
}

function installEditor(at: vscode.Position): vscode.TextDocument {
  const document = makeDocument();
  (vscode.window as unknown as Record<string, unknown>).activeTextEditor = {
    document,
    selection: { active: at },
    viewColumn: 1,
  };
  return document;
}

const sessions = {
  getSession: () => ({ id: 7, rbSupportAvailable: true }),
} as unknown as SessionManager;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('rename-temporary command decline feedback', () => {
  it('shows the engine reason as a warning when the target is not a renamable local', async () => {
    installEditor(new vscode.Position(2, 2)); // on `count` (an instance variable)
    const reason =
      "'count' is an instance variable of R5Demo, not a temporary or argument. Use Rename Instance Variable to rename it everywhere it is used.";
    vi.mocked(queries.renameTemporaryDeclineReason).mockResolvedValue(reason);

    await renameTemporaryCommand(sessions);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(reason);
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
  });

  it('warns to place the cursor on a variable when the position is not on an identifier', async () => {
    installEditor(new vscode.Position(2, 0)); // on the tab before ^count

    await renameTemporaryCommand(sessions);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Place the cursor on a temporary or argument'),
    );
    expect(queries.renameTemporaryDeclineReason).not.toHaveBeenCalled();
  });

  it('renames the token at the code-action position, not the editor selection', async () => {
    installEditor(new vscode.Position(0, 0)); // selection parked on the selector line
    vi.mocked(queries.renameTemporaryDeclineReason).mockResolvedValue('some reason');

    await renameTemporaryCommand(sessions, new vscode.Position(2, 2)); // action on `count`

    expect(queries.renameTemporaryDeclineReason).toHaveBeenCalledWith(
      expect.anything(),
      'R5Demo',
      'readsCount',
      false,
      'count',
      expect.any(Number),
      expect.anything(),
    );
  });

  it('proceeds to the new-name prompt when the engine reports the target renamable', async () => {
    installEditor(new vscode.Position(2, 2));
    vi.mocked(queries.renameTemporaryDeclineReason).mockResolvedValue('');
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined); // user cancels

    await renameTemporaryCommand(sessions);

    expect(vscode.window.showInputBox).toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });
});
