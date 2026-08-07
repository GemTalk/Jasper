import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  renameTemporaryDeclineReason: vi.fn(),
  getInstVarNames: vi.fn(),
  getVisibleClassVarNames: vi.fn(),
}));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { renameAtCursorCommand } from '../renameAtCursorCommand';
import type { SessionManager } from '../../sessionManager';
import type { SelectorAtPosition } from '../renameMethodAtCursorCommand';

/**
 * Drives the single "Rename…" dispatcher: it classifies what the cursor is on and
 * routes to the matching rename command. Precedence is temporary/argument FIRST
 * (offset-based, so a method-pattern argument isn't misread as a unary selector),
 * then a selector/method header, then instance variable, then class variable, then
 * a class reference; a word that is none of those declines. (See the module doc for
 * why the offset probe precedes the selector probe.)
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

const onCount = (): vscode.Position => new vscode.Position(1, 2); // `count` in the body
const noSelector: SelectorAtPosition = () => Promise.resolve(null);

/** The command id dispatched via executeCommand (or undefined if none was). */
function dispatchedCommand(): string | undefined {
  const calls = vi.mocked(vscode.commands.executeCommand).mock.calls;
  return calls.length > 0 ? calls[0][0] : undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(queries.renameTemporaryDeclineReason).mockResolvedValue('not a temporary');
  vi.mocked(queries.getInstVarNames).mockReturnValue([]);
  vi.mocked(queries.getVisibleClassVarNames).mockReturnValue([]);
});

describe('unified rename dispatcher', () => {
  it('renames the method when the cursor is on a selector or the header', async () => {
    installEditor(onCount());
    const selectorAt: SelectorAtPosition = () => Promise.resolve('scaleBy:');

    await renameAtCursorCommand(sessions, selectorAt, onCount());

    expect(dispatchedCommand()).toBe('gemstone.renameMethodInEditor');
  });

  it('renames a temporary/argument when the word is a renamable local', async () => {
    installEditor(onCount());
    vi.mocked(queries.renameTemporaryDeclineReason).mockResolvedValue(''); // it IS a temp

    await renameAtCursorCommand(sessions, noSelector, onCount());

    expect(dispatchedCommand()).toBe('gemstone.renameTemporary');
  });

  it('renames a method-pattern argument as a variable even when the AST probe calls it a selector', async () => {
    installEditor(onCount());
    vi.mocked(queries.renameTemporaryDeclineReason).mockResolvedValue(''); // it IS an argument
    // The AST-based selector probe misreads a method-pattern argument as a unary
    // selector; the offset-based temporary probe runs first and must win.
    const selectorSaysItsASelector: SelectorAtPosition = () => Promise.resolve('count');

    await renameAtCursorCommand(sessions, selectorSaysItsASelector, onCount());

    expect(dispatchedCommand()).toBe('gemstone.renameTemporary');
  });

  it('renames an instance variable when the word is one (including inherited)', async () => {
    installEditor(onCount());
    vi.mocked(queries.getInstVarNames).mockReturnValue(['count']); // inherited/own ivar

    await renameAtCursorCommand(sessions, noSelector, onCount());

    expect(dispatchedCommand()).toBe('gemstone.renameInstVarAtCursor');
  });

  it('renames a class variable when the word is one', async () => {
    installEditor(onCount());
    vi.mocked(queries.getVisibleClassVarNames).mockReturnValue(['count']);

    await renameAtCursorCommand(sessions, noSelector, onCount());

    expect(dispatchedCommand()).toBe('gemstone.renameClassVarAtCursor');
  });

  it('prefers a temporary over an instance variable of the same name (shadowing)', async () => {
    installEditor(onCount());
    vi.mocked(queries.renameTemporaryDeclineReason).mockResolvedValue(''); // a temp named count
    vi.mocked(queries.getInstVarNames).mockReturnValue(['count']); // an ivar also named count

    await renameAtCursorCommand(sessions, noSelector, onCount());

    expect(dispatchedCommand()).toBe('gemstone.renameTemporary');
  });

  it('falls through to Rename Class when the word is neither a selector nor a variable', async () => {
    installEditor(onCount()); // not a temp/ivar/classvar (all queries empty)

    await renameAtCursorCommand(sessions, noSelector, onCount());

    // The class command resolves whether it is actually a class and declines if not.
    expect(dispatchedCommand()).toBe('gemstone.renameClassAtCursor');
  });
});
