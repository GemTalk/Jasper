import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../browserQueries', () => ({
  getStepPointSelectorRanges: vi.fn(() => []),
  setBreakAtStepPoint: vi.fn(),
  clearBreakAtStepPoint: vi.fn(),
  clearAllBreaks: vi.fn(),
}));

import { Uri, window } from '../__mocks__/vscode';
import type * as vscode from 'vscode';
import {
  SelectorBreakpointManager,
  findNearestStepPoint,
  expandKeywordParts,
} from '../selectorBreakpointManager';
import { SessionManager } from '../sessionManager';
import {
  getStepPointSelectorRanges,
  setBreakAtStepPoint,
  clearBreakAtStepPoint,
  StepPointSelectorInfo,
} from '../browserQueries';

const mockGetRanges = vi.mocked(getStepPointSelectorRanges);
const mockSetBreak = vi.mocked(setBreakAtStepPoint);
const mockClearBreak = vi.mocked(clearBreakAtStepPoint);

function makeSessionManager(hasSession: boolean) {
  return {
    getSelectedSession: vi.fn(() =>
      hasSession
        ? { id: 1, gci: {}, handle: 'h1', login: { label: 'Test' }, stoneVersion: '3.7.2' }
        : undefined,
    ),
    onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
  } as unknown as SessionManager;
}

function makeEditor(uriStr: string, source: string) {
  const uri = Uri.parse(uriStr);
  return {
    document: {
      uri,
      getText: vi.fn(() => source),
      offsetAt: vi.fn((pos: { line: number; character: number }) => {
        // Simple: each line is 20 chars + newline
        return pos.line * 21 + pos.character;
      }),
      positionAt: vi.fn((offset: number) => ({
        line: Math.floor(offset / 21),
        character: offset % 21,
      })),
    },
    selection: {
      active: { line: 0, character: 5 },
    },
    setDecorations: vi.fn(),
  } as unknown as vscode.TextEditor & {
    document: { offsetAt: Mock };
    setDecorations: Mock;
  };
}

// ── findNearestStepPoint ──────────────────────────────────

describe('findNearestStepPoint', () => {
  it('returns null for empty list', () => {
    expect(findNearestStepPoint([], 10)).toBeNull();
  });

  it('returns exact match when cursor is within selector range', () => {
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 0, selectorLength: 4, selectorText: 'size' },
      { stepPoint: 2, selectorOffset: 20, selectorLength: 3, selectorText: 'at:' },
    ];
    const result = findNearestStepPoint(infos, 21);
    expect(result).toEqual(infos[1]);
  });

  it('returns match when cursor is at selector start', () => {
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 10, selectorLength: 4, selectorText: 'size' },
    ];
    const result = findNearestStepPoint(infos, 10);
    expect(result).toEqual(infos[0]);
  });

  it('returns match when cursor is at selector end', () => {
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 10, selectorLength: 4, selectorText: 'size' },
    ];
    const result = findNearestStepPoint(infos, 14);
    expect(result).toEqual(infos[0]);
  });

  it('falls back to nearest by distance when not contained', () => {
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 0, selectorLength: 4, selectorText: 'foo' },
      { stepPoint: 2, selectorOffset: 50, selectorLength: 3, selectorText: 'bar' },
    ];
    // Cursor at 45 — closer to step 2 (midpoint 51.5) than step 1 (midpoint 2)
    const result = findNearestStepPoint(infos, 45);
    expect(result).toEqual(infos[1]);
  });

  it('handles cursor before all selectors', () => {
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 100, selectorLength: 4, selectorText: 'size' },
      { stepPoint: 2, selectorOffset: 200, selectorLength: 3, selectorText: 'at:' },
    ];
    const result = findNearestStepPoint(infos, 0);
    expect(result).toEqual(infos[0]);
  });

  it('handles cursor after all selectors', () => {
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 10, selectorLength: 4, selectorText: 'foo' },
      { stepPoint: 2, selectorOffset: 30, selectorLength: 3, selectorText: 'bar' },
    ];
    const result = findNearestStepPoint(infos, 500);
    expect(result).toEqual(infos[1]);
  });

  it('selects correct selector when cursor is on equals: not at:', () => {
    // Simulates: "self at: idx equals: val" with 0-based offsets
    // at: starts at offset 8, equals: starts at offset 16
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 8, selectorLength: 3, selectorText: 'at:' },
      { stepPoint: 2, selectorOffset: 16, selectorLength: 7, selectorText: 'equals:' },
    ];
    // Cursor at offset 18 — within 'equals:' (16..23)
    const result = findNearestStepPoint(infos, 18);
    expect(result).toEqual(infos[1]);
  });

  it('selects at: when cursor is on at: not equals:', () => {
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 8, selectorLength: 3, selectorText: 'at:' },
      { stepPoint: 2, selectorOffset: 16, selectorLength: 7, selectorText: 'equals:' },
    ];
    // Cursor at offset 9 — within 'at:' (8..11)
    const result = findNearestStepPoint(infos, 9);
    expect(result).toEqual(infos[0]);
  });

  it('returns first contained match when cursor is in overlapping ranges', () => {
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 5, selectorLength: 10, selectorText: 'longSelector:' },
      { stepPoint: 2, selectorOffset: 8, selectorLength: 4, selectorText: 'sel:' },
    ];
    // Cursor at 9 is within both — returns first match
    const result = findNearestStepPoint(infos, 9);
    expect(result).toEqual(infos[0]);
  });
});

