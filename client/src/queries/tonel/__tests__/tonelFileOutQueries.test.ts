// SUPPORTED CONFIGURATION: GemStone 3.7.5+ on a rowan3 extent — see
// `../tonelCapability` for the full statement.
//
// Unit tests for the Tonel class file-out query. These pin the parts of the
// emitted Smalltalk that are load-bearing — which selectors are sent, in what
// order, and which branch is NOT taken — not its whitespace.
//
// Two cases here encode decisions that cost real measurement to reach, and both
// would look like harmless "simplifications" to a future reader:
//   * `populates every live selector` / `takes no loaded-vs-unloaded branch`
//   * `sets methodSortBlock before writing anything`
// See their comments before changing either.
import { describe, it, expect, vi } from 'vitest';

import { fileOutClassTonel, isTonelFileOutError, TONEL_NO_ROWAN } from '../fileOutClassTonel';

const exec = (result = 'Class { }') => vi.fn().mockReturnValue(result);
const codeOf = (fn: ReturnType<typeof exec>): string => fn.mock.calls[0][0] as string;

const codeFor = (className = 'Animal', dict?: number | string): string => {
  const e = exec();
  fileOutClassTonel(e, className, dict);
  return codeOf(e);
};

describe('fileOutClassTonel', () => {
  it('resolves the class in the named dictionary', () => {
    expect(codeFor('Animal', 3)).toContain(
      "(System myUserProfile symbolList at: 3) at: #'Animal' ifAbsent: [nil]",
    );
  });

  it('resolves the Rowan classes through the reach-through, not the symbol list', () => {
    // DataCurator cannot see RowanKernel/RowanTools; the feature is required to
    // work for DataCurator anyway. See ../rowanLookup.
    const code = codeFor();
    expect(code).toContain('rwLookup :=');
    expect(code).toContain("rwLookup value: #'RwModificationTonelWriterVisitorV2'");
    expect(code).toContain("rwLookup value: #'RwMethodDefinition'");
  });

  it('sets methodSortBlock before writing anything', () => {
    // `methodSortBlock` lazily reads `currentProjectDefinition methodSortOrder`,
    // which is nil on a visitor we built ourselves — so the writer
    // doesNotUnderstand the first time it sorts methods unless this is set
    // first. Ordering, not mere presence, is the property.
    const code = codeFor();
    const sortBlock = code.indexOf('methodSortBlock:');
    const firstWrite = code.indexOf('_writeClassDefinition:');
    expect(sortBlock).toBeGreaterThanOrEqual(0);
    expect(firstWrite).toBeGreaterThan(sortBlock);
  });

  it('sorts methods the way the reference corpus is sorted', () => {
    // Which comparator is used is a real, observable decision, not a detail:
    // measured on a rowan3 stone, `_unicodeLessThan:` and `codePointCompareTo:`
    // produce DIFFERENT method orders for 164 of 776 classes. `Message` is one —
    // the corpus emits `sends:` before `sendTo:`, codepoint order is the reverse.
    //
    // These files go into git, so order is not cosmetic: a different order makes
    // every later diff noise. The reference corpus is the authority, and the
    // method-order oracle in the integration suite is what actually checks it —
    // this case only pins the choice so switching it is a visible edit.
    const code = codeFor();
    expect(code).toContain('_unicodeLessThan:');
    expect(code).not.toContain('codePointCompareTo:');
  });

  it('writes the definition, then the class side, then the instance side', () => {
    // The order Rowan's own `processClass:` uses. The reference corpus is
    // byte-identical only in this order.
    const code = codeFor();
    const defn = code.indexOf('_writeClassDefinition:');
    const classSide = code.indexOf('_writeClassSideMethodDefinitions:');
    const instSide = code.indexOf('_writeInstanceSideMethodDefinitions:');
    expect(defn).toBeLessThan(classSide);
    expect(classSide).toBeLessThan(instSide);
  });

  it('populates every live selector from both sides', () => {
    // A Jasper user sees every method on the class and has no notion of a Rowan
    // package, so the file carries every method — including the ones Rowan would
    // file into another package's .extension.st.
    const code = codeFor();
    expect(code).toContain('selectors do:');
    expect(code).toContain('addClassMethodDefinition:');
    expect(code).toContain('addInstanceMethodDefinition:');
    expect(code).toContain('newForSelector:');
  });

  it('excludes methods a trait provides', () => {
    // Traits are not a supported Jasper feature, so a trait's methods are not the
    // class's own code and do not belong in its file. Without this, a class using
    // a trait would export methods it does not define — and adding a trait would
    // rewrite its whole file.
    const code = codeFor();
    expect(code).toContain('isFromTrait');
  });

  it('takes no loaded-vs-unloaded branch', () => {
    // Populating ALWAYS is the whole design. Measured against the 649-class
    // reference corpus: populate-always keeps every shipped method verbatim and
    // adds 13,400 the user can see; branching on `loadedClassForClass:` would
    // silently drop every method of any class Rowan has not loaded — which is
    // most classes a developer files out.
    expect(codeFor()).not.toContain('loadedClassForClass:');
  });

  it('never leaves the category nil', () => {
    // `rwClassDefinitionInSymbolDictionaryNamed:` answers `#category : nil` for a
    // class with no class category, which is not valid Tonel and will not read
    // back in.
    expect(codeFor()).toContain('category:');
  });

  it('escapes a class name containing a quote', () => {
    expect(codeFor("Od'd")).toContain("Od''d");
  });

  it('answers the no-rowan sentinel rather than raising', () => {
    expect(codeFor()).toContain(TONEL_NO_ROWAN);
    expect(fileOutClassTonel(exec(TONEL_NO_ROWAN), 'Animal')).toBe(TONEL_NO_ROWAN);
    expect(isTonelFileOutError(TONEL_NO_ROWAN)).toBe(true);
  });

  it('answers an error sentinel rather than raising', () => {
    const code = codeFor();
    expect(code).toContain('on: Error do:');
    expect(isTonelFileOutError('!ERR something went wrong')).toBe(true);
  });

  it('does not mistake real Tonel output for an error', () => {
    // A class file starts with `Class {` or with its comment — never with `!`.
    expect(isTonelFileOutError("Class {\n\t#name : 'Animal'\n}\n")).toBe(false);
    expect(isTonelFileOutError('"\nA comment.\n"\nClass {\n}\n')).toBe(false);
  });
});
