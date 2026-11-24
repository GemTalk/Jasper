import { describe, it, expect } from 'vitest';
import { compareMethods, compareNames } from '../methodOrder';

describe('the one order for selectors and method category names', () => {
  it('keeps every operator and private _ method together ahead of the letters', () => {
    // GemStone's own sort puts \\, _foo and ~= after Z; plain .sort() puts \\ and _foo
    // between the capitals and the lower case. VS Code's file-name rule keeps them together.
    const stoneOrder = [
      '/',
      '//',
      '<',
      '=',
      '>=',
      'abs',
      'rem:',
      'Zed',
      '\\\\',
      '_bottomBit',
      '~=',
    ];
    expect([...stoneOrder].sort(compareNames)).toEqual([
      '_bottomBit',
      '/',
      '//',
      '\\\\',
      '<',
      '=',
      '>=',
      '~=',
      'abs',
      'rem:',
      'Zed',
    ]);
  });

  it('ignores case, so capitalised selectors sit among the lower-case ones', () => {
    expect(['beta', 'Zulu', 'alpha'].sort(compareNames)).toEqual(['alpha', 'beta', 'Zulu']);
  });

  it('puts the capitalised one first when two names differ only in case or accent, as VS Code does', () => {
    expect(['at:', 'resume', 'résumé', 'At:', 'Resume'].sort(compareNames)).toEqual([
      'At:',
      'at:',
      'Resume',
      'resume',
      'résumé',
    ]);
  });

  it('orders the digits in a name by value, as VS Code orders file names', () => {
    expect(['test10', 'test2', 'test1'].sort(compareNames)).toEqual(['test1', 'test2', 'test10']);
  });

  it('puts a keyword selector before its longer forms', () => {
    expect(['at:put:', 'at:', 'printString', 'printOn:'].sort(compareNames)).toEqual([
      'at:',
      'at:put:',
      'printOn:',
      'printString',
    ]);
  });

  it('never calls two different names equal, so the order does not depend on the input order', () => {
    // Canonically equivalent spellings collate as equal; the result must still be stable.
    const composed = 'café';
    const decomposed = 'café';
    expect(compareNames(composed, decomposed)).not.toBe(0);
    expect(Math.sign(compareNames(composed, decomposed))).toBe(
      -Math.sign(compareNames(decomposed, composed)),
    );
    expect(compareNames('same', 'same')).toBe(0);
  });
});

describe('compareMethods: the one order for methods across classes', () => {
  const row = (
    className: string,
    isMeta: boolean,
    selector: string,
    extra: { dictName?: string; environmentId?: number } = {},
  ) => ({ className, isMeta, selector, ...extra });

  it('sorts by class name, then instance side before class side, then selector', () => {
    const rows = [
      row('Zed', false, 'a'),
      row('Array', true, 'new:'),
      row('Array', false, 'size'),
      row('Array', false, '_basicSize'),
      row('array2', false, 'x'),
    ];
    expect(rows.sort(compareMethods)).toEqual([
      row('Array', false, '_basicSize'),
      row('Array', false, 'size'),
      row('Array', true, 'new:'),
      row('array2', false, 'x'),
      row('Zed', false, 'a'),
    ]);
  });

  it('uses the same name rule for class names and selectors', () => {
    const rows = [
      row('Foo10', false, 'test10'),
      row('Foo2', false, 'test2'),
      row('Foo2', false, '\\\\'),
    ];
    expect(rows.sort(compareMethods)).toEqual([
      row('Foo2', false, '\\\\'),
      row('Foo2', false, 'test2'),
      row('Foo10', false, 'test10'),
    ]);
  });

  it('breaks a tie on the dictionary, then on the environment, last', () => {
    const rows = [
      row('Foo', false, 'bar', { dictName: 'UserGlobals', environmentId: 1 }),
      row('Foo', false, 'bar', { dictName: 'UserGlobals', environmentId: 0 }),
      row('Foo', false, 'bar', { dictName: 'Globals', environmentId: 2 }),
    ];
    expect(rows.sort(compareMethods)).toEqual([
      row('Foo', false, 'bar', { dictName: 'Globals', environmentId: 2 }),
      row('Foo', false, 'bar', { dictName: 'UserGlobals', environmentId: 0 }),
      row('Foo', false, 'bar', { dictName: 'UserGlobals', environmentId: 1 }),
    ]);
  });
});
