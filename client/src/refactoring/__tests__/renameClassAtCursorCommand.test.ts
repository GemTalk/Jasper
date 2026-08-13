import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  resolveClassReference: vi.fn(),
}));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { renameClassAtCursorCommand } from '../renameClassAtCursorCommand';
import type { SessionManager } from '../../sessionManager';

/**
 * Drives the editor-triggered rename-class command: on a token that resolves to a
 * class it starts the shared class-rename flow with that class and its binding
 * dictionary; on a plain global/shared variable (or an unbound name) it declines.
 */

const SOURCE = ['withParents', '\t^ super withParents addFirst: (Path root); yourself'].join('\n');

function makeDocument(): vscode.TextDocument {
  const lines = SOURCE.split('\n');
  return {
    uri: vscode.Uri.parse('gemstone://7/Globals/AbsolutePath/instance/enumerating/withParents'),
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

const onPath = (): vscode.Position => new vscode.Position(1, 33); // inside `Path`

beforeEach(() => {
  vi.clearAllMocks();
});

describe('rename-class at cursor', () => {
  it('starts the class-rename flow for a token that resolves to a class', async () => {
    installEditor(onPath());
    vi.mocked(queries.resolveClassReference).mockReturnValue({ className: 'Path', dictIndex: 2 });
    const beginRename = vi.fn(async () => undefined);

    await renameClassAtCursorCommand(sessions, beginRename, onPath());

    expect(beginRename).toHaveBeenCalledWith({ className: 'Path', dict: 2 });
  });

  it('resolves across the whole symbol list when the class is not bound by name', async () => {
    installEditor(onPath());
    vi.mocked(queries.resolveClassReference).mockReturnValue({ className: 'Path', dictIndex: 0 });
    const beginRename = vi.fn(async () => undefined);

    await renameClassAtCursorCommand(sessions, beginRename, onPath());

    expect(beginRename).toHaveBeenCalledWith({ className: 'Path', dict: undefined });
  });

  it('declines a token that is not a class', async () => {
    installEditor(onPath());
    vi.mocked(queries.resolveClassReference).mockReturnValue(undefined);
    const beginRename = vi.fn(async () => undefined);

    await renameClassAtCursorCommand(sessions, beginRename, onPath());

    expect(beginRename).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("isn't a class"),
    );
  });
});
