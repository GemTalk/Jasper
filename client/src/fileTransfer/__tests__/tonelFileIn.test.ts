// SUPPORTED CONFIGURATION: GemStone 3.7.5+ on a rowan3 extent — see
// `../../queries/tonel/tonelCapability` for the full statement.
//
// Applying a parsed Tonel class to the image — the half of file in that WRITES.
//
// File out reads and cannot damage anything. This replaces a class's behaviour,
// so most of these cases are about refusing to do half a job: nothing is created
// when the superclass is missing, nothing is written when the class is
// read-only, and a single bad method does not cost the other twenty.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('fs', () => ({ readFileSync: vi.fn() }));
vi.mock('../../browserQueries', () => ({
  getDictionaryNames: vi.fn(() => ['UserGlobals', 'Globals', 'Published']),
  executeFetchString: vi.fn(() => ''),
  tonelCapability: vi.fn(() => ({ available: true, missing: [] })),
  compileClassDefinition: vi.fn(() => 'Widget'),
  setClassComment: vi.fn(() => 'ok'),
  compileMethod: vi.fn(() => 'Compiled'),
  removeAllMethods: vi.fn(() => 'ok'),
  canClassBeWritten: vi.fn(() => true),
  dictionariesContainingClass: vi.fn(() => []),
  recategorizeClass: vi.fn(() => 'Recategorized: Widget'),
}));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import * as fs from 'fs';
import { applyTonelClass, chooseTonelDictionary, fileInTonelUri } from '../tonelFileIn';
import type { TonelClass } from '../../queries/tonel/tonelWire';

// A FRESH session object per test: the Tonel capability answer is cached per
// session (tonelAvailability.ts), so a shared object would let one test's probe
// answer decide another's.
let SESSION: ActiveSession;
beforeEach(() => {
  SESSION = { id: 1 } as ActiveSession;
});

const widget = (overrides: Partial<TonelClass> = {}): TonelClass => ({
  name: 'Widget',
  superclass: 'Object',
  type: 'normal',
  category: 'Widgets',
  comment: 'A widget.',
  instVars: ['size', 'colour'],
  classVars: ['Registry'],
  classInstVars: [],
  pools: [],
  options: [],
  uncarried: [],
  methods: [
    { isMeta: false, selector: 'size', category: 'accessing', source: 'size\n\t^size' },
    { isMeta: true, selector: 'make', category: 'instance creation', source: 'make\n\t^self new' },
  ],
  ...overrides,
});

const definitionSource = (): string => vi.mocked(queries.compileClassDefinition).mock.calls[0][1];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(queries.compileClassDefinition).mockReturnValue('Widget');
  vi.mocked(queries.setClassComment).mockReturnValue('ok');
  vi.mocked(queries.compileMethod).mockReturnValue('Compiled');
  vi.mocked(queries.removeAllMethods).mockReturnValue('ok');
  vi.mocked(queries.canClassBeWritten).mockReturnValue(true);
  // The ordinary case: a NEW class whose superclass already exists. Tests that
  // care about either half override this.
  vi.mocked(queries.dictionariesContainingClass).mockImplementation((_s, name) =>
    name === 'Widget' ? [] : ['Globals'],
  );
  // Real VS Code always answers a Thenable from these; the mock defaults to
  // undefined, which the reporting path awaits.
  vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined);
  vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
});

