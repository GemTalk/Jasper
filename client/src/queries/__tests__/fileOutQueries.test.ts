import { describe, it, expect, vi } from 'vitest';

import { fileOutHeader } from '../fileOutHeader';
import { fileOutMethod } from '../fileOutMethod';
import { fileOutMethodCategory } from '../fileOutMethodCategory';
import { fileOutDictionary, dictionaryPreamble } from '../fileOutDictionary';
import { fileOutClass, isClassNotFound, CLASS_NOT_FOUND_PREFIX } from '../fileOutClass';

// These queries emit Smalltalk that GemStone runs; the tests pin the parts of the
// emitted text that are load-bearing (which selector is sent, how the receiver is
// scoped, how names are escaped), not its whitespace.
const exec = (result = 'out') => vi.fn().mockReturnValue(result);
const codeOf = (fn: ReturnType<typeof exec>): string => fn.mock.calls[0][0] as string;

describe('fileOutHeader', () => {
  it('emits the fileformat directive Topaz needs, and stamps image and time', async () => {
    const e = exec();
    await fileOutHeader(e);
    const code = codeOf(e);
    expect(code).toContain("nextPutAll: 'fileformat utf8'");
    expect(code).toContain('System _version');
    expect(code).toContain('Date today');
    expect(code).toContain('Time now');
  });

  it('marks the first version line "From" and the rest as bare comments', async () => {
    const e = exec();
    await fileOutHeader(e);
    // Jadeite doubles the marker into `! From ! GemStone/S ...`; this one does not.
    expect(codeOf(e)).toContain("(i = 1 ifTrue: ['! From '] ifFalse: ['! '])");
  });
});

describe('fileOutMethod', () => {
  it('files out one instance-side method in environment 0', async () => {
    const e = exec();
    expect(await fileOutMethod(e, 'Animal', false, 'speak', 3)).toBe('out');
    const code = codeOf(e);
    expect(code).toContain("(System myUserProfile symbolList at: 3) at: #'Animal' ifAbsent: [nil]");
    expect(code).toContain("cls fileOutMethod: #'speak' environmentId: 0");
  });

  it('files out a class-side method against the metaclass', async () => {
    const e = exec();
    await fileOutMethod(e, 'Animal', true, 'new', 3);
    expect(codeOf(e)).toContain("cls class fileOutMethod: #'new' environmentId: 0");
  });

  it('escapes quotes in the class name and keeps a keyword selector intact', async () => {
    const e = exec();
    await fileOutMethod(e, "O'Class", false, 'at:put:');
    const code = codeOf(e);
    expect(code).toContain("#'O''Class'");
    expect(code).toContain("fileOutMethod: #'at:put:'");
  });

  it('raises rather than answering placeholder text when the class is gone', async () => {
    const e = exec();
    await fileOutMethod(e, 'Animal', false, 'speak');
    expect(codeOf(e)).toContain("cls ifNil: [^ Error signal: 'Class not found: Animal']");
  });
});

describe('fileOutMethodCategory', () => {
  it('resolves the category to an ALREADY-INTERNED symbol, never a string literal', async () => {
    const e = exec();
    await fileOutMethodCategory(e, 'Animal', false, 'accessing', 3);
    const code = codeOf(e);
    // A literal would compile to Unicode7 and compare false against the image's
    // Symbol on 3.6.x, so the category would match nothing and the file come out
    // empty; _existingWithAll: also avoids interning a symbol for a failed lookup.
    expect(code).toContain("cat := Symbol _existingWithAll: 'accessing'");
    expect(code).not.toContain("fileOutCategory: 'accessing'");
    expect(code).toContain('cls fileOutCategory: cat');
  });

  it('files out a class-side category against the metaclass', async () => {
    const e = exec();
    await fileOutMethodCategory(e, 'Animal', true, 'instance creation');
    expect(codeOf(e)).toContain('cls class fileOutCategory: cat');
  });

  it('raises when no symbol exists for the category', async () => {
    const e = exec();
    await fileOutMethodCategory(e, 'Animal', false, 'gone');
    expect(codeOf(e)).toContain("cat ifNil: [^ Error signal: 'Method category not found: gone']");
  });
});

