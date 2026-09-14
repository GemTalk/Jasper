import { describe, it, expect, vi } from 'vitest';
import {
  captureDictionary,
  dictionaryEntryCount,
  parseDictionaryCapture,
  reinsertDictionary,
} from '../queries/dictionaryQueries';

/**
 * The two symbol-list doits, as data (#434).
 *
 * The rules with teeth are POSITION and the two things the stone taught us:
 * `insertDictionary:at:` raises on an index past the end of a list that has since got
 * shorter, and it will happily list the same dictionary twice.
 */

describe('captureDictionary', () => {
  it('compares dictionary names as SYMBOLS', () => {
    // `each name asString = 'Foo'` raises "Unicode argument disallowed in String comparison"
    // on a stone in legacy string mode.
    const exec = vi.fn().mockReturnValue('0');

    captureDictionary(exec, 'Reports');

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain("each name == #'Reports'");
    expect(code).not.toContain('asString =');
  });

  it('asks for the stash only when a key is given', () => {
    const exec = vi.fn().mockReturnValue('0');

    captureDictionary(exec, 'Reports');
    expect(exec.mock.calls[0][0] as string).not.toContain('SessionTemps');

    captureDictionary(exec, 'Reports', 'k1');
    expect(exec.mock.calls[1][0] as string).toContain("SessionTemps current at: #'k1' put: d");
  });

  it("escapes a quote in the name so the statement can't be broken out of", () => {
    const exec = vi.fn().mockReturnValue('0');

    captureDictionary(exec, "Re'ports", "k'1");

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain("#'Re''ports'");
    expect(code).toContain("#'k''1'");
  });
});

describe('parseDictionaryCapture', () => {
  it('reads a present dictionary with its 1-based position', () => {
    expect(parseDictionaryCapture('1\t3', 'Reports')).toEqual({
      present: true,
      name: 'Reports',
      index: 3,
    });
  });

  it('reads the absent marker', () => {
    expect(parseDictionaryCapture('0', 'Reports')).toEqual({
      present: false,
      name: 'Reports',
      index: 0,
    });
  });

  it('reads an empty answer as absent rather than as position zero of something', () => {
    expect(parseDictionaryCapture('   ', 'Reports')).toEqual({
      present: false,
      name: 'Reports',
      index: 0,
    });
  });

  it('falls back to 0 on a position it cannot read', () => {
    expect(parseDictionaryCapture('1\tnonsense', 'Reports').index).toBe(0);
    expect(parseDictionaryCapture('1', 'Reports').index).toBe(0);
  });
});

describe('reinsertDictionary', () => {
  it('refuses rather than listing the same dictionary twice', () => {
    const exec = vi.fn().mockReturnValue('that dictionary is already on the symbol list');

    const result = reinsertDictionary(exec, 'k1', 2);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain('anySatisfy: [:each | each == d]');
    expect(result).toContain('already on the symbol list');
  });

  it('clamps the position into a list that has since got shorter', () => {
    // `insertDictionary:at:` raises an OffsetError past the end rather than appending.
    const exec = vi.fn().mockReturnValue('ok');

    reinsertDictionary(exec, 'k1', 9);

    expect(exec.mock.calls[0][0] as string).toContain('pos := 9 min: sl size + 1');
  });

  it('never asks for a position below 1', () => {
    const exec = vi.fn().mockReturnValue('ok');

    reinsertDictionary(exec, 'k1', 0);
    expect(exec.mock.calls[0][0] as string).toContain('pos := 1 min:');

    reinsertDictionary(exec, 'k1', -4);
    expect(exec.mock.calls[1][0] as string).toContain('pos := 1 min:');
  });

  it('answers null only for ok, and the reason otherwise', () => {
    expect(reinsertDictionary(vi.fn().mockReturnValue('ok\n'), 'k1', 2)).toBeNull();
    expect(reinsertDictionary(vi.fn().mockReturnValue('some failure'), 'k1', 2)).toBe(
      'some failure',
    );
  });
});

describe('dictionaryEntryCount', () => {
  it('discounts the self-referential entry, so a fresh dictionary reads as empty', () => {
    // A SymbolDictionary holds its own name by identity (`#Name -> theDict`), so a
    // genuinely empty one reports a size of ONE.
    const exec = vi.fn().mockReturnValue('1');

    dictionaryEntryCount(exec, 'Reports');

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain('keyAtValue: d');
    expect(code).toContain('d size - selfEntry');
  });

  it('does not name a temporary `self`, which is a reserved word', () => {
    const exec = vi.fn().mockReturnValue('0');

    dictionaryEntryCount(exec, 'Reports');

    expect(exec.mock.calls[0][0] as string).not.toMatch(/\|[^|]*\bself\b[^|]*\|/);
  });

  it('reads the count', () => {
    expect(dictionaryEntryCount(vi.fn().mockReturnValue(' 3 \n'), 'Reports')).toBe(3);
  });

  it('reads a negative or unreadable answer as empty rather than warning about nonsense', () => {
    expect(dictionaryEntryCount(vi.fn().mockReturnValue('nonsense'), 'Reports')).toBe(0);
    expect(dictionaryEntryCount(vi.fn().mockReturnValue('-2'), 'Reports')).toBe(0);
    expect(dictionaryEntryCount(vi.fn().mockReturnValue(''), 'Reports')).toBe(0);
  });

  it('compares dictionary names as SYMBOLS, and escapes them', () => {
    const exec = vi.fn().mockReturnValue('0');

    dictionaryEntryCount(exec, "Re'ports");

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain("each name == #'Re''ports'");
    expect(code).not.toContain('asString =');
  });
});