describe('applyTonelClass — the class definition', () => {
  it('creates the class in the dictionary it was given', () => {
    applyTonelClass(SESSION, widget(), 'UserGlobals');
    expect(definitionSource()).toContain('inDictionary: UserGlobals');
  });

  it('carries the superclass, instance variables and class variables across', () => {
    applyTonelClass(SESSION, widget(), 'UserGlobals');
    const source = definitionSource();
    expect(source).toContain("Object subclass: 'Widget'");
    expect(source).toContain("instVarNames: #('size' 'colour')");
    expect(source).toContain("classVars: #('Registry')");
  });

  it('carries class-instance variables and pool dictionaries across', () => {
    applyTonelClass(
      SESSION,
      widget({ classInstVars: ['Count'], pools: ['SharedPool'] }),
      'UserGlobals',
    );
    const source = definitionSource();
    expect(source).toContain("classInstVars: #('Count')");
    expect(source).toContain('poolDictionaries: #(SharedPool)');
  });

  it('creates an indexable class for a variable type', () => {
    applyTonelClass(SESSION, widget({ type: 'variable' }), 'UserGlobals');
    expect(definitionSource()).toContain("indexableSubclass: 'Widget'");
  });

  it('creates a byte class for Rowan’s byteSubclass type', () => {
    // Rowan's parser answers 'byteSubclass', not 'bytes' — measured on a 3.7.5
    // rowan3 stone. Keying the map on 'bytes' made every byte class fail file-in
    // with "Unsupported class type 'byteSubclass'".
    applyTonelClass(SESSION, widget({ type: 'byteSubclass' }), 'UserGlobals');
    expect(definitionSource()).toContain("byteSubclass: 'Widget'");
  });

  it('omits instVarNames: for a byte class, which GemStone does not accept there', () => {
    // `byteSubclass:instVarNames:…` is not understood on a 3.7.5 stone; the byte
    // form takes classVars: directly. Emitting instVarNames: anyway made the
    // definition fail to compile even once the type key was right.
    applyTonelClass(SESSION, widget({ type: 'byteSubclass', instVars: [] }), 'UserGlobals');
    expect(definitionSource()).not.toContain('instVarNames:');
    expect(definitionSource()).toContain('classVars:');
  });

  it('refuses the immediate type rather than building a normal class', () => {
    // 29 classes in the shipped 3.7.5 corpus are #type : 'immediate', and GemStone
    // exposes no immediateSubclass: creation selector, so there is nothing to do
    // but name it.
    const outcome = applyTonelClass(SESSION, widget({ type: 'immediate' }), 'UserGlobals');
    expect(queries.compileClassDefinition).not.toHaveBeenCalled();
    expect(outcome.errors[0].message).toMatch(/immediate/);
  });

  it('refuses a class type it does not understand rather than guessing', () => {
    // Silently creating a normal class for an unrecognised type would produce a
    // class of the wrong shape that looks like it filed in fine.
    const outcome = applyTonelClass(SESSION, widget({ type: 'quasiIndexable' }), 'UserGlobals');
    expect(queries.compileClassDefinition).not.toHaveBeenCalled();
    expect(outcome.errors[0].message).toMatch(/class type/i);
  });
});

describe('applyTonelClass — the class comment', () => {
  it('sets the comment the file carries', () => {
    applyTonelClass(SESSION, widget(), 'UserGlobals');
    expect(queries.setClassComment).toHaveBeenCalledWith(
      SESSION,
      'Widget',
      'A widget.',
      'UserGlobals',
    );
  });

  it('clears the comment when the file carries none', () => {
    // Replace semantics reach the comment too: a file with no comment means the
    // class has no comment, not "leave whatever was there".
    applyTonelClass(SESSION, widget({ comment: '' }), 'UserGlobals');
    expect(queries.setClassComment).toHaveBeenCalledWith(SESSION, 'Widget', '', 'UserGlobals');
  });

  it('reports a comment that will not set, without failing the rest', () => {
    vi.mocked(queries.setClassComment).mockImplementation(() => {
      throw new Error('no write permission');
    });
    const outcome = applyTonelClass(SESSION, widget(), 'UserGlobals');
    expect(outcome.compiled).toBe(2);
    expect(outcome.errors[0].message).toMatch(/comment/i);
  });
});

describe('applyTonelClass — replace, not merge', () => {
  it('clears both sides before compiling the file’s methods', () => {
    applyTonelClass(SESSION, widget(), 'UserGlobals');
    expect(queries.removeAllMethods).toHaveBeenCalledWith(SESSION, 'Widget', false, 'UserGlobals');
    expect(queries.removeAllMethods).toHaveBeenCalledWith(SESSION, 'Widget', true, 'UserGlobals');
  });

  it('clears AFTER defining, so the clear lands on the version the file describes', () => {
    // A reshape creates a new class version; clearing before defining would empty
    // the OLD version and leave the new one untouched.
    applyTonelClass(SESSION, widget(), 'UserGlobals');
    const defineOrder = vi.mocked(queries.compileClassDefinition).mock.invocationCallOrder[0];
    const clearOrder = vi.mocked(queries.removeAllMethods).mock.invocationCallOrder[0];
    expect(defineOrder).toBeLessThan(clearOrder);
  });

  it('compiles the file’s methods after clearing', () => {
    applyTonelClass(SESSION, widget(), 'UserGlobals');
    const clearOrder = vi.mocked(queries.removeAllMethods).mock.invocationCallOrder[0];
    const compileOrder = vi.mocked(queries.compileMethod).mock.invocationCallOrder[0];
    expect(clearOrder).toBeLessThan(compileOrder);
  });
});

