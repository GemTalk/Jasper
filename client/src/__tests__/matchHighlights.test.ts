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
    uri: vscode.Uri.parse(uri),
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
    editor: {
      document: d,
      setDecorations,
      selection: undefined,
      revealRange: vi.fn(),
    } as unknown as vscode.TextEditor,
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

describe('showMatches', () => {
  /** A fresh module, so its once-per-session re-show listener is registered by this test. */
  async function freshWithListener() {
    vi.resetModules();
    const fresh = await import('../matchHighlights.js');
    const registered = vi.mocked(vscode.window.onDidChangeActiveTextEditor);
    const before = registered.mock.calls.length;
    return {
      fresh,
      reshow: (ed: vscode.TextEditor) =>
        (registered.mock.calls[before][0] as unknown as (e: vscode.TextEditor) => void)(ed),
    };
  }
  const sel = (ed: vscode.TextEditor) => {
    const s = ed.selection as vscode.Selection | undefined;
    return s && [s.start.line, s.start.character, s.end.line, s.end.character];
  };

  it('selects and reveals the first match, and marks them all', async () => {
    const { fresh } = await freshWithListener();
    const { editor, setDecorations } = editorOn(doc(SOURCE));

    fresh.showMatches(editor, [{ start: AT, end: PUT_END }]);

    expect(sel(editor)).toEqual([1, 8, 2, 8]);
    expect(vi.mocked(editor.revealRange)).toHaveBeenCalled();
    expect(setDecorations).toHaveBeenCalled();
  });

  // The GemStone Explorer, following the open to a method it was not showing, opens that method
  // itself, and VS Code hands the document a new editor with neither.
  it('applies them again when the document is re-shown in a new editor soon after', async () => {
    const { fresh, reshow } = await freshWithListener();
    const d = doc(SOURCE, 'gemstone://1/reshown');
    fresh.showMatches(editorOn(d).editor, [{ start: AT, end: PUT_END }]);
    const { editor: replacement, setDecorations } = editorOn(d);

    reshow(replacement);

    expect(sel(replacement)).toEqual([1, 8, 2, 8]);
    expect(setDecorations).toHaveBeenCalled();
  });

  // The Explorer reopens the method under its own form of the URI, with the dictionary's position,
  // so the replacement is a different document of the same method.
  it('applies them again to the same method reopened under another form of its URI', async () => {
    const { fresh, reshow } = await freshWithListener();
    const fromSearch = 'gemstone://1/Globals/Foo/class/Cache%20Stats/bar';
    fresh.showMatches(editorOn(doc(SOURCE, fromSearch)).editor, [{ start: 0, end: 3 }]);
    const fromExplorer = editorOn(doc(SOURCE, `${fromSearch}?dict=2`)).editor;
    const otherMethod = editorOn(
      doc(SOURCE, 'gemstone://1/Globals/Foo/class/Cache%20Stats/baz'),
    ).editor;

    reshow(otherMethod);
    reshow(fromExplorer);

    expect(otherMethod.selection).toBeUndefined();
    expect(sel(fromExplorer)).toEqual([0, 0, 0, 3]);
  });

  it('applies them to a new editor that only becomes visible, not active', async () => {
    vi.resetModules();
    const fresh = await import('../matchHighlights.js');
    const visible = vi.mocked(vscode.window.onDidChangeVisibleTextEditors);
    const before = visible.mock.calls.length;
    const d = doc(SOURCE, 'gemstone://1/visible');
    fresh.showMatches(editorOn(d).editor, [{ start: 0, end: 3 }]);
    const replacement = editorOn(d).editor;

    (visible.mock.calls[before][0] as unknown as (eds: vscode.TextEditor[]) => void)([replacement]);

    expect(sel(replacement)).toEqual([0, 0, 0, 3]);
  });

  it('leaves another document, and a re-show after the window, alone', async () => {
    vi.useFakeTimers();
    try {
      const { fresh, reshow } = await freshWithListener();
      const d = doc(SOURCE, 'gemstone://1/late');
      fresh.showMatches(editorOn(d).editor, [{ start: 0, end: 3 }]);
      const other = editorOn(doc(SOURCE, 'gemstone://1/other')).editor;
      reshow(other);
      expect(other.selection).toBeUndefined();

      vi.advanceTimersByTime(fresh.RESHOW_WINDOW_MS + 1);
      const late = editorOn(d).editor;
      reshow(late);
      expect(late.selection).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('methodKey', () => {
  const key = (u: string) => {
    return import('../matchHighlights.js').then((m) => m.methodKey(vscode.Uri.parse(u)));
  };

  it('is the same for one method whatever form its URI takes, and differs between methods', async () => {
    const base = 'gemstone://1/Globals/Foo/instance/accessing/bar';
    expect(await key(`${base}?dict=2`)).toBe(await key(base));
    expect(await key('gemstone://1/Globals/Foo/class/accessing/bar')).not.toBe(await key(base));
    expect(await key('gemstone://1/Globals/Foo/instance/accessing/baz')).not.toBe(await key(base));
    expect(await key('gemstone://2/Globals/Foo/instance/accessing/bar')).not.toBe(await key(base));
  });
});
