import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  getDefinedInstVarNames: vi.fn(),
  getInstVarNames: vi.fn(),
  getDefiningClassOfInstVar: vi.fn(),
}));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { renameInstVarAtCursorCommand } from '../renameInstVarAtCursorCommand';
import type { SessionManager } from '../../sessionManager';

/**
 * Drives the editor-triggered rename-instance-variable command so its contract is
 * pinned down: a defined ivar starts the shared rename flow directly; an inherited
 * ivar is not a dead-end — after a one-line confirm it retargets the rename to the
 * defining class (across that hierarchy); only a word that is not a visible ivar at
 * all declines, pointing at the temp/arg rename.
 */

const SOURCE = ['scaleBy: aFactor', '\t^count * aFactor'].join('\n');

function makeDocument(): vscode.TextDocument {
  const lines = SOURCE.split('\n');
  return {
    uri: vscode.Uri.parse('gemstone://7/UserGlobals/R5Demo/instance/demo/scaleBy%3A?dict=2'),
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
  } as unknown as vscode.TextDocument;
}

function installEditor(at: vscode.Position): void {
  (vscode.window as unknown as Record<string, unknown>).activeTextEditor = {
    document: makeDocument(),
    selection: { active: at },
    viewColumn: 1,
  };
}

const sessions = {
  getSession: () => ({ id: 7, rbSupportAvailable: true }),
} as unknown as SessionManager;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(queries.getDefinedInstVarNames).mockReturnValue(['count', 'total']);
  vi.mocked(queries.getInstVarNames).mockReturnValue(['count', 'total', 'inherited1']);
  vi.mocked(queries.getDefiningClassOfInstVar).mockReturnValue({
    className: 'BaseDemo',
    dictIndex: 2,
  });
});

