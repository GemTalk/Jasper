import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  getDefinedClassVarNames: vi.fn(),
  getVisibleClassVarNames: vi.fn(),
}));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { renameClassVarAtCursorCommand } from '../renameClassVarAtCursorCommand';
import type { SessionManager } from '../../sessionManager';

/**
 * Drives the editor-triggered rename-class-variable command: a class variable
 * declared on the class starts the shared rename flow; a visible-but-inherited
 * one or a non-class-var word declines with a warning that says what the word
 * actually is — the same simple-but-polite contract as the instance-variable and
 * temp/arg commands.
 */

const SOURCE = ['bumpRegistry', '\tRegistry := (Registry ifNil: [0]) + count'].join('\n');

function makeDocument(): vscode.TextDocument {
  const lines = SOURCE.split('\n');
  return {
    uri: vscode.Uri.parse('gemstone://7/UserGlobals/R5Demo/instance/demo/bumpRegistry?dict=2'),
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
  vi.mocked(queries.getDefinedClassVarNames).mockReturnValue(['Registry']);
  vi.mocked(queries.getVisibleClassVarNames).mockReturnValue(['Registry', 'SharedDefault']);
});

describe('rename-class-variable at cursor', () => {
  it('starts the shared rename flow for a class variable declared on the class', async () => {
    installEditor(new vscode.Position(1, 2)); // on `Registry`
    const beginRename = vi.fn(async () => false);

    await renameClassVarAtCursorCommand(sessions, beginRename);

    expect(beginRename).toHaveBeenCalledWith({
      className: 'R5Demo',
      classVarName: 'Registry',
      dict: 2,
    });
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('declines an inherited class variable, pointing at the defining class', async () => {
    installEditor(new vscode.Position(1, 2));
    vi.mocked(queries.getDefinedClassVarNames).mockReturnValue([]); // declared on a superclass
    const beginRename = vi.fn(async () => false);

    await renameClassVarAtCursorCommand(sessions, beginRename);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('INHERITED'),
    );
    expect(beginRename).not.toHaveBeenCalled();
  });

  it('declines a word that is not a class variable, pointing at the other renames', async () => {
    installEditor(new vscode.Position(1, 40)); // on `count` (an ivar, not a class var)
    const beginRename = vi.fn(async () => false);

    await renameClassVarAtCursorCommand(sessions, beginRename);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('not a class variable'),
    );
    expect(beginRename).not.toHaveBeenCalled();
  });

  it('warns to place the cursor on a variable when the position is not on an identifier', async () => {
    installEditor(new vscode.Position(1, 0)); // on the tab

    await renameClassVarAtCursorCommand(
      sessions,
      vi.fn(async () => false),
    );

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Place the cursor on a class variable'),
    );
  });

  it('renames the token at the code-action position, not the editor selection', async () => {
    installEditor(new vscode.Position(0, 0)); // selection parked on the selector
    const beginRename = vi.fn(async () => false);

    await renameClassVarAtCursorCommand(sessions, beginRename, new vscode.Position(1, 2));

    expect(beginRename).toHaveBeenCalledWith(expect.objectContaining({ classVarName: 'Registry' }));
  });

  it('still starts the rename when the membership pre-check query throws (non-fatal)', async () => {
    installEditor(new vscode.Position(1, 2)); // on `Registry`
    vi.mocked(queries.getDefinedClassVarNames).mockImplementation(() => {
      throw new Error('GCI hiccup');
    });
    const beginRename = vi.fn(async () => false);

    await renameClassVarAtCursorCommand(sessions, beginRename);

    expect(beginRename).toHaveBeenCalledWith(expect.objectContaining({ classVarName: 'Registry' }));
  });

  it('reloads and refocuses the method editor after an applied rename', async () => {
    installEditor(new vscode.Position(1, 2)); // on `Registry`
    const beginRename = vi.fn(async () => true); // applied

    await renameClassVarAtCursorCommand(sessions, beginRename);

    expect(vscode.window.showTextDocument).toHaveBeenCalled();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.files.revert');
  });
});