describe('applyTonelClass — the methods', () => {
  it('compiles each method with its own protocol and side', () => {
    applyTonelClass(SESSION, widget(), 'UserGlobals');
    expect(queries.compileMethod).toHaveBeenCalledWith(
      SESSION,
      'Widget',
      false,
      'accessing',
      'size\n\t^size',
      0,
      'UserGlobals',
    );
    expect(queries.compileMethod).toHaveBeenCalledWith(
      SESSION,
      'Widget',
      true,
      'instance creation',
      'make\n\t^self new',
      0,
      'UserGlobals',
    );
  });

  it('counts what went in', () => {
    const outcome = applyTonelClass(SESSION, widget(), 'UserGlobals');
    expect(outcome.compiled).toBe(2);
    expect(outcome.errors).toEqual([]);
  });

  it('keeps going when one method will not compile', () => {
    // A developer filing in a class with one bad method wants the other
    // nineteen compiled and the bad one named.
    vi.mocked(queries.compileMethod).mockImplementation((_s, _c, isMeta) => {
      if (isMeta) throw new Error('parse error at line 2');
      return 'Compiled';
    });
    const outcome = applyTonelClass(SESSION, widget(), 'UserGlobals');
    expect(outcome.compiled).toBe(1);
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0].message).toContain('parse error at line 2');
  });

  it('names the selector that failed', () => {
    vi.mocked(queries.compileMethod).mockImplementation((_s, _c, isMeta) => {
      if (isMeta) throw new Error('nope');
      return 'Compiled';
    });
    const outcome = applyTonelClass(SESSION, widget(), 'UserGlobals');
    expect(outcome.errors[0].message).toContain('make');
  });

  it('files in a class with no methods at all', () => {
    const outcome = applyTonelClass(SESSION, widget({ methods: [] }), 'UserGlobals');
    expect(outcome.compiled).toBe(0);
    expect(outcome.errors).toEqual([]);
    expect(queries.compileClassDefinition).toHaveBeenCalled();
  });
});

describe('applyTonelClass — refusing to do half a job', () => {
  it('reports a superclass that does not resolve and creates nothing', () => {
    vi.mocked(queries.dictionariesContainingClass).mockReturnValue([]);
    const outcome = applyTonelClass(SESSION, widget({ superclass: 'NoSuchThing' }), 'UserGlobals');
    expect(queries.compileClassDefinition).not.toHaveBeenCalled();
    expect(queries.removeAllMethods).not.toHaveBeenCalled();
    expect(outcome.errors[0].message).toContain('NoSuchThing');
  });

  it('accepts a superclass that resolves somewhere in the symbol list', () => {
    vi.mocked(queries.dictionariesContainingClass).mockImplementation((_s, name) =>
      name === 'Object' ? ['Globals'] : [],
    );
    const outcome = applyTonelClass(SESSION, widget(), 'UserGlobals');
    expect(queries.compileClassDefinition).toHaveBeenCalled();
    expect(outcome.errors).toEqual([]);
  });

  it('allows a root class whose superclass is nil', () => {
    const outcome = applyTonelClass(SESSION, widget({ superclass: 'nil' }), 'UserGlobals');
    expect(definitionSource()).toContain("nil subclass: 'Widget'");
    expect(outcome.errors).toEqual([]);
  });

  it('refuses a class that cannot be written, and removes nothing', () => {
    // The class already exists — that is when writability is asked at all.
    vi.mocked(queries.dictionariesContainingClass).mockReturnValue(['Globals']);
    vi.mocked(queries.canClassBeWritten).mockReturnValue(false);
    const outcome = applyTonelClass(SESSION, widget(), 'Globals');
    expect(queries.removeAllMethods).not.toHaveBeenCalled();
    expect(queries.compileClassDefinition).not.toHaveBeenCalled();
    expect(outcome.errors[0].message).toMatch(/read-only|cannot be written/i);
  });

  it('does not ask whether a NEW class can be written', () => {
    // canBeWritten on a class that does not exist yet answers false; asking would
    // refuse every new class.
    applyTonelClass(SESSION, widget(), 'UserGlobals');
    expect(queries.canClassBeWritten).not.toHaveBeenCalled();
    expect(queries.compileClassDefinition).toHaveBeenCalled();
  });

  it('stops after a failed class definition instead of compiling methods into nothing', () => {
    vi.mocked(queries.compileClassDefinition).mockImplementation(() => {
      throw new Error('a SecurityError occurred');
    });
    const outcome = applyTonelClass(SESSION, widget(), 'UserGlobals');
    expect(queries.compileMethod).not.toHaveBeenCalled();
    expect(outcome.errors[0].message).toContain('SecurityError');
  });
});

