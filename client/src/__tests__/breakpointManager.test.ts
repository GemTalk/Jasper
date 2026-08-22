import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../browserQueries', () => ({
  getMethodSource: vi.fn(() => ''),
  getSourceOffsets: vi.fn(() => []),
  getStepPointSelectorRanges: vi.fn(() => []),
  setBreakAtStepPoint: vi.fn(),
  clearBreakAtStepPoint: vi.fn(),
  disableBreakAtStepPoint: vi.fn(),
  clearAllBreaks: vi.fn(),
}));

import { Uri, debug, Location, Position, SourceBreakpoint } from '../__mocks__/vscode';
import {
  BreakpointManager,
  buildLineOffsets,
  mapLineToStepPoint,
  mapOffsetToStepPoint,
} from '../breakpointManager';
import { SessionManager } from '../sessionManager';
import { StepPointModel } from '../stepPointModel';
import {
  getMethodSource,
  getSourceOffsets,
  setBreakAtStepPoint,
  disableBreakAtStepPoint,
  clearAllBreaks,
} from '../browserQueries';

const mockGetMethodSource = vi.mocked(getMethodSource);
const mockGetSourceOffsets = vi.mocked(getSourceOffsets);
const mockSetBreakAtStepPoint = vi.mocked(setBreakAtStepPoint);
const mockClearAllBreaks = vi.mocked(clearAllBreaks);
const mockDisableBreakAtStepPoint = vi.mocked(disableBreakAtStepPoint);

const METHOD_URI = 'gemstone://1/Globals/Array/instance/accessing/at%3A';

/** A manager wired to a real StepPointModel over the mocked queries. */
function makeManager(hasSession = true) {
  const sessionManager = makeSessionManager(hasSession);
  return new BreakpointManager(sessionManager, new StepPointModel(sessionManager));
}

function session() {
  return makeSessionManager(true).getSelectedSession()!;
}

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

describe('buildLineOffsets', () => {
  it('returns offsets for a single-line source', () => {
    const offsets = buildLineOffsets('hello');
    // offsets[0] = 0 (dummy), offsets[1] = 0 (line 1 starts at 0)
    expect(offsets[1]).toBe(0);
    expect(offsets.length).toBe(2);
  });

  it('returns offsets for multi-line source', () => {
    const offsets = buildLineOffsets('abc\ndef\nghi');
    // Line 1: offset 0, Line 2: offset 4, Line 3: offset 8
    expect(offsets[1]).toBe(0);
    expect(offsets[2]).toBe(4);
    expect(offsets[3]).toBe(8);
    expect(offsets.length).toBe(4);
  });

  it('handles empty source', () => {
    const offsets = buildLineOffsets('');
    expect(offsets[1]).toBe(0);
    expect(offsets.length).toBe(2);
  });
});

describe('mapLineToStepPoint', () => {
  // Source:
  // Line 1: "at: index"          (offset 0-9)
  // Line 2: "  ^ self basicAt: index"  (offset 10-33)
  const lineOffsets = [0, 0, 10, 34]; // dummy, line1, line2, (end)
  // Step points: step 1 at offset 0, step 2 at offset 14
  const sourceOffsets = [0, 14];

  it('maps line 1 to step point 1', () => {
    const result = mapLineToStepPoint(1, lineOffsets, sourceOffsets);
    expect(result).toEqual({ stepPoint: 1, actualLine: 1 });
  });

  it('maps line 2 to step point 2', () => {
    const result = mapLineToStepPoint(2, lineOffsets, sourceOffsets);
    expect(result).toEqual({ stepPoint: 2, actualLine: 2 });
  });

  it('adjusts to nearest following step point when no step on target line', () => {
    // Source with 4 lines, step points on lines 1 and 3
    const lo = [0, 0, 10, 20, 30];
    const so = [0, 22]; // step 1 at line 1, step 2 at line 3

    const result = mapLineToStepPoint(2, lo, so);
    // Line 2 has no step point, nearest after is step 2 at offset 22 → line 3
    expect(result).toEqual({ stepPoint: 2, actualLine: 3 });
  });

  it('returns null for empty sourceOffsets', () => {
    const result = mapLineToStepPoint(1, [0, 0], []);
    expect(result).toBeNull();
  });

  it('returns null for invalid line number', () => {
    const result = mapLineToStepPoint(0, [0, 0], [0]);
    expect(result).toBeNull();
  });

  it('returns null for line beyond source', () => {
    const result = mapLineToStepPoint(5, [0, 0, 10], [0]);
    expect(result).toBeNull();
  });

  it('handles unsorted source offsets', () => {
    // Step points not in source order (blocks can cause this)
    const lo = [0, 0, 10, 20, 30];
    const so = [25, 5, 15]; // step 1 at offset 25 (line 3), step 2 at 5 (line 1), step 3 at 15 (line 2)

    const result = mapLineToStepPoint(2, lo, so);
    // Line 2 (offset 10-19), step 3 at offset 15 is on line 2
    expect(result).toEqual({ stepPoint: 3, actualLine: 2 });
  });

  it('picks earliest step point when multiple on same line', () => {
    const lo = [0, 0, 20];
    const so = [10, 5, 15]; // step 1 at 10, step 2 at 5, step 3 at 15 — all on line 1

    const result = mapLineToStepPoint(1, lo, so);
    // Step 2 has smallest offset (5) on line 1
    expect(result).toEqual({ stepPoint: 2, actualLine: 1 });
  });
});

