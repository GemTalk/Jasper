import { describe, it, expect, vi } from 'vitest';
import { getVisibleClassVarNames } from '../queries/getVisibleClassVarNames';

describe("a class's visible class-variable names", () => {
  it('lists one variable per line', () => {
    const execute = vi.fn().mockReturnValue('Registry\nSharedDefault\n');

    expect(getVisibleClassVarNames(execute, 'R5Demo')).toEqual(['Registry', 'SharedDefault']);
  });

  it('walks the superclass chain so inherited class variables are included', () => {
    const execute = vi.fn().mockReturnValue('');

    getVisibleClassVarNames(execute, 'R5Demo');

    const code = execute.mock.calls[0][0];
    expect(code).toContain('allSuperclasses');
    expect(code).toContain('classVarNames');
  });

  it('resolves the class scoped to a 1-based dictionary index when given one', () => {
    const execute = vi.fn().mockReturnValue('');

    getVisibleClassVarNames(execute, 'R5Demo', 5);

    expect(execute.mock.calls[0][0]).toContain('symbolList at: 5');
  });

  it('returns nothing for an unbound class name', () => {
    const execute = vi.fn().mockReturnValue('');

    expect(getVisibleClassVarNames(execute, 'NoSuchClass')).toEqual([]);
  });
});