// ── expandKeywordParts ──────────────────────────────────

describe('expandKeywordParts', () => {
  it('returns infos unchanged for unary messages', () => {
    const source = 'self size';
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 5, selectorLength: 4, selectorText: 'size' },
    ];
    expect(expandKeywordParts(source, infos)).toEqual(infos);
  });

  it('finds continuation keyword for assert:equals:', () => {
    //              0         1         2         3
    //              0123456789012345678901234567890123456
    const source = 'self assert: (x at: 1) equals: true.';
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 16, selectorLength: 3, selectorText: 'at:' },
      { stepPoint: 2, selectorOffset: 5, selectorLength: 7, selectorText: 'assert:' },
    ];
    const expanded = expandKeywordParts(source, infos);
    expect(expanded).toHaveLength(3);
    // at: has no continuation (argument is literal, then ) exits)
    expect(expanded[0]).toEqual(infos[0]);
    // assert: should get equals: as continuation
    expect(expanded[1]).toEqual(infos[1]);
    expect(expanded[2]).toEqual({
      stepPoint: 2,
      selectorOffset: 23,
      selectorLength: 7,
      selectorText: 'equals:',
    });
  });

  it('finds continuation keywords for perform:env:', () => {
    //              0123456789012345678901234567890
    const source = 'true perform: #foo env: 2';
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 5, selectorLength: 8, selectorText: 'perform:' },
    ];
    const expanded = expandKeywordParts(source, infos);
    expect(expanded).toHaveLength(2);
    expect(expanded[1]).toEqual({
      stepPoint: 1,
      selectorOffset: 19,
      selectorLength: 4,
      selectorText: 'env:',
    });
  });

  it('skips keywords inside parenthesized arguments', () => {
    //              01234567890123456789012345678901234567890
    const source = 'self assert: (x at: 1) equals: true.';
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 5, selectorLength: 7, selectorText: 'assert:' },
    ];
    const expanded = expandKeywordParts(source, infos);
    // Should find equals: but NOT at: (which is inside parens)
    const continuations = expanded.filter((e) => e !== infos[0]);
    expect(continuations).toHaveLength(1);
    expect(continuations[0].selectorText).toBe('equals:');
  });

  it('skips symbol literals', () => {
    //              012345678901234567890123456
    const source = 'self foo: #bar: baz: 2';
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 5, selectorLength: 4, selectorText: 'foo:' },
    ];
    const expanded = expandKeywordParts(source, infos);
    // #bar: is a symbol literal, baz: is the continuation
    const texts = expanded.map((e) => e.selectorText);
    expect(texts).toContain('foo:');
    expect(texts).toContain('baz:');
    expect(texts).not.toContain('bar:');
  });

  it('stops at period', () => {
    const source = 'self foo: 1. self bar: 2';
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 5, selectorLength: 4, selectorText: 'foo:' },
    ];
    const expanded = expandKeywordParts(source, infos);
    // bar: is after period — should not be included
    expect(expanded).toHaveLength(1);
  });

  it('stops at semicolon (cascade)', () => {
    const source = 'self foo: 1; bar: 2';
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 5, selectorLength: 4, selectorText: 'foo:' },
    ];
    const expanded = expandKeywordParts(source, infos);
    expect(expanded).toHaveLength(1);
  });

  it('does not expand unary messages (no colon)', () => {
    const source = 'self size printString';
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 5, selectorLength: 4, selectorText: 'size' },
    ];
    const expanded = expandKeywordParts(source, infos);
    expect(expanded).toHaveLength(1);
  });
});