// Column-aware mapping for "Run to Cursor" (#2): unlike mapLineToStepPoint, the
// cursor's column chooses among several step points on the same line.
describe('mapOffsetToStepPoint', () => {
  // `x := a asInteger` — 1-based source offsets: sp1@1 (x), sp2@6 (a), sp3@8 (asInteger).
  const so = [1, 6, 8];
  const lineStart = 0;
  const lineEnd = 16; // whole single line

  it('picks the step point nearest the cursor column, not the leftmost on the line', () => {
    // Cursor on `asInteger` (offset 7) → sp3, NOT the leftmost sp1 (the := store).
    expect(mapOffsetToStepPoint(7, so, lineStart, lineEnd)).toEqual({ stepPoint: 3, offset: 8 });
  });

  it('picks the leftmost when the cursor is at the start of the line', () => {
    expect(mapOffsetToStepPoint(0, so, lineStart, lineEnd)).toEqual({ stepPoint: 1, offset: 1 });
  });

  it('breaks inside a one-line block when the cursor is in the block body', () => {
    // `self do: [:e | body ]` style: sp1@5 (self), sp2@10 (do:), sp3@20 (body).
    const blk = [5, 10, 20];
    // Cursor at offset 19 (on `body`) → sp3, not the do:/self sends.
    expect(mapOffsetToStepPoint(19, blk, 0, 30)).toEqual({ stepPoint: 3, offset: 20 });
  });

  it('falls back to the nearest step point AFTER the cursor when its line has none', () => {
    // Cursor on a blank line [10, 20) with no step point → nearest after (offset 25).
    expect(mapOffsetToStepPoint(12, [5, 25, 40], 10, 20)).toEqual({ stepPoint: 2, offset: 25 });
  });

  it('returns null when the cursor is past every step point', () => {
    expect(mapOffsetToStepPoint(100, [5, 10], 90, 110)).toBeNull();
  });
});

