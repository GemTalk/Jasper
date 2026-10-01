// SUPPORTED CONFIGURATION: GemStone 3.7.5+ on a rowan3 extent — see
// `../tonelCapability` for the full statement.
//
// Tests for the three test oracles the Tonel file-out suites judge output with. A wrong
// oracle passes silently and takes the tests it backs with it, so it gets its
// own fixtures — especially `methodBlocksOf`, whose whole job is to be exact.
import { describe, it, expect } from 'vitest';

import {
  headerOf,
  methodBlocksOf,
  declarationsOf,
  declarationSequenceOf,
  duplicateDeclarationsOf,
} from './tonelOracles';

const CLASS_FILE = `"
A comment.
"
Class {
	#name : 'Widget',
	#superclass : 'Object',
	#instVars : [
		'size'
	],
	#category : 'Widgets'
}

{ #category : 'instance creation' }
Widget class >> make [ ^self new
]

{ #category : 'accessing' }
Widget >> size [
	^size
]
`;

describe('headerOf', () => {
  it('keeps the comment and the Class block, and stops at the first method', () => {
    expect(headerOf(CLASS_FILE)).toBe(`"
A comment.
"
Class {
	#name : 'Widget',
	#superclass : 'Object',
	#instVars : [
		'size'
	],
	#category : 'Widgets'
}
`);
  });

  it('normalizes the blank line separating the header from the first method', () => {
    // That whitespace is the separator between the two, belonging to neither, so
    // the header and method-fidelity oracles normalize it. A difference INSIDE the header still fails.
    const oneBlank = `Class {\n\t#name : 'X'\n}\n\n{ #category : 'a' }\nX >> m [\n\t^1\n]\n`;
    const twoBlanks = `Class {\n\t#name : 'X'\n}\n\n\n{ #category : 'a' }\nX >> m [\n\t^1\n]\n`;
    expect(headerOf(oneBlank)).toBe(headerOf(twoBlanks));
    expect(headerOf(oneBlank)).toBe(`Class {\n\t#name : 'X'\n}\n`);
  });

  it('returns the whole text when there are no methods', () => {
    const noMethods = `Class {\n\t#name : 'Empty'\n}\n`;
    expect(headerOf(noMethods)).toBe(noMethods);
  });

  it('is not fooled by a #category: inside method source', () => {
    // A method whose body mentions a category literal must not be read as the
    // start of a new method block — otherwise the header oracle truncates and
    // two different files compare equal.
    const tricky = `Class {\n\t#name : 'X'\n}\n\n{ #category : 'a' }\nX >> m [\n\t^'{ #category : ''fake'' }'\n]\n`;
    expect(headerOf(tricky)).toBe(`Class {\n\t#name : 'X'\n}\n`);
  });
});

describe('methodBlocksOf', () => {
  it('keys each block by its declaration and keeps the block verbatim', () => {
    const blocks = methodBlocksOf(CLASS_FILE);
    expect([...blocks.keys()].sort()).toEqual(['Widget >> size', 'Widget class >> make']);
    expect(blocks.get('Widget >> size')).toBe(
      `{ #category : 'accessing' }\nWidget >> size [\n\t^size\n]\n`,
    );
  });

  it('distinguishes the class side from the instance side', () => {
    const blocks = methodBlocksOf(CLASS_FILE);
    expect(blocks.has('Widget class >> make')).toBe(true);
    expect(blocks.has('Widget >> make')).toBe(false);
  });

  it('finds nothing in a file with no methods', () => {
    expect(methodBlocksOf(`Class {\n\t#name : 'Empty'\n}\n`).size).toBe(0);
  });

  it('keeps a declaration that wraps across lines whole', () => {
    // Rowan wraps long keyword declarations. Two DIFFERENT methods can share a
    // first line — `Array class` really has two `byteSubclass: aString …` methods
    // that differ only in their later keywords — so a key taken from line one
    // alone collides, reporting a false duplicate and hiding a real one.
    const wrapped =
      `Class {\n\t#name : 'X'\n}\n` +
      `\n{ #category : 'a' }\nX class >> big: a\nwith: b\nand: c [\n\t^1\n]\n` +
      `\n{ #category : 'a' }\nX class >> big: a\nwith: b\nor: c [\n\t^2\n]\n`;
    expect([...methodBlocksOf(wrapped).keys()]).toEqual([
      'X class >> big: a with: b and: c',
      'X class >> big: a with: b or: c',
    ]);
    expect(duplicateDeclarationsOf(wrapped)).toEqual([]);
  });

  it('keeps a keyword selector whole', () => {
    const text = `Class {\n\t#name : 'X'\n}\n\n{ #category : 'a' }\nX >> at: k put: v [\n\t^v\n]\n`;
    expect([...methodBlocksOf(text).keys()]).toEqual(['X >> at: k put: v']);
  });
});

