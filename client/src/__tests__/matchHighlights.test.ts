/**
 * Showing a regex search's matches in the editor a hit opens in: the first selected, all marked,
 * the marks cleared by the first edit. Matches across a line break are checked throughout, since a
 * whole-method pattern (one with \n) produces them.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { firstMatchSelection, fittingMatches, markMatches } from '../matchHighlights';

/** A document over `text` whose positionAt maps offsets to line/character as VS Code does. */
function doc(text: string, uri = 'gemstone://1/UserGlobals/Foo/instance/x/bar') {
  return {
    uri: { toString: () => uri },
    getText: () => text,
    positionAt(offset: number) {
      const before = text.slice(0, offset);
      const line = before.split('\n').length - 1;
      return new vscode.Position(line, offset - (before.lastIndexOf('\n') + 1));
    },
  } as unknown as vscode.TextDocument;
}

function editorOn(d: vscode.TextDocument) {
  const setDecorations = vi.fn();
  return {
    editor: { document: d, setDecorations } as unknown as vscode.TextEditor,
    setDecorations,
  };
}

const SOURCE = 'bar\n  ^self at: 1\n    put: 2';
const AT = SOURCE.indexOf('at:');
const PUT_END = SOURCE.indexOf('put:') + 4;

describe('fittingMatches', () => {
  it('keeps matches that fit, in order', () => {
    expect(
      fittingMatches(doc(SOURCE), [
        { start: 0, end: 3 },
        { start: AT, end: PUT_END },
      ]),
    ).toEqual([
      { start: 0, end: 3 },
      { start: AT, end: PUT_END },
    ]);
  });

  it('drops a match past the end of a method edited since the search, an empty one and an overlap', () => {
    expect(
      fittingMatches(doc(SOURCE), [
        { start: 2, end: 2 },
        { start: 0, end: 3 },
        { start: 1, end: 4 },
        { start: 5, end: SOURCE.length + 1 },
      ]),
    ).toEqual([{ start: 0, end: 3 }]);
  });

  it('answers none for none', () => {
    expect(fittingMatches(doc(SOURCE), undefined)).toEqual([]);
  });
});

describe('firstMatchSelection', () => {
  it('selects the first match', () => {
    const sel = firstMatchSelection(doc(SOURCE), [
      { start: 0, end: 3 },
      { start: AT, end: AT + 3 },
    ]);

    expect([sel?.start.line, sel?.start.character, sel?.end.line, sel?.end.character]).toEqual([
      0, 0, 0, 3,
    ]);
  });

  it('selects a match that runs across a line break, from its line to the next', () => {
    const sel = firstMatchSelection(doc(SOURCE), [{ start: AT, end: PUT_END }]);

    expect([sel?.start.line, sel?.start.character]).toEqual([1, 8]);
    expect([sel?.end.line, sel?.end.character]).toEqual([2, 8]);
  });

  it('selects nothing when no match fits', () => {
    expect(firstMatchSelection(doc(SOURCE), [{ start: 0, end: 999 }])).toBeUndefined();
    expect(firstMatchSelection(doc(SOURCE), undefined)).toBeUndefined();
  });
});

describe('markMatches', () => {
  it('marks every match, including one across a line break', () => {
    const { editor, setDecorations } = editorOn(doc(SOURCE));

    markMatches(editor, [
      { start: 0, end: 3 },
      { start: AT, end: PUT_END },
    ]);

    const ranges = setDecorations.mock.calls[0][1] as vscode.Range[];
    expect(
      ranges.map((r) => [r.start.line, r.start.character, r.end.line, r.end.character]),
    ).toEqual([
      [0, 0, 0, 3],
      [1, 8, 2, 8],
    ]);
  });

  it('clears the marks on the first edit to the document, not on an unrelated one', async () => {
    // A fresh copy of the module, so its once-per-session edit listener is registered here.
    vi.resetModules();
    const fresh = await import('../matchHighlights.js');
    const registered = vi.mocked(vscode.workspace.onDidChangeTextDocument);
    const callsBefore = registered.mock.calls.length;
    const d = doc(SOURCE, 'gemstone://1/marked');
    const { editor, setDecorations } = editorOn(d);
    (vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = [editor];

    fresh.markMatches(editor, [{ start: 0, end: 3 }]);
    const listener = registered.mock.calls[callsBefore][0] as unknown as (e: {
      document: vscode.TextDocument;
      contentChanges: unknown[];
    }) => void;
    setDecorations.mockClear();

    listener({ document: doc('x', 'gemstone://1/other'), contentChanges: [{}] });
    expect(setDecorations).not.toHaveBeenCalled();

    listener({ document: d, contentChanges: [{}] });
    expect(setDecorations).toHaveBeenCalledWith(expect.anything(), []);
  });
});
