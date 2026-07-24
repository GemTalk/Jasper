import { describe, it, expect, vi } from 'vitest';
import { getDefinedClassVarNames } from '../queries/getDefinedClassVarNames';
import { getDefinedClassVarCounts } from '../queries/getDefinedClassVarCounts';

describe('getDefinedClassVarNames', () => {
  it('splits the newline-separated names the stone returns', () => {
    const execute = vi.fn().mockReturnValue('Alpha\nBeta\n');

    expect(getDefinedClassVarNames(execute, 'Account')).toEqual(['Alpha', 'Beta']);
  });

  it('returns an empty list when the class defines none', () => {
    const execute = vi.fn().mockReturnValue('');

    expect(getDefinedClassVarNames(execute, 'Account')).toEqual([]);
  });

  it('resolves the class scoped to a 1-based dictionary index (and guards nil)', () => {
    const execute = vi.fn().mockReturnValue('');

    getDefinedClassVarNames(execute, 'Account', 5);

    const code = execute.mock.calls[0][0];
    expect(code).toContain('symbolList at: 5');
    expect(code).toContain('ifNil: [#()]');
    expect(code).toContain('classVarNames');
  });

  it('resolves unscoped by name when no dictionary is given, quoting the class name', () => {
    const execute = vi.fn().mockReturnValue('');

    getDefinedClassVarNames(execute, 'Account');

    expect(execute.mock.calls[0][0]).toContain("objectNamed: #'Account'");
  });
});

describe('getDefinedClassVarCounts', () => {
  it('builds a class→count map from tab-separated lines', () => {
    const execute = vi.fn().mockReturnValue('Account\t2\nSavings\t0\n');

    const counts = getDefinedClassVarCounts(execute, 3);

    expect(counts.get('Account')).toBe(2);
    expect(counts.get('Savings')).toBe(0);
  });

  it('skips malformed lines and coerces a non-numeric count to 0', () => {
    const execute = vi.fn().mockReturnValue('Account\t2\nnoTabHere\nFoo\tx\n');

    const counts = getDefinedClassVarCounts(execute, 3);

    expect(counts.get('Account')).toBe(2);
    expect(counts.has('noTabHere')).toBe(false);
    expect(counts.get('Foo')).toBe(0);
  });

  it('returns an empty map for a nil dictionary (empty result)', () => {
    const execute = vi.fn().mockReturnValue('');

    expect(getDefinedClassVarCounts(execute, 3).size).toBe(0);
  });

  it('scopes by index or by name in the generated query', () => {
    const byIndex = vi.fn().mockReturnValue('');
    getDefinedClassVarCounts(byIndex, 4);
    expect(byIndex.mock.calls[0][0]).toContain('symbolList at: 4');

    const byName = vi.fn().mockReturnValue('');
    getDefinedClassVarCounts(byName, 'MyDict');
    expect(byName.mock.calls[0][0]).toContain("objectNamed: #'MyDict'");
  });
});
