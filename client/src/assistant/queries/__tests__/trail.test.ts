import { describe, expect, it } from 'vitest';
import { findFocus, matchTrail, trailCode, type TrailStep } from '../trail';
import type { MethodSearchResult } from '../../../queries/methodSearch';

function step(className: string, selector: string, classSide = false): TrailStep {
  return { className, selector, classSide, note: `${selector} note` };
}

function method(className: string, selector: string, isMeta = false): MethodSearchResult {
  return { dictName: 'UserGlobals', className, isMeta, selector, category: 'x', environmentId: 0 };
}

describe('a trail of methods to read', () => {
  it('keeps each step with its note, in the order given', () => {
    const steps = [step('Order', 'total'), step('Order', 'tax'), step('Order', 'new', true)];

    const { found, missing } = matchTrail(steps, [
      method('Order', 'total'),
      method('Order', 'tax'),
      method('Order', 'new', true),
    ]);

    expect(found.map((f) => [f.method.selector, f.note])).toEqual([
      ['total', 'total note'],
      ['tax', 'tax note'],
      ['new', 'new note'],
    ]);
    expect(missing).toEqual([]);
  });

  it('names the steps whose method does not exist, and keeps the rest in order', () => {
    const steps = [step('Order', 'total'), step('Order', 'nope'), step('Order', 'tax')];

    const { found, missing } = matchTrail(steps, [
      method('Order', 'total'),
      method('Order', 'tax'),
    ]);

    expect(found.map((f) => f.note)).toEqual(['total note', 'tax note']);
    expect(missing.map((s) => s.selector)).toEqual(['nope']);
  });

  it('accepts an inherited method found in a superclass, on either side', () => {
    const { found } = matchTrail([step('Order', 'new', true)], [method('Class', 'new')]);

    expect(found.map((f) => f.method.className)).toEqual(['Class']);
  });

  it('never puts a step with an invalid selector into the Smalltalk', () => {
    const code = trailCode([step('Order', "x']. System logout. #['")]);

    expect(code).not.toContain('logout');
  });
});

describe("finding a step's code of interest in its method", () => {
  const source = 'run\n  | m |\n  m := self matcher.\n  ^m matchesIn: [:x | x size > 2]';

  it('finds code copied exactly', () => {
    const found = findFocus(source, 'm := self matcher.');

    expect(source.slice(found!.start, found!.end)).toBe('m := self matcher.');
  });

  it('finds code whose spaces and line breaks differ from the source', () => {
    const found = findFocus(source, 'm := self matcher.\n^m   matchesIn: [:x | x size > 2]');

    expect(source.slice(found!.start, found!.end)).toBe(
      'm := self matcher.\n  ^m matchesIn: [:x | x size > 2]',
    );
  });

  it('finds nothing for code the method does not hold', () => {
    expect(findFocus(source, 'self halt')).toBeUndefined();
  });
});
