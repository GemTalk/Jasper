import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

// `StepPointModel.fetch` asks for all three in one query now. The bundle mock
// delegates to the three separate mocks so every test keeps setting up its
// method the same way, one fact at a time.
vi.mock('../browserQueries', () => {
  const getMethodSource = vi.fn(() => '');
  const getSourceOffsets = vi.fn((): number[] => []);
  const getStepPointSelectorRanges = vi.fn((): unknown[] => []);
  return {
    getMethodSource,
    getSourceOffsets,
    getStepPointSelectorRanges,
    getStepPointBundle: vi.fn((...args: unknown[]) => ({
      source: (getMethodSource as (...a: unknown[]) => string)(...args),
      offsets: (getSourceOffsets as (...a: unknown[]) => number[])(...args),
      selectors: (getStepPointSelectorRanges as (...a: unknown[]) => unknown[])(...args),
    })),
  };
});

import { Uri } from '../__mocks__/vscode';
import {
  StepPointModel,
  StepPointInfo,
  buildLineStarts,
  lineOfOffset,
  resolveStepPoint,
  stepPointAtOffset,
  rangesForStepPoint,
} from '../stepPointModel';
import { SessionManager } from '../sessionManager';
import { getMethodSource, getSourceOffsets, getStepPointSelectorRanges } from '../browserQueries';

const mockGetMethodSource = vi.mocked(getMethodSource);
const mockGetSourceOffsets = vi.mocked(getSourceOffsets);
const mockGetRanges = vi.mocked(getStepPointSelectorRanges);

/**
 * A StepPointInfo built the way the model builds one: GemStone hands back
 * 1-based source offsets, which become 0-based here.
 */
function makeInfo(source: string, oneBasedOffsets: number[]): StepPointInfo {
  return {
    source,
    offsets: oneBasedOffsets.map((o) => o - 1),
    selectors: [],
    lineStarts: buildLineStarts(source),
  };
}

describe('buildLineStarts', () => {
  it('pads index 0 so lines read 1-based', () => {
    expect(buildLineStarts('abc')).toEqual([0, 0]);
  });

  it('records the offset after each newline', () => {
    expect(buildLineStarts('abc\ndef\nghi')).toEqual([0, 0, 4, 8]);
  });

  it('counts a trailing newline as starting another line', () => {
    expect(buildLineStarts('abc\n')).toEqual([0, 0, 4]);
  });
});

describe('lineOfOffset', () => {
  const starts = buildLineStarts('abc\ndef\nghi');

  it('finds the first line', () => {
    expect(lineOfOffset(starts, 0)).toBe(1);
    expect(lineOfOffset(starts, 3)).toBe(1);
  });

  it('finds a middle line', () => {
    expect(lineOfOffset(starts, 4)).toBe(2);
    expect(lineOfOffset(starts, 7)).toBe(2);
  });

  it('finds the last line', () => {
    expect(lineOfOffset(starts, 8)).toBe(3);
    expect(lineOfOffset(starts, 10)).toBe(3);
  });
});

describe('resolveStepPoint', () => {
  // 'm\nx := self foo'
  //  0 1 2345678901234
  // line 2 starts at offset 2; 'self' at 7, 'foo' at 12
  const info = makeInfo('m\nx := self foo', [8, 13]);

  it('with no column, takes the leftmost step point on the line', () => {
    expect(resolveStepPoint(info, 2)).toEqual({ stepPoint: 1, offset: 7, line: 2 });
  });

  it('treats column 0 as a whole-line request, like a gutter click', () => {
    expect(resolveStepPoint(info, 2, 0)?.stepPoint).toBe(1);
  });

  it('with a column, takes the nearest step point on the line', () => {
    // character 10 => offset 12, exactly 'foo'
    expect(resolveStepPoint(info, 2, 10)).toEqual({ stepPoint: 2, offset: 12, line: 2 });
  });

  it('picks the left step point for a column nearer to it', () => {
    expect(resolveStepPoint(info, 2, 5)?.stepPoint).toBe(1);
  });

  it('returns null for a line outside the source', () => {
    expect(resolveStepPoint(info, 99)).toBeNull();
    expect(resolveStepPoint(info, 0)).toBeNull();
  });

  it('returns null when the method has no step points at all', () => {
    expect(resolveStepPoint(makeInfo('m\n^1', []), 2)).toBeNull();
  });

  it('falls forward, reporting the line it really landed on', () => {
    // 'foo\n"a comment"\n^1' — only step point is the '^' at 0-based 16
    const commented = makeInfo('foo\n"a comment"\n^1', [17]);
    expect(resolveStepPoint(commented, 2)).toEqual({ stepPoint: 1, offset: 16, line: 3 });
  });

  it('returns null when nothing is at or after the requested line', () => {
    const info2 = makeInfo('foo\n^1\n', [1]);
    expect(resolveStepPoint(info2, 3)).toBeNull();
  });
});