describe('applyTonelClass — what it must never do', () => {
  it('never commits', () => {
    // Matches chunk file-in and the rest of Jasper: the session is left dirty and
    // the developer decides. There is no commit query in the module's imports, so
    // this asserts on the mocked surface as a whole.
    applyTonelClass(SESSION, widget(), 'UserGlobals');
    expect(Object.keys(queries)).not.toContain('commitTransaction');
  });

  it('reports which dictionary it used', () => {
    const outcome = applyTonelClass(SESSION, widget(), 'UserGlobals');
    expect(outcome.dictionary).toBe('UserGlobals');
    expect(outcome.className).toBe('Widget');
  });
});

describe('fileInTonelUri — reporting a parse failure', () => {
  it('reports the line the parse failed on, not the top of the file', async () => {
    // What the developer sees in the GemStone File In channel. `…:1` on a 500-line
    // file says "it is broken, go find it"; the real line says where.
    const text = `Class {\n\t#name : 'X'\n}\n\n{ #category : 'a' }\nX >> m [\n`;
    vi.mocked(fs.readFileSync).mockReturnValue(text);
    vi.mocked(queries.tonelCapability).mockReturnValue({ available: true, missing: [] });
    vi.mocked(queries.executeFetchString).mockReturnValue(
      `!ERR ${text.indexOf('X >> m')}\tInvalid class name`,
    );

    const outcome = await fileInTonelUri(SESSION, '/tmp/X.class.st');

    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0].line).toBe(6);
    expect(outcome.errors[0].message).toBe('Invalid class name');
    // Counted as a file attempted, so a mixed selection's totals add up.
    expect(outcome.files).toBe(1);
  });

  it('names the FILE in its errors, not the class', async () => {
    // The log prints `<file>:<line>`, and in a multi-file selection the class name
    // alone would not say which file the failure came from.
    const text = `Class {\n\t#name : 'Widget'\n}\n`;
    vi.mocked(fs.readFileSync).mockReturnValue(text);
    vi.mocked(queries.tonelCapability).mockReturnValue({ available: true, missing: [] });
    vi.mocked(queries.dictionariesContainingClass).mockReturnValue(['UserGlobals']);
    vi.mocked(queries.executeFetchString).mockReturnValue(
      'NAME\t6\nWidget\nSUPER\t6\nObject\nTYPE\t6\nnormal\n' +
        'CATEGORY\t1\nX\nCOMMENT\t0\n\nIVARS\t0\n\nCVARS\t0\n\nCIVARS\t0\n\nPOOLS\t0\n\n' +
        'IMETHOD\t18\nm\naccessing\n\t^1\n',
    );
    vi.mocked(queries.compileMethod).mockImplementation(() => {
      throw new Error('nope');
    });

    const outcome = await fileInTonelUri(SESSION, '/tmp/Widget.class.st');
    expect(outcome.errors[0].file).toBe('/tmp/Widget.class.st');
  });

  it('records a refusal so the log agrees with the warning', async () => {
    vi.mocked(queries.tonelCapability).mockReturnValue({ available: false, missing: ['x'] });
    const outcome = await fileInTonelUri(SESSION, '/tmp/X.class.st');
    expect(outcome.errors[0].message).toMatch(/3\.7\.5|rowan3/);
    expect(outcome.compiled).toBe(0);
  });
});