describe('duplicateDeclarationsOf', () => {
  it('finds nothing in a well-formed file', () => {
    expect(duplicateDeclarationsOf(CLASS_FILE)).toEqual([]);
  });

  it('names a method emitted twice', () => {
    // The case that was silently passing: every other helper here answers a Map
    // or a sorted set, so a doubled method looked identical to a single one.
    const doubled =
      `Class {\n\t#name : 'X'\n}\n` +
      `\n{ #category : 'a' }\nX >> m [\n\t^1\n]\n` +
      `\n{ #category : 'a' }\nX >> m [\n\t^1\n]\n`;
    expect(duplicateDeclarationsOf(doubled)).toEqual(['X >> m']);
    // And the proof that the other helpers cannot see it:
    expect(methodBlocksOf(doubled).size).toBe(1);
    expect(declarationsOf(doubled).instance).toEqual(['m']);
  });

  it('distinguishes the two sides', () => {
    const bothSides =
      `Class {\n\t#name : 'X'\n}\n` +
      `\n{ #category : 'a' }\nX class >> m [\n\t^1\n]\n` +
      `\n{ #category : 'a' }\nX >> m [\n\t^1\n]\n`;
    expect(duplicateDeclarationsOf(bothSides)).toEqual([]);
  });
});

describe('declarationSequenceOf', () => {
  it('reports declarations in FILE order, not sorted', () => {
    // The whole point: `declarationsOf` sorts and `methodBlocksOf` is a keyed
    // map, so neither can see a scrambled file. This one can.
    expect(declarationSequenceOf(CLASS_FILE)).toEqual(['Widget class >> make', 'Widget >> size']);
  });

  it('preserves an order that is not alphabetical', () => {
    const text =
      `Class {\n\t#name : 'X'\n}\n` +
      `\n{ #category : 'a' }\nX >> zebra [\n\t^1\n]\n` +
      `\n{ #category : 'a' }\nX >> alpha [\n\t^2\n]\n`;
    expect(declarationSequenceOf(text)).toEqual(['X >> zebra', 'X >> alpha']);
  });

  it('finds nothing in a file with no methods', () => {
    expect(declarationSequenceOf(`Class {\n\t#name : 'Empty'\n}\n`)).toEqual([]);
  });

  it('lists a doubled method twice, rather than collapsing it', () => {
    // It must count BLOCKS, not distinct names: a caller comparing this length
    // against the image's selector count is relying on that, and reading the keys
    // of the (Map-backed) methodBlocksOf would hide the very thing we check for.
    const doubled =
      `Class {\n\t#name : 'X'\n}\n` +
      `\n{ #category : 'a' }\nX >> m [\n\t^1\n]\n` +
      `\n{ #category : 'a' }\nX >> m [\n\t^1\n]\n`;
    expect(declarationSequenceOf(doubled)).toEqual(['X >> m', 'X >> m']);
    expect(methodBlocksOf(doubled).size).toBe(1);
  });
});

describe('declarationsOf', () => {
  it('reports the selector set as class-side and instance-side names', () => {
    expect(declarationsOf(CLASS_FILE)).toEqual({
      instance: ['size'],
      meta: ['make'],
    });
  });

  it('reduces a keyword declaration to its selector', () => {
    const text = `Class {\n\t#name : 'X'\n}\n\n{ #category : 'a' }\nX >> at: k put: v [\n\t^v\n]\n`;
    expect(declarationsOf(text)).toEqual({ instance: ['at:put:'], meta: [] });
  });

  it('reduces a binary declaration to its selector', () => {
    const text = `Class {\n\t#name : 'X'\n}\n\n{ #category : 'a' }\nX >> + other [\n\t^other\n]\n`;
    expect(declarationsOf(text)).toEqual({ instance: ['+'], meta: [] });
  });
});
