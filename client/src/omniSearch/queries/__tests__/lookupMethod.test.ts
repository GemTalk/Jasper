import { describe, it, expect, vi } from 'vitest';
import { buildMethodLookupCode, lookupMethod, parseMethodLookupResults } from '../lookupMethod';
import { homeDictionaryNameExpr } from '../../../queries/util';

describe('buildMethodLookupCode', () => {
  it('looks the class and selector up as existing symbols, so a lookup never creates one', () => {
    const code = buildMethodLookupCode('Dictionary', false, 'at:put:');
    expect(code).toContain("Symbol _existingWithAll: 'Dictionary'");
    expect(code).toContain("Symbol _existingWithAll: 'at:put:'");
    expect(code).not.toContain("#'");
  });

  it("names the defining class's dictionary through the shared home-dictionary helper", () => {
    expect(buildMethodLookupCode('Object', false, 'printString')).toContain(
      homeDictionaryNameExpr('home'),
    );
  });

  it('starts the walk from the metaclass for a class-side reference', () => {
    expect(buildMethodLookupCode('String', true, 'new')).toContain('cls := v class');
    expect(buildMethodLookupCode('String', false, 'new')).toContain('cls := v.');
  });

  it('resolves up the superclass chain in environment 0, like the Methods scan', () => {
    const code = buildMethodLookupCode('Object', false, 'printString');
    expect(code).toContain('whichClassIncludesSelector: sel environmentId: 0');
    expect(code).toContain('categoryOfSelector: sel environmentId: 0');
  });

  it('compares class identity, not names, so Unicode7 literals never meet a String', () => {
    const code = buildMethodLookupCode('Object', false, 'printString');
    expect(code).not.toMatch(/ = '/);
  });
});

describe('parseMethodLookupResults', () => {
  it('reads an own method and an inherited one', () => {
    const raw =
      'Globals\tObject\t0\tprintString\tprinting\t\n' +
      'Globals\tCollection\t0\tprintString\tprinting\tOrderedCollection\n';
    expect(parseMethodLookupResults(raw)).toEqual([
      {
        dictName: 'Globals',
        className: 'Object',
        isMeta: false,
        selector: 'printString',
        category: 'printing',
      },
      {
        dictName: 'Globals',
        className: 'Collection',
        isMeta: false,
        selector: 'printString',
        category: 'printing',
        inheritedBy: 'OrderedCollection',
      },
    ]);
  });

  it('skips a line too short to be a row', () => {
    expect(parseMethodLookupResults('Globals\tObject\t0\n')).toEqual([]);
  });

  it('reads the class side', () => {
    const [row] = parseMethodLookupResults('Globals\tString\t1\tnew\tinstance creation\t\n');
    expect(row.isMeta).toBe(true);
  });
});

describe('lookupMethod', () => {
  it('asks the stone nothing for a name that is not a class or a selector', () => {
    const execute = vi.fn(() => '');
    expect(lookupMethod(execute, "Ob'ject", false, 'printString')).toEqual([]);
    expect(lookupMethod(execute, 'Object', false, "print'String")).toEqual([]);
    expect(lookupMethod(execute, 'Object', false, 'a:b')).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns the parsed rows', () => {
    const execute = vi.fn(() => 'Globals\tObject\t0\tprintString\tprinting\t\n');
    expect(lookupMethod(execute, 'Object', false, 'printString')).toHaveLength(1);
  });
});