describe('BreakpointManager', () => {
  beforeEach(() => {
    mockGetMethodSource.mockReset();
    mockGetSourceOffsets.mockReset();
    mockSetBreakAtStepPoint.mockReset();
    mockDisableBreakAtStepPoint.mockReset();
    mockClearAllBreaks.mockReset();
    debug.breakpoints = [];
    vi.mocked(debug.addBreakpoints).mockClear();
    vi.mocked(debug.removeBreakpoints).mockClear();
  });

  describe('applyToUri', () => {
    it('returns unverified for a non-gemstone URI', () => {
      const results = makeManager().applyToUri(session(), Uri.parse('file:///test.tpz'), [
        { line: 1, enabled: true },
      ]);
      expect(results).toHaveLength(1);
      expect(results[0].verified).toBe(false);
    });

    it('sets a breakpoint per requested line and reports where each landed', () => {
      // GemStone _sourceOffsets are 1-based: step point 1 at source[0], 2 at source[11].
      mockGetMethodSource.mockReturnValue('at: index\n^self basicAt: index');
      mockGetSourceOffsets.mockReturnValue([1, 11]);

      const results = makeManager().applyToUri(session(), Uri.parse(METHOD_URI), [
        { line: 1, enabled: true },
        { line: 2, enabled: true },
      ]);

      expect(results).toEqual([
        { stepPoint: 1, actualLine: 1, verified: true },
        { stepPoint: 2, actualLine: 2, verified: true },
      ]);
      expect(mockClearAllBreaks).toHaveBeenCalledTimes(1);
      expect(mockSetBreakAtStepPoint).toHaveBeenCalledTimes(2);
      expect(mockDisableBreakAtStepPoint).not.toHaveBeenCalled();
    });

    it('clears the method and sets nothing when no breakpoints are wanted', () => {
      const results = makeManager().applyToUri(session(), Uri.parse(METHOD_URI), []);
      expect(results).toHaveLength(0);
      expect(mockClearAllBreaks).toHaveBeenCalledTimes(1);
      expect(mockSetBreakAtStepPoint).not.toHaveBeenCalled();
    });

    it('applies a disabled breakpoint as set-then-disable', () => {
      // disableBreakAtStepPoint: is a no-op on a step point with no breakpoint,
      // so a disabled breakpoint has to be set first or it would not exist at all.
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);

      makeManager().applyToUri(session(), Uri.parse(METHOD_URI), [{ line: 2, enabled: false }]);

      expect(mockSetBreakAtStepPoint).toHaveBeenCalledTimes(1);
      expect(mockDisableBreakAtStepPoint).toHaveBeenCalledTimes(1);
      const setArgs = mockSetBreakAtStepPoint.mock.calls[0];
      const disableArgs = mockDisableBreakAtStepPoint.mock.calls[0];
      expect(setArgs[4]).toBe(2); // same step point
      expect(disableArgs[4]).toBe(2);
    });

    it('resolves a column to the nearest step point on the line, not the leftmost', () => {
      //           0    5    10   15   20
      //           x := self foo bar
      mockGetMethodSource.mockReturnValue('m\nx := self foo');
      // step points (1-based): 8 -> 'self' area start, 13 -> 'foo'
      mockGetSourceOffsets.mockReturnValue([8, 13]);

      // Line 2 starts at offset 2. Column 10 => offset 12, nearest step point is #2.
      const results = makeManager().applyToUri(session(), Uri.parse(METHOD_URI), [
        { line: 2, character: 10, enabled: true },
      ]);
      expect(results[0].stepPoint).toBe(2);
    });

    it('a gutter click (no column) takes the leftmost step point on the line', () => {
      mockGetMethodSource.mockReturnValue('m\nx := self foo');
      mockGetSourceOffsets.mockReturnValue([8, 13]);

      const results = makeManager().applyToUri(session(), Uri.parse(METHOD_URI), [
        { line: 2, enabled: true },
      ]);
      expect(results[0].stepPoint).toBe(1);
    });

    it('collapses two requests that land on the same step point, keeping it armed', () => {
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([5]);

      const results = makeManager().applyToUri(session(), Uri.parse(METHOD_URI), [
        { line: 2, enabled: false },
        { line: 2, character: 1, enabled: true },
      ]);

      // Both requests report the same step point...
      expect(results.map((r) => r.stepPoint)).toEqual([1, 1]);
      // ...but the gem gets one breakpoint, left enabled because one request wanted it.
      expect(mockSetBreakAtStepPoint).toHaveBeenCalledTimes(1);
      expect(mockDisableBreakAtStepPoint).not.toHaveBeenCalled();
    });

    it('falls forward to the next step point when the line has none', () => {
      mockGetMethodSource.mockReturnValue('foo\n"just a comment"\n^1');
      // Only one step point: the '^' at 0-based offset 21, so 22 1-based.
      mockGetSourceOffsets.mockReturnValue([22]);

      const results = makeManager().applyToUri(session(), Uri.parse(METHOD_URI), [
        { line: 2, enabled: true },
      ]);
      expect(results[0]).toEqual({ stepPoint: 1, actualLine: 3, verified: true });
    });

    it('returns unverified when the method has no step point at or after the line', () => {
      mockGetMethodSource.mockReturnValue('foo\n^1\n');
      mockGetSourceOffsets.mockReturnValue([1]);

      const results = makeManager().applyToUri(session(), Uri.parse(METHOD_URI), [
        { line: 3, enabled: true },
      ]);
      expect(results[0].verified).toBe(false);
    });

    it('returns unverified when the source cannot be fetched', () => {
      mockGetMethodSource.mockImplementation(() => {
        throw new Error('method gone');
      });

      const results = makeManager().applyToUri(session(), Uri.parse(METHOD_URI), [
        { line: 1, enabled: true },
      ]);
      expect(results[0].verified).toBe(false);
    });

    it('returns unverified when setting the breakpoint throws', () => {
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);
      mockSetBreakAtStepPoint.mockImplementation(() => {
        throw new Error('fail');
      });

      const results = makeManager().applyToUri(session(), Uri.parse(METHOD_URI), [
        { line: 1, enabled: true },
      ]);
      expect(results[0].verified).toBe(false);
    });

    it('reads the class side and environment id out of the URI', () => {
      mockGetMethodSource.mockReturnValue('new\n^super new');
      mockGetSourceOffsets.mockReturnValue([1, 5]);

      makeManager().applyToUri(
        session(),
        Uri.parse('gemstone://1/Globals/Array/class/creation/new?env=2'),
        [{ line: 1, enabled: true }],
      );

      expect(mockGetMethodSource).toHaveBeenCalledWith(expect.anything(), 'Array', true, 'new', 2);
    });
  });

  describe('setBreakpointsForSource', () => {
    it("converts the debug adapter's 1-based columns to 0-based characters", () => {
      mockGetMethodSource.mockReturnValue('m\nx := self foo');
      mockGetSourceOffsets.mockReturnValue([8, 13]);

      // DAP column 11 == character 10 == offset 12 on line 2 => step point 2.
      const results = makeManager().setBreakpointsForSource(
        session(),
        Uri.parse(METHOD_URI),
        [2],
        [11],
      );
      expect(results[0].stepPoint).toBe(2);
    });

    it('treats a missing column as a whole-line request', () => {
      mockGetMethodSource.mockReturnValue('m\nx := self foo');
      mockGetSourceOffsets.mockReturnValue([8, 13]);

      const results = makeManager().setBreakpointsForSource(
        session(),
        Uri.parse(METHOD_URI),
        [2],
        [undefined],
      );
      expect(results[0].stepPoint).toBe(1);
    });
  });

  describe('appliedFor', () => {
    it('reports the step points now set on a method, with their enabled state', () => {
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);

      const manager = makeManager();
      manager.applyToUri(session(), Uri.parse(METHOD_URI), [
        { line: 1, enabled: true },
        { line: 2, enabled: false },
      ]);

      const applied = manager.appliedFor(Uri.parse(METHOD_URI));
      expect(applied.map((a) => [a.stepPoint, a.enabled])).toEqual([
        [1, true],
        [2, false],
      ]);
    });

    it('is empty again once the breakpoints are gone', () => {
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);

      const manager = makeManager();
      const uri = Uri.parse(METHOD_URI);
      manager.applyToUri(session(), uri, [{ line: 1, enabled: true }]);
      expect(manager.appliedFor(uri)).toHaveLength(1);

      manager.applyToUri(session(), uri, []);
      expect(manager.appliedFor(uri)).toHaveLength(0);
    });
  });

  describe('reapplyAll', () => {
    it('re-applies every gemstone breakpoint, which is what a new login needs', () => {
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);

      debug.breakpoints = [
        new SourceBreakpoint(new Location(Uri.parse(METHOD_URI), new Position(0, 0))),
        // A non-gemstone breakpoint must be left entirely alone.
        new SourceBreakpoint(new Location(Uri.parse('file:///a.ts'), new Position(3, 0))),
      ];

      makeManager().reapplyAll(session());

      expect(mockSetBreakAtStepPoint).toHaveBeenCalledTimes(1);
      expect(mockGetMethodSource).toHaveBeenCalledWith(expect.anything(), 'Array', false, 'at:', 0);
    });
  });

  describe('clearAllForSession', () => {
    it('forgets a logged-out session, so nothing is re-pushed for it', () => {
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);

      const manager = makeManager();
      const uri = Uri.parse(METHOD_URI);
      manager.applyToUri(session(), uri, [{ line: 1, enabled: true }]);
      expect(manager.appliedFor(uri)).toHaveLength(1);

      manager.clearAllForSession(1);
      expect(manager.appliedFor(uri)).toHaveLength(0);
    });

    it("leaves another session's breakpoints alone", () => {
      mockGetMethodSource.mockReturnValue('foo\n^1');
      mockGetSourceOffsets.mockReturnValue([1, 5]);

      const manager = makeManager();
      const uri = Uri.parse(METHOD_URI);
      manager.applyToUri(session(), uri, [{ line: 1, enabled: true }]);

      manager.clearAllForSession(2);
      expect(manager.appliedFor(uri)).toHaveLength(1);
    });
  });

  describe('removeAll', () => {
    it('drops gemstone breakpoints from VS Code and sweeps the gem', () => {
      const gemstoneBp = new SourceBreakpoint(
        new Location(Uri.parse(METHOD_URI), new Position(0, 0)),
      );
      const fileBp = new SourceBreakpoint(
        new Location(Uri.parse('file:///a.ts'), new Position(1, 0)),
      );
      debug.breakpoints = [gemstoneBp, fileBp];

      makeManager().removeAll();

      expect(vi.mocked(debug.removeBreakpoints)).toHaveBeenCalledWith([gemstoneBp]);
      // The file breakpoint survives — "all GemStone breakpoints" is not "all breakpoints".
      expect(debug.breakpoints).toEqual([fileBp]);
    });
  });
});