describe('stepPointAtOffset', () => {
  const info = makeInfo('m\nx := self foo', [8, 13]);

  it('picks the step point the caret is sitting on', () => {
    expect(stepPointAtOffset(info, 12)?.stepPoint).toBe(2);
    expect(stepPointAtOffset(info, 7)?.stepPoint).toBe(1);
  });

  it('stays on the caret column rather than snapping to the leftmost step point', () => {
    // Offset 14 is inside 'foo'; a whole-line reading would answer step point 1.
    expect(stepPointAtOffset(info, 14)?.stepPoint).toBe(2);
  });

  it('returns null when the method has no step points', () => {
    expect(stepPointAtOffset(makeInfo('m\n^1', []), 2)).toBeNull();
  });
});

describe('rangesForStepPoint', () => {
  it('returns every selector range recorded for the step point', () => {
    const info: StepPointInfo = {
      source: 'm\nself assert: 1 equals: 1',
      offsets: [7],
      selectors: [
        { stepPoint: 1, selectorOffset: 7, selectorLength: 7, selectorText: 'assert:' },
        { stepPoint: 1, selectorOffset: 17, selectorLength: 7, selectorText: 'equals:' },
      ],
      lineStarts: buildLineStarts('m\nself assert: 1 equals: 1'),
    };
    expect(rangesForStepPoint(info, 1)).toEqual([
      { start: 7, end: 14 },
      { start: 17, end: 24 },
    ]);
  });

  it('marks a single character for a step point with no selector token', () => {
    // A step point on ':=' or '^' has no identifier for the query to report.
    const info = makeInfo('m\n^1', [3]);
    expect(rangesForStepPoint(info, 1)).toEqual([{ start: 2, end: 3 }]);
  });

  it('returns nothing for a step point that does not exist', () => {
    expect(rangesForStepPoint(makeInfo('m\n^1', [3]), 9)).toEqual([]);
  });
});

