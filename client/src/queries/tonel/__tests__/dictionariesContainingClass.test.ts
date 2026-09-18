// SUPPORTED CONFIGURATION: GemStone 3.7.5+ on a rowan3 extent — see
// `../tonelCapability` for the full statement.
//
// Which dictionaries hold a given name. File-in needs this twice: to default the
// target dictionary to the one the class already lives in, and to tell whether a
// superclass resolves at all before creating anything.
import { describe, it, expect, vi } from 'vitest';

import { dictionariesContainingClass } from '../dictionariesContainingClass';

const exec = (result = '') => vi.fn().mockReturnValue(result);
const codeOf = (fn: ReturnType<typeof exec>): string => fn.mock.calls[0][0] as string;

describe('dictionariesContainingClass', () => {
  it('walks the session symbol list in order', () => {
    // Order matters: the first match is what an unqualified name binds to, so a
    // caller choosing a default must see them in the same order the image does.
    const code = codeOf(
      (() => {
        const e = exec();
        dictionariesContainingClass(e, 'Animal');
        return e;
      })(),
    );
    expect(code).toContain('System myUserProfile symbolList do:');
    expect(code).toContain("at: #'Animal' ifAbsent: [nil]");
  });

  it('answers the dictionary names', () => {
    expect(dictionariesContainingClass(exec('UserGlobals\nGlobals\n'), 'Animal')).toEqual([
      'UserGlobals',
      'Globals',
    ]);
  });

  it('answers empty when the name resolves nowhere', () => {
    expect(dictionariesContainingClass(exec(''), 'Nope')).toEqual([]);
  });

  it('ignores blank lines in the answer', () => {
    expect(dictionariesContainingClass(exec('\nUserGlobals\n\n'), 'Animal')).toEqual([
      'UserGlobals',
    ]);
  });

  it('escapes a name containing a quote', () => {
    const e = exec();
    dictionariesContainingClass(e, "Od'd");
    expect(codeOf(e)).toContain("Od''d");
  });

  it('only counts entries that are actually classes', () => {
    // A SymbolDictionary can hold anything. Binding a global that happens to share
    // the class's name would otherwise look like the class living there.
    expect(
      codeOf(
        (() => {
          const e = exec();
          dictionariesContainingClass(e, 'Animal');
          return e;
        })(),
      ),
    ).toContain('isBehavior');
  });
});
