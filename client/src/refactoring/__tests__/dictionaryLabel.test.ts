import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

vi.mock('../../browserQueries', () => ({
  getDictionaryNames: vi.fn(),
}));

import * as queries from '../../browserQueries';
import { dictionaryNameFor, dictionaryNameLookup, qualifiedClassName } from '../dictionaryLabel';
import { ambiguousClassNames, classNameForRow } from '../qualifiedClassName';
import type { ActiveSession } from '../../sessionManager';

const session = {} as ActiveSession;

// A class name does not identify a class -- the same name can be bound in several dictionaries,
// and a refactoring acts on exactly one. These name the dictionary in the text the user reads
// afterwards, which is the last place a refactoring that went somewhere unintended is catchable
// (#396).
describe('dictionaryNameLookup', () => {
  it('reads the symbol list once, however many indexes it names', () => {
    vi.mocked(queries.getDictionaryNames).mockClear();
    vi.mocked(queries.getDictionaryNames).mockReturnValue(['UserGlobals', 'Globals']);
    const nameOf = dictionaryNameLookup(session);

    expect([1, 2, 1, 2].map(nameOf)).toEqual(['UserGlobals', 'Globals', 'UserGlobals', 'Globals']);
    expect(queries.getDictionaryNames).toHaveBeenCalledTimes(1);
  });

  it('answers a name as itself and no dictionary as no name', () => {
    vi.mocked(queries.getDictionaryNames).mockReturnValue(['UserGlobals', 'Globals']);
    const nameOf = dictionaryNameLookup(session);

    expect(nameOf('DictionaryB')).toBe('DictionaryB');
    expect(nameOf(undefined)).toBeUndefined();
    expect(nameOf('')).toBeUndefined();
  });

  it('answers no name, and keeps answering it, when the symbol list cannot be read', () => {
    vi.mocked(queries.getDictionaryNames).mockClear();
    vi.mocked(queries.getDictionaryNames).mockImplementation(() => {
      throw new Error('no session');
    });
    const nameOf = dictionaryNameLookup(session);

    expect(nameOf(1)).toBeUndefined();
    expect(nameOf(2)).toBeUndefined();
    expect(queries.getDictionaryNames).toHaveBeenCalledTimes(1);
    vi.mocked(queries.getDictionaryNames).mockReset();
  });
});

describe('dictionaryNameFor', () => {
  it('resolves a 1-based SymbolList index to its dictionary name', () => {
    vi.mocked(queries.getDictionaryNames).mockReturnValue([
      'UserGlobals',
      'Globals',
      'DictionaryB',
    ]);

    expect(dictionaryNameFor(session, 3)).toBe('DictionaryB');
  });

  it('passes a name straight through without a round trip', () => {
    vi.mocked(queries.getDictionaryNames).mockClear();

    expect(dictionaryNameFor(session, 'DictionaryB')).toBe('DictionaryB');
    expect(queries.getDictionaryNames).not.toHaveBeenCalled();
  });

  it('answers undefined for no reference at all', () => {
    expect(dictionaryNameFor(session, undefined)).toBeUndefined();
  });

  it('answers undefined for an index past the end of the symbol list', () => {
    vi.mocked(queries.getDictionaryNames).mockReturnValue(['UserGlobals']);

    expect(dictionaryNameFor(session, 9)).toBeUndefined();
  });

  it('answers undefined rather than throwing when the query fails', () => {
    vi.mocked(queries.getDictionaryNames).mockImplementation(() => {
      throw new Error('session gone');
    });

    expect(dictionaryNameFor(session, 2)).toBeUndefined();
  });
});

describe('qualifiedClassName', () => {
  it('names the dictionary alongside the class', () => {
    expect(qualifiedClassName('Shadowed', 'DictionaryB')).toBe('Shadowed (DictionaryB)');
  });

  it('leaves the class name alone when the dictionary is unknown', () => {
    // Less specific beats wrong: a label naming the wrong dictionary is worse than none.
    expect(qualifiedClassName('Shadowed', undefined)).toBe('Shadowed');
  });
});

describe('telling apart preview rows that name the same class', () => {
  const change = (className: string, dictName: string | null) => ({ className, dictName });

  it('marks a name two dictionaries claim', () => {
    const ambiguous = ambiguousClassNames([
      change('Shadowed', 'DictionaryA'),
      change('Shadowed', 'DictionaryB'),
      change('Account', 'DictionaryA'),
    ]);
    expect([...ambiguous]).toEqual(['Shadowed']);
  });

  it('leaves a name alone when every row means the same class', () => {
    const ambiguous = ambiguousClassNames([
      change('Shadowed', 'DictionaryA'),
      change('Shadowed', 'DictionaryA'),
    ]);
    expect(ambiguous.size).toBe(0);
  });

  it('treats a row with no dictionary as its own claim', () => {
    // "somewhere unstated" is not the same place as a named dictionary, and a row that cannot
    // say where it lands is exactly one worth marking.
    const ambiguous = ambiguousClassNames([
      change('Shadowed', 'DictionaryA'),
      change('Shadowed', null),
    ]);
    expect(ambiguous.has('Shadowed')).toBe(true);
  });

  it('qualifies only the ambiguous rows', () => {
    const ambiguous = new Set(['Shadowed']);
    expect(classNameForRow('Shadowed', 'DictionaryB', ambiguous)).toBe('Shadowed (DictionaryB)');
    expect(classNameForRow('Account', 'DictionaryA', ambiguous)).toBe('Account');
  });

  it('leaves an ambiguous row with no dictionary unqualified rather than inventing one', () => {
    expect(classNameForRow('Shadowed', null, new Set(['Shadowed']))).toBe('Shadowed');
  });

  it('qualifies nothing when no set is given', () => {
    expect(classNameForRow('Shadowed', 'DictionaryB', undefined)).toBe('Shadowed');
  });
});