describe('rename-instance-variable at cursor', () => {
  it('starts the shared rename flow for an instance variable defined on the class', async () => {
    installEditor(new vscode.Position(1, 2)); // on `count`
    const beginRename = vi.fn(async () => false);

    await renameInstVarAtCursorCommand(sessions, beginRename);

    expect(beginRename).toHaveBeenCalledWith({
      className: 'R5Demo',
      ivarName: 'count',
      dict: 2,
    });
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('retargets an inherited instance variable to its defining class once confirmed', async () => {
    installEditor(new vscode.Position(1, 2)); // on `count`, not defined on this class
    vi.mocked(queries.getDefinedInstVarNames).mockReturnValue(['total']);
    vi.mocked(queries.getDefiningClassOfInstVar).mockReturnValue({
      className: 'BaseDemo',
      dictIndex: 5,
    });
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(
      'Rename on BaseDemo…' as unknown as vscode.MessageItem,
    );
    const beginRename = vi.fn(async () => false);

    await renameInstVarAtCursorCommand(sessions, beginRename);

    expect(beginRename).toHaveBeenCalledWith({
      className: 'BaseDemo',
      ivarName: 'count',
      dict: 5,
    });
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('does not rename when the retarget confirm is dismissed', async () => {
    installEditor(new vscode.Position(1, 2));
    vi.mocked(queries.getDefinedInstVarNames).mockReturnValue(['total']);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined); // dismissed
    const beginRename = vi.fn(async () => false);

    await renameInstVarAtCursorCommand(sessions, beginRename);

    expect(beginRename).not.toHaveBeenCalled();
  });

  it('declines, without even asking to confirm, when the inherited defining class is not uniquely bound by name', async () => {
    // dictIndex 0: the defining class was reached by the superclass walk but isn't
    // bound under its own name, so there is no identity-safe handle. Resolving it by
    // name in the SUBCLASS's dictionary could land on a different class of the same
    // name and rename the wrong one — so the command must stop, not guess.
    installEditor(new vscode.Position(1, 2));
    vi.mocked(queries.getDefinedInstVarNames).mockReturnValue(['total']);
    vi.mocked(queries.getDefiningClassOfInstVar).mockReturnValue({
      className: 'BaseDemo',
      dictIndex: 0,
    });
    const beginRename = vi.fn(async () => false);

    await renameInstVarAtCursorCommand(sessions, beginRename);

    expect(beginRename).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled(); // refuses before the retarget confirm
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("isn't uniquely bound by name"),
    );
  });

  it('declines an inherited instance variable whose defining class cannot be resolved', async () => {
    installEditor(new vscode.Position(1, 2));
    vi.mocked(queries.getDefinedInstVarNames).mockReturnValue(['total']);
    vi.mocked(queries.getDefiningClassOfInstVar).mockReturnValue(undefined);
    const beginRename = vi.fn(async () => false);

    await renameInstVarAtCursorCommand(sessions, beginRename);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('could not be resolved'),
    );
    expect(beginRename).not.toHaveBeenCalled();
  });

  it('declines a word that is not an instance variable, suggesting the temp/arg rename', async () => {
    installEditor(new vscode.Position(0, 12)); // on the argument `aFactor`
    const beginRename = vi.fn(async () => false);

    await renameInstVarAtCursorCommand(sessions, beginRename);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('not an instance variable'),
    );
    expect(beginRename).not.toHaveBeenCalled();
  });

  it('warns to place the cursor on a variable when the position is not on an identifier', async () => {
    installEditor(new vscode.Position(1, 0)); // on the tab

    await renameInstVarAtCursorCommand(
      sessions,
      vi.fn(async () => false),
    );

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Place the cursor on an instance variable'),
    );
  });

  it('renames the token at the code-action position, not the editor selection', async () => {
    installEditor(new vscode.Position(0, 0)); // selection parked on the selector
    const beginRename = vi.fn(async () => false);

    await renameInstVarAtCursorCommand(sessions, beginRename, new vscode.Position(1, 2));

    expect(beginRename).toHaveBeenCalledWith(expect.objectContaining({ ivarName: 'count' }));
  });

  // The editor-resolution guards live in the shared renameAtCursorShared helper;
  // exercising them through this command covers all four cursor commands.
  it('declines when there is no active editor', async () => {
    (vscode.window as unknown as Record<string, unknown>).activeTextEditor = undefined;
    const beginRename = vi.fn(async () => false);

    await renameInstVarAtCursorCommand(sessions, beginRename);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Open a GemStone method'),
    );
    expect(beginRename).not.toHaveBeenCalled();
  });

  it('declines when the active editor is not a gemstone method URI', async () => {
    (vscode.window as unknown as Record<string, unknown>).activeTextEditor = {
      document: { uri: vscode.Uri.parse('gemstone://7/UserGlobals/R5Demo/definition/R5Demo') },
      selection: { active: new vscode.Position(0, 0) },
    };
    const beginRename = vi.fn(async () => false);

    await renameInstVarAtCursorCommand(sessions, beginRename);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('method source editor'),
    );
    expect(beginRename).not.toHaveBeenCalled();
  });

  it('declines when no session backs the editor', async () => {
    installEditor(new vscode.Position(1, 2));
    const noSession = { getSession: () => undefined } as unknown as SessionManager;
    const beginRename = vi.fn(async () => false);

    await renameInstVarAtCursorCommand(noSession, beginRename);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('No GemStone session'),
    );
    expect(beginRename).not.toHaveBeenCalled();
  });

  it('stops with a retry warning when the membership pre-check query throws — never renames against an unverified class', async () => {
    // A probe failure leaves the defined/inherited classification unknown. Falling
    // through to rename the cursor's class would, for an inherited ivar, stage a
    // reference rewrite on a class that doesn't declare it — a broken method. So a
    // throw must stop with a retry message, not proceed.
    installEditor(new vscode.Position(1, 2)); // on `count`
    vi.mocked(queries.getDefinedInstVarNames).mockImplementation(() => {
      throw new Error('GCI hiccup');
    });
    const beginRename = vi.fn(async () => false);

    await renameInstVarAtCursorCommand(sessions, beginRename);

    expect(beginRename).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('a stone query failed'),
    );
  });

  it('reloads and refocuses the method editor after an applied rename', async () => {
    installEditor(new vscode.Position(1, 2)); // on `count`
    const beginRename = vi.fn(async () => true); // applied

    await renameInstVarAtCursorCommand(sessions, beginRename);

    expect(vscode.window.showTextDocument).toHaveBeenCalled();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.files.revert');
  });
});
