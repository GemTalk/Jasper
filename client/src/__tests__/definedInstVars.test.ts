import { describe, it, expect, vi } from 'vitest';
import { getDefinedInstVarNames } from '../queries/getDefinedInstVarNames';
import { getDefinedInstVarCounts } from '../queries/getDefinedInstVarCounts';

describe("a class's locally-defined instance variable names", () => {
  it('lists one variable per line, in declared order', () => {
    const execute = vi.fn().mockReturnValue('x\ny\nz\n');

    expect(getDefinedInstVarNames(execute, 'Point')).toEqual(['x', 'y', 'z']);
  });

  it("asks for the class's own variables, not the inherited ones", () => {
    const execute = vi.fn().mockReturnValue('');

    getDefinedInstVarNames(execute, 'Point');

    const code = execute.mock.calls[0][0];
    // Resolves the class (dict-scoped/quoted via classLookupExpr) then reads its own
    // instVarNames — not allInstVarNames (which would include inherited ones).
    expect(code).toContain("objectNamed: #'Point'");
    expect(code).toContain('instVarNames');
    expect(code).not.toContain('allInstVarNames');
  });

  it('resolves the class scoped to a 1-based dictionary index when given one', () => {
    const execute = vi.fn().mockReturnValue('');

    getDefinedInstVarNames(execute, 'Point', 5);

    expect(execute.mock.calls[0][0]).toContain('symbolList at: 5');
  });

  it('returns nothing for a class that defines no variables', () => {
    const execute = vi.fn().mockReturnValue('');

    expect(getDefinedInstVarNames(execute, 'Object')).toEqual([]);
  });
});

describe('counting locally-defined instance variables across a dictionary', () => {
  it('maps each class name to its own variable count', () => {
    const execute = vi.fn().mockReturnValue('Object\t0\nPoint\t2\nAssociation\t2\n');

    const counts = getDefinedInstVarCounts(execute, 1);

    expect(counts.get('Object')).toBe(0);
    expect(counts.get('Point')).toBe(2);
    expect(counts.get('Association')).toBe(2);
  });

  it('looks the dictionary up by name when given a string', () => {
    const execute = vi.fn().mockReturnValue('');

    getDefinedInstVarCounts(execute, 'UserGlobals');

    expect(execute).toHaveBeenCalledWith(expect.stringContaining("objectNamed: #'UserGlobals'"));
  });

  it('has no entries for an empty dictionary', () => {
    const execute = vi.fn().mockReturnValue('');

    expect(getDefinedInstVarCounts(execute, 5).size).toBe(0);
  });
});
