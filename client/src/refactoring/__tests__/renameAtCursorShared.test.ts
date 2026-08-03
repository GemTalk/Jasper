import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { wordAt, MethodEditorTarget } from '../renameAtCursorShared';

/**
 * The shared editor→target plumbing. Focus here is the one subtle bit: `wordAt`
 * must produce a 1-based CHARACTER (code-point) offset — what the engine indexes
 * the stored source by — not a UTF-16 code-unit offset, so a non-BMP character
 * before the cursor doesn't shift the offset by one per astral char. The editor
 * guards themselves are exercised through the four cursor-command tests.
 */

// A faithful multi-line document over `text`: line/character positions are UTF-16
// (as VS Code uses), getText(range) slices the real string, and
// getWordRangeAtPosition finds the identifier covering the position on its line.
function docOver(text: string): vscode.TextDocument {
  const lines = text.split('\n');
  const utf16Offset = (p: vscode.Position): number =>
    lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
  return {
    getText: (range?: vscode.Range) =>
      range ? text.slice(utf16Offset(range.start), utf16Offset(range.end)) : text,
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
  } as unknown as vscode.TextDocument;
}

function targetOver(text: string, at: vscode.Position): MethodEditorTarget {
  return {
    editor: { document: docOver(text) },
    at,
  } as unknown as MethodEditorTarget;
}

describe('wordAt source offset', () => {
  it('gives the 1-based character offset of an ASCII identifier', () => {
    // "computeTemp | t | t := 1" — the first `t := 1` occurrence.
    const text = 'computeTemp | t | t := 1. ^t';
    const at = new vscode.Position(0, text.indexOf('t := 1'));

    const word = wordAt(targetOver(text, at), 'a temporary');

    expect(word?.name).toBe('t');
    expect(word?.offset).toBe(text.indexOf('t := 1') + 1); // ASCII: char offset == index
  });

  it('counts code points, not UTF-16 units, when a non-BMP char precedes the cursor', () => {
    // A target emoji (🎯: one code point, two UTF-16 units) sits in the comment
    // before the `total` reference, so the character offset the engine wants is one
    // LESS than VS Code's UTF-16 offset.
    const text = 'foo\n\t"🎯 aim"\n\t^total';
    const line2 = '\t^total';
    const at = new vscode.Position(2, line2.indexOf('total'));

    const word = wordAt(targetOver(text, at), 'a temporary');

    expect(word?.name).toBe('total');
    // Code points before `total`: "foo"(3)+nl(1) + tab"🎯 aim"(8)+nl(1) + tab^(2) = 15.
    expect(word?.offset).toBe(16);
    // The UTF-16 offset would be 17 (the emoji counts as 2) — the bug this guards.
    const utf16 = text.indexOf('total') /* JS indexOf is UTF-16 */ + 1;
    expect(utf16).toBe(17);
  });

  it('refuses (returns undefined) when the position is not on an identifier', () => {
    const text = '\t^count';
    const word = wordAt(targetOver(text, new vscode.Position(0, 0)), 'a temporary');

    expect(word).toBeUndefined();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Place the cursor on a temporary'),
    );
  });
});