describe('chooseTonelDictionary', () => {
  // Tonel carries no dictionary — its `#category` is a PACKAGE — so the target has
  // to come from the image or from the user. Defaulting to where the class already
  // lives is what makes filing a class back in a one-click operation.
  it("uses the class's own dictionary without asking", async () => {
    vi.mocked(queries.dictionariesContainingClass).mockReturnValue(['Globals']);
    await expect(chooseTonelDictionary(SESSION, 'Widget')).resolves.toBe('Globals');
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it('asks when the class lives in more than one dictionary', async () => {
    // A shadowed name must never be resolved by guess: picking the first would
    // silently write to whichever happens to come first in the symbol list.
    vi.mocked(queries.dictionariesContainingClass).mockReturnValue(['UserGlobals', 'Globals']);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue('Globals' as never);
    await expect(chooseTonelDictionary(SESSION, 'Widget')).resolves.toBe('Globals');
    const offered = vi.mocked(vscode.window.showQuickPick).mock.calls[0][0];
    expect(offered).toEqual(['UserGlobals', 'Globals']);
  });

  it('asks from every dictionary when the class is new', async () => {
    vi.mocked(queries.dictionariesContainingClass).mockReturnValue([]);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue('UserGlobals' as never);
    await expect(chooseTonelDictionary(SESSION, 'Widget')).resolves.toBe('UserGlobals');
    expect(vi.mocked(vscode.window.showQuickPick).mock.calls[0][0]).toEqual([
      'UserGlobals',
      'Globals',
      'Published',
    ]);
  });

  it('answers undefined when the user dismisses the prompt', async () => {
    // Cancelling must file nothing in, not fall back to a default.
    vi.mocked(queries.dictionariesContainingClass).mockReturnValue([]);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);
    await expect(chooseTonelDictionary(SESSION, 'Widget')).resolves.toBeUndefined();
  });
});

describe('applyTonelClass — every write lands in the chosen dictionary', () => {
  // The whole point of chooseTonelDictionary is the case where the name lives in
  // more than one dictionary. Resolving the bare name for the writes that follow
  // the definition binds to the FIRST dictionary in the symbol list instead, so
  // picking the second one silently gutted the first one's class and left the
  // chosen one with a definition and no methods.
  const twoDictionaries = () => {
    vi.mocked(queries.dictionariesContainingClass).mockReturnValue(['UserGlobals', 'Globals']);
  };

  it('scopes the class definition, comment, clear and compile to one dictionary', () => {
    twoDictionaries();
    applyTonelClass(SESSION, widget(), 'Globals');

    expect(vi.mocked(queries.compileClassDefinition).mock.calls[0][1]).toContain(
      'inDictionary: Globals',
    );
    expect(queries.setClassComment).toHaveBeenCalledWith(SESSION, 'Widget', 'A widget.', 'Globals');
    expect(queries.removeAllMethods).toHaveBeenCalledWith(SESSION, 'Widget', false, 'Globals');
    expect(queries.removeAllMethods).toHaveBeenCalledWith(SESSION, 'Widget', true, 'Globals');
    for (const call of vi.mocked(queries.compileMethod).mock.calls) {
      expect(call[6]).toBe('Globals');
    }
  });

  it('asks whether the class is writable in the chosen dictionary, not anywhere', () => {
    twoDictionaries();
    applyTonelClass(SESSION, widget(), 'Globals');
    expect(queries.canClassBeWritten).toHaveBeenCalledWith(SESSION, 'Widget', 'Globals');
  });

  it('files a new class in even though a read-only class of that name exists elsewhere', () => {
    // The class is in Globals only; the user is filing into UserGlobals, where
    // there is no Widget at all. A refusal here is about a class they never named.
    vi.mocked(queries.dictionariesContainingClass).mockImplementation((_s, name) =>
      name === 'Widget' ? ['Globals'] : ['Globals'],
    );
    vi.mocked(queries.canClassBeWritten).mockReturnValue(false);

    const outcome = applyTonelClass(SESSION, widget(), 'UserGlobals');

    expect(outcome.errors).toEqual([]);
    expect(queries.compileClassDefinition).toHaveBeenCalled();
  });

  it('still refuses when the class in the CHOSEN dictionary is read-only', () => {
    vi.mocked(queries.dictionariesContainingClass).mockReturnValue(['Globals']);
    vi.mocked(queries.canClassBeWritten).mockReturnValue(false);

    const outcome = applyTonelClass(SESSION, widget(), 'Globals');

    expect(queries.compileClassDefinition).not.toHaveBeenCalled();
    expect(outcome.errors[0].message).toMatch(/Globals/);
    // Names the login, not the class: canBeWritten is an authorization answer, and
    // every Globals class is writable as SystemUser and none as DataCurator.
    expect(outcome.errors[0].message).toMatch(/SystemUser/);
  });
});

describe('applyTonelClass — properties beyond the class shape', () => {
  it('carries #gs_options into the definition', () => {
    // A dbTransient class filed back in without its options is an ordinary
    // persistent class that looks like it filed in cleanly.
    applyTonelClass(SESSION, widget({ options: ['dbTransient'] }), 'UserGlobals');
    expect(definitionSource()).toContain('options: #(dbTransient)');
  });

  it('omits options: entirely when the file carries none', () => {
    applyTonelClass(SESSION, widget(), 'UserGlobals');
    expect(definitionSource()).not.toContain('options:');
  });

  it('restores the class category, which no creation selector carries', () => {
    applyTonelClass(SESSION, widget(), 'UserGlobals');
    expect(queries.recategorizeClass).toHaveBeenCalledWith(
      SESSION,
      'Widget',
      'Widgets',
      'UserGlobals',
    );
  });

  it('does not recategorize when the file carries no category', () => {
    applyTonelClass(SESSION, widget({ category: '' }), 'UserGlobals');
    expect(queries.recategorizeClass).not.toHaveBeenCalled();
  });

  it('reports properties it does not apply instead of dropping them silently', () => {
    const outcome = applyTonelClass(
      SESSION,
      widget({ uncarried: ['gs_reservedoop', 'gs_constraints'] }),
      'UserGlobals',
    );
    expect(outcome.errors.map((e) => e.message).join('\n')).toMatch(
      /gs_reservedoop, gs_constraints.*not applied/,
    );
    // Reported, but the class and its methods still go in.
    expect(outcome.compiled).toBe(2);
  });

  it('refuses a pool or option name that is not a Smalltalk identifier', () => {
    // These are spliced into the doit unquoted, so a name that is not an
    // identifier would change the shape of the generated Smalltalk.
    const outcome = applyTonelClass(
      SESSION,
      widget({ options: ['dbTransient) foo: #('] }),
      'UserGlobals',
    );
    expect(queries.compileClassDefinition).not.toHaveBeenCalled();
    expect(outcome.errors[0].message).toMatch(/not usable as a name/);
  });

  it('doubles a quote in the class name rather than ending the literal', () => {
    applyTonelClass(SESSION, widget({ name: "Odd'Name" }), 'UserGlobals');
    expect(definitionSource()).toContain("subclass: 'Odd''Name'");
  });
});

describe('fileInTonelUri — dismissing the dictionary prompt', () => {
  /** A minimal wire answer for a class called Widget with no methods. */
  const WIRE =
    'NAME\t6\nWidget\nSUPER\t6\nObject\nTYPE\t6\nnormal\n' +
    'CATEGORY\t1\nX\nCOMMENT\t0\n\nIVARS\t0\n\nCVARS\t0\n\nCIVARS\t0\n\nPOOLS\t0\n\n' +
    'OPTIONS\t0\n\nUNCARRIED\t0\n\n';

  beforeEach(() => {
    vi.mocked(fs.readFileSync).mockReturnValue(`Class {\n\t#name : 'Widget'\n}\n`);
    vi.mocked(queries.tonelCapability).mockReturnValue({ available: true, missing: [] });
    vi.mocked(queries.executeFetchString).mockReturnValue(WIRE);
  });

  it('records which file was not filed in, rather than doing nothing silently', async () => {
    vi.mocked(queries.dictionariesContainingClass).mockReturnValue(['UserGlobals', 'Globals']);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

    const outcome = await fileInTonelUri(SESSION, '/tmp/Widget.st');

    expect(outcome.compiled).toBe(0);
    expect(outcome.skipped).toHaveLength(1);
    expect(outcome.skipped[0].message).toMatch(/not filed in/);
    expect(outcome.skipped[0].file).toBe('/tmp/Widget.st');
  });

  it('marks the run cancelled, so the rest are not prompted for one by one', async () => {
    // With several files picked, dismissing is the only way to stop. Without this
    // the user gets one prompt per remaining file and no record of any of them.
    vi.mocked(queries.dictionariesContainingClass).mockReturnValue(['UserGlobals', 'Globals']);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

    const outcome = await fileInTonelUri(SESSION, '/tmp/Widget.st');

    expect(outcome.cancelled).toBe(true);
  });

  it('is not cancelled when the class needs no prompt at all', async () => {
    vi.mocked(queries.dictionariesContainingClass).mockReturnValue(['UserGlobals']);

    const outcome = await fileInTonelUri(SESSION, '/tmp/Widget.st');

    expect(outcome.cancelled).toBe(false);
    expect(outcome.skipped).toEqual([]);
  });
});