// ── findNearestStepPoint with expanded keywords ─────────

describe('findNearestStepPoint with keyword expansion', () => {
  it('matches cursor on equals: to assert:equals: step point', () => {
    // Simulates expanded infos for: self assert: (x at: 1) equals: true.
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 14, selectorLength: 3, selectorText: 'at:' },
      { stepPoint: 2, selectorOffset: 5, selectorLength: 7, selectorText: 'assert:' },
      { stepPoint: 2, selectorOffset: 23, selectorLength: 7, selectorText: 'equals:' },
    ];
    // Cursor on equals: at offset 25
    const result = findNearestStepPoint(infos, 25);
    expect(result!.stepPoint).toBe(2);
    expect(result!.selectorText).toBe('equals:');
  });
});

// ── SelectorBreakpointManager ────────────────────────────

describe('SelectorBreakpointManager', () => {
  beforeEach(() => {
    mockGetRanges.mockReset();
    mockSetBreak.mockReset();
    mockClearBreak.mockReset();
    mockGetRanges.mockReturnValue([]);
    vi.mocked(window.showErrorMessage).mockReset();
    vi.mocked(window.showInformationMessage).mockReset();
  });

  describe('toggleBreakpointAtCursor', () => {
    it('ignores non-gemstone URIs', () => {
      const manager = new SelectorBreakpointManager(makeSessionManager(true));
      const editor = makeEditor('file:///test.tpz', 'foo');
      manager.toggleBreakpointAtCursor(editor);

      expect(mockGetRanges).not.toHaveBeenCalled();
      expect(mockSetBreak).not.toHaveBeenCalled();
    });

    it('shows error when no session', () => {
      const manager = new SelectorBreakpointManager(makeSessionManager(false));
      const editor = makeEditor('gemstone://1/Globals/Array/instance/accessing/at%3A', '');
      manager.toggleBreakpointAtCursor(editor);

      expect(window.showErrorMessage).toHaveBeenCalledWith('No active GemStone session.');
    });

    it('shows info when no step points found', () => {
      mockGetRanges.mockReturnValue([]);
      const manager = new SelectorBreakpointManager(makeSessionManager(true));
      const editor = makeEditor('gemstone://1/Globals/Array/instance/accessing/at%3A', '');
      manager.toggleBreakpointAtCursor(editor);

      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'No breakpointable step points found in this method.',
      );
    });

    it('sets breakpoint and updates decorations', () => {
      mockGetRanges.mockReturnValue([
        { stepPoint: 1, selectorOffset: 5, selectorLength: 3, selectorText: 'at:' },
      ]);
      const manager = new SelectorBreakpointManager(makeSessionManager(true));
      const editor = makeEditor('gemstone://1/Globals/Array/instance/accessing/at%3A', '');
      editor.document.offsetAt.mockReturnValue(6); // cursor within 'at:' range
      manager.toggleBreakpointAtCursor(editor);

      expect(mockSetBreak).toHaveBeenCalledWith(expect.anything(), 'Array', false, 'at:', 1, 0);
      expect(editor.setDecorations).toHaveBeenCalledTimes(1);
      const ranges = editor.setDecorations.mock.calls[0][1];
      expect(ranges).toHaveLength(1);
    });

    it('clears breakpoint on second toggle of same step point', () => {
      mockGetRanges.mockReturnValue([
        { stepPoint: 1, selectorOffset: 5, selectorLength: 3, selectorText: 'at:' },
      ]);
      const manager = new SelectorBreakpointManager(makeSessionManager(true));
      const editor = makeEditor('gemstone://1/Globals/Array/instance/accessing/at%3A', '');
      editor.document.offsetAt.mockReturnValue(6);

      // First toggle: sets breakpoint
      manager.toggleBreakpointAtCursor(editor);
      expect(mockSetBreak).toHaveBeenCalledTimes(1);

      // Second toggle: clears breakpoint
      manager.toggleBreakpointAtCursor(editor);
      expect(mockClearBreak).toHaveBeenCalledTimes(1);
      expect(mockClearBreak).toHaveBeenCalledWith(expect.anything(), 'Array', false, 'at:', 1, 0);

      // Decorations should be cleared
      const lastCall =
        editor.setDecorations.mock.calls[editor.setDecorations.mock.calls.length - 1];
      expect(lastCall[1]).toHaveLength(0);
    });

    it('handles setBreakAtStepPoint throwing', () => {
      mockGetRanges.mockReturnValue([
        { stepPoint: 1, selectorOffset: 5, selectorLength: 3, selectorText: 'at:' },
      ]);
      mockSetBreak.mockImplementation(() => {
        throw new Error('GCI error');
      });
      const manager = new SelectorBreakpointManager(makeSessionManager(true));
      const editor = makeEditor('gemstone://1/Globals/Array/instance/accessing/at%3A', '');
      editor.document.offsetAt.mockReturnValue(6);
      manager.toggleBreakpointAtCursor(editor);

      expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('GCI error'));
    });

    it('handles getStepPointSelectorRanges throwing', () => {
      mockGetRanges.mockImplementation(() => {
        throw new Error('AST error');
      });
      const manager = new SelectorBreakpointManager(makeSessionManager(true));
      const editor = makeEditor('gemstone://1/Globals/Array/instance/accessing/at%3A', '');
      manager.toggleBreakpointAtCursor(editor);

      expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('AST error'));
    });

    it('parses class-side URIs correctly', () => {
      mockGetRanges.mockReturnValue([
        { stepPoint: 1, selectorOffset: 0, selectorLength: 3, selectorText: 'new' },
      ]);
      const manager = new SelectorBreakpointManager(makeSessionManager(true));
      const editor = makeEditor('gemstone://1/Globals/Array/class/creation/new', '');
      editor.document.offsetAt.mockReturnValue(1);
      manager.toggleBreakpointAtCursor(editor);

      expect(mockGetRanges).toHaveBeenCalledWith(expect.anything(), 'Array', true, 'new', 0);
      expect(mockSetBreak).toHaveBeenCalledWith(expect.anything(), 'Array', true, 'new', 1, 0);
    });

    it('parses environment ID from query string', () => {
      mockGetRanges.mockReturnValue([
        { stepPoint: 1, selectorOffset: 0, selectorLength: 3, selectorText: 'foo' },
      ]);
      const manager = new SelectorBreakpointManager(makeSessionManager(true));
      const editor = makeEditor('gemstone://1/Globals/Array/instance/accessing/foo?env=2', '');
      editor.document.offsetAt.mockReturnValue(1);
      manager.toggleBreakpointAtCursor(editor);

      expect(mockGetRanges).toHaveBeenCalledWith(expect.anything(), 'Array', false, 'foo', 2);
    });

    it('sets breakpoint on correct selector when multiple step points exist', () => {
      // Simulates a method with at: at offset 8 and equals: at offset 16
      mockGetRanges.mockReturnValue([
        { stepPoint: 1, selectorOffset: 8, selectorLength: 3, selectorText: 'at:' },
        { stepPoint: 2, selectorOffset: 16, selectorLength: 7, selectorText: 'equals:' },
      ]);
      const manager = new SelectorBreakpointManager(makeSessionManager(true));
      const editor = makeEditor('gemstone://1/Globals/Array/instance/accessing/at%3Aequals%3A', '');
      // Cursor at offset 18 — within 'equals:' range (16..23)
      editor.document.offsetAt.mockReturnValue(18);
      manager.toggleBreakpointAtCursor(editor);

      // Should set breakpoint on step point 2 (equals:), not step point 1 (at:)
      expect(mockSetBreak).toHaveBeenCalledWith(
        expect.anything(),
        'Array',
        false,
        'at:equals:',
        2,
        0,
      );
    });

    it('caches selector info across toggles', () => {
      mockGetRanges.mockReturnValue([
        { stepPoint: 1, selectorOffset: 0, selectorLength: 3, selectorText: 'foo' },
        { stepPoint: 2, selectorOffset: 10, selectorLength: 4, selectorText: 'bar:' },
      ]);
      const manager = new SelectorBreakpointManager(makeSessionManager(true));
      const editor = makeEditor('gemstone://1/Globals/Array/instance/accessing/foo', '');
      editor.document.offsetAt.mockReturnValue(1);

      manager.toggleBreakpointAtCursor(editor);
      manager.toggleBreakpointAtCursor(editor);

      // getStepPointSelectorRanges should only be called once (cached)
      expect(mockGetRanges).toHaveBeenCalledTimes(1);
    });
  });

  describe('refreshDecorations', () => {
    it('applies empty decorations for non-gemstone URIs', () => {
      const manager = new SelectorBreakpointManager(makeSessionManager(true));
      const editor = makeEditor('file:///test.tpz', '');
      manager.refreshDecorations(editor);

      expect(editor.setDecorations).not.toHaveBeenCalled();
    });

    it('applies empty decorations when no breakpoints tracked', () => {
      const manager = new SelectorBreakpointManager(makeSessionManager(true));
      const editor = makeEditor('gemstone://1/Globals/Array/instance/accessing/foo', '');
      manager.refreshDecorations(editor);

      expect(editor.setDecorations).toHaveBeenCalledTimes(1);
      expect(editor.setDecorations.mock.calls[0][1]).toHaveLength(0);
    });
  });

  describe('clearAllForSession', () => {
    it('removes tracked breakpoints for the session', () => {
      mockGetRanges.mockReturnValue([
        { stepPoint: 1, selectorOffset: 0, selectorLength: 3, selectorText: 'foo' },
      ]);
      const manager = new SelectorBreakpointManager(makeSessionManager(true));
      const editor = makeEditor('gemstone://1/Globals/Array/instance/accessing/foo', '');
      editor.document.offsetAt.mockReturnValue(1);

      manager.toggleBreakpointAtCursor(editor);
      expect(mockSetBreak).toHaveBeenCalledTimes(1);

      manager.clearAllForSession(1);

      // After clearing, decorations should show nothing
      manager.refreshDecorations(editor);
      const lastCall =
        editor.setDecorations.mock.calls[editor.setDecorations.mock.calls.length - 1];
      expect(lastCall[1]).toHaveLength(0);
    });
  });

  describe('invalidateForUri', () => {
    it('clears breakpoints and cache on recompile', () => {
      mockGetRanges.mockReturnValue([
        { stepPoint: 1, selectorOffset: 0, selectorLength: 3, selectorText: 'foo' },
      ]);
      const manager = new SelectorBreakpointManager(makeSessionManager(true));
      const editor = makeEditor('gemstone://1/Globals/Array/instance/accessing/foo', '');
      editor.document.offsetAt.mockReturnValue(1);

      // Set a breakpoint
      manager.toggleBreakpointAtCursor(editor);
      expect(mockSetBreak).toHaveBeenCalledTimes(1);

      // Recompile replaces GsNMethod — breakpoints are gone
      manager.invalidateForUri(Uri.parse('gemstone://1/Globals/Array/instance/accessing/foo'));

      // Decorations should be cleared
      manager.refreshDecorations(editor);
      const lastCall =
        editor.setDecorations.mock.calls[editor.setDecorations.mock.calls.length - 1];
      expect(lastCall[1]).toHaveLength(0);
    });

    it('clears cache so next toggle re-fetches', () => {
      mockGetRanges.mockReturnValue([
        { stepPoint: 1, selectorOffset: 0, selectorLength: 3, selectorText: 'foo' },
      ]);
      const manager = new SelectorBreakpointManager(makeSessionManager(true));
      const editor = makeEditor('gemstone://1/Globals/Array/instance/accessing/foo', '');
      editor.document.offsetAt.mockReturnValue(1);

      // First toggle — caches selector info
      manager.toggleBreakpointAtCursor(editor);
      expect(mockGetRanges).toHaveBeenCalledTimes(1);

      // Invalidate clears cache
      manager.invalidateForUri(Uri.parse('gemstone://1/Globals/Array/instance/accessing/foo'));

      // Next toggle should re-fetch
      manager.toggleBreakpointAtCursor(editor);
      expect(mockGetRanges).toHaveBeenCalledTimes(2);
    });
  });
});
