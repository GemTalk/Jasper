import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../browserQueries', () => ({
  getMethodSource: vi.fn(() => ''),
  getSourceOffsets: vi.fn(() => []),
  setBreakAtStepPoint: vi.fn(),
  clearBreakAtStepPoint: vi.fn(),
  clearAllBreaks: vi.fn(),
}));

import { Uri } from '../__mocks__/vscode';
import {
  BreakpointManager,
  buildLineOffsets,
  mapLineToStepPoint,
  mapOffsetToStepPoint,
} from '../breakpointManager';
import { SessionManager } from '../sessionManager';
import {
  getMethodSource,
  getSourceOffsets,
  setBreakAtStepPoint,
  clearAllBreaks,
} from '../browserQueries';

const mockGetMethodSource = vi.mocked(getMethodSource);
const mockGetSourceOffsets = vi.mocked(getSourceOffsets);
const mockSetBreakAtStepPoint = vi.mocked(setBreakAtStepPoint);
const mockClearAllBreaks = vi.mocked(clearAllBreaks);

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
    mockClearAllBreaks.mockReset();
  });

  describe('setBreakpointsForSource', () => {
    it('returns unverified for non-gemstone URI', () => {
      const manager = new BreakpointManager(makeSessionManager(true));
      const session = makeSessionManager(true).getSelectedSession()!;
      const uri = Uri.parse('file:///test.tpz');
      const results = manager.setBreakpointsForSource(session, uri, [1]);
      expect(results).toHaveLength(1);
      expect(results[0].verified).toBe(false);
    });

    it('sets breakpoints and returns verified locations', () => {
      mockGetMethodSource.mockReturnValue('at: index\n  ^ self basicAt: index');
      mockGetSourceOffsets.mockReturnValue([0, 12]);

      const manager = new BreakpointManager(makeSessionManager(true));
      const session = makeSessionManager(true).getSelectedSession()!;
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      const results = manager.setBreakpointsForSource(session, uri, [1, 2]);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ stepPoint: 1, actualLine: 1, verified: true });
      expect(results[1]).toEqual({ stepPoint: 2, actualLine: 2, verified: true });
      expect(mockClearAllBreaks).toHaveBeenCalledTimes(1);
      expect(mockSetBreakAtStepPoint).toHaveBeenCalledTimes(2);
    });

    it('clears all breakpoints when lines is empty', () => {
      const manager = new BreakpointManager(makeSessionManager(true));
      const session = makeSessionManager(true).getSelectedSession()!;
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      const results = manager.setBreakpointsForSource(session, uri, []);

      expect(results).toHaveLength(0);
      expect(mockClearAllBreaks).toHaveBeenCalledTimes(1);
    });

    it('returns unverified when getMethodSource throws', () => {
      mockGetMethodSource.mockImplementation(() => {
        throw new Error('fail');
      });

      const manager = new BreakpointManager(makeSessionManager(true));
      const session = makeSessionManager(true).getSelectedSession()!;
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      const results = manager.setBreakpointsForSource(session, uri, [1]);

      expect(results).toHaveLength(1);
      expect(results[0].verified).toBe(false);
    });

    it('returns unverified when setBreakAtStepPoint throws', () => {
      mockGetMethodSource.mockReturnValue('foo\n  ^ 1');
      mockGetSourceOffsets.mockReturnValue([0, 6]);
      mockSetBreakAtStepPoint.mockImplementation(() => {
        throw new Error('fail');
      });

      const manager = new BreakpointManager(makeSessionManager(true));
      const session = makeSessionManager(true).getSelectedSession()!;
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/foo');
      const results = manager.setBreakpointsForSource(session, uri, [1]);

      expect(results).toHaveLength(1);
      expect(results[0].verified).toBe(false);
    });

    it('parses class-side URIs correctly', () => {
      mockGetMethodSource.mockReturnValue('new\n  ^ super new');
      mockGetSourceOffsets.mockReturnValue([0, 6]);

      const manager = new BreakpointManager(makeSessionManager(true));
      const session = makeSessionManager(true).getSelectedSession()!;
      const uri = Uri.parse('gemstone://1/Globals/Array/class/creation/new');
      manager.setBreakpointsForSource(session, uri, [1]);

      expect(mockGetMethodSource).toHaveBeenCalledWith(expect.anything(), 'Array', true, 'new', 0);
    });

    it('parses environment ID from query string', () => {
      mockGetMethodSource.mockReturnValue('foo\n  ^ 1');
      mockGetSourceOffsets.mockReturnValue([0, 6]);

      const manager = new BreakpointManager(makeSessionManager(true));
      const session = makeSessionManager(true).getSelectedSession()!;
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/foo?env=2');
      manager.setBreakpointsForSource(session, uri, [1]);

      expect(mockGetMethodSource).toHaveBeenCalledWith(expect.anything(), 'Array', false, 'foo', 2);
    });
  });

  describe('clearAllForSession', () => {
    it('removes tracked breakpoints for the given session', () => {
      mockGetMethodSource.mockReturnValue('foo\n  ^ 1');
      mockGetSourceOffsets.mockReturnValue([0, 6]);

      const manager = new BreakpointManager(makeSessionManager(true));
      const session = makeSessionManager(true).getSelectedSession()!;
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/foo');
      manager.setBreakpointsForSource(session, uri, [1]);

      // Verify tracked (indirectly: clearing and re-setting should not fail)
      manager.clearAllForSession(1);

      // After clearing, the internal map should be empty for this session
      // We can verify by calling invalidateForUri which checks the map
      manager.invalidateForUri(uri);
      // getMethodSource should NOT be called again since tracking was cleared
      mockGetMethodSource.mockReset();
      manager.invalidateForUri(uri);
      expect(mockGetMethodSource).not.toHaveBeenCalled();
    });
  });
});