describe('dictionaryPreamble', () => {
  it('creates the dictionary only when the reading stone does not have it', () => {
    const preamble = dictionaryPreamble('Zoo');

    // GemStone's own dictionary file-out writes nothing that creates the dictionary,
    // while every class definition in it says `inDictionary: Zoo` — so without this
    // the first chunk fails on an undefined symbol and takes the file with it.
    expect(preamble).toContain("dict := System myUserProfile symbolList objectNamed: #'Zoo'.");
    expect(preamble).toContain('dict isNil ifTrue: [');
    expect(preamble).toContain("dict := SymbolDictionary new name: #'Zoo'; yourself.");
    expect(preamble).toContain('System myUserProfile insertDictionary: dict at: 1.');
  });

  it('is a Topaz run chunk, so a file-in executes it like any other', () => {
    const lines = dictionaryPreamble('Zoo').split('\n');

    expect(lines.filter((l) => l.startsWith('!')).length).toBeGreaterThan(0);
    expect(lines).toContain('run');
    expect(lines[lines.length - 1]).toBe('%');
  });

  it('escapes a quote in the dictionary name', () => {
    expect(dictionaryPreamble("O'Zoo")).toContain("objectNamed: #'O''Zoo'.");
  });

  it('emits no character literal for a quote — 3.6.x cannot compile one in a doit', () => {
    // This is why the preamble is composed here rather than in the doit that fetches
    // the file-out: a `$'` there fails with CompileError 1001 (ComStrmSetCursor).
    expect(dictionaryPreamble("O'Zoo")).not.toContain('$');
  });
});

describe('fileOutDictionary', () => {
  it('asks the organizer for the whole dictionary, resolved by 1-based index', async () => {
    const e = exec('Zoo\nBODY');

    const text = await fileOutDictionary(e, 2);

    const code = codeOf(e);
    expect(code).toContain('System myUserProfile symbolList at: 2 ifAbsent: [nil]');
    expect(code).toContain('ClassOrganizer new fileOutClassesAndMethodsInDictionary: d on: ws');
    expect(text).toContain('BODY');
  });

  it("puts the dictionary-creating preamble in front of the organizer's output", async () => {
    const e = exec('Zoo\nBODY');

    const text = await fileOutDictionary(e, 2);

    expect(text.indexOf("SymbolDictionary new name: #'Zoo'")).toBeLessThan(text.indexOf('BODY'));
  });

  it('takes the name from the image, since the caller may only have an index', async () => {
    const e = exec('Zoo\nBODY');

    await fileOutDictionary(e, 2);

    // First line of the answer is the name; the rest is the file-out.
    expect(codeOf(e)).toContain('ws nextPutAll: d name asString; lf.');
  });

  it('resolves a dictionary by name through the shared helper', async () => {
    const e = exec('UserGlobals\n');
    await fileOutDictionary(e, 'UserGlobals');
    expect(codeOf(e)).toContain("objectNamed: #'UserGlobals'");
  });

  it('raises on a dictionary that no longer exists rather than writing an empty file', async () => {
    const e = exec('X\n');
    await fileOutDictionary(e, 9);
    expect(codeOf(e)).toContain("d ifNil: [^ Error signal: 'Dictionary not found']");
  });

  it('raises on an unnamed dictionary, which no inDictionary: can name', async () => {
    const e = exec('X\n');
    await fileOutDictionary(e, 9);
    expect(codeOf(e)).toContain("d name ifNil: [^ Error signal: 'Dictionary has no name']");
  });

  it('still writes the preamble for a dictionary that holds no classes', async () => {
    const e = exec('Zoo\n');

    const text = await fileOutDictionary(e, 2);

    // An empty dictionary is still a dictionary worth recreating.
    expect(text).toContain("SymbolDictionary new name: #'Zoo'");
  });
});

describe('fileOutClass not-found sentinel', () => {
  it('answers the sentinel as the whole "source" when the class is gone', async () => {
    const e = exec();
    await fileOutClass(e, 'Animal', 3);
    expect(codeOf(e)).toContain(`^ '${CLASS_NOT_FOUND_PREFIX}Animal'`);
  });

  it('recognises the sentinel, and does not mistake real source for it', () => {
    expect(isClassNotFound(`${CLASS_NOT_FOUND_PREFIX}Animal`)).toBe(true);
    expect(isClassNotFound('doit\nObject subclass: #Animal\n%')).toBe(false);
  });
});