describe('StepPointModel', () => {
  function makeSessionManager(hasSession = true) {
    return {
      getSelectedSession: vi.fn(() =>
        hasSession ? { id: 1, gci: {}, handle: 'h', login: {}, stoneVersion: '3.7.5' } : undefined,
      ),
      onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
    } as unknown as SessionManager;
  }

  const METHOD_URI = 'gemstone://1/Globals/Array/instance/accessing/at%3A';

  function makeDocument(uriStr = METHOD_URI, isDirty = false) {
    return {
      uri: Uri.parse(uriStr),
      isDirty,
      getText: () => 'at: index\n^self basicAt: index',
    } as unknown as import('vscode').TextDocument;
  }

  beforeEach(() => {
    mockGetMethodSource.mockReset().mockReturnValue('at: index\n^self basicAt: index');
    mockGetSourceOffsets.mockReset().mockReturnValue([11]);
    mockGetRanges.mockReset().mockReturnValue([]);
  });

  it('converts GemStone 1-based offsets to 0-based', () => {
    const model = new StepPointModel(makeSessionManager());
    expect(model.get(makeDocument())?.offsets).toEqual([10]);
  });

  it('queries a method once and serves the rest from cache', () => {
    const model = new StepPointModel(makeSessionManager());
    model.get(makeDocument());
    model.get(makeDocument());
    expect(mockGetSourceOffsets).toHaveBeenCalledTimes(1);
  });

  it('re-queries after the method is invalidated', () => {
    const model = new StepPointModel(makeSessionManager());
    model.get(makeDocument());
    model.invalidate(Uri.parse(METHOD_URI));
    model.get(makeDocument());
    expect(mockGetSourceOffsets).toHaveBeenCalledTimes(2);
  });

  it('refuses a dirty document, whose text no longer matches the offsets', () => {
    const model = new StepPointModel(makeSessionManager());
    expect(model.get(makeDocument(METHOD_URI, true))).toBeNull();
    expect(mockGetSourceOffsets).not.toHaveBeenCalled();
  });

  it('refuses a non-gemstone document', () => {
    const model = new StepPointModel(makeSessionManager());
    expect(model.get(makeDocument('file:///a.st'))).toBeNull();
  });

  it('refuses a diff view, which must never be given a breakpoint', () => {
    const model = new StepPointModel(makeSessionManager());
    const diff = makeDocument(
      'gemstone://1/Globals/Array/instance/accessing/at%3A%20(base)?base=1',
    );
    expect(model.get(diff)).toBeNull();
  });

  it('refuses when no session is selected', () => {
    const model = new StepPointModel(makeSessionManager(false));
    expect(model.get(makeDocument())).toBeNull();
  });

  it('returns null rather than throwing when the method is gone', () => {
    mockGetMethodSource.mockImplementation(() => {
      throw new Error('not found');
    });
    const model = new StepPointModel(makeSessionManager());
    expect(model.get(makeDocument())).toBeNull();
  });

  describe('explain', () => {
    /** The reason `explain` gave, or '' when it produced step points. */
    const problemFor = (doc: import('vscode').TextDocument) => {
      const result = new StepPointModel(makeSessionManager()).explain(doc);
      return 'problem' in result ? result.problem : '';
    };

    it('names the unsaved buffer, the case a developer can actually fix', () => {
      const problem = problemFor(makeDocument(METHOD_URI, true));
      expect(problem).toContain('unsaved edits');
      // Both ways back to a compiled method, since saving a half-finished edit
      // is not always what the developer wants.
      expect(problem).toContain('Save the method');
      expect(problem).toContain('Revert File');
    });

    it('says breakpoints need GemStone method source for another scheme', () => {
      expect(problemFor(makeDocument('file:///a.st'))).toContain('GemStone method source');
    });

    it('points at the real method for a comparison view', () => {
      const diff = makeDocument(
        'gemstone://1/Globals/Array/instance/accessing/at%3A%20(base)?base=1',
      );
      expect(problemFor(diff)).toContain('comparison view');
    });

    it('reports a missing session', () => {
      const model = new StepPointModel(makeSessionManager(false));
      const result = model.explain(makeDocument());
      expect(result).toEqual({ problem: 'No active GemStone session.' });
    });

    it("passes the stone's own words along when the query fails", () => {
      mockGetMethodSource.mockImplementation(() => {
        throw new Error('method not found');
      });
      const problem = problemFor(makeDocument());
      expect(problem).toContain('Array>>at:');
      expect(problem).toContain('method not found');
    });

    it('says so when the method compiles but has no step points', () => {
      mockGetSourceOffsets.mockReturnValue([]);
      expect(problemFor(makeDocument())).toContain('no step points');
    });

    it('returns the step points when there is nothing wrong', () => {
      const result = new StepPointModel(makeSessionManager()).explain(makeDocument());
      expect('info' in result && result.info.offsets).toEqual([10]);
    });

    it('does not leak a stale error into a later successful fetch', () => {
      const model = new StepPointModel(makeSessionManager());
      mockGetMethodSource.mockImplementationOnce(() => {
        throw new Error('transient');
      });
      expect('problem' in model.explain(makeDocument())).toBe(true);

      model.invalidate(Uri.parse(METHOD_URI));
      expect('info' in model.explain(makeDocument())).toBe(true);
    });
  });

  it('invalidateSession drops only that session', () => {
    const model = new StepPointModel(makeSessionManager());
    model.get(makeDocument());
    model.invalidateSession(2);
    model.get(makeDocument());
    expect(mockGetSourceOffsets).toHaveBeenCalledTimes(1);

    model.invalidateSession(1);
    model.get(makeDocument());
    expect(mockGetSourceOffsets).toHaveBeenCalledTimes(2);
  });
});
