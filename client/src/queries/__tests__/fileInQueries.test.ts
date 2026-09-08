import { describe, it, expect, vi } from 'vitest';

import { fileInChunk } from '../fileInChunk';
import { removeAllMethods } from '../removeAllMethods';

const exec = (result = 'ok') => vi.fn().mockReturnValue(result);
const codeOf = (fn: ReturnType<typeof exec>): string => fn.mock.calls[0][0] as string;

describe('fileInChunk', () => {
  it('wraps the chunk in a block so its temporaries stay legal', () => {
    const e = exec();

    expect(fileInChunk(e, "| d |\nd := Dictionary new.\nd at: 1 put: 'x'")).toBe('ok');
    expect(codeOf(e)).toBe("[| d |\nd := Dictionary new.\nd at: 1 put: 'x'] ensure: [^ 'ok']");
  });

  it("discards the value through ensure:, so a chunk ending in ^ still answers 'ok'", () => {
    const e = exec();

    fileInChunk(e, '^ws contents');

    // A hand-written topaz script routinely ends a `run` chunk with `^`. That is a
    // non-local return: it exits the whole doit, so a trailing `. 'ok'` would never
    // run and the doit would answer the chunk's own object instead of a String.
    // An ensure: block runs however the protected block exits.
    expect(codeOf(e)).toBe("[^ws contents] ensure: [^ 'ok']");
    expect(codeOf(e)).not.toContain("value. 'ok'");
  });

  it("answers 'ok' rather than the chunk's own value", () => {
    const e = exec();
    fileInChunk(e, 'UserGlobals');
    // Filing in a dictionary evaluates a chunk whose value IS the dictionary;
    // printString on that would drag a large object across the wire for nothing.
    expect(codeOf(e)).not.toContain('printString');
    expect(codeOf(e)).toContain("'ok'");
  });

  it('does not swallow the exception, so a failed chunk is distinguishable', () => {
    const e = exec();
    fileInChunk(e, "Object subclass: 'Animal'");
    // executeCode's workspace wrapper folds errors into an 'Error: ...' string; a
    // file-in has to be able to report the chunk that failed against its line.
    expect(codeOf(e)).not.toContain('on: AbstractException');
    expect(codeOf(e)).not.toContain('AlmostOutOfStack');
  });
});

describe('removeAllMethods', () => {
  it('removes the instance side through a global class lookup', () => {
    const e = exec();

    expect(removeAllMethods(e, 'Animal', false)).toBe('ok');
    const code = codeOf(e);
    // A file-out names its classes as bare globals, so the file-in binds them the
    // same way — no dictionary scope.
    expect(code).toContain("System myUserProfile symbolList objectNamed: #'Animal'");
    expect(code).toContain('cls removeAllMethods');
  });

  it('removes the class side via the metaclass — GemStone has no removeAllClassMethods', () => {
    const e = exec();

    removeAllMethods(e, 'Animal', true);

    expect(codeOf(e)).toContain('cls class removeAllMethods');
  });

  it('raises on a name that is not a class, rather than reporting a removal', () => {
    const e = exec();

    removeAllMethods(e, "O'Animal", false);

    const code = codeOf(e);
    expect(code).toContain("cls ifNil: [^ Error signal: 'Class not found: O''Animal']");
    expect(code).toContain("cls isBehavior ifFalse: [^ Error signal: 'Not a class: O''Animal']");
  });
});
