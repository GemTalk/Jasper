// SUPPORTED CONFIGURATION: GemStone 3.7.5+ on a rowan3 extent — see
// `../tonelCapability` for the full statement.
//
// Tests for the wire format that carries a parsed Tonel class back from the
// stone. The format exists because METHOD SOURCE IS ARBITRARY TEXT: it contains
// newlines, tabs, single quotes, square brackets and, in the base image,
// occasional control characters. Every delimiter-based framing this project
// already uses (tab-and-newline) would be corrupted by it.
import { describe, it, expect } from 'vitest';

import { decodeTonelClass, encodeTonelClassForTest } from '../tonelWire';

describe('decodeTonelClass', () => {
  const widget = {
    name: 'Widget',
    superclass: 'Object',
    type: 'normal',
    category: 'Widgets',
    comment: 'A widget.',
    instVars: ['size', 'colour'],
    classVars: ['Registry'],
    classInstVars: [],
    pools: [],
    methods: [
      { isMeta: false, selector: 'size', category: 'accessing', source: 'size\n\t^size' },
      {
        isMeta: true,
        selector: 'make',
        category: 'instance creation',
        source: 'make\n\t^self new',
      },
    ],
  };

  it('round-trips a class description', () => {
    expect(decodeTonelClass(encodeTonelClassForTest(widget))).toEqual(widget);
  });

  it('round-trips method source containing the field and record separators', () => {
    // The whole reason for a length-prefixed format. A tab-delimited one would
    // lose the second half of this method.
    const gnarly = {
      ...widget,
      methods: [
        {
          isMeta: false,
          selector: 'awkward',
          category: 'a\tb',
          source: "awkward\n\t\"a ' quote, a ] bracket\"\n\t^#(1 2 3)\n\tx := 'tab\there'.\n",
        },
      ],
    };
    expect(decodeTonelClass(encodeTonelClassForTest(gnarly))).toEqual(gnarly);
  });

  it('round-trips a comment containing newlines and quotes', () => {
    const commented = { ...widget, comment: "Line one.\n\nA 'quoted' word.\nEnd." };
    expect(decodeTonelClass(encodeTonelClassForTest(commented))).toEqual(commented);
  });

  it('round-trips an empty comment and empty variable lists', () => {
    const bare = {
      ...widget,
      comment: '',
      instVars: [],
      classVars: [],
      classInstVars: [],
      pools: [],
      methods: [],
    };
    expect(decodeTonelClass(encodeTonelClassForTest(bare))).toEqual(bare);
  });

  it('rejects a truncated payload instead of half-decoding it', () => {
    // A short read must be loud. Half a class filed in is worse than none, and
    // file-in REPLACES, so a silently truncated method list would delete methods.
    const whole = encodeTonelClassForTest(widget);
    expect(() => decodeTonelClass(whole.slice(0, whole.length - 5))).toThrow(
      /truncat|length|incomplete/i,
    );
  });

  it('rejects a payload whose declared length does not match', () => {
    const whole = encodeTonelClassForTest(widget);
    const corrupted = whole.replace(/^COMMENT\t\d+$/m, 'COMMENT\t999');
    expect(() => decodeTonelClass(corrupted)).toThrow(/truncat|length|incomplete/i);
  });

  it('rejects the same method appearing twice', () => {
    // A class cannot define one selector twice on a side, so a file that carries
    // it twice is malformed. It must not reach file in, where REPLACE means the
    // last one silently wins and the developer never learns the file was wrong.
    // This also backstops the file-out bug that shipped duplicates for days.
    const doubled = {
      ...widget,
      methods: [
        { isMeta: false, selector: 'size', category: 'accessing', source: 'size\n\t^size' },
        { isMeta: false, selector: 'size', category: 'accessing', source: 'size\n\t^0' },
      ],
    };
    expect(() => decodeTonelClass(encodeTonelClassForTest(doubled))).toThrow(/twice|duplicate/i);
  });

  it('allows the same selector on both sides', () => {
    // `Foo >> name` and `Foo class >> name` are different methods.
    const bothSides = {
      ...widget,
      methods: [
        { isMeta: false, selector: 'name', category: 'accessing', source: 'name\n\t^1' },
        { isMeta: true, selector: 'name', category: 'accessing', source: 'name\n\t^2' },
      ],
    };
    expect(decodeTonelClass(encodeTonelClassForTest(bothSides))).toEqual(bothSides);
  });

  it('rejects an unknown record kind rather than ignoring it', () => {
    // Silently skipping an unrecognised record is how a future field gets dropped
    // on the floor and nobody notices until data is missing.
    const whole = encodeTonelClassForTest(widget);
    expect(() => decodeTonelClass(`SURPRISE\t3\nabc\n${whole}`)).toThrow(/unknown|unrecognis/i);
  });
});
