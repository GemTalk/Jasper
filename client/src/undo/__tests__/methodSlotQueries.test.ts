import { describe, it, expect, vi } from 'vitest';
import {
  applyMethodSlotOps,
  captureMethodSlots,
  parseApply,
  parseCapture,
} from '../queries/methodSlotQueries';
import { decodeEscaped } from '../queries/methodSlotCodec';
import { MethodSlot, MethodSlotOp } from '../undoTypes';

/**
 * The two doits (#434).
 *
 * The property that matters most is the one in the first test: NEITHER doit names a class
 * the refactoring engine installs. That is what lets a saved or deleted method be undone
 * on a stone with no engine on it, which is the reason the undo stack lives in the client
 * at all.
 *
 * The rest pin the wire format. Method source contains the two characters a line-oriented,
 * tab-delimited result cannot carry, and may be non-ASCII — which is the sharper problem,
 * since a Unicode-promoted GemStone result trips the client's character-based GCI fetch. So
 * source travels escaped, and it has to survive the round trip exactly: this text is
 * recompiled, not displayed.
 */

const slot = (selector: string): MethodSlot => ({
  className: 'Account',
  isMeta: false,
  selector,
  environmentId: 0,
});

describe('the undo doits', () => {
  it('never mention the refactoring engine, so they run on any stone', () => {
    const seen: string[] = [];
    const execute = (code: string) => {
      seen.push(code);
      return '0\n';
    };
    captureMethodSlots(execute, [slot('balance')]);
    applyMethodSlotOps(execute, [
      { kind: 'restore', slot: slot('balance'), source: 'balance ^1', category: 'accessing' },
    ]);

    for (const code of seen) {
      expect(code).not.toMatch(/GsRefactoring|GsRename|GsExtract|GsMove|GsPush|GsInline/);
    }
  });

  it('asks for nothing when there are no slots', () => {
    const execute = vi.fn();
    expect(captureMethodSlots(execute, [])).toEqual([]);
    expect(applyMethodSlotOps(execute, [])).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('resolves the class before taking its metaclass', () => {
    // `nil class` is UndefinedObject, so a bare `X class` would turn "no such class" into a
    // snapshot of the wrong object.
    let code = '';
    captureMethodSlots(
      (c) => {
        code = c;
        return '0\n';
      },
      [{ ...slot('new'), isMeta: true }],
    );
    expect(code).toContain('base isNil');
    expect(code).toContain('base class');
  });
});

describe('parseCapture', () => {
  it('reads a method that is there, source and category', () => {
    expect(parseCapture('1\taccessing\tbalance ^1\n', 1)).toEqual([
      { exists: true, source: 'balance ^1', category: 'accessing' },
    ]);
  });

  it('reads a method that is not there', () => {
    expect(parseCapture('0\n', 1)).toEqual([{ exists: false, source: null, category: null }]);
  });

  it('reads a state per slot, in order', () => {
    const states = parseCapture('0\n1\tc\tsrc\n', 2);
    expect(states.map((s) => s.exists)).toEqual([false, true]);
  });

  it('reads a truncated result as "not there" rather than throwing', () => {
    // A result short of what was asked for means something went wrong server-side. Reading
    // the missing slots as absent makes the reversal a no-op there instead of a crash.
    expect(parseCapture('', 2)).toHaveLength(2);
    expect(parseCapture('', 2).every((s) => !s.exists)).toBe(true);
  });

  it('round-trips a multi-line, tab-containing, non-ASCII method body', () => {
    const source = 'balance\n\t"café ✓ ①"\n\t^ 1 / 2';
    // What the doit's escaper produces for that text.
    const escaped = 'balance\\u000A\\u0009"caf\\u00E9 \\u2713 \\u2460"\\u000A\\u0009^ 1 / 2';
    expect(decodeEscaped(escaped)).toBe(source);
    expect(parseCapture(`1\taccessing\t${escaped}\n`, 1)[0].source).toBe(source);
  });

  it('round-trips a backslash, which the escaper doubles', () => {
    expect(decodeEscaped('a\\\\b')).toBe('a\\b');
  });

  it('passes through a backslash sequence the encoder never produces', () => {
    // Decoding is the last step before source is compiled back into the image, so an
    // unrecognised escape must not silently lose a character. `\q` is not one of the four
    // the encoder emits; the backslash survives, and so does the q.
    expect(decodeEscaped('a\\qb')).toBe('a\\qb');
  });

  it('round-trips a character above the BMP', () => {
    expect(decodeEscaped('\\U0001F600')).toBe('\u{1F600}');
  });
});

describe('parseApply', () => {
  const ops: MethodSlotOp[] = [
    { kind: 'restore', slot: slot('a'), source: 'a ^1', category: 'c' },
    { kind: 'remove', slot: slot('b'), source: null, category: null },
  ];

  it('pairs each outcome with its operation', () => {
    const results = parseApply('O\nE\tnot writable\n', ops);
    expect(results[0]).toEqual({ op: ops[0], error: null });
    expect(results[1].error).toBe('not writable');
  });

  it('reads a line with no fields as an empty method rather than undefined', () => {
    // A '1' with nothing after it can only come from a stone that answered something
    // malformed. Empty source and empty category are wrong but harmless; undefined would
    // reach the compiler.
    expect(parseCapture('1', 1)).toEqual([{ exists: true, source: '', category: '' }]);
  });

  it('reports a missing line rather than silently counting it as success', () => {
    expect(parseApply('O\n', ops)[1].error).toBe('no result reported');
  });
});
